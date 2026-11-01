import { describe, expect, test } from "bun:test";
import { composeTestProject, missingPolicy } from "../../Composition.ts";

describe("RequestTick", () => {
  test("stopped project: a one-shot generation runs the full start sequence, then one tick", async () => {
    const t = composeTestProject();

    expect(await t.requestTick()).toEqual({ kind: "ticked" });

    expect(t.log.names()).toEqual([
      "ProjectStarted",
      "PolicyLoaded",
      "AutomationsLoaded",
      "ProjectIdled",
    ]);
  });

  test("running project: SIGUSR1 to the PID from the pidfile", async () => {
    const t = composeTestProject();
    await t.lock.acquire();
    t.lock.pid = 4242;

    expect(await t.requestTick()).toEqual({ kind: "nudged", pid: 4242 });

    expect(t.control.signals).toEqual([{ pid: 4242, signal: "SIGUSR1" }]);
    expect(t.log.appended()).toEqual([]); // the running process writes, not the CLI
  });

  test("running, but the pidfile holds no PID yet", async () => {
    const t = composeTestProject();
    await t.lock.acquire();

    expect(await t.requestTick()).toEqual({ kind: "no-pid" });
    expect(t.control.signals).toEqual([]);
  });

  test("unknown project refuses without ghost state", async () => {
    const t = composeTestProject({ policy: missingPolicy() });

    expect(await t.requestTick()).toEqual({ kind: "unknown-project" });
    expect(t.log.appended()).toEqual([]);
  });
});
