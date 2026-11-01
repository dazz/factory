import type {
  EventLog,
  InstanceLock,
  PolicySource,
} from "~/Automations/Application/AutomationsPorts.ts";
import type { Event } from "~/Automations/Domain/Event.ts";
import { Policy } from "~/Automations/Domain/Policy.ts";
import { Project } from "~/Automations/Domain/Project.ts";
import type { Clock } from "~/Shared/Clock.ts";

/**
 * What one process generation shares: the replayed project and the policy in
 * effect. `StartProject` fills it; tick, resume and the drain read and apply
 * through it. All of it is a deletable cache of the log (FR-044).
 */
export interface ProjectContext {
  project: Project;
  policy: Policy | undefined;
}

export function freshContext(): ProjectContext {
  return { project: new Project(), policy: undefined };
}

export type StartResult =
  /** Running — possibly paused (FR-051): the policy was unreadable or invalid. */
  | { readonly kind: "started" }
  /** Another process holds the lock (exit 75) — without s6 nothing restarts it, so this refuses late (FR-027). */
  | { readonly kind: "lock-held" }
  /** No policy file and no event log (exit 69): a typo'd project ID must not create ghost state. */
  | { readonly kind: "unknown-project" };

/**
 * The start sequence of **every** process generation, one-shots included
 * (data-model): lock → replay → `ProjectStarted` → `SessionAborted(orphaned)`
 * per open session → read policy → `PolicyLoaded` or `ProjectPaused`.
 * Execution order and event order are the same; lock and log need no path
 * from the policy.
 */
export class StartProject {
  constructor(
    private readonly ports: {
      readonly lock: InstanceLock;
      readonly log: EventLog;
      readonly policySource: PolicySource;
      readonly clock: Clock;
    },
    private readonly context: ProjectContext,
  ) {}

  async run(): Promise<StartResult> {
    const { lock, log, policySource, clock } = this.ports;
    if (!(await lock.acquire())) return { kind: "lock-held" };

    const project = new Project();
    let logExists = false;
    for await (const event of log.replay()) {
      logExists = true;
      project.apply(event);
    }
    this.context.project = project;

    // The unknown-project guard peeks at the policy before the first append —
    // refusing must not create the very log whose absence it checks.
    let reading = logExists ? undefined : await policySource.read();
    if (reading !== undefined && !(reading instanceof Policy) && reading.missing) {
      return { kind: "unknown-project" };
    }

    await this.record({ name: "ProjectStarted", at: clock.now() });

    const orphan = project.openSession();
    if (orphan !== undefined) {
      await this.record({
        name: "SessionAborted",
        at: clock.now(),
        automation: orphan.automation,
        subject: orphan.subject,
        sessionId: orphan.sessionId,
      });
    }

    reading ??= await policySource.read();
    if (reading instanceof Policy) {
      // In effect before its announcement, so the line itself carries the forge.
      this.context.policy = reading;
      await this.record({
        name: "PolicyLoaded",
        at: clock.now(),
        tick: reading.tick.text,
        limits: { turns: reading.limits.turns, time: reading.limits.time.text },
      });
    } else {
      // Unreadable and invalid both pause (contracts/policy.md); a replayed
      // pause stays paused regardless (FR-051) — only `resume` lifts it.
      await this.record({ name: "ProjectPaused", at: clock.now(), reason: reading.problem });
      this.context.policy = undefined;
    }
    return { kind: "started" };
  }

  private async record(event: Event): Promise<void> {
    await this.ports.log.append(event);
    this.context.project.apply(event);
  }
}
