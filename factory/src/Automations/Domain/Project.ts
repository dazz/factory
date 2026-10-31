import type { Event, SessionOutcome } from "~/Automations/Domain/Event.ts";
import type {
  AutomationName,
  CommitId,
  Revision,
  SessionId,
  SubjectId,
} from "~/Automations/Domain/Ids.ts";

export type ProjectState = "running" | "idle" | "paused";

export interface OpenSession {
  readonly sessionId: SessionId;
  readonly automation: AutomationName;
  readonly subject: SubjectId;
  readonly revision: Revision;
}

/**
 * The rebuilt state (data-model.md): a fold over the event log, all of it a
 * deletable cache — the log is the source of truth (FR-044). `paused` survives
 * restart because it is replayed, not held in memory (FR-051).
 */
export class Project {
  private currentState: ProjectState = "idle";
  private pauseReasonValue: string | undefined;
  private openSessionValue: OpenSession | undefined;
  private readonly consumed = new Map<string, Revision>();
  private lastValidAutomationsCommitValue: CommitId | undefined;
  private lastTickValue: Date | undefined;
  private lastSessionOutcomeValue: SessionOutcome | undefined;
  private lastErrorValue: string | undefined;
  private lastErrorFromAutomations = false;

  static replay(events: Iterable<Event>): Project {
    const project = new Project();
    for (const event of events) project.apply(event);
    return project;
  }

  apply(event: Event): void {
    switch (event.name) {
      case "ProjectPaused":
        this.currentState = "paused";
        this.pauseReasonValue = event.reason;
        this.recordError(event.reason, false);
        return;
      case "ProjectResumed":
        this.currentState = "idle";
        this.pauseReasonValue = undefined;
        return;
      case "ResumeFailed":
        // Stays paused; only the reason is updated.
        this.pauseReasonValue = event.reason;
        this.recordError(event.reason, false);
        return;
      case "AutomationsLoaded":
        this.lastValidAutomationsCommitValue = event.commit;
        // A valid load resolves an automations problem; a pause reason stays.
        if (this.lastErrorFromAutomations) this.recordError(undefined, false);
        return;
      case "AutomationsInvalid":
        // The kept commit stays in effect — only the error is recorded.
        this.recordError(event.problem, true);
        return;
      case "AutomationsNeverValid":
        this.currentState = "idle";
        this.recordError(event.problem, true);
        return;
      case "ProjectIdled":
        this.currentState = "idle";
        this.lastTickValue = event.at;
        return;
      case "TickSkipped":
        this.lastTickValue = event.at;
        return;
      case "SessionStarted":
        this.currentState = "running";
        this.openSessionValue = {
          sessionId: event.sessionId,
          automation: event.automation,
          subject: event.subject,
          revision: event.revision,
        };
        // Starting consumes the input, whatever the outcome (FR-035, FR-043).
        this.consumed.set(consumedKey(event.automation, event.subject), event.revision);
        return;
      case "SessionFinished":
        this.openSessionValue = undefined;
        this.lastSessionOutcomeValue = event.outcome;
        return;
      case "SessionAborted":
        this.openSessionValue = undefined;
        this.lastSessionOutcomeValue = "aborted";
        return;
      default:
        // ProjectStarted, PolicyLoaded, ResumeIgnored, HeartbeatRecorded —
        // and every kind/outcome this version does not know (extension rule):
        // recorded, never folded.
        return;
    }
  }

  state(): ProjectState {
    return this.currentState;
  }

  pauseReason(): string | undefined {
    return this.pauseReasonValue;
  }

  openSession(): OpenSession | undefined {
    return this.openSessionValue;
  }

  /** The revision a session already consumed for automation + subject (FR-035). */
  consumedRevision(automation: AutomationName, subject: SubjectId): Revision | undefined {
    return this.consumed.get(consumedKey(automation, subject));
  }

  lastValidAutomationsCommit(): CommitId | undefined {
    return this.lastValidAutomationsCommitValue;
  }

  /** The newer of the tick-ending events — never a heartbeat. */
  lastTick(): Date | undefined {
    return this.lastTickValue;
  }

  lastSessionOutcome(): SessionOutcome | undefined {
    return this.lastSessionOutcomeValue;
  }

  lastError(): string | undefined {
    return this.lastErrorValue;
  }

  private recordError(error: string | undefined, fromAutomations: boolean): void {
    this.lastErrorValue = error;
    this.lastErrorFromAutomations = fromAutomations;
  }
}

function consumedKey(automation: string, subject: string): string {
  // U+001F (unit separator) cannot appear in either part — no two pairs collide.
  return `${automation}\u001F${subject}`;
}
