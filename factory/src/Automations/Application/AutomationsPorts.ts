import type { Automation } from "~/Automations/Domain/Automation.ts";
import type { Automations } from "~/Automations/Domain/Automations.ts";
import type { ConsumedInput, Finding } from "~/Automations/Domain/ConsumedInput.ts";
import type { Event, SessionOutcome } from "~/Automations/Domain/Event.ts";
import type { AutomationName, CommitId } from "~/Automations/Domain/Ids.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import type { Limits, Policy } from "~/Automations/Domain/Policy.ts";

/**
 * The eight ports of the Automations module (data-model.md): concepts, no
 * suffix. External systems stay behind them; tests use the in-memory
 * adapters, never mocks. `Clock` is the ninth, shared (`~/Shared/Clock.ts`).
 */

export type Stop = () => void;

/** Fires the tick on its interval; tests fire directly instead (FR-020). */
export interface Scheduler {
  start(interval: IsoDuration, fire: () => Promise<void>): Stop;
}

/**
 * The liveness heartbeat cadence (FR-028), tied to the Uptime check: its
 * period is 5 minutes plus 10 minutes grace — 15-minute ticks or long
 * sessions would trigger it, a 5-minute heartbeat never does.
 */
export const HEARTBEAT_INTERVAL = IsoDuration.parse("PT5M", "heartbeat interval");

/**
 * An append or fsync failed (FR-053): the factory never acts without a
 * record — the process ends with exit 74, the supervisor restarts it and
 * the replay catches up.
 */
export class EventLogUnwritable extends Error {}

/** Runs one session. The `FakeHarness` is a shipped adapter, not a test hack. */
export interface Harness {
  run(automation: Automation, input: ConsumedInput, limits: Limits): Promise<SessionOutcome>;
}

/** The automation's deterministic precheck answers from here (slice 1). */
export interface Tracker {
  findings(automation: AutomationName): Promise<readonly Finding[]>;
}

/** The source of truth. Append is fsynced; replay tolerates a truncated last line. */
export interface EventLog {
  append(event: Event): Promise<void>;
  replay(): AsyncIterable<Event>;
}

/** Parsed value or problem — never raw text; parsing (YAML, zod) lives in Infrastructure. */
export interface PolicyProblem {
  /** Carries the failing path, e.g. `policy.limits.turns: expected number`. */
  readonly problem: string;
  /** No file at all — the unknown-project guard (exit 69) needs the difference. */
  readonly missing: boolean;
}

/** Read at start and on resume from a pause only (FR-004). */
export interface PolicySource {
  read(): Promise<Policy | PolicyProblem>;
}

export type AutomationsReading =
  | { readonly automations: Automations }
  | { readonly problem: string; readonly commit: CommitId };

/** Reads `automations.yml` at the default branch head — parsed, with its commit. */
export interface AutomationsSource {
  read(): Promise<AutomationsReading>;
}

/** Resume and tick-now nudges; `SignalControlChannel` maps SIGHUP / SIGUSR1. */
export interface ControlChannel {
  onResume(fn: () => void): void;
  onTickNow(fn: () => void): void;
}

/** One process per project (FR-027). `acquire` retries briefly (named constant). */
export interface InstanceLock {
  acquire(): Promise<boolean>;
  /** Whether some process holds it, without taking it — the `factory status` probe (FR-025). */
  isHeld(): boolean;
}
