import { Command } from "@cliffy/command";

const VERSION = "0.1.0";

/**
 * The composition root. T004 walking skeleton: only `--help`/`--version` —
 * the commands (start | tick | status | resume) grow here in Phase 6
 * (contracts/cli.md). Spawns nothing itself: processes go through the
 * ProcessRunner adapter.
 */
export function cli(): Command {
  return new Command()
    .name("factory")
    .version(VERSION)
    .description("The software factory: one project process per repository.")
    .action(function (this: Command) {
      this.showHelp();
    });
}

if (import.meta.main) {
  await cli().parse();
}
