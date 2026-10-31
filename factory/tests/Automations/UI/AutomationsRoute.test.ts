import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ControlChannel,
  Scheduler,
  Stop,
} from "~/Automations/Application/AutomationsPorts.ts";
import { EventLogUnwritable } from "~/Automations/Application/AutomationsPorts.ts";
import type { Event } from "~/Automations/Domain/Event.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { hangUntilAborted } from "~/Automations/Infrastructure/FakeHarness.ts";
import { InMemoryEventLog } from "~/Automations/Infrastructure/InMemoryEventLog.ts";
import {
  type Assembly,
  resolveRoots,
  resumeFlow,
  startFlow,
  statusFlow,
  tickFlow,
} from "~/Automations/UI/AutomationsRoute.ts";
import {
  composeTestProject,
  finding,
  invalidPolicy,
  missingPolicy,
  settle,
  type TestProjectOptions,
  validPolicy,
} from "../../Composition.ts";

class FakeScheduler implements Scheduler {
  readonly jobs: Array<{ interval: IsoDuration; fire: () => Promise<void>; stopped: boolean }> = [];

  start(interval: IsoDuration, fire: () => Promise<void>): Stop {
    const job = { interval, fire, stopped: false };
    this.jobs.push(job);
    return () => {
      job.stopped = true;
    };
  }
}

class FakeControl implements ControlChannel {
  resume: (() => void) | undefined;
  tickNow: (() => void) | undefined;

  onResume(fn: () => void): void {
    this.resume = fn;
  }

  onTickNow(fn: () => void): void {
    this.tickNow = fn;
  }
}

class BreakableLog extends InMemoryEventLog {
  broken = false;

  override append(event: Event): Promise<void> {
    if (this.broken) {
      return Promise.reject(new EventLogUnwritable("event log unwritable: disk full"));
    }
    return super.append(event);
  }
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

async function pidfileWith(pid: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-route-"));
  tempDirs.push(dir);
  const path = join(dir, "factory.pid");
  await writeFile(path, `${pid}\n`);
  return path;
}

function assemble(options: TestProjectOptions = {}) {
  const project = composeTestProject(options);
  const scheduler = new FakeScheduler();
  const control = new FakeControl();
  const lines: string[] = [];
  const kills: Array<{ pid: number; signal: string }> = [];
  const assembly: Assembly = {
    context: project.context,
    start: project.start,
    tick: project.tick,
    resume: project.resume,
    status: project.status,
    probe: () => project.lock.isHeld(),
    scheduler,
    control,
    log: project.log,
    clock: project.clock,
    pidfile: "/nonexistent/factory.pid",
    kill: (pid, signal) => kills.push({ pid, signal }),
  };
  return {
    ...project,
    scheduler,
    control,
    assembly,
    lines,
    kills,
    print: (line: string) => lines.push(line),
  };
}

describe("startFlow", () => {
  test("start sequence, ticks at the policy interval, heartbeat, clean shutdown", async () => {
    const t = assemble({ policy: validPolicy({ tick: IsoDuration.parse("PT10M", "x") }) });
    let shutdown!: () => void;
    const until = new Promise<void>((resolve) => {
      shutdown = resolve;
    });

    const flow = startFlow(t.assembly, t.print, until);
    await settle();

    expect(t.lines).toEqual(["started"]);
    expect(t.log.names()).toEqual(["ProjectStarted", "PolicyLoaded"]);
    expect(t.scheduler.jobs.map((job) => job.interval.text)).toEqual(["PT10M", "PT5M"]);

    await t.scheduler.jobs[1]?.fire(); // the liveness heartbeat (FR-028)
    expect(t.log.names().at(-1)).toBe("HeartbeatRecorded");

    await t.scheduler.jobs[0]?.fire(); // a due tick drains
    expect(t.log.names().at(-1)).toBe("ProjectIdled");

    t.control.tickNow?.(); // SIGUSR1 → one manual tick
    await settle();
    expect(t.log.names().at(-1)).toBe("ProjectIdled");

    shutdown();
    expect(await flow).toBe(0);
    expect(t.scheduler.jobs.every((job) => job.stopped)).toBe(true);
  });

  test("an invalid policy starts paused, ticking at the schema default", async () => {
    const t = assemble({ policy: invalidPolicy() });

    const flow = startFlow(t.assembly, t.print, Promise.resolve());

    expect(await flow).toBe(0);
    expect(t.lines[0]).toContain("started paused — policy.limitz");
    expect(t.scheduler.jobs[0]?.interval.text).toBe("PT15M");
  });

  test("a held lock refuses with 75, an unknown project with 69", async () => {
    const held = assemble();
    await held.lock.acquire();
    expect(await startFlow(held.assembly, held.print, Promise.resolve())).toBe(75);

    const unknown = assemble({ policy: missingPolicy() });
    expect(await startFlow(unknown.assembly, unknown.print, Promise.resolve())).toBe(69);
    expect(unknown.log.appended()).toEqual([]);
  });

  test("FR-053 — a failed append ends the process with 74 instead of acting on", async () => {
    const log = new BreakableLog();
    const t = assemble({ log });
    const never = new Promise<void>(() => {});

    const flow = startFlow(t.assembly, t.print, never);
    await settle();
    expect(t.lines).toEqual(["started"]);

    log.broken = true;
    await t.scheduler.jobs[0]?.fire(); // the scheduled tick hits the full disk

    expect(await flow).toBe(74);
    expect(t.lines.at(-1)).toContain("disk full");
    expect(t.scheduler.jobs.every((job) => job.stopped)).toBe(true);
  });
});

describe("tickFlow", () => {
  test("stopped project: a one-shot generation runs the full start sequence, then one tick", async () => {
    const t = assemble();

    expect(await tickFlow(t.assembly, t.print)).toBe(0);

    expect(t.log.names()).toEqual([
      "ProjectStarted",
      "PolicyLoaded",
      "AutomationsLoaded",
      "ProjectIdled",
    ]);
  });

  test("running project: SIGUSR1 to the PID from the pidfile", async () => {
    const t = assemble();
    await t.lock.acquire();
    t.assembly.pidfile = await pidfileWith("4242");

    expect(await tickFlow(t.assembly, t.print)).toBe(0);

    expect(t.kills).toEqual([{ pid: 4242, signal: "SIGUSR1" }]);
    expect(t.lines[0]).toContain("SIGUSR1 sent to 4242");
    expect(t.log.appended()).toEqual([]); // the running process writes, not the CLI
  });

  test("unknown project refuses with 69; a broken log ends with 74", async () => {
    const unknown = assemble({ policy: missingPolicy() });
    expect(await tickFlow(unknown.assembly, unknown.print)).toBe(69);

    const log = new BreakableLog();
    log.broken = true;
    const broken = assemble({ log });
    expect(await tickFlow(broken.assembly, broken.print)).toBe(74);
  });
});

describe("resumeFlow", () => {
  test("stopped + fixed policy: one-shot generation resumes — PolicyLoaded before ProjectResumed", async () => {
    const first = assemble({ policy: invalidPolicy() });
    await first.assembly.start();
    first.lock.release(); // the paused process stopped

    const second = assemble({ policy: invalidPolicy(), log: first.log });
    second.policySource.set(validPolicy());

    expect(await resumeFlow(second.assembly, second.print)).toBe(0);
    expect(second.lines).toEqual(["resumed"]);
    expect(second.log.names().slice(-2)).toEqual(["PolicyLoaded", "ProjectResumed"]);
  });

  test("running + paused: SIGHUP, then the result polled from the log", async () => {
    const t = assemble({ policy: invalidPolicy() });
    await t.assembly.start(); // paused, lock held
    t.assembly.pidfile = await pidfileWith("4242");
    t.policySource.set(validPolicy());
    t.assembly.kill = (pid, signal) => {
      t.kills.push({ pid, signal });
      void t.resume(); // what the running process does on SIGHUP
    };

    expect(await resumeFlow(t.assembly, t.print)).toBe(0);

    expect(t.kills).toEqual([{ pid: 4242, signal: "SIGHUP" }]);
    expect(t.lines).toEqual(["resumed"]);
  });

  test("running + not paused: SIGHUP sent, notice `not paused` (FR-051)", async () => {
    const t = assemble();
    await t.assembly.start();
    t.assembly.pidfile = await pidfileWith("4242");

    expect(await resumeFlow(t.assembly, t.print)).toBe(0);

    expect(t.lines).toEqual(["not paused"]);
    expect(t.kills).toEqual([{ pid: 4242, signal: "SIGHUP" }]);
  });
});

describe("statusFlow", () => {
  test("the paused report, formatted per contracts/cli.md", async () => {
    const t = assemble({ policy: invalidPolicy() });
    await t.assembly.start();
    await t.tick();

    expect(await statusFlow(t.assembly, "dazz/foo", t.print)).toBe(0);

    expect(t.lines[0]).toBe("project:       dazz/foo");
    expect(t.lines[1]).toContain("paused — policy.limitz");
    expect(t.lines[2]).toBe("process:       running");
    expect(t.lines[3]).toContain("(skipped — paused)");
    expect(t.lines[4]).toBe("last session:  none yet");
    expect(t.lines[5]).toContain("policy.limitz");
  });

  test("a dead session never shows running (FR-025)", async () => {
    const first = assemble();
    await first.assembly.start();
    first.harness.script("board-walker", hangUntilAborted());
    first.tracker.present("board-walker", finding("ticket-42", "r1"));
    first.tick();
    await settle();

    const second = assemble({ log: first.log }); // fresh lock: nobody holds it
    await statusFlow(second.assembly, "dazz/foo", second.print);

    expect(second.lines[1]).toBe("state:         idle");
    expect(second.lines[2]).toBe(
      "process:       not running (open session will be aborted at next start)",
    );
  });

  test("unknown project refuses with 69", async () => {
    const t = assemble({ policy: missingPolicy() });

    expect(await statusFlow(t.assembly, "dazz/foo", t.print)).toBe(69);
    expect(t.lines[0]).toContain("project unknown");
  });
});

describe("resolveRoots", () => {
  test("flag beats env beats the XDG default", () => {
    process.env.FACTORY_CONFIG_DIR = "/from/env/config";
    process.env.FACTORY_STATE_DIR = "/from/env/state";
    try {
      expect(resolveRoots({ configDir: "/from/flag" })).toEqual({
        configDir: "/from/flag",
        stateDir: "/from/env/state",
      });
    } finally {
      delete process.env.FACTORY_CONFIG_DIR;
      delete process.env.FACTORY_STATE_DIR;
    }
    const defaults = resolveRoots({});
    expect(defaults.configDir.endsWith(".config/factory")).toBe(true);
    expect(defaults.stateDir.endsWith(".local/state/factory")).toBe(true);
  });
});
