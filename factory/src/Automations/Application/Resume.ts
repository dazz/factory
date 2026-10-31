import type { EventLog, PolicySource } from "~/Automations/Application/AutomationsPorts.ts";
import type { ProjectContext } from "~/Automations/Application/StartProject.ts";
import type { Event } from "~/Automations/Domain/Event.ts";
import { Policy } from "~/Automations/Domain/Policy.ts";
import type { Clock } from "~/Shared/Clock.ts";

export type ResumeResult =
  | { readonly kind: "resumed" }
  | { readonly kind: "failed"; readonly reason: string }
  /** Not paused — the policy is not even re-read (FR-051). */
  | { readonly kind: "ignored" };

/**
 * Resume from a pause: re-read and re-validate the policy — the only moment
 * besides start that reads it (FR-004). Valid → `PolicyLoaded` before
 * `ProjectResumed` (data-model); still broken → `ResumeFailed` with the new
 * reason and the pause stays.
 */
export class Resume {
  constructor(
    private readonly ports: {
      readonly policySource: PolicySource;
      readonly log: EventLog;
      readonly clock: Clock;
    },
    private readonly context: ProjectContext,
  ) {}

  async run(): Promise<ResumeResult> {
    const { policySource, clock } = this.ports;
    if (this.context.project.state() !== "paused") {
      await this.record({ name: "ResumeIgnored", at: clock.now() });
      return { kind: "ignored" };
    }

    const reading = await policySource.read();
    if (reading instanceof Policy) {
      await this.record({
        name: "PolicyLoaded",
        at: clock.now(),
        tick: reading.tick.text,
        limits: { turns: reading.limits.turns, time: reading.limits.time.text },
      });
      await this.record({ name: "ProjectResumed", at: clock.now() });
      this.context.policy = reading;
      return { kind: "resumed" };
    }
    await this.record({ name: "ResumeFailed", at: clock.now(), reason: reading.problem });
    return { kind: "failed", reason: reading.problem };
  }

  private async record(event: Event): Promise<void> {
    await this.ports.log.append(event);
    this.context.project.apply(event);
  }
}
