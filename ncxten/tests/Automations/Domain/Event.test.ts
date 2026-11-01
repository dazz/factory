import { describe, expect, test } from "bun:test";
import { type Event, identityOf, levelOf } from "~/Automations/Domain/Event.ts";
import {
  automationName,
  commitId,
  revision,
  sessionId,
  subjectId,
} from "~/Automations/Domain/Ids.ts";

const at = new Date("2026-10-31T12:00:00.000Z");
const walker = automationName("board-walker");
const ticket = subjectId("ticket-42");
const s1 = sessionId("s1");

/** Every domain event of the catalog, with its expected kind/outcome/level (data-model.md). */
const CATALOG: ReadonlyArray<[Event, string, string, string]> = [
  [{ name: "ProjectStarted", at }, "project", "started", "info"],
  [
    { name: "PolicyLoaded", at, tick: "PT15M", limits: { turns: 50, time: "PT20M" } },
    "policy",
    "loaded",
    "info",
  ],
  [{ name: "ProjectPaused", at, reason: "policy unreadable" }, "project", "paused", "error"],
  [{ name: "ProjectResumed", at }, "project", "resumed", "info"],
  [{ name: "ResumeFailed", at, reason: "policy still invalid" }, "resume", "failed", "error"],
  [{ name: "ResumeIgnored", at }, "resume", "ignored", "info"],
  [{ name: "AutomationsLoaded", at, commit: commitId("c2") }, "automations", "loaded", "info"],
  [
    {
      name: "AutomationsInvalid",
      at,
      problem: "duplicate name",
      commit: commitId("c3"),
      keptCommit: commitId("c2"),
    },
    "automations",
    "invalid",
    "error",
  ],
  [
    { name: "AutomationsNeverValid", at, problem: "no automations key", commit: commitId("c1") },
    "automations",
    "never-valid",
    "error",
  ],
  [{ name: "ProjectIdled", at }, "tick", "idle", "info"],
  [{ name: "TickSkipped", at, reason: "paused", trigger: "schedule" }, "tick", "skipped", "info"],
  [{ name: "HeartbeatRecorded", at }, "project", "heartbeat", "info"],
  [
    {
      name: "SessionStarted",
      at,
      automation: walker,
      subject: ticket,
      revision: revision("r3"),
      sessionId: s1,
    },
    "session",
    "started",
    "info",
  ],
  [
    {
      name: "SessionFinished",
      at,
      automation: walker,
      subject: ticket,
      sessionId: s1,
      outcome: "succeeded",
    },
    "session",
    "succeeded",
    "info",
  ],
  [
    {
      name: "SessionFinished",
      at,
      automation: walker,
      subject: ticket,
      sessionId: s1,
      outcome: "failed",
    },
    "session",
    "failed",
    "warn",
  ],
  [
    {
      name: "SessionAborted",
      at,
      automation: walker,
      subject: ticket,
      sessionId: s1,
    },
    "session",
    "aborted",
    "warn",
  ],
];

describe("the event catalog (schema v1 mapping)", () => {
  for (const [event, kind, outcome, level] of CATALOG) {
    const label = "outcome" in event ? `${event.name}(${event.outcome})` : event.name;

    test(`${label} → ${kind}/${outcome}, level ${level}`, () => {
      expect(identityOf(event)).toEqual({ kind, outcome });
      expect(levelOf(event)).toBe(level as ReturnType<typeof levelOf>);
    });
  }

  test("no two events share an identity — kind + outcome is the identity on disk", () => {
    const identities = CATALOG.map(([, kind, outcome]) => `${kind}/${outcome}`);

    expect(new Set(identities).size).toBe(identities.length);
  });
});
