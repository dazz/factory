/** A bare program name — no path, no shell metacharacters, nothing to interpolate. */
const BARE_PROGRAM = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * One external program and its argument vector (ported from dazzhub). No
 * shell is involved anywhere: argv elements are values, never syntax.
 */
export class Command {
  private constructor(
    readonly program: string,
    readonly args: readonly string[],
    readonly environment: Readonly<Record<string, string>>,
  ) {}

  /** `environment` is added to the inherited one; it is not part of the identity (`toKey`). */
  static of(
    program: string,
    args: readonly string[] = [],
    environment: Readonly<Record<string, string>> = {},
  ): Command {
    if (!BARE_PROGRAM.test(program)) {
      throw new Error(
        `not a bare program name: ${JSON.stringify(program)} — commands are looked up on PATH`,
      );
    }
    return new Command(program, [...args], { ...environment });
  }

  /** Identity for logs and for stubbing. */
  toKey(): string {
    return [this.program, ...this.args].join(" ");
  }
}

export class ProcessResult {
  constructor(
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {}

  get ok(): boolean {
    return this.code === 0;
  }

  /** The trimmed stdout of a successful run; anything else throws. */
  outputOf(command: Command): string {
    if (!this.ok) {
      const detail = this.stderr.trim() || this.stdout.trim() || "no output";
      throw new Error(`\`${command.toKey()}\` exited ${this.code}: ${detail}`);
    }
    return this.stdout.trim();
  }
}

/** The seam: everything leaving this process goes through here, so tests see only the fake. */
export interface ProcessRunner {
  run(command: Command): Promise<ProcessResult>;
}
