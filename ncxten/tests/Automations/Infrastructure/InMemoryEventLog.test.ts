import { describe, expect, test } from "bun:test";
import type { Event } from "~/Automations/Domain/Event.ts";
import { InMemoryEventLog } from "~/Automations/Infrastructure/InMemoryEventLog.ts";

const at = new Date("2026-10-31T12:00:00.000Z");

describe("InMemoryEventLog", () => {
  test("replays what was appended, in order", async () => {
    const log = new InMemoryEventLog();
    await log.append({ name: "ProjectStarted", at });
    await log.append({ name: "ProjectIdled", at });

    const replayed: Event[] = [];
    for await (const event of log.replay()) replayed.push(event);

    expect(replayed.map((event) => event.name)).toEqual(["ProjectStarted", "ProjectIdled"]);
    expect(log.names()).toEqual(["ProjectStarted", "ProjectIdled"]);
  });

  test("an append during a replay does not leak into that replay", async () => {
    const log = new InMemoryEventLog();
    await log.append({ name: "ProjectStarted", at });

    const replayed: Event[] = [];
    for await (const event of log.replay()) {
      replayed.push(event);
      await log.append({ name: "ProjectIdled", at });
    }

    expect(replayed).toHaveLength(1);
    expect(log.appended()).toHaveLength(2);
  });
});
