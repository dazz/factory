import type {
  ControlChannel,
  InstanceLock,
  Scheduler,
} from "~/Automations/Application/AutomationsPorts.ts";
import type { Resume, ResumeResult } from "~/Automations/Application/Resume.ts";
import type { StartProject } from "~/Automations/Application/StartProject.ts";
import type { Status } from "~/Automations/Application/Status.ts";

/** The running process writes the result to its log — polled briefly from there. */
const POLL_TRIES = 10;
const POLL_EVERY_MS = 200;

export type ResumeRequestOutcome =
  | ResumeResult
  /** SIGHUP sent; the result was not in the log within the poll window. */
  | { readonly kind: "requested" }
  /** Running, but the pidfile holds no PID yet (the write follows the lock). */
  | { readonly kind: "no-pid" }
  | { readonly kind: "unknown-project" };

/**
 * `ncxten resume <project>`: SIGHUP to the running process, then poll the
 * status query briefly for the result; or a one-shot generation that resumes
 * itself (contracts/cli.md).
 */
export class RequestResume {
  constructor(
    private readonly ports: {
      readonly lock: InstanceLock;
      readonly control: ControlChannel;
      readonly scheduler: Scheduler;
    },
    private readonly flows: {
      readonly start: StartProject;
      readonly resume: Resume;
      readonly status: Status;
    },
  ) {}

  async run(): Promise<ResumeRequestOutcome> {
    if (this.ports.lock.isHeld()) return this.resumeRunning();
    const started = await this.flows.start.run();
    if (started.kind === "unknown-project") return { kind: "unknown-project" };
    if (started.kind === "lock-held") return this.resumeRunning();
    return this.flows.resume.run();
  }

  private async resumeRunning(): Promise<ResumeRequestOutcome> {
    const before = await this.flows.status.run();
    if (before.kind === "unknown-project") return { kind: "unknown-project" };
    const pid = await this.ports.lock.holderPid();
    if (pid === undefined) return { kind: "no-pid" };
    this.ports.control.signal(pid, "SIGHUP");
    if (before.state !== "paused") {
      // The process appends ResumeIgnored; nothing will change (FR-051).
      return { kind: "ignored" };
    }
    for (let tries = 0; tries < POLL_TRIES; tries += 1) {
      await this.ports.scheduler.sleep(POLL_EVERY_MS);
      const now = await this.flows.status.run();
      if (now.kind !== "report") continue;
      if (now.state !== "paused") return { kind: "resumed" };
      if (now.pauseReason !== before.pauseReason) {
        return { kind: "failed", reason: now.pauseReason ?? "unknown" };
      }
    }
    return { kind: "requested" };
  }
}
