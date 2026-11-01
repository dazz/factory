import { type Command, ProcessResult, type ProcessRunner } from "~/Process/ProcessRunner.ts";

/**
 * The only file in `src/` that may spawn a process (enforced by the boundary
 * test, as in dazzhub). `Bun.spawn([program, ...args])` starts no shell.
 * In 001 only git runs through it; the Claude harness joins with 002.
 */
export class BunProcessRunner implements ProcessRunner {
  async run(command: Command): Promise<ProcessResult> {
    const child = spawn(command);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return new ProcessResult(code, stdout, stderr);
  }
}

function spawn(command: Command) {
  try {
    return Bun.spawn([command.program, ...command.args], {
      env: { ...process.env, ...command.environment },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new Error(`${command.program} is not installed or not on PATH`);
    }
    throw error;
  }
}
