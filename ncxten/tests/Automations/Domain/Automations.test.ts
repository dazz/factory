import { describe, expect, test } from "bun:test";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { Automations } from "~/Automations/Domain/Automations.ts";
import { automationName, commitId } from "~/Automations/Domain/Ids.ts";

const reactor = new Automation(automationName("pull-request-reactor"), "react-to-reviews");
const walker = new Automation(automationName("board-walker"), "walk-the-board");

describe("Automations", () => {
  test("keeps the list order — it is the priority (FR-031)", () => {
    const automations = Automations.of([reactor, walker], commitId("c1"));

    expect(automations.inOrder().map((a) => a.name)).toEqual([
      automationName("pull-request-reactor"),
      automationName("board-walker"),
    ]);
    expect(automations.commit).toBe(commitId("c1"));
  });

  test("requires at least one automation", () => {
    expect(() => Automations.of([], commitId("c1"))).toThrow("at least one");
  });

  test("rejects duplicate names", () => {
    expect(() => Automations.of([walker, walker], commitId("c1"))).toThrow(
      "duplicate name board-walker",
    );
  });
});
