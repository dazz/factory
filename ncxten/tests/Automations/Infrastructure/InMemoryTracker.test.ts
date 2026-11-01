import { describe, expect, test } from "bun:test";
import { automationName, revision, subjectId } from "~/Automations/Domain/Ids.ts";
import { InMemoryTracker } from "~/Automations/Infrastructure/InMemoryTracker.ts";

const finding = { subject: subjectId("ticket-42"), revision: revision("r1") };

describe("InMemoryTracker", () => {
  test("answers with what was presented for exactly that automation", async () => {
    const tracker = new InMemoryTracker();
    tracker.present("board-walker", finding);

    expect(await tracker.findings(automationName("board-walker"))).toEqual([finding]);
    expect(await tracker.findings(automationName("pull-request-reactor"))).toEqual([]);
  });

  test("a finding stays presented until cleared — no new/old judgment here", async () => {
    const tracker = new InMemoryTracker();
    tracker.present("board-walker", finding);

    expect(await tracker.findings(automationName("board-walker"))).toEqual([finding]);
    expect(await tracker.findings(automationName("board-walker"))).toEqual([finding]);

    tracker.clear("board-walker");
    expect(await tracker.findings(automationName("board-walker"))).toEqual([]);
  });
});
