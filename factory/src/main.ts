import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@cliffy/command";
import type { AutomationsSource } from "~/Automations/Application/AutomationsPorts.ts";
import { RecordHeartbeat } from "~/Automations/Application/RecordHeartbeat.ts";
import { RequestResume } from "~/Automations/Application/RequestResume.ts";
import { RequestTick } from "~/Automations/Application/RequestTick.ts";
import { Resume } from "~/Automations/Application/Resume.ts";
import { RunPass } from "~/Automations/Application/RunPass.ts";
import { RunProject } from "~/Automations/Application/RunProject.ts";
import { RunTick } from "~/Automations/Application/RunTick.ts";
import { freshContext, StartProject } from "~/Automations/Application/StartProject.ts";
import { Status } from "~/Automations/Application/Status.ts";
import { FakeHarness } from "~/Automations/Infrastructure/FakeHarness.ts";
import { FlockInstanceLock } from "~/Automations/Infrastructure/FlockInstanceLock.ts";
import { GitAutomationsSource } from "~/Automations/Infrastructure/GitAutomationsSource.ts";
import { InMemoryTracker } from "~/Automations/Infrastructure/InMemoryTracker.ts";
import { JsonlEventLog } from "~/Automations/Infrastructure/JsonlEventLog.ts";
import { SignalControlChannel } from "~/Automations/Infrastructure/SignalControlChannel.ts";
import { TimerScheduler } from "~/Automations/Infrastructure/TimerScheduler.ts";
import { YamlPolicy } from "~/Automations/Infrastructure/YamlPolicy.ts";
import {
  type Assembly,
  automationsCommands,
  type RootOptions,
} from "~/Automations/UI/AutomationsRoute.ts";
import { BunProcessRunner } from "~/Process/BunProcessRunner.ts";
import { SystemClock } from "~/Shared/Clock.ts";

const VERSION = "0.1.0";

export interface Roots {
  readonly configDir: string;
  readonly stateDir: string;
}

/** Flag, then env var, then the XDG default (contracts/cli.md). */
export function resolveRoots(options: RootOptions): Roots {
  return {
    configDir:
      options.configDir ?? process.env.FACTORY_CONFIG_DIR ?? join(homedir(), ".config/factory"),
    stateDir:
      options.stateDir ?? process.env.FACTORY_STATE_DIR ?? join(homedir(), ".local/state/factory"),
  };
}

/**
 * The composition root: one project's hexagon from the real adapters. It
 * spawns nothing itself — processes go through the ProcessRunner adapter.
 * The harness is the shipped fake and the tracker an empty stub until
 * 002/003; the loop, the log and the container are real from this slice on.
 */
function composeProject(project: string, options: RootOptions): Assembly {
  const roots = resolveRoots(options);
  const context = freshContext();
  const clock = new SystemClock();
  const log = new JsonlEventLog(
    join(roots.stateDir, "events", `${project}.jsonl`),
    project,
    () => context.policy?.forge,
  );
  const policySource = new YamlPolicy(join(roots.configDir, `${project}.yaml`));
  const lock = new FlockInstanceLock(join(roots.stateDir, "projects", project, "factory.pid"));
  const scheduler = new TimerScheduler();
  const control = new SignalControlChannel();
  const runner = new BunProcessRunner();
  const automationsSource: AutomationsSource = {
    // The checkout comes from the policy, which is in effect only after
    // PolicyLoaded — and a paused project skips its ticks before any read.
    read: () => {
      const checkout = context.policy?.checkout;
      if (checkout === undefined) {
        throw new Error("no policy in effect — nothing to read automations from");
      }
      return new GitAutomationsSource(checkout, runner).read();
    },
  };
  const harness = new FakeHarness();
  const tracker = new InMemoryTracker();
  const runPass = new RunPass({ tracker, harness, log, clock }, context);
  const runTick = new RunTick({ automationsSource, log, clock }, context, runPass);
  const startProject = new StartProject({ lock, log, policySource, clock }, context);
  const resumeProject = new Resume({ policySource, log, clock }, context);
  const statusQuery = new Status({ log, lock, policySource });
  const heartbeat = new RecordHeartbeat({ log, clock }, context);
  const runProject = new RunProject({ scheduler, control }, context, {
    start: startProject,
    tick: runTick,
    resume: resumeProject,
    heartbeat,
  });
  const requestTick = new RequestTick({ lock, control }, { start: startProject, tick: runTick });
  const requestResume = new RequestResume(
    { lock, control, scheduler },
    { start: startProject, resume: resumeProject, status: statusQuery },
  );
  return {
    run: () => runProject.run(),
    tick: () => requestTick.run(),
    resume: () => requestResume.run(),
    status: () => statusQuery.run(),
  };
}

export function cli(): Command {
  const root = new Command()
    .name("factory")
    .version(VERSION)
    .description("The software factory: one project process per repository.")
    .action(function (this: Command) {
      this.showHelp();
    });
  return automationsCommands(root, composeProject);
}

if (import.meta.main) {
  await cli().parse();
}
