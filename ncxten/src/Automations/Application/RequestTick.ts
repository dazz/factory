import type { ControlChannel, InstanceLock } from "~/Automations/Application/AutomationsPorts.ts";
import type { RunTick } from "~/Automations/Application/RunTick.ts";
import type { StartProject } from "~/Automations/Application/StartProject.ts";

export type TickRequestOutcome =
  /** A one-shot generation ran the full start sequence, then exactly one tick. */
  | { readonly kind: "ticked" }
  /** A process is running — SIGUSR1 sent, the outcome lands in its log. */
  | { readonly kind: "nudged"; readonly pid: number }
  /** Running, but the pidfile holds no PID yet (the write follows the lock). */
  | { readonly kind: "no-pid" }
  | { readonly kind: "unknown-project" };

/**
 * `ncxten tick <project>`: nudge the running process (SIGUSR1), or run a
 * one-shot process generation — the full start sequence, then exactly one
 * tick (contracts/cli.md).
 */
export class RequestTick {
  constructor(
    private readonly ports: { readonly lock: InstanceLock; readonly control: ControlChannel },
    private readonly flows: { readonly start: StartProject; readonly tick: RunTick },
  ) {}

  async run(): Promise<TickRequestOutcome> {
    if (this.ports.lock.isHeld()) return this.nudge();
    const started = await this.flows.start.run();
    if (started.kind === "unknown-project") return { kind: "unknown-project" };
    // Someone started the project between the probe and the lock: nudge it.
    if (started.kind === "lock-held") return this.nudge();
    await this.flows.tick.run("manual");
    return { kind: "ticked" };
  }

  private async nudge(): Promise<TickRequestOutcome> {
    const pid = await this.ports.lock.holderPid();
    if (pid === undefined) return { kind: "no-pid" };
    this.ports.control.signal(pid, "SIGUSR1");
    return { kind: "nudged", pid };
  }
}
