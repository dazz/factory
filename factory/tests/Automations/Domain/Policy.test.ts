import { describe, expect, test } from "bun:test";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { Policy } from "~/Automations/Domain/Policy.ts";

function fields(overrides: Partial<ConstructorParameters<typeof Policy>[0]> = {}) {
  return {
    repository: "dazz/foo",
    checkout: "/home/dazz/checkouts/foo",
    tick: IsoDuration.parse("PT15M", "policy.tick"),
    limits: { turns: 50, time: IsoDuration.parse("PT20M", "policy.limits.time") },
    ...overrides,
  };
}

describe("Policy", () => {
  test("carries the used fields of a valid policy", () => {
    const policy = new Policy(fields());

    expect(policy.repository).toBe("dazz/foo");
    expect(policy.checkout).toBe("/home/dazz/checkouts/foo");
    expect(policy.tick.text).toBe("PT15M");
    expect(policy.limits.turns).toBe(50);
  });

  test("the repository is owner/repo — the project ID itself", () => {
    for (const repository of ["foo", "dazz/", "/foo", "dazz/foo/bar", "dazz foo/bar"]) {
      expect(() => new Policy(fields({ repository }))).toThrow("owner/repo");
    }
  });

  test("the checkout is an absolute path", () => {
    expect(() => new Policy(fields({ checkout: "checkouts/foo" }))).toThrow("absolute path");
  });

  test("the tick bounds catch the two classic typos", () => {
    const seconds = IsoDuration.parse("PT15S", "policy.tick");
    const months = IsoDuration.parse("P15M", "policy.tick");

    expect(() => new Policy(fields({ tick: seconds }))).toThrow("below the minimum PT1M");
    expect(() => new Policy(fields({ tick: months }))).toThrow("above the maximum PT24H");
  });

  test("the bounds themselves are valid ticks", () => {
    const min = IsoDuration.parse("PT1M", "policy.tick");
    const max = IsoDuration.parse("PT24H", "policy.tick");

    expect(new Policy(fields({ tick: min })).tick.text).toBe("PT1M");
    expect(new Policy(fields({ tick: max })).tick.text).toBe("PT24H");
  });

  test("limits must be positive", () => {
    const time = IsoDuration.parse("PT20M", "x");
    const zero = IsoDuration.parse("PT0S", "x");

    expect(() => new Policy(fields({ limits: { turns: 0, time } }))).toThrow("positive integer");
    expect(() => new Policy(fields({ limits: { turns: 2.5, time } }))).toThrow("positive integer");
    expect(() => new Policy(fields({ limits: { turns: 50, time: zero } }))).toThrow(
      "positive duration",
    );
  });
});
