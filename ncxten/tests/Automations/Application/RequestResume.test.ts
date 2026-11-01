import { describe, expect, test } from "bun:test";
import {
  composeTestProject,
  invalidPolicy,
  missingPolicy,
  validPolicy,
} from "../../Composition.ts";

describe("RequestResume", () => {
  test("stopped + fixed policy: one-shot resumes — PolicyLoaded before ProjectResumed", async () => {
    const first = composeTestProject({ policy: invalidPolicy() });
    await first.start();
    first.lock.release(); // the paused process stopped

    const second = composeTestProject({ policy: invalidPolicy(), log: first.log });
    second.policySource.set(validPolicy());

    expect(await second.requestResume()).toEqual({ kind: "resumed" });
    expect(second.log.names().slice(-2)).toEqual(["PolicyLoaded", "ProjectResumed"]);
  });

  test("running + paused: SIGHUP, then the result polled from the log", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    await t.start(); // paused, lock held
    t.lock.pid = 4242;
    t.policySource.set(validPolicy());
    t.control.remote = () => void t.resume(); // what the running process does on SIGHUP

    expect(await t.requestResume()).toEqual({ kind: "resumed" });
    expect(t.control.signals).toEqual([{ pid: 4242, signal: "SIGHUP" }]);
  });

  test("running + still broken: the new reason polled from the log", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    await t.start();
    t.lock.pid = 4242;
    t.policySource.set(invalidPolicy("policy.tick: not an ISO duration"));
    t.control.remote = () => void t.resume();

    expect(await t.requestResume()).toEqual({
      kind: "failed",
      reason: "policy.tick: not an ISO duration",
    });
  });

  test("running + not paused: SIGHUP sent, result ignored (FR-051)", async () => {
    const t = composeTestProject();
    await t.start();
    t.lock.pid = 4242;

    expect(await t.requestResume()).toEqual({ kind: "ignored" });
    expect(t.control.signals).toEqual([{ pid: 4242, signal: "SIGHUP" }]);
  });

  test("running + no reaction in the poll window: requested", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    await t.start();
    t.lock.pid = 4242; // no remote wired: the "running process" never reacts

    expect(await t.requestResume()).toEqual({ kind: "requested" });
  });

  test("running, but the pidfile holds no PID yet", async () => {
    const t = composeTestProject({ policy: invalidPolicy() });
    await t.start();

    expect(await t.requestResume()).toEqual({ kind: "no-pid" });
  });

  test("unknown project refuses without ghost state", async () => {
    const t = composeTestProject({ policy: missingPolicy() });

    expect(await t.requestResume()).toEqual({ kind: "unknown-project" });
    expect(t.log.appended()).toEqual([]);
  });
});
