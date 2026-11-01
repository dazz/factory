import { type Command, ProcessResult, type ProcessRunner } from "~/Process/ProcessRunner.ts";

/** Stubs by `Command.toKey()`, records every call, and throws on an unstubbed one (dazzhub pattern). */
export class FakeProcessRunner implements ProcessRunner {
  private readonly stubs = new Map<string, ProcessResult>();
  private readonly calls: Command[] = [];

  stub(key: string, result: ProcessResult): this {
    this.stubs.set(key, result);
    return this;
  }

  succeedWith(key: string, stdout: string): this {
    return this.stub(key, new ProcessResult(0, `${stdout}\n`, ""));
  }

  failWith(key: string, stderr: string): this {
    return this.stub(key, new ProcessResult(1, "", `${stderr}\n`));
  }

  run(command: Command): Promise<ProcessResult> {
    this.calls.push(command);
    const stubbed = this.stubs.get(command.toKey());
    if (stubbed === undefined) {
      throw new Error(
        `FakeProcessRunner: no stub for \`${command.toKey()}\` — stubbed: ${
          [...this.stubs.keys()].join(" | ") || "nothing"
        }`,
      );
    }
    return Promise.resolve(stubbed);
  }

  /** Readable assertions. */
  keys(): string[] {
    return this.calls.map((call) => call.toKey());
  }
}
