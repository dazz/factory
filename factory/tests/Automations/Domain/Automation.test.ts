import { describe, expect, test } from "bun:test";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { automationName } from "~/Automations/Domain/Ids.ts";

const walker = automationName("board-walker");

describe("Automation", () => {
  test("carries name, skill ref and optional gate", () => {
    const automation = new Automation(walker, "walk-the-board", "make ci");

    expect(automation.name).toBe(walker);
    expect(automation.skill).toBe("walk-the-board");
    expect(automation.gate).toBe("make ci");
  });

  test("the gate is optional", () => {
    expect(new Automation(walker, "walk-the-board").gate).toBeUndefined();
  });

  test("rejects an empty skill ref", () => {
    expect(() => new Automation(walker, " ")).toThrow("skill must not be empty");
  });

  test("rejects an empty gate when declared", () => {
    expect(() => new Automation(walker, "walk-the-board", "")).toThrow(
      "gate must not be empty when declared",
    );
  });
});
