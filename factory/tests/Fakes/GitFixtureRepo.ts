import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunProcessRunner } from "~/Process/BunProcessRunner.ts";
import { Command } from "~/Process/ProcessRunner.ts";

const VALID_C1 = `automations:
  - name: pull-request-reactor
    skill: react-to-reviews
  - name: board-walker
    skill: walk-the-board
    gate: make ci
`;

const INVALID_C2 = `automationz:
  - name: board-walker
    skill: walk-the-board
`;

const VALID_C3 = `automations:
  - name: pull-request-reactor
    skill: react-to-reviews
  - name: board-walker
    skill: walk-the-board
  - name: gardener
    skill: tend-the-backlog
`;

/**
 * The git fixture repo (quickstart): c1 valid → c2 invalid → c3 valid again
 * (healing, FR-013), in a temp dir, zero network. `advanceTo` moves the
 * branch head — what a merge does to the default branch.
 */
export async function gitFixtureRepo() {
  const runner = new BunProcessRunner();
  const path = await mkdtemp(join(tmpdir(), "factory-git-"));
  const git = async (...args: string[]) => {
    const command = Command.of("git", ["-C", path, ...args]);
    return (await runner.run(command)).outputOf(command);
  };

  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "factory@test");
  await git("config", "user.name", "factory");

  const commitFile = async (content: string, message: string) => {
    await writeFile(join(path, "automations.yml"), content);
    await git("add", "automations.yml");
    await git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };

  const c1 = await commitFile(VALID_C1, "c1 valid");
  const c2 = await commitFile(INVALID_C2, "c2 invalid");
  const c3 = await commitFile(VALID_C3, "c3 heals");

  return {
    path,
    commits: { c1, c2, c3 },
    advanceTo: (commit: string) => git("reset", "-q", "--hard", commit),
    remove: () => rm(path, { recursive: true, force: true }),
  };
}
