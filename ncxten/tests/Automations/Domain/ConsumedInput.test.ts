import { describe, expect, test } from "bun:test";
import { ConsumedInput } from "~/Automations/Domain/ConsumedInput.ts";
import { automationName, revision, subjectId } from "~/Automations/Domain/Ids.ts";

const walker = automationName("board-walker");
const reactor = automationName("pull-request-reactor");

describe("ConsumedInput", () => {
  test("builds from an automation and a finding", () => {
    const input = ConsumedInput.of(walker, {
      subject: subjectId("ticket-42"),
      revision: revision("r3"),
    });

    expect(input.automation).toBe(walker);
    expect(input.subject).toBe(subjectId("ticket-42"));
    expect(input.revision).toBe(revision("r3"));
  });

  test("equality is automation + subject + revision", () => {
    const input = new ConsumedInput(walker, subjectId("ticket-42"), revision("r3"));

    expect(input.equals(new ConsumedInput(walker, subjectId("ticket-42"), revision("r3")))).toBe(
      true,
    );
    expect(input.equals(new ConsumedInput(reactor, subjectId("ticket-42"), revision("r3")))).toBe(
      false,
    );
    expect(input.equals(new ConsumedInput(walker, subjectId("ticket-7"), revision("r3")))).toBe(
      false,
    );
    expect(input.equals(new ConsumedInput(walker, subjectId("ticket-42"), revision("r4")))).toBe(
      false,
    );
  });
});
