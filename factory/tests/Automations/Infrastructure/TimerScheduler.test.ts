import { describe, expect, test } from "bun:test";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import { HEARTBEAT_INTERVAL, TimerScheduler } from "~/Automations/Infrastructure/TimerScheduler.ts";

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

  test("a rejecting fire does not kill the schedule", async () => {
    const scheduler = new TimerScheduler();
    let fired = 0;

    const stop = scheduler.start(IsoDuration.parse("PT0.02S", "test interval"), () => {
      fired += 1;
      return Promise.reject(new Error("one bad tick"));
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
