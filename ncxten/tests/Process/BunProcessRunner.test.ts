import { describe, expect, test } from "bun:test";
import { BunProcessRunner } from "~/Process/BunProcessRunner.ts";
import { Command } from "~/Process/ProcessRunner.ts";

const runner = new BunProcessRunner();

describe("BunProcessRunner", () => {
  test("runs a real program and captures code and stdout", async () => {
    const result = await runner.run(Command.of("echo", ["hello"]));

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello\n");
  });

  test("a non-zero exit is a result, not an exception", async () => {
    const result = await runner.run(Command.of("false"));

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
  });

  test("the extra environment reaches the child", async () => {
    const result = await runner.run(
      Command.of("printenv", ["FACTORY_PROBE"], { FACTORY_PROBE: "it-works" }),
    );

    expect(result.stdout.trim()).toBe("it-works");
  });

  test("a missing program names itself", async () => {
    expect(runner.run(Command.of("definitely-not-installed-xyz"))).rejects.toThrow(
      "definitely-not-installed-xyz is not installed or not on PATH",
    );
  });
});
