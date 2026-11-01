import { describe, expect, test } from "bun:test";
import { HEARTBEAT_INTERVAL } from "~/Automations/Application/RecordHeartbeat.ts";
import { composeTestProject } from "../../Composition.ts";

describe("RecordHeartbeat", () => {
  test("appends the beat and applies it — liveness only, state unchanged (FR-028)", async () => {
    const t = composeTestProject();
    await t.start();

    await t.heartbeat();

    expect(t.log.names().at(-1)).toBe("HeartbeatRecorded");
    expect(t.context.project.state()).toBe("idle");
  });

  test("the cadence is the named 5-minute constant (Uptime period plus grace)", () => {
    expect(HEARTBEAT_INTERVAL.text).toBe("PT5M");
    expect(HEARTBEAT_INTERVAL.milliseconds).toBe(5 * 60 * 1000);
  });
});
