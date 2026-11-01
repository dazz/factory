import { describe, expect, test } from "bun:test";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";

describe("IsoDuration", () => {
  test("carries the original text and the milliseconds", () => {
    const tick = IsoDuration.parse("PT15M", "policy.tick");

    expect(tick.text).toBe("PT15M");
    expect(tick.milliseconds).toBe(15 * 60 * 1000);
  });

  test("parses combined time units", () => {
    expect(IsoDuration.parse("PT1H30M", "x").milliseconds).toBe(90 * 60 * 1000);
    expect(IsoDuration.parse("PT20S", "x").milliseconds).toBe(20 * 1000);
    expect(IsoDuration.parse("P1DT12H", "x").milliseconds).toBe(36 * 60 * 60 * 1000);
  });

  test("the classic typo P15M parses as months — huge, for the bounds to reject", () => {
    const months = IsoDuration.parse("P15M", "policy.tick");
    const day = IsoDuration.parse("P1D", "x");

    expect(months.milliseconds).toBeGreaterThan(300 * day.milliseconds);
  });

  test("rejects what is not an ISO 8601 duration, naming the field", () => {
    for (const text of ["", "P", "PT", "15M", "PT15X", "pt15m", " PT15M", "PT-5M"]) {
      expect(() => IsoDuration.parse(text, "policy.tick")).toThrow("policy.tick");
    }
  });
});
