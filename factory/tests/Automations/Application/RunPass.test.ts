import { describe, expect, test } from "bun:test";
import { RunPass } from "~/Automations/Application/RunPass.ts";
import { automationName, subjectId } from "~/Automations/Domain/Ids.ts";
import { composeTestProject, finding, validAutomations, validPolicy } from "../../Composition.ts";

function compose() {
  const project = composeTestProject();
  const { harness, tracker, log, clock, context } = project;
  const runPass = new RunPass({ tracker, harness, log, clock }, context);
  const reading = validAutomations();
  if (!("automations" in reading)) throw new Error("fixture");
  return { ...project, runPass, automations: reading.automations, limits: validPolicy().limits };
}

describe("one pass", () => {
  test("no new input → empty pass, nothing appended, no harness call", async () => {
    const { runPass, automations, limits, log, harness } = compose();

    expect(await runPass.run(automations, limits)).toBe("empty-pass");
    expect(log.appended()).toEqual([]);
    expect(harness.calls()).toEqual([]);
  });

  test("FR-043 — SessionStarted is appended before the harness is dispatched", async () => {
    const { runPass, automations, limits, log, harness, tracker } = compose();
    tracker.present("board-walker", finding("ticket-42", "r1"));
    let namesWhenDispatched: readonly string[] = [];
    harness.script("board-walker", () => {
      namesWhenDispatched = log.names();
      return Promise.resolve("succeeded");
    });

    expect(await runPass.run(automations, limits)).toBe("session-ran");

    expect(namesWhenDispatched).toEqual(["SessionStarted"]);
    expect(log.names()).toEqual(["SessionStarted", "SessionFinished"]);
  });

  test("starting consumes the input, whatever the outcome (FR-035)", async () => {
    const { runPass, automations, limits, context, tracker, harness } = compose();
    tracker.present("board-walker", finding("ticket-42", "r1"));
    harness.script("board-walker", () => Promise.resolve("failed"));

    await runPass.run(automations, limits);

    expect(
      String(
        context.project.consumedRevision(automationName("board-walker"), subjectId("ticket-42")),
      ),
    ).toBe("r1");
    // The same finding is still presented — the next pass is empty.
    expect(await runPass.run(automations, limits)).toBe("empty-pass");
  });

  test("an aborted outcome ends as SessionAborted, not SessionFinished", async () => {
    const { runPass, automations, limits, log, tracker, harness } = compose();
    tracker.present("board-walker", finding("ticket-42", "r1"));
    harness.script("board-walker", () => Promise.resolve("aborted"));

    await runPass.run(automations, limits);

    expect(log.names()).toEqual(["SessionStarted", "SessionAborted"]);
  });
});
