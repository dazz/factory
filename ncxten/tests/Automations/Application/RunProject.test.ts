import { describe, expect, test } from "bun:test";
import { EventLogUnwritable } from "~/Automations/Application/EventLogUnwritable.ts";
import type { RunHandle } from "~/Automations/Application/RunProject.ts";
import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";
import {
  BreakableLog,
  composeTestProject,
  invalidPolicy,
  missingPolicy,
  settle,
  validPolicy,
} from "../../Composition.ts";

function started(handle: RunHandle): Extract<RunHandle, { kind: "started" }> {
  if (handle.kind !== "started") throw new Error(`expected started, got ${handle.kind}`);
  return handle;
}

describe("RunProject", () => {
  test("start sequence, ticks at the policy interval, heartbeat, clean shutdown", async () => {
    const t = composeTestProject({
      policy: validPolicy({ tick: IsoDuration.parse("PT10M", "x") }),
    });

    const handle = started(await t.run());

    expect(handle.pauseReason).toBeUndefined();
    expect(t.log.names()).toEqual(["ProjectStarted", "PolicyLoaded"]);
    expect(t.scheduler.jobs.map((job) => job.interval.text)).toEqual(["PT10M", "PT5M"]);

    await t.scheduler.jobs[1]?.fire(); // the liveness heartbeat (FR-028)
    expect(t.log.names().at(-1)).toBe("HeartbeatRecorded");

    await t.scheduler.jobs[0]?.fire(); // a due tick drains
    expect(t.log.names().at(-1)).toBe("ProjectIdled");

    t.control.tickNow?.(); // SIGUSR1 → one manual tick
    await settle();
    expect(t.log.names().at(-1)).toBe("ProjectIdled");

    t.control.shutdown?.(); // SIGTERM → the clean end
    await handle.finished;
    expect(t.scheduler.jobs.every((job) => job.stopped)).toBe(true);
  });

  test("an invalid policy starts paused, ticking at the schema default", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });

    const handle = started(await t.run());

    expect(handle.pauseReason).toContain("policy.limitz");
    expect(t.scheduler.jobs[0]?.interval.text).toBe("PT15M");
    t.control.shutdown?.();
    await handle.finished;
  });

  test("SIGHUP lands on the resume use-case; the resumed policy's tick takes effect now", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    const handle = started(await t.run());
    t.policySource.set(validPolicy({ tick: IsoDuration.parse("PT10M", "x") }));

    t.control.resume?.();
    await settle();

    expect(t.log.names().slice(-2)).toEqual(["PolicyLoaded", "ProjectResumed"]);
    // The paused-start default timer stops; the policy's interval replaces it.
    expect(t.scheduler.jobs.map((job) => [job.interval.text, job.stopped])).toEqual([
      ["PT15M", true],
      ["PT5M", false],
      ["PT10M", false],
    ]);
    await t.scheduler.jobs[2]?.fire(); // the new timer drives real ticks
    expect(t.log.names().at(-1)).toBe("ProjectIdled");

    t.control.shutdown?.();
    await handle.finished;
    expect(t.scheduler.jobs.every((job) => job.stopped)).toBe(true);
  });

  test("a failed resume keeps the running timer — nothing to retune (FR-051)", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    const handle = started(await t.run());
    t.policySource.set(invalidPolicy("policy.tick: not an ISO duration"));

    t.control.resume?.();
    await settle();

    expect(t.log.names().at(-1)).toBe("ResumeFailed");
    expect(t.scheduler.jobs.map((job) => job.stopped)).toEqual([false, false]);
    t.control.shutdown?.();
    await handle.finished;
  });

  test("a held lock refuses, an unknown project refuses without ghost state", async () => {
    const held = composeTestProject();
    await held.lock.acquire();
    expect((await held.run()).kind).toBe("lock-held");

    const unknown = composeTestProject({ policy: missingPolicy() });
    expect((await unknown.run()).kind).toBe("unknown-project");
    expect(unknown.log.appended()).toEqual([]);
  });

  test("FR-053 — a failed append ends the run instead of acting on", async () => {
    const log = new BreakableLog();
    const t = composeTestProject({ log });
    const handle = started(await t.run());

    log.broken = true;
    await t.scheduler.jobs[0]?.fire(); // the scheduled tick hits the full disk

    expect(handle.finished).rejects.toThrow(EventLogUnwritable);
    await handle.finished.catch(() => undefined);
    expect(t.scheduler.jobs.every((job) => job.stopped)).toBe(true);
  });
});
