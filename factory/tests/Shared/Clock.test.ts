import { describe, expect, test } from "bun:test";
import { ManualClock, SystemClock } from "~/Shared/Clock.ts";

describe("SystemClock", () => {
  test("now() is the system time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("ManualClock", () => {
  test("stands still until a test moves it", () => {
    const clock = new ManualClock(new Date("2026-10-31T12:00:00.000Z"));

    expect(clock.now().toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  test("advances by milliseconds", () => {
    const clock = new ManualClock(new Date("2026-10-31T12:00:00.000Z"));

    clock.advanceBy(1500);

    expect(clock.now().toISOString()).toBe("2026-10-31T12:00:01.500Z");
  });

  test("hands out copies — a caller mutating the Date does not move the clock", () => {
    const start = new Date("2026-10-31T12:00:00.000Z");
    const clock = new ManualClock(start);

    clock.now().setFullYear(1999);
    start.setFullYear(1999);

    expect(clock.now().toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
});
