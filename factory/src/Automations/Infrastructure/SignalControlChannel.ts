import type { ControlChannel } from "~/Automations/Application/AutomationsPorts.ts";

/**
 * The control channel as Unix signals (STACK): SIGHUP = re-read the policy
 * and resume, SIGUSR1 = tick now — under s6 that is `s6-svc -h` and
 * `s6-svc -1`. Handlers run between the drain's awaits, so a nudge during a
 * running drain becomes `TickSkipped { trigger: manual, reason: running }`
 * (FR-023). Signals carry no reply: the CLI learns the outcome from the
 * event log through the status query.
 */
export class SignalControlChannel implements ControlChannel {
  onResume(fn: () => void): void {
    process.on("SIGHUP", fn);
  }

  onTickNow(fn: () => void): void {
    process.on("SIGUSR1", fn);
  }
}
