import { describe, expect, test } from "bun:test";
import { HEARTBEAT_INTERVAL } from "~/Automations/Application/AutomationsPorts.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { TimerScheduler } from "~/Automations/Infrastructure/TimerScheduler.ts";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("TimerScheduler", () => {
  test("fires on its interval until stopped — sub-second, not through the bounded policy tick", async () => {
    const scheduler = new TimerScheduler();
    let fired = 0;

    const stop = scheduler.start(IsoDuration.parse("PT0.02S", "test interval"), () => {
      fired += 1;
      return Promise.resolve();
    });
    await sleep(90);
    stop();
    const atStop = fired;
    await sleep(50);

    expect(atStop).toBeGreaterThanOrEqual(2);
    expect(fired).toBe(atStop);
  });

  test("the schedule keeps firing when a fire handles its own failure (FR-053 is the caller's)", async () => {
    const scheduler = new TimerScheduler();
    let fired = 0;

    const stop = scheduler.start(IsoDuration.parse("PT0.02S", "test interval"), () => {
      fired += 1;
      return Promise.reject(new Error("one bad tick")).catch(() => undefined);
    });
    await sleep(70);
    stop();

    expect(fired).toBeGreaterThanOrEqual(2);
  });

  test("the heartbeat interval is the named 5-minute constant (Uptime period)", () => {
    expect(HEARTBEAT_INTERVAL.text).toBe("PT5M");
    expect(HEARTBEAT_INTERVAL.milliseconds).toBe(5 * 60 * 1000);
  });
});
