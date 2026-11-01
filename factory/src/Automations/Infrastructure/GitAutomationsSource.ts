import { z } from "zod";
import type {
  AutomationsReading,
  AutomationsSource,
} from "~/Automations/Application/AutomationsPorts.ts";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { Automations } from "~/Automations/Domain/Automations.ts";
import { automationName, commitId } from "~/Automations/Domain/Ids.ts";
import { Command, type ProcessRunner } from "~/Process/ProcessRunner.ts";

/**
 * The strict schema of `automations.yml` (contracts/automations.md): an
 * unknown key makes the file invalid, because "the repo proposes" must not
 * smuggle undeclared behavior past the schema.
 */
const SCHEMA = z.strictObject({
  automations: z
    .array(
      z.strictObject({
        name: z.string(),
        skill: z.string(),
        gate: z.string().optional(),
      }),
    )
    .min(1, "at least one automation is required"),
});

/**
 * Reads `automations.yml` + commit from the head of a **local** repo — via
 * the ProcessRunner (`git rev-parse`, `git show`), zero network. The checkout
 * sits on the default branch; changes take effect after merge (FR-010).
 * Returns parsed `Automations` or a problem, each with its commit.
 */
export class GitAutomationsSource implements AutomationsSource {
  constructor(
    private readonly checkout: string,
    private readonly runner: ProcessRunner,
  ) {}

  async read(): Promise<AutomationsReading> {
    const git = (...args: string[]) => Command.of("git", ["-C", this.checkout, ...args]);
    // A checkout that is no repo is a broken installation, not an invalid
    // file: outputOf throws and the error surfaces as exit 1.
    const revParse = git("rev-parse", "HEAD");
    const commit = commitId((await this.runner.run(revParse)).outputOf(revParse));

    const shown = await this.runner.run(git("show", "HEAD:automations.yml"));
    if (!shown.ok) {
      return { problem: `automations.yml: ${shown.stderr.trim() || "not in the repo"}`, commit };
    }

    let data: unknown;
    try {
      data = Bun.YAML.parse(shown.stdout);
    } catch (error) {
      return { problem: `automations.yml is not YAML: ${(error as Error).message}`, commit };
    }

    const parsed = SCHEMA.safeParse(data);
    if (!parsed.success) {
      // Prefer the unknown-key issue — the typo's own path, not what it shadows.
      const issue =
        parsed.error.issues.find((candidate) => candidate.code === "unrecognized_keys") ??
        parsed.error.issues[0];
      const path = issue?.path.join(".") || "automations.yml";
      return { problem: `${path}: ${issue?.message ?? "invalid"}`, commit };
    }

    try {
      return {
        automations: Automations.of(
          parsed.data.automations.map(
            (entry) => new Automation(automationName(entry.name), entry.skill, entry.gate),
          ),
          commit,
        ),
      };
    } catch (error) {
      // The domain's own validation: kebab-case names, uniqueness, non-empty refs.
      return { problem: (error as Error).message, commit };
    }
  }
}
