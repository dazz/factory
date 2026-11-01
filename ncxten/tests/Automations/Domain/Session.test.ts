import { describe, expect, test } from "bun:test";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { ConsumedInput } from "~/Automations/Domain/ConsumedInput.ts";
import { automationName, revision, sessionId, subjectId } from "~/Automations/Domain/Ids.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { Session } from "~/Automations/Domain/Session.ts";

const walker = new Automation(automationName("board-walker"), "walk-the-board");
const input = new ConsumedInput(
  automationName("board-walker"),
  subjectId("ticket-42"),
  revision("r3"),
);
const limits = { turns: 50, time: IsoDuration.parse("PT20M", "x") };

describe("Session", () => {
  test("is open until the harness returns an outcome", () => {
    const session = new Session(sessionId("s1"), walker, input, limits);

    expect(session.isOpen()).toBe(true);
    expect(session.outcome).toBeUndefined();
  });

  test("finishes with the harness outcome", () => {
    const finished = new Session(sessionId("s1"), walker, input, limits).finishedWith("failed");

    expect(finished.isOpen()).toBe(false);
    expect(finished.outcome).toBe("failed");
  });

  test("rejects input that belongs to another automation", () => {
    const foreign = new ConsumedInput(
      automationName("pull-request-reactor"),
      subjectId("ticket-42"),
      revision("r3"),
    );

    expect(() => new Session(sessionId("s1"), walker, foreign, limits)).toThrow(
      "input belongs to pull-request-reactor, not board-walker",
    );
  });
});
