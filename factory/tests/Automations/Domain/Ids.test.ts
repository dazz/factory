import { describe, expect, test } from "bun:test";
import {
  automationName,
  commitId,
  revision,
  sessionId,
  subjectId,
} from "~/Automations/Domain/Ids.ts";

describe("AutomationName", () => {
  test("accepts kebab-case", () => {
    expect(String(automationName("board-walker"))).toBe("board-walker");
    expect(String(automationName("a2"))).toBe("a2");
  });

  test("rejects anything but kebab-case", () => {
    for (const name of ["", "Board-Walker", "board_walker", "board walker", "-x", "x-", "a--b"]) {
      expect(() => automationName(name)).toThrow("kebab-case");
    }
  });
});

describe("the plain ids", () => {
  test("accept non-empty text", () => {
    expect(String(subjectId("ticket-42"))).toBe("ticket-42");
    expect(String(revision("r3"))).toBe("r3");
    expect(String(sessionId("s1"))).toBe("s1");
    expect(String(commitId("c2"))).toBe("c2");
  });

  test("reject empty and whitespace-only text", () => {
    expect(() => subjectId("")).toThrow("must not be empty");
    expect(() => revision("  ")).toThrow("must not be empty");
    expect(() => sessionId("")).toThrow("must not be empty");
    expect(() => commitId("")).toThrow("must not be empty");
  });
});
