import type {
  AutomationsReading,
  AutomationsSource,
  InstanceLock,
  PolicyProblem,
  PolicySource,
} from "~/Automations/Application/AutomationsPorts.ts";
import { Resume } from "~/Automations/Application/Resume.ts";
import { RunPass } from "~/Automations/Application/RunPass.ts";
import { RunTick } from "~/Automations/Application/RunTick.ts";
import { freshContext, StartProject } from "~/Automations/Application/StartProject.ts";
import { Status } from "~/Automations/Application/Status.ts";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { Automations } from "~/Automations/Domain/Automations.ts";
import type { Finding } from "~/Automations/Domain/ConsumedInput.ts";
import type { TickTrigger } from "~/Automations/Domain/Event.ts";
import { automationName, commitId, revision, subjectId } from "~/Automations/Domain/Ids.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { Policy, type PolicyFields } from "~/Automations/Domain/Policy.ts";
import { FakeHarness } from "~/Automations/Infrastructure/FakeHarness.ts";
import { InMemoryEventLog } from "~/Automations/Infrastructure/InMemoryEventLog.ts";
import { InMemoryTracker } from "~/Automations/Infrastructure/InMemoryTracker.ts";
import { ManualClock } from "~/Shared/Clock.ts";

/** Builders with sensible defaults — override per test (quickstart). */

export function validPolicy(overrides: Partial<PolicyFields> = {}): Policy {
  return new Policy({
    repository: "dazz/foo",
    forge: "github.com",
    checkout: "/home/dazz/checkouts/foo",
    tick: IsoDuration.parse("PT15M", "policy.tick"),
    limits: { turns: 50, time: IsoDuration.parse("PT20M", "policy.limits.time") },
    ...overrides,
  });
}

export function invalidPolicy(
  problem = "policy.limitz: unknown key — did you mean limits?",
): PolicyProblem {
  return { problem, missing: false };
}

export function missingPolicy(): PolicyProblem {
  return { problem: "no policy file", missing: true };
}

/** The two automations of `contracts/examples/automations.yml`, reacting first. */
export function validAutomations(commit = "c1"): AutomationsReading {
  return {
    automations: Automations.of(
      [
        new Automation(automationName("pull-request-reactor"), "react-to-reviews"),
        new Automation(automationName("board-walker"), "walk-the-board"),
      ],
      commitId(commit),
    ),
  };
}

export function invalidAutomations(
  commit: string,
  problem = "automationz: unknown key — did you mean automations?",
): AutomationsReading {
  return { problem, commit: commitId(commit) };
}

/** The never-valid case: invalid from the first commit on (FR-013). */
export function neverValid(): AutomationsReading {
  return invalidAutomations("c1");
}

export function finding(subject: string, rev: string): Finding {
  return { subject: subjectId(subject), revision: revision(rev) };
}

/** In-memory port fakes — adapters for the test composition only. */

export class InMemoryPolicySource implements PolicySource {
  reads = 0;

  constructor(private reading: Policy | PolicyProblem) {}

  set(reading: Policy | PolicyProblem): void {
    this.reading = reading;
  }

  read(): Promise<Policy | PolicyProblem> {
    this.reads += 1;
    return Promise.resolve(this.reading);
  }
}

export class InMemoryAutomationsSource implements AutomationsSource {
  constructor(private reading: AutomationsReading) {}

  /** Moves the default branch head — scenario 3's fixture. */
  advanceTo(reading: AutomationsReading): void {
    this.reading = reading;
  }

  read(): Promise<AutomationsReading> {
    return Promise.resolve(this.reading);
  }
}

export class FakeInstanceLock implements InstanceLock {
  private held = false;

  acquire(): Promise<boolean> {
    if (this.held) return Promise.resolve(false);
    this.held = true;
    return Promise.resolve(true);
  }

  isHeld(): boolean {
    return this.held;
  }

  /** What a process exit (or crash — flock dies with it) does. */
  release(): void {
    this.held = false;
  }
}

export interface TestProjectOptions {
  readonly policy?: Policy | PolicyProblem;
  readonly automations?: AutomationsReading;
  /** Share a log to "restart": re-compose over the same log (quickstart). */
  readonly log?: InMemoryEventLog;
  readonly clock?: ManualClock;
}

/** One fixture assembles the system; no per-test hand-wiring (quickstart). */
export function composeTestProject(options: TestProjectOptions = {}) {
  const policy = options.policy ?? validPolicy();
  const log = options.log ?? new InMemoryEventLog();
  const clock = options.clock ?? new ManualClock(new Date("2026-10-31T12:00:00.000Z"));
  const harness = new FakeHarness();
  const tracker = new InMemoryTracker();
  const policySource = new InMemoryPolicySource(policy);
  const automationsSource = new InMemoryAutomationsSource(
    options.automations ?? validAutomations(),
  );
  const lock = new FakeInstanceLock();

  const context = freshContext();
  // A valid policy is pre-loaded so a test may tick without start();
  // start()/resume() overwrite it from the PolicySource as in production.
  if (policy instanceof Policy) context.policy = policy;

  const runPass = new RunPass({ tracker, harness, log, clock }, context);
  const runTick = new RunTick({ automationsSource, log, clock }, context, runPass);
  const startProject = new StartProject({ lock, log, policySource, clock }, context);
  const resumeProject = new Resume({ policySource, log, clock }, context);
  const statusQuery = new Status({ log, lock, policySource });

  return {
    context,
    harness,
    tracker,
    log,
    clock,
    policySource,
    automationsSource,
    lock,
    tick: (trigger: TickTrigger = "schedule") => runTick.run(trigger),
    start: () => startProject.run(),
    resume: () => resumeProject.run(),
    status: () => statusQuery.run(),
  };
}

/** Lets queued microtasks and timers run — until a hanging session is reached, for example. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
