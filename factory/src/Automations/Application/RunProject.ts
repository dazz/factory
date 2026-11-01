import type {
  ControlChannel,
  Scheduler,
  Stop,
} from "~/Automations/Application/AutomationsPorts.ts";
import {
  HEARTBEAT_INTERVAL,
  type RecordHeartbeat,
} from "~/Automations/Application/RecordHeartbeat.ts";
import type { Resume } from "~/Automations/Application/Resume.ts";
import type { RunTick } from "~/Automations/Application/RunTick.ts";
import type { ProjectContext, StartProject } from "~/Automations/Application/StartProject.ts";
import { DEFAULT_TICK } from "~/Automations/Domain/Policy.ts";

export type RunHandle =
  /** Another process holds the lock (exit 75). */
  | { readonly kind: "lock-held" }
  /** No policy file and no event log (exit 69). */
  | { readonly kind: "unknown-project" }
  | {
      readonly kind: "started";
      /** Undefined, or why the project starts paused (FR-051) — for the UI's one line. */
      readonly pauseReason: string | undefined;
      /** Resolves on shutdown (SIGTERM/SIGINT), rejects on a failed append (FR-053). */
      readonly finished: Promise<void>;
    };

/**
 * `factory start` as one Application service: the start sequence, then
 * scheduled ticks, the liveness heartbeat (FR-028) and the control signals —
 * until shutdown or an error ends the process (FR-053). The UI calls it
 * once, prints the handle, and awaits `finished`.
 */
export class RunProject {
  constructor(
    private readonly ports: { readonly scheduler: Scheduler; readonly control: ControlChannel },
    private readonly context: ProjectContext,
    private readonly flows: {
      readonly start: StartProject;
      readonly tick: RunTick;
      readonly resume: Resume;
      readonly heartbeat: RecordHeartbeat;
    },
  ) {}

  async run(): Promise<RunHandle> {
    const started = await this.flows.start.run();
    if (started.kind !== "started") return started;

    const { scheduler, control } = this.ports;
    // FR-053: a failed append in any scheduled or signalled work ends the
    // process instead of letting it act without a record.
    let crash!: (error: unknown) => void;
    const crashed = new Promise<never>((_, reject) => {
      crash = reject;
    });
    const shutdown = new Promise<void>((resolve) => control.onShutdown(resolve));
    // Skipped ticks on a paused project run at the schema default (contracts/policy.md).
    const interval = this.context.policy?.tick ?? DEFAULT_TICK;
    const stops: Stop[] = [
      scheduler.start(interval, () => this.flows.tick.run("schedule").catch(crash)),
      scheduler.start(HEARTBEAT_INTERVAL, () => this.flows.heartbeat.run().catch(crash)),
    ];
    control.onTickNow(() => void this.flows.tick.run("manual").catch(crash));
    control.onResume(() => void this.flows.resume.run().catch(crash));
    const finished = Promise.race([shutdown, crashed]).finally(() => {
      for (const stop of stops) stop();
    });
    return { kind: "started", pauseReason: this.context.project.pauseReason(), finished };
  }
}
