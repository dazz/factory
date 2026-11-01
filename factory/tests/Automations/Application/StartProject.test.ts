import { describe, expect, test } from "bun:test";
import { automationName, revision, subjectId } from "~/Automations/Domain/Ids.ts";
import { hangUntilAborted } from "~/Automations/Infrastructure/FakeHarness.ts";
import {
  composeTestProject,
  finding,
  invalidPolicy,
  missingPolicy,
  settle,
} from "../../Composition.ts";

describe("the start sequence", () => {
  test("valid policy: lock → replay → ProjectStarted → PolicyLoaded, in that order", async () => {
    const { start, log, lock, context } = composeTestProject();

    const result = await start();

    expect(result).toEqual({ kind: "started" });
    expect(log.names()).toEqual(["ProjectStarted", "PolicyLoaded"]);
    expect(lock.isHeld()).toBe(true);
    expect(context.policy?.tick.text).toBe("PT15M");
    expect(context.project.state()).toBe("idle");
  });

  test("scenario 4 — invalid policy pauses with the failing path as reason", async () => {
    const { start, tick, log, context } = composeTestProject({ policy: invalidPolicy() });

    await start();

    expect(log.names()).toEqual(["ProjectStarted", "ProjectPaused"]);
    expect(context.project.state()).toBe("paused");
    expect(context.project.pauseReason()).toContain("policy.limitz");

    // No session possible: a due tick is skipped without any input check.
    await tick();
    expect(log.names().at(-1)).toBe("TickSkipped");
  });

  test("scenario 7 — a pause survives the restart because it is replayed (FR-051)", async () => {
    const first = composeTestProject({ policy: invalidPolicy() });
    await first.start();

    const second = composeTestProject({ policy: invalidPolicy(), log: first.log });
    await second.start();

    expect(second.context.project.state()).toBe("paused");

    await second.tick();
    const events = second.log.appended();
    const last = events.at(-1);
    expect(last?.name).toBe("TickSkipped");
    expect(last?.name === "TickSkipped" && last.reason).toBe("paused");
  });

  test("crash during a session: the next generation aborts the orphan, input stays consumed", async () => {
    const first = composeTestProject();
    first.harness.script("board-walker", hangUntilAborted());
    first.tracker.present("board-walker", finding("ticket-42", "r1"));
    first.tick(); // never settles — the "crash"
    await settle();
    expect(first.log.names().at(-1)).toBe("SessionStarted");

    const second = composeTestProject({ log: first.log });
    await second.start();

    const names = second.log.names();
    const startIndex = names.lastIndexOf("ProjectStarted");
    expect(names.slice(startIndex)).toEqual(["ProjectStarted", "SessionAborted", "PolicyLoaded"]);
    expect(second.context.project.openSession()).toBeUndefined();
    expect(second.context.project.lastSession()?.outcome).toBe("aborted");
    expect(
      second.context.project.consumedRevision(
        automationName("board-walker"),
        subjectId("ticket-42"),
      ),
    ).toBe(revision("r1"));
  });

  test("unknown project: no policy file and no log — refused without creating ghost state", async () => {
    const { start, log } = composeTestProject({ policy: missingPolicy() });

    const result = await start();

    expect(result).toEqual({ kind: "unknown-project" });
    expect(log.appended()).toEqual([]);
  });

  test("a missing policy with an existing log pauses — the project is known", async () => {
    const first = composeTestProject();
    await first.start();

    const second = composeTestProject({ policy: missingPolicy(), log: first.log });
    const result = await second.start();

    expect(result).toEqual({ kind: "started" });
    expect(second.context.project.state()).toBe("paused");
  });

  test("a held lock refuses the start (exit 75 at the UI)", async () => {
    const project = composeTestProject();
    await project.lock.acquire();

    expect(await project.start()).toEqual({ kind: "lock-held" });
    expect(project.log.appended()).toEqual([]);
  });
});
