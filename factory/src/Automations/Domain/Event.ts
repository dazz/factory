/**
 * The event catalog (data-model.md). Domain events keep their past-tense
 * names in code; on disk every event is one schema v1 line — the contract
 * the observability pipeline already consumes (infra/) — whose identity is
 * `kind` + `outcome`. `JsonlEventLog` translates in both directions; the
 * mapping itself lives here, next to the events it describes.
 */

export type Level = "info" | "warn" | "error";
export type TickTrigger = "schedule" | "manual";
export type SkipReason = "running" | "paused";
export type SessionOutcome = "succeeded" | "failed" | "aborted";

/** The limits a session runs under, as the policy declares them. */
export interface SessionLimits {
  readonly turns: number;
  /** ISO 8601 duration, e.g. `PT20M`. */
  readonly time: string;
}

/** Marks a process generation; no state change. */
export interface ProjectStarted {
  readonly name: "ProjectStarted";
  readonly at: Date;
}

/** The policy in effect — the log says which limits a session ran under. */
export interface PolicyLoaded {
  readonly name: "PolicyLoaded";
  readonly at: Date;
  /** ISO 8601 duration, e.g. `PT15M`. */
  readonly tick: string;
  readonly limits: SessionLimits;
}

export interface ProjectPaused {
  readonly name: "ProjectPaused";
  readonly at: Date;
  readonly reason: string;
}

export interface ProjectResumed {
  readonly name: "ProjectResumed";
  readonly at: Date;
}

export interface ResumeFailed {
  readonly name: "ResumeFailed";
  readonly at: Date;
  readonly reason: string;
}

export interface ResumeIgnored {
  readonly name: "ResumeIgnored";
  readonly at: Date;
}

export interface AutomationsLoaded {
  readonly name: "AutomationsLoaded";
  readonly at: Date;
  readonly commit: string;
}

/** An invalid revision; the last valid one (`keptCommit`) stays in effect. */
export interface AutomationsInvalid {
  readonly name: "AutomationsInvalid";
  readonly at: Date;
  readonly problem: string;
  readonly commit: string;
  readonly keptCommit: string;
}

/** No revision was ever valid — the project keeps ticking without automations. */
export interface AutomationsNeverValid {
  readonly name: "AutomationsNeverValid";
  readonly at: Date;
  readonly problem: string;
  readonly commit: string;
}

/** The tick-ending event of an empty pass (FR-024's counterpart: a tick ran). */
export interface ProjectIdled {
  readonly name: "ProjectIdled";
  readonly at: Date;
}

/** The tick-ending event of a tick that did not run (FR-024). */
export interface TickSkipped {
  readonly name: "TickSkipped";
  readonly at: Date;
  readonly reason: SkipReason;
  readonly trigger: TickTrigger;
}

/** Liveness only (FR-028): never a state change, never "last tick". */
export interface HeartbeatRecorded {
  readonly name: "HeartbeatRecorded";
  readonly at: Date;
}

/** Written before dispatch (FR-043) — starting is what consumes the input (FR-035). */
export interface SessionStarted {
  readonly name: "SessionStarted";
  readonly at: Date;
  readonly automation: string;
  readonly subject: string;
  readonly revision: string;
  readonly sessionId: string;
}

export interface SessionFinished {
  readonly name: "SessionFinished";
  readonly at: Date;
  readonly automation: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly outcome: "succeeded" | "failed";
}

/** Orphan cleanup at start (FR-025): the previous generation died mid-session. */
export interface SessionAborted {
  readonly name: "SessionAborted";
  readonly at: Date;
  readonly automation: string;
  readonly subject: string;
  readonly sessionId: string;
}

export type Event =
  | ProjectStarted
  | PolicyLoaded
  | ProjectPaused
  | ProjectResumed
  | ResumeFailed
  | ResumeIgnored
  | AutomationsLoaded
  | AutomationsInvalid
  | AutomationsNeverValid
  | ProjectIdled
  | TickSkipped
  | HeartbeatRecorded
  | SessionStarted
  | SessionFinished
  | SessionAborted;

/** Event identity on disk: schema v1 has no `type`, only `kind` + `outcome`. */
export interface LineIdentity {
  readonly kind: string;
  readonly outcome: string;
}

const IDENTITIES = {
  ProjectStarted: { kind: "project", outcome: "started" },
  PolicyLoaded: { kind: "policy", outcome: "loaded" },
  ProjectPaused: { kind: "project", outcome: "paused" },
  ProjectResumed: { kind: "project", outcome: "resumed" },
  ResumeFailed: { kind: "resume", outcome: "failed" },
  ResumeIgnored: { kind: "resume", outcome: "ignored" },
  AutomationsLoaded: { kind: "automations", outcome: "loaded" },
  AutomationsInvalid: { kind: "automations", outcome: "invalid" },
  AutomationsNeverValid: { kind: "automations", outcome: "never-valid" },
  ProjectIdled: { kind: "tick", outcome: "idle" },
  TickSkipped: { kind: "tick", outcome: "skipped" },
  HeartbeatRecorded: { kind: "project", outcome: "heartbeat" },
  SessionStarted: { kind: "session", outcome: "started" },
  SessionAborted: { kind: "session", outcome: "aborted" },
} as const satisfies Record<Exclude<Event["name"], "SessionFinished">, LineIdentity>;

export function identityOf(event: Event): LineIdentity {
  // The one event whose outcome is not fixed by its name: a change of meaning
  // gets a new kind/outcome combination, never a reused one (append-only rule).
  if (event.name === "SessionFinished") return { kind: "session", outcome: event.outcome };
  return IDENTITIES[event.name];
}

/**
 * `error` = a human must act (Better Stack pushes on it), `warn` = something
 * failed but the project continues, `info` = the rest.
 */
export function levelOf(event: Event): Level {
  switch (event.name) {
    case "ProjectPaused":
    case "ResumeFailed":
    case "AutomationsInvalid":
    case "AutomationsNeverValid":
      return "error";
    case "SessionAborted":
      return "warn";
    case "SessionFinished":
      return event.outcome === "failed" ? "warn" : "info";
    default:
      return "info";
  }
}
