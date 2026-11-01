import { describe, expect, test } from "bun:test";
import type {
  AutomationsSource,
  EventLog,
  Harness,
  InstanceLock,
  PolicySource,
  Tracker,
} from "~/Automations/Application/AutomationsPorts.ts";
import { automationName } from "~/Automations/Domain/Ids.ts";
import { FakeHarness } from "~/Automations/Infrastructure/FakeHarness.ts";
import { InMemoryEventLog } from "~/Automations/Infrastructure/InMemoryEventLog.ts";
import { InMemoryTracker } from "~/Automations/Infrastructure/InMemoryTracker.ts";
import {
  FakeInstanceLock,
  InMemoryAutomationsSource,
  InMemoryPolicySource,
  validAutomations,
  validPolicy,
} from "../../Composition.ts";

/**
 * The in-memory adapters satisfy the ports — the assignments are the
 * (compile-time) assertion; the smoke calls go through the port types only.
 * Scheduler and ControlChannel get their adapters in Phase 5 (T029/T031);
 * tests fire ticks directly (FR-020).
 */
describe("the ports and their in-memory adapters", () => {
  const log: EventLog = new InMemoryEventLog();
  const tracker: Tracker = new InMemoryTracker();
  const harness: Harness = new FakeHarness();
  const policySource: PolicySource = new InMemoryPolicySource(validPolicy());
  const automationsSource: AutomationsSource = new InMemoryAutomationsSource(validAutomations());
  const lock: InstanceLock = new FakeInstanceLock();

  test("EventLog: append and replay", async () => {
    await log.append({ name: "ProjectStarted", at: new Date() });
    const names: string[] = [];
    for await (const event of log.replay()) names.push(event.name);
    expect(names).toEqual(["ProjectStarted"]);
  });

  test("Tracker: findings per automation", async () => {
    expect(await tracker.findings(automationName("board-walker"))).toEqual([]);
  });

  test("PolicySource and AutomationsSource: parsed values, never raw text", async () => {
    expect(await policySource.read()).toHaveProperty("repository", "dazz/foo");
    expect(await automationsSource.read()).toHaveProperty("automations");
  });

  test("InstanceLock: acquire holds, isHeld probes", async () => {
    expect(lock.isHeld()).toBe(false);
    expect(await lock.acquire()).toBe(true);
    expect(lock.isHeld()).toBe(true);
    expect(await lock.acquire()).toBe(false);
  });

  test("Harness: runs a session", () => {
    expect(typeof harness.run).toBe("function");
  });
});
