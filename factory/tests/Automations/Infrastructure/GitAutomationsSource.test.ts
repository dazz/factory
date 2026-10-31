import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GitAutomationsSource } from "~/Automations/Infrastructure/GitAutomationsSource.ts";
import { BunProcessRunner } from "~/Process/BunProcessRunner.ts";
import { gitFixtureRepo } from "../../Fakes/GitFixtureRepo.ts";

let fixture: Awaited<ReturnType<typeof gitFixtureRepo>>;
let source: GitAutomationsSource;

beforeAll(async () => {
  fixture = await gitFixtureRepo();
  source = new GitAutomationsSource(fixture.path, new BunProcessRunner());
});

afterAll(async () => {
  await fixture.remove();
});

describe("GitAutomationsSource", () => {
  test("reads parsed automations and their commit from the branch head", async () => {
    await fixture.advanceTo(fixture.commits.c1);

    const reading = await source.read();

    expect("automations" in reading).toBe(true);
    if (!("automations" in reading)) return;
    expect(String(reading.automations.commit)).toBe(fixture.commits.c1);
    const names = reading.automations.inOrder().map((automation) => String(automation.name));
    expect(names).toEqual(["pull-request-reactor", "board-walker"]);
    expect(reading.automations.inOrder()[1]?.gate).toBe("make ci");
  });

  test("an invalid turn reports the problem with its path and the breaking commit", async () => {
    await fixture.advanceTo(fixture.commits.c2);

    const reading = await source.read();

    expect("problem" in reading && reading.problem).toContain("automationz");
    expect("commit" in reading && String(reading.commit)).toBe(fixture.commits.c2);
  });

  test("a later valid commit heals (FR-013)", async () => {
    await fixture.advanceTo(fixture.commits.c3);

    const reading = await source.read();

    expect("automations" in reading).toBe(true);
    if (!("automations" in reading)) return;
    expect(String(reading.automations.commit)).toBe(fixture.commits.c3);
    expect(reading.automations.inOrder()).toHaveLength(3);
  });
});
