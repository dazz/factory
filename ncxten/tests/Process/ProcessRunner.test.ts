import { describe, expect, test } from "bun:test";
import { Command, ProcessResult } from "~/Process/ProcessRunner.ts";

describe("Command", () => {
  test("carries program, argv and extra environment", () => {
    const command = Command.of("git", ["rev-parse", "HEAD"], { GIT_PAGER: "cat" });

    expect(command.program).toBe("git");
    expect(command.args).toEqual(["rev-parse", "HEAD"]);
    expect(command.environment).toEqual({ GIT_PAGER: "cat" });
    expect(command.toKey()).toBe("git rev-parse HEAD");
  });

  test("rejects anything but a bare program name — no paths, no shell syntax", () => {
    for (const program of ["/usr/bin/git", "git status", "git;rm", "$(git)", ""]) {
      expect(() => Command.of(program)).toThrow("not a bare program name");
    }
  });
});

describe("ProcessResult", () => {
  test("outputOf returns the trimmed stdout of a success", () => {
    const result = new ProcessResult(0, "abc123\n", "");

    expect(result.ok).toBe(true);
    expect(result.outputOf(Command.of("git", ["rev-parse", "HEAD"]))).toBe("abc123");
  });

  test("outputOf throws on failure, naming command and stderr", () => {
    const result = new ProcessResult(128, "", "fatal: not a git repository\n");

    expect(() => result.outputOf(Command.of("git", ["rev-parse", "HEAD"]))).toThrow(
      "`git rev-parse HEAD` exited 128: fatal: not a git repository",
    );
  });
});
