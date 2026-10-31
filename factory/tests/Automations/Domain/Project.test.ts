import { describe, expect, test } from "bun:test";
import type { Event } from "~/Automations/Domain/Event.ts";
import { Project } from "~/Automations/Domain/Project.ts";

const at = new Date("2026-10-31T12:00:00.000Z");
const later = new Date("2026-10-31T12:15:00.000Z");

function started(sessionId = "s1", revision = "r3"): Event {
  return {
    name: "SessionStarted",
    at,
    automation: "board-walker",
    subject: "ticket-42",
    revision,
    sessionId,
  };
}

describe("a fresh project", () => {
  test("is idle with nothing rebuilt yet", () => {
    const project = Project.replay([]);

    expect(project.state()).toBe("idle");
    expect(project.openSession()).toBeUndefined();
    expect(project.lastTick()).toBeUndefined();
    expect(project.lastError()).toBeUndefined();
  });

  test("ProjectStarted and PolicyLoaded mark the generation, change no state", () => {
    const project = Project.replay([
      { name: "ProjectStarted", at },
      { name: "PolicyLoaded", at, tick: "PT15M", limits: { turns: 50, time: "PT20M" } },
    ]);

    expect(project.state()).toBe("idle");
  });
});

describe("pause and resume", () => {
  test("ProjectPaused pauses with the reason as pause reason and last error", () => {
    const project = Project.replay([{ name: "ProjectPaused", at, reason: "policy unreadable" }]);

    expect(project.state()).toBe("paused");
    expect(project.pauseReason()).toBe("policy unreadable");
    expect(project.lastError()).toBe("policy unreadable");
  });

  test("ResumeFailed stays paused and updates the reason", () => {
    const project = Project.replay([
      { name: "ProjectPaused", at, reason: "policy unreadable" },
      { name: "ResumeFailed", at: later, reason: "tick below PT1M" },
    ]);

    expect(project.state()).toBe("paused");
    expect(project.pauseReason()).toBe("tick below PT1M");
  });

  test("ProjectResumed clears the pause", () => {
    const project = Project.replay([
      { name: "ProjectPaused", at, reason: "policy unreadable" },
      { name: "ProjectResumed", at: later },
    ]);

    expect(project.state()).toBe("idle");
    expect(project.pauseReason()).toBeUndefined();
  });

  test("ResumeIgnored changes nothing", () => {
    const project = Project.replay([{ name: "ResumeIgnored", at }]);

    expect(project.state()).toBe("idle");
  });

  test("paused survives a restart because it is replayed (FR-051)", () => {
    const project = Project.replay([
      { name: "ProjectPaused", at, reason: "policy unreadable" },
      { name: "ProjectStarted", at: later },
    ]);

    expect(project.state()).toBe("paused");
  });
});

describe("sessions and consumed input", () => {
  test("SessionStarted runs the project, opens the session and consumes the input", () => {
    const project = Project.replay([started()]);

    expect(project.state()).toBe("running");
    expect(project.openSession()).toEqual({
      sessionId: "s1",
      automation: "board-walker",
      subject: "ticket-42",
      revision: "r3",
    });
    expect(project.consumedRevision("board-walker", "ticket-42")).toBe("r3");
  });

  test("a failed session keeps its input consumed (FR-035, scenario 9)", () => {
    const project = Project.replay([
      started(),
      {
        name: "SessionFinished",
        at: later,
        automation: "board-walker",
        subject: "ticket-42",
        sessionId: "s1",
        outcome: "failed",
      },
    ]);

    expect(project.openSession()).toBeUndefined();
    expect(project.lastSessionOutcome()).toBe("failed");
    expect(project.consumedRevision("board-walker", "ticket-42")).toBe("r3");
  });

  test("SessionAborted clears the open session as aborted", () => {
    const project = Project.replay([
      started(),
      {
        name: "SessionAborted",
        at: later,
        automation: "board-walker",
        subject: "ticket-42",
        sessionId: "s1",
      },
    ]);

    expect(project.openSession()).toBeUndefined();
    expect(project.lastSessionOutcome()).toBe("aborted");
  });

  test("a crash directly after SessionStarted rebuilds as an open session with consumed input", () => {
    // The log of a dead process simply ends here; the next generation aborts it.
    const project = Project.replay([{ name: "ProjectStarted", at }, started()]);

    expect(project.state()).toBe("running");
    expect(project.openSession()?.sessionId).toBe("s1");
    expect(project.consumedRevision("board-walker", "ticket-42")).toBe("r3");
  });

  test("automation + subject is one consumption key, not two", () => {
    const project = Project.replay([started()]);

    expect(project.consumedRevision("board-walker", "ticket-7")).toBeUndefined();
    expect(project.consumedRevision("pull-request-reactor", "ticket-42")).toBeUndefined();
  });
});

describe("ticks and the heartbeat", () => {
  test("ProjectIdled ends the tick: idle, last tick stamped", () => {
    const project = Project.replay([started(), { name: "ProjectIdled", at: later }]);

    expect(project.state()).toBe("idle");
    expect(project.lastTick()).toEqual(later);
  });

  test("TickSkipped stamps the last tick and keeps the state", () => {
    const project = Project.replay([
      { name: "ProjectPaused", at, reason: "policy unreadable" },
      { name: "TickSkipped", at: later, reason: "paused", trigger: "schedule" },
    ]);

    expect(project.state()).toBe("paused");
    expect(project.lastTick()).toEqual(later);
  });

  test("a heartbeat is never the last tick and changes nothing (FR-028)", () => {
    const project = Project.replay([
      { name: "ProjectIdled", at },
      { name: "HeartbeatRecorded", at: later },
    ]);

    expect(project.lastTick()).toEqual(at);
    expect(project.state()).toBe("idle");
  });
});

describe("automations revisions", () => {
  test("AutomationsLoaded records the last valid commit", () => {
    const project = Project.replay([{ name: "AutomationsLoaded", at, commit: "c2" }]);

    expect(project.lastValidAutomationsCommit()).toBe("c2");
  });

  test("AutomationsInvalid keeps the last valid commit and records the problem", () => {
    const project = Project.replay([
      { name: "AutomationsLoaded", at, commit: "c2" },
      {
        name: "AutomationsInvalid",
        at: later,
        problem: "duplicate name",
        commit: "c3",
        keptCommit: "c2",
      },
    ]);

    expect(project.lastValidAutomationsCommit()).toBe("c2");
    expect(project.lastError()).toBe("duplicate name");
  });

  test("AutomationsNeverValid records the problem and the project keeps ticking idle", () => {
    const project = Project.replay([
      { name: "AutomationsNeverValid", at, problem: "no automations key", commit: "c1" },
    ]);

    expect(project.state()).toBe("idle");
    expect(project.lastError()).toBe("no automations key");
    expect(project.lastValidAutomationsCommit()).toBeUndefined();
  });

  test("a valid load clears an automations problem, but never a pause reason", () => {
    const project = Project.replay([
      { name: "AutomationsNeverValid", at, problem: "no automations key", commit: "c1" },
      { name: "AutomationsLoaded", at: later, commit: "c2" },
    ]);
    const paused = Project.replay([
      { name: "ProjectPaused", at, reason: "policy unreadable" },
      { name: "AutomationsLoaded", at: later, commit: "c2" },
    ]);

    expect(project.lastError()).toBeUndefined();
    expect(paused.lastError()).toBe("policy unreadable");
    expect(paused.pauseReason()).toBe("policy unreadable");
  });
});

describe("the extension rule", () => {
  test("replay ignores events this version does not know", () => {
    const unknown = { name: "SomethingNewer", at, extra: "field" } as unknown as Event;
    const project = Project.replay([{ name: "ProjectIdled", at }, unknown]);

    expect(project.state()).toBe("idle");
    expect(project.lastTick()).toEqual(at);
    expect(project.lastError()).toBeUndefined();
  });
});
