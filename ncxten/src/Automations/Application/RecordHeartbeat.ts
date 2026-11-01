import type { EventLog } from "~/Automations/Application/AutomationsPorts.ts";
import type { ProjectContext } from "~/Automations/Application/StartProject.ts";
import type { Event } from "~/Automations/Domain/Event.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import type { Clock } from "~/Shared/Clock.ts";

/**
 * The liveness heartbeat cadence (FR-028), tied to the Uptime check: its
 * period is 5 minutes plus 10 minutes grace — 15-minute ticks or long
 * sessions would trigger it, a 5-minute heartbeat never does.
 */
export const HEARTBEAT_INTERVAL = IsoDuration.parse("PT5M", "heartbeat interval");

/** In every state, also mid-session — the append queue serializes it (FR-028). */
export class RecordHeartbeat {
  constructor(
    private readonly ports: { readonly log: EventLog; readonly clock: Clock },
    private readonly context: ProjectContext,
  ) {}

  async run(): Promise<void> {
    const beat: Event = { name: "HeartbeatRecorded", at: this.ports.clock.now() };
    await this.ports.log.append(beat);
    this.context.project.apply(beat);
  }
}
