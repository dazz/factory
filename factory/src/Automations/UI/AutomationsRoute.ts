import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@cliffy/command";
import type {
  ControlChannel,
  EventLog,
  Scheduler,
} from "~/Automations/Application/AutomationsPorts.ts";
import {
  EventLogUnwritable,
  HEARTBEAT_INTERVAL,
} from "~/Automations/Application/AutomationsPorts.ts";
import type { ResumeResult } from "~/Automations/Application/Resume.ts";
import type { ProjectContext, StartResult } from "~/Automations/Application/StartProject.ts";
import type { StatusResult } from "~/Automations/Application/Status.ts";
import type { Event, TickTrigger } from "~/Automations/Domain/Event.ts";
import { DEFAULT_TICK } from "~/Automations/Domain/Policy.ts";
import type { Clock } from "~/Shared/Clock.ts";

/** Exit codes (contracts/cli.md). */
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_UNKNOWN_PROJECT = 69;
const EXIT_LOG_UNWRITABLE = 74;
const EXIT_LOCK_HELD = 75;

const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;
const UNKNOWN_PROJECT = "project unknown: no policy file and no event log";

/** Status output: label column width of the contracts/cli.md example. */
const STATUS_LABEL_WIDTH = 15;

/** The pidfile may be empty for an instant (between lock acquisition and the PID write). */
const PID_READ_WINDOW_MS = 1_000;
const PID_READ_EVERY_MS = 50;
/** `resume` polls the log briefly for the running process's result event. */
const RESUME_POLL_WINDOW_MS = 2_000;
const RESUME_POLL_EVERY_MS = 200;

export interface Roots {
  readonly configDir: string;
  readonly stateDir: string;
}

/** What one project's wiring hands the flows — main builds it from the real adapters. */
export interface Assembly {
  readonly context: ProjectContext;
  start(): Promise<StartResult>;
  tick(trigger: TickTrigger): Promise<void>;
  resume(): Promise<ResumeResult>;
  status(): Promise<StatusResult>;
  /** Non-blocking lock probe: is a project process alive? */
  probe(): boolean;
  readonly scheduler: Scheduler;
  readonly control: ControlChannel;
  readonly log: EventLog;
  readonly clock: Clock;
  pidfile: string;
  kill: (pid: number, signal: "SIGHUP" | "SIGUSR1") => void;
}

export type Compose = (project: string, roots: Roots) => Assembly;
export type Print = (line: string) => void;

/**
 * `factory start <project>`: the project process in the foreground
 * (supervisor-friendly). Start sequence, then scheduled ticks, the liveness
 * heartbeat (FR-028) and the signal handlers — until `shutdown` resolves
 * (SIGTERM) or an error ends the process (FR-053).
 */
export async function startFlow(
  a: Assembly,
  print: Print,
  shutdown: Promise<void>,
): Promise<number> {
  let started: StartResult;
  try {
    started = await a.start();
  } catch (error) {
    print(String(error));
    return exitCodeOf(error);
  }
  if (started.kind === "lock-held") {
    print("already running — the lock is held (exactly one process per project)");
    return EXIT_LOCK_HELD;
  }
  if (started.kind === "unknown-project") {
    print(UNKNOWN_PROJECT);
    return EXIT_UNKNOWN_PROJECT;
  }
  const pauseReason = a.context.project.pauseReason();
  print(pauseReason === undefined ? "started" : `started paused — ${pauseReason}`);

  // FR-053: a failed append in any scheduled or signalled work ends the
  // process instead of letting it act without a record.
  let crash!: (error: unknown) => void;
  const crashed = new Promise<never>((_, reject) => {
    crash = reject;
  });
  // Skipped ticks on a paused project run at the schema default (contracts/policy.md).
  const interval = a.context.policy?.tick ?? DEFAULT_TICK;
  const stopTicks = a.scheduler.start(interval, () => a.tick("schedule").catch(crash));
  const stopHeartbeat = a.scheduler.start(HEARTBEAT_INTERVAL, () => heartbeat(a).catch(crash));
  a.control.onTickNow(() => void a.tick("manual").catch(crash));
  a.control.onResume(() => void a.resume().catch(crash));
  try {
    await Promise.race([shutdown, crashed]);
    return EXIT_OK;
  } catch (error) {
    print(String(error));
    return exitCodeOf(error);
  } finally {
    stopTicks();
    stopHeartbeat();
  }
}

/** In every state, also mid-session — the append queue serializes it (FR-028). */
async function heartbeat(a: Assembly): Promise<void> {
  const beat: Event = { name: "HeartbeatRecorded", at: a.clock.now() };
  await a.log.append(beat);
  a.context.project.apply(beat);
}

/**
 * `factory tick <project>`: nudge the running process (SIGUSR1), or run a
 * one-shot process generation — the full start sequence, then exactly one
 * tick (contracts/cli.md).
 */
export async function tickFlow(a: Assembly, print: Print): Promise<number> {
  try {
    if (a.probe()) return await nudge(a, "SIGUSR1", print);
    const started = await a.start();
    if (started.kind === "unknown-project") {
      print(UNKNOWN_PROJECT);
      return EXIT_UNKNOWN_PROJECT;
    }
    // Someone started the project between the probe and the lock: nudge it.
    if (started.kind === "lock-held") return await nudge(a, "SIGUSR1", print);
    await a.tick("manual");
    print("tick ran — outcome in the event log (factory status)");
    return EXIT_OK;
  } catch (error) {
    print(String(error));
    return exitCodeOf(error);
  }
}

/**
 * `factory resume <project>`: SIGHUP to the running process, then poll the
 * status query briefly for the result; or a one-shot generation that resumes
 * itself (contracts/cli.md).
 */
export async function resumeFlow(a: Assembly, print: Print): Promise<number> {
  try {
    if (a.probe()) return await resumeRunning(a, print);
    const started = await a.start();
    if (started.kind === "unknown-project") {
      print(UNKNOWN_PROJECT);
      return EXIT_UNKNOWN_PROJECT;
    }
    if (started.kind === "lock-held") return await resumeRunning(a, print);
    const result = await a.resume();
    print(resumeNotice(result));
    return EXIT_OK;
  } catch (error) {
    print(String(error));
    return exitCodeOf(error);
  }
}

async function resumeRunning(a: Assembly, print: Print): Promise<number> {
  const before = await a.status();
  if (before.kind === "unknown-project") {
    print(UNKNOWN_PROJECT);
    return EXIT_UNKNOWN_PROJECT;
  }
  const pid = await readPid(a.pidfile);
  if (pid === undefined) {
    print("running, but the pidfile holds no PID yet — try again");
    return EXIT_ERROR;
  }
  a.kill(pid, "SIGHUP");
  if (before.state !== "paused") {
    // The process appends ResumeIgnored; nothing will change (FR-051).
    print("not paused");
    return EXIT_OK;
  }
  const deadline = Date.now() + RESUME_POLL_WINDOW_MS;
  while (Date.now() < deadline) {
    await sleep(RESUME_POLL_EVERY_MS);
    const now = await a.status();
    if (now.kind !== "report") continue;
    if (now.state !== "paused") {
      print("resumed");
      return EXIT_OK;
    }
    if (now.pauseReason !== before.pauseReason) {
      print(`still paused: ${now.pauseReason}`);
      return EXIT_OK;
    }
  }
  print("resume requested — SIGHUP sent; result not yet in the log (factory status)");
  return EXIT_OK;
}

function resumeNotice(result: ResumeResult): string {
  switch (result.kind) {
    case "resumed":
      return "resumed";
    case "failed":
      return `still paused: ${result.reason}`;
    case "ignored":
      return "not paused";
  }
}

/** `factory status <project>`: read-only — replay + lock probe, never the JSONL itself. */
export async function statusFlow(a: Assembly, project: string, print: Print): Promise<number> {
  const result = await a.status();
  if (result.kind === "unknown-project") {
    print(UNKNOWN_PROJECT);
    return EXIT_UNKNOWN_PROJECT;
  }
  const line = (label: string, value: string) =>
    print(`${`${label}:`.padEnd(STATUS_LABEL_WIDTH)}${value}`);
  line("project", project);
  line(
    "state",
    result.state === "paused" ? `paused — ${result.pauseReason ?? "unknown"}` : result.state,
  );
  line(
    "process",
    result.processAlive
      ? "running"
      : result.openSession === undefined
        ? "not running"
        : "not running (open session will be aborted at next start)",
  );
  line(
    "last tick",
    result.lastTick === undefined
      ? "never"
      : `${result.lastTick.toISOString()}${
          result.lastTickSkipped === undefined ? "" : ` (skipped — ${result.lastTickSkipped})`
        }`,
  );
  line(
    "last session",
    result.lastSession === undefined
      ? "none yet"
      : `${result.lastSession.automation} → ${result.lastSession.outcome} (${result.lastSession.at.toISOString()})`,
  );
  if (result.lastError !== undefined) line("last error", result.lastError);
  return EXIT_OK;
}

async function nudge(a: Assembly, signal: "SIGHUP" | "SIGUSR1", print: Print): Promise<number> {
  const pid = await readPid(a.pidfile);
  if (pid === undefined) {
    print("running, but the pidfile holds no PID yet — try again");
    return EXIT_ERROR;
  }
  a.kill(pid, signal);
  print(`tick requested — ${signal} sent to ${pid}; outcome in the event log (factory status)`);
  return EXIT_OK;
}

/** The PID write happens right after lock acquisition — retry the brief gap. */
async function readPid(pidfile: string): Promise<number | undefined> {
  const deadline = Date.now() + PID_READ_WINDOW_MS;
  for (;;) {
    try {
      const pid = Number.parseInt(await readFile(pidfile, "utf8"), 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // not written yet
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(PID_READ_EVERY_MS);
  }
}

function exitCodeOf(error: unknown): number {
  return error instanceof EventLogUnwritable ? EXIT_LOG_UNWRITABLE : EXIT_ERROR;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** `--config-dir`/`--state-dir`, their env vars, then the XDG defaults (contracts/cli.md). */
export function resolveRoots(options: { configDir?: string; stateDir?: string }): Roots {
  return {
    configDir:
      options.configDir ?? process.env.FACTORY_CONFIG_DIR ?? join(homedir(), ".config/factory"),
    stateDir:
      options.stateDir ?? process.env.FACTORY_STATE_DIR ?? join(homedir(), ".local/state/factory"),
  };
}

type ProjectAction = (assembly: Assembly, project: string) => Promise<number>;

function projectCommand(description: string, compose: Compose, action: ProjectAction) {
  // Return type inferred: cliffy's generics track options and arguments.
  return new Command()
    .description(description)
    .arguments("<project:string>")
    .option("--config-dir <path:string>", "Root of the policy files (FACTORY_CONFIG_DIR).")
    .option(
      "--state-dir <path:string>",
      "Root of event logs and project state (FACTORY_STATE_DIR).",
    )
    .action(async (options, project: string) => {
      if (!PROJECT_ID.test(project)) {
        console.error(`not a project ID: ${JSON.stringify(project)} — expected owner/repo`);
        process.exit(2);
      }
      const assembly = compose(project, resolveRoots(options));
      process.exit(await action(assembly, project));
    });
}

/** The four commands of contracts/cli.md, wired onto the root command. */
export function automationsCommands(root: Command, compose: Compose): Command {
  // The chain re-types with every subcommand; the root reference stays the root.
  root
    .command(
      "start",
      projectCommand("Run the project process in the foreground.", compose, (assembly) =>
        startFlow(assembly, console.log, waitForSigterm()),
      ),
    )
    .command(
      "tick",
      projectCommand("Tick now: nudge the running process, or run one tick.", compose, (assembly) =>
        tickFlow(assembly, console.log),
      ),
    )
    .command(
      "resume",
      projectCommand("Lift a pause: re-read and re-validate the policy.", compose, (assembly) =>
        resumeFlow(assembly, console.log),
      ),
    )
    .command(
      "status",
      projectCommand(
        "Replayed state, lock probe, last tick and error.",
        compose,
        (assembly, project) => statusFlow(assembly, project, console.log),
      ),
    );
  return root;
}

function waitForSigterm(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve());
    process.once("SIGINT", () => resolve());
  });
}
