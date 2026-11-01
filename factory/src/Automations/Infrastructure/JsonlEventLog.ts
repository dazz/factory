import { type FileHandle, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EventLog } from "~/Automations/Application/AutomationsPorts.ts";
import { EventLogUnwritable } from "~/Automations/Application/EventLogUnwritable.ts";
import { type Event, identityOf, levelOf, type SessionLimits } from "~/Automations/Domain/Event.ts";
import {
  automationName,
  commitId,
  revision,
  sessionId,
  subjectId,
} from "~/Automations/Domain/Ids.ts";

/**
 * The event log on disk: one schema v1 line per event — the contract the
 * observability pipeline consumes (`infra/`, STACK Events). Translates domain
 * events ↔ lines in both directions. Every append goes through one in-process
 * queue (signal handlers, the liveness heartbeat and the drain share the
 * path) and is fsynced, because the event precedes the action it announces.
 * Replay drops a truncated last line and skips lines this version does not
 * know (extension rule).
 */
export class JsonlEventLog implements EventLog {
  private handle: FileHandle | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    /** `<state-root>/events/<owner>/<repo>.jsonl` — the only directory Vector mounts. */
    private readonly path: string,
    /** The project ID — in every line, because Vector merges several logs. */
    private readonly repository: string,
    /** From the policy at append time; omitted on lines without a valid one. */
    private readonly forge: () => string | undefined,
  ) {}

  append(event: Event): Promise<void> {
    const task = this.queue.then(() => this.write(event));
    this.queue = task.catch(() => undefined);
    return task;
  }

  async *replay(): AsyncIterable<Event> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const lines = text.split("\n").filter((line) => line !== "");
    for (const [index, line] of lines.entries()) {
      let fields: unknown;
      try {
        fields = JSON.parse(line);
      } catch (error) {
        // A crash mid-append truncates only the last line — drop it.
        if (index === lines.length - 1) return;
        throw error;
      }
      const event = toEvent(fields as Record<string, unknown>);
      if (event !== undefined) yield event;
    }
  }

  async close(): Promise<void> {
    await this.queue;
    await this.handle?.close();
    this.handle = undefined;
  }

  private async write(event: Event): Promise<void> {
    try {
      if (this.handle === undefined) {
        await mkdir(dirname(this.path), { recursive: true });
        this.handle = await open(this.path, "a");
      }
      await this.handle.write(`${JSON.stringify(this.toLine(event))}\n`, null, "utf8");
      await this.handle.sync();
    } catch (error) {
      // FR-053: no append, no action — the caller ends the process (exit 74).
      throw new EventLogUnwritable(`event log unwritable at ${this.path}: ${String(error)}`);
    }
  }

  private toLine(event: Event): Record<string, unknown> {
    const { kind, outcome } = identityOf(event);
    const forge = this.forge();
    return {
      schema: SCHEMA,
      time: event.at.toISOString(),
      kind,
      repository: this.repository,
      ...(forge === undefined ? {} : { forge }),
      ...identifiers(event),
      outcome,
      ...extras(event),
      level: levelOf(event),
    };
  }
}

const SCHEMA = 1;

/** `automation`, `issue` and `detail` — the envelope's who-and-why fields. */
function identifiers(event: Event): Record<string, unknown> {
  switch (event.name) {
    case "ProjectPaused":
    case "ResumeFailed":
      return { detail: event.reason };
    case "AutomationsInvalid":
    case "AutomationsNeverValid":
      return { detail: event.problem };
    case "TickSkipped":
      return { detail: event.reason };
    case "SessionStarted":
    case "SessionFinished":
      return { automation: event.automation, issue: event.subject };
    case "SessionAborted":
      return { automation: event.automation, issue: event.subject, detail: "orphaned" };
    default:
      return {};
  }
}

/** The per-event extra fields of the catalog (data-model.md). */
function extras(event: Event): Record<string, unknown> {
  switch (event.name) {
    case "PolicyLoaded":
      return { tick: event.tick, limits: event.limits };
    case "AutomationsLoaded":
    case "AutomationsNeverValid":
      return { commit: event.commit };
    case "AutomationsInvalid":
      return { commit: event.commit, keptCommit: event.keptCommit };
    case "TickSkipped":
      return { trigger: event.trigger };
    case "SessionStarted":
      return { sessionId: event.sessionId, revision: event.revision };
    case "SessionFinished":
    case "SessionAborted":
      return { sessionId: event.sessionId };
    default:
      return {};
  }
}

/** Line → domain event; `undefined` for a kind/outcome this version does not know. */
function toEvent(fields: Record<string, unknown>): Event | undefined {
  const at = new Date(text(fields.time));
  switch (`${text(fields.kind)}/${text(fields.outcome)}`) {
    case "project/started":
      return { name: "ProjectStarted", at };
    case "policy/loaded":
      return {
        name: "PolicyLoaded",
        at,
        tick: text(fields.tick),
        limits: fields.limits as SessionLimits,
      };
    case "project/paused":
      return { name: "ProjectPaused", at, reason: text(fields.detail) };
    case "project/resumed":
      return { name: "ProjectResumed", at };
    case "resume/failed":
      return { name: "ResumeFailed", at, reason: text(fields.detail) };
    case "resume/ignored":
      return { name: "ResumeIgnored", at };
    case "automations/loaded":
      return { name: "AutomationsLoaded", at, commit: commitId(text(fields.commit)) };
    case "automations/invalid":
      return {
        name: "AutomationsInvalid",
        at,
        problem: text(fields.detail),
        commit: commitId(text(fields.commit)),
        keptCommit: commitId(text(fields.keptCommit)),
      };
    case "automations/never-valid":
      return {
        name: "AutomationsNeverValid",
        at,
        problem: text(fields.detail),
        commit: commitId(text(fields.commit)),
      };
    case "tick/idle":
      return { name: "ProjectIdled", at };
    case "tick/skipped":
      return {
        name: "TickSkipped",
        at,
        reason: text(fields.detail) === "paused" ? "paused" : "running",
        trigger: text(fields.trigger) === "manual" ? "manual" : "schedule",
      };
    case "project/heartbeat":
      return { name: "HeartbeatRecorded", at };
    case "session/started":
      return {
        name: "SessionStarted",
        at,
        automation: automationName(text(fields.automation)),
        subject: subjectId(text(fields.issue)),
        revision: revision(text(fields.revision)),
        sessionId: sessionId(text(fields.sessionId)),
      };
    case "session/succeeded":
    case "session/failed":
      return {
        name: "SessionFinished",
        at,
        automation: automationName(text(fields.automation)),
        subject: subjectId(text(fields.issue)),
        sessionId: sessionId(text(fields.sessionId)),
        outcome: text(fields.outcome) === "failed" ? "failed" : "succeeded",
      };
    case "session/aborted":
      return {
        name: "SessionAborted",
        at,
        automation: automationName(text(fields.automation)),
        subject: subjectId(text(fields.issue)),
        sessionId: sessionId(text(fields.sessionId)),
      };
    default:
      return undefined;
  }
}

function text(field: unknown): string {
  return typeof field === "string" ? field : "";
}
