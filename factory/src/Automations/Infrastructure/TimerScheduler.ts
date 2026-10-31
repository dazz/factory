import type { Scheduler, Stop } from "~/Automations/Application/AutomationsPorts.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";

/**
 * The liveness heartbeat interval (FR-028), tied to the Uptime check: its
 * period is 5 minutes plus 10 minutes grace — 15-minute ticks or long
 * sessions would trigger it, a 5-minute heartbeat never does.
 */
export const HEARTBEAT_INTERVAL = IsoDuration.parse("PT5M", "heartbeat interval");

/**
 * A plain timer to the next due tick — not a cron (STACK Scheduling). The
 * same adapter drives the tick and the liveness heartbeat; tests fire both
 * directly instead (FR-020).
 */
export class TimerScheduler implements Scheduler {
  start(interval: IsoDuration, fire: () => Promise<void>): Stop {
    const timer = setInterval(() => {
      fire().catch((error) => console.error("scheduled fire failed:", error));
    }, interval.milliseconds);
    return () => clearInterval(timer);
  }
}
