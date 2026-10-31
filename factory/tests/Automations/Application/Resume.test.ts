import { describe, expect, test } from "bun:test";
import { composeTestProject, invalidPolicy, validPolicy } from "../../Composition.ts";

describe("resume", () => {
  test("scenario 6 — a fixed policy resumes: PolicyLoaded before ProjectResumed", async () => {
    const project = composeTestProject({ policy: invalidPolicy() });
    await project.start();

    // No resume yet: a due tick stays skipped, the pause stays.
    await project.tick();
    expect(project.log.names().at(-1)).toBe("TickSkipped");
    expect(project.context.project.state()).toBe("paused");

    // The fix on disk, then the resume re-reads and re-validates.
    project.policySource.set(validPolicy());
    const result = await project.resume();

    expect(result).toEqual({ kind: "resumed" });
    expect(project.log.names().slice(-2)).toEqual(["PolicyLoaded", "ProjectResumed"]);
    expect(project.context.project.state()).toBe("idle");
    expect(project.context.policy?.tick.text).toBe("PT15M");

    // Ticking works again.
    await project.tick();
    expect(project.log.names().at(-1)).toBe("ProjectIdled");
  });

  test("resume while the cause persists: ResumeFailed with the new reason, still paused", async () => {
    const project = composeTestProject({ policy: invalidPolicy() });
    await project.start();

    project.policySource.set(invalidPolicy("policy.tick: PT15S is below the minimum PT1M"));
    const result = await project.resume();

    expect(result).toEqual({
      kind: "failed",
      reason: "policy.tick: PT15S is below the minimum PT1M",
    });
    expect(project.log.names().at(-1)).toBe("ResumeFailed");
    expect(project.context.project.state()).toBe("paused");
    expect(project.context.project.pauseReason()).toContain("PT15S");
  });

  test("resume when not paused: ResumeIgnored, the policy is not even re-read (FR-051)", async () => {
    const project = composeTestProject();
    await project.start();
    const readsAfterStart = project.policySource.reads;

    const result = await project.resume();

    expect(result).toEqual({ kind: "ignored" });
    expect(project.log.names().at(-1)).toBe("ResumeIgnored");
    expect(project.policySource.reads).toBe(readsAfterStart);
  });
});
