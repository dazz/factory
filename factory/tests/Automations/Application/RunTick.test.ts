import { describe, expect, test } from "bun:test";
import { automationName } from "~/Automations/Domain/Ids.ts";
import { fail, hangUntilAborted } from "~/Automations/Infrastructure/FakeHarness.ts";
import {
  composeTestProject,
  finding,
  invalidAutomations,
  invalidPolicy,
  neverValid,
  settle,
  validAutomations,
} from "../../Composition.ts";

describe("the tick", () => {
  test("scenario 1 — idle tick: no findings, no session, the harness is never called", async () => {
    const { tick, log, harness } = composeTestProject();

    await tick();

    expect(log.names()).toEqual(["AutomationsLoaded", "ProjectIdled"]);
    expect(harness.calls()).toEqual([]);
  });

  test("scenario 2 — one input, one session, the limits arrive in the harness", async () => {
    const { tick, log, harness, tracker } = composeTestProject();
    tracker.present("board-walker", finding("ticket-42", "r1"));

    await tick();

    expect(log.names()).toEqual([
      "AutomationsLoaded",
      "SessionStarted",
      "SessionFinished",
      "ProjectIdled",
    ]);
    const started = log.appended()[1];
    expect(started?.name === "SessionStarted" && started.automation).toBe(
      automationName("board-walker"),
    );
    expect(started?.name === "SessionStarted" && String(started.subject)).toBe("ticket-42");
    expect(started?.name === "SessionStarted" && String(started.revision)).toBe("r1");
    expect(harness.calls()[0]?.limits.turns).toBe(50);
    expect(harness.calls()[0]?.limits.time.text).toBe("PT20M");
  });

  test("scenario 3 — an invalid turn keeps the last valid version in effect", async () => {
    const { tick, log, tracker, automationsSource } = composeTestProject({
      automations: validAutomations("c1"),
    });
    await tick(); // loads c1

    automationsSource.advanceTo(invalidAutomations("c2"));
    tracker.present("board-walker", finding("ticket-42", "r1"));
    await tick();

    const names = log.names();
    expect(names).toContain("AutomationsInvalid");
    const invalid = log.appended().find((event) => event.name === "AutomationsInvalid");
    expect(invalid?.name === "AutomationsInvalid" && String(invalid.keptCommit)).toBe("c1");
    // the automations of c1 still run, and ticking continues
    expect(names.filter((name) => name === "SessionStarted")).toHaveLength(1);
    expect(names.at(-1)).toBe("ProjectIdled");
  });

  test("scenario 5 — no parallel session: a tick during a drain is skipped", async () => {
    const { tick, log, harness, tracker } = composeTestProject();
    harness.script("board-walker", hangUntilAborted());
    tracker.present("board-walker", finding("ticket-42", "r1"));

    tick(); // hangs in the session
    await settle();
    await tick();

    const names = log.names();
    expect(names.filter((name) => name === "SessionStarted")).toHaveLength(1);
    const last = log.appended().at(-1);
    expect(last?.name).toBe("TickSkipped");
    expect(last?.name === "TickSkipped" && last.reason).toBe("running");
    expect(last?.name === "TickSkipped" && last.trigger).toBe("schedule");
  });

  test("scenario 8 — the drain runs automations in list order, strictly sequential", async () => {
    const { tick, log, tracker } = composeTestProject();
    tracker.present("board-walker", finding("ticket-42", "r1"));
    tracker.present("pull-request-reactor", finding("pr-7", "r1"));

    await tick();

    const sessions = log
      .appended()
      .filter((event) => event.name === "SessionStarted")
      .map((event) => (event.name === "SessionStarted" ? String(event.automation) : ""));
    expect(sessions).toEqual(["pull-request-reactor", "board-walker"]);
    expect(log.names().at(-1)).toBe("ProjectIdled");
  });

  test("scenario 9 — a failed session consumes its input: no retry loop", async () => {
    const { tick, log, harness, tracker } = composeTestProject();
    harness.script("board-walker", fail());
    tracker.present("board-walker", finding("ticket-42", "r1"));

    await tick();
    const afterFirst = log.names();
    expect(afterFirst).toEqual([
      "AutomationsLoaded",
      "SessionStarted",
      "SessionFinished",
      "ProjectIdled",
    ]);

    await tick(); // the finding is still presented — but consumed
    expect(log.names().slice(afterFirst.length)).toEqual(["ProjectIdled"]);
  });

  test("a tick on a paused project is skipped without any input check (FR-024)", async () => {
    const { start, tick, log, tracker } = composeTestProject({ policy: invalidPolicy() });
    await start();
    tracker.present("board-walker", finding("ticket-42", "r1"));

    await tick("manual");

    const last = log.appended().at(-1);
    expect(last?.name).toBe("TickSkipped");
    expect(last?.name === "TickSkipped" && last.reason).toBe("paused");
    expect(last?.name === "TickSkipped" && last.trigger).toBe("manual");
  });

  test("never-valid automations: the project keeps ticking idle and heals on a valid commit", async () => {
    const { tick, log, automationsSource } = composeTestProject({ automations: neverValid() });

    await tick();
    expect(log.names()).toEqual(["AutomationsNeverValid", "ProjectIdled"]);

    automationsSource.advanceTo(validAutomations("c3"));
    await tick();
    expect(log.names().slice(2)).toEqual(["AutomationsLoaded", "ProjectIdled"]);
  });

  test("an unchanged commit loads nothing again", async () => {
    const { tick, log } = composeTestProject();

    await tick();
    await tick();

    expect(log.names()).toEqual(["AutomationsLoaded", "ProjectIdled", "ProjectIdled"]);
  });
});
