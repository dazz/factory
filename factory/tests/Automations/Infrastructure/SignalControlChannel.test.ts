import { afterEach, describe, expect, test } from "bun:test";
import { hangUntilAborted } from "~/Automations/Infrastructure/FakeHarness.ts";
import { SignalControlChannel } from "~/Automations/Infrastructure/SignalControlChannel.ts";
import { composeTestProject, finding, settle } from "../../Composition.ts";

afterEach(() => {
  process.removeAllListeners("SIGHUP");
  process.removeAllListeners("SIGUSR1");
});

describe("SignalControlChannel", () => {
  test("SIGHUP lands on onResume, SIGUSR1 on onTickNow", async () => {
    const channel = new SignalControlChannel();
    const received: string[] = [];
    channel.onResume(() => received.push("resume"));
    channel.onTickNow(() => received.push("tick-now"));

    process.kill(process.pid, "SIGUSR1");
    await settle();
    process.kill(process.pid, "SIGHUP");
    await settle();

    expect(received).toEqual(["tick-now", "resume"]);
  });

  test("a tick-now during a running drain is skipped per FR-023", async () => {
    const project = composeTestProject();
    const channel = new SignalControlChannel();
    channel.onTickNow(() => void project.tick("manual"));
    project.harness.script("board-walker", hangUntilAborted());
    project.tracker.present("board-walker", finding("ticket-42", "r1"));

    project.tick(); // hangs in the session
    await settle();
    process.kill(process.pid, "SIGUSR1"); // the handler runs between the drain's awaits
    await settle();

    const last = project.log.appended().at(-1);
    expect(last?.name).toBe("TickSkipped");
    expect(last?.name === "TickSkipped" && last.reason).toBe("running");
    expect(last?.name === "TickSkipped" && last.trigger).toBe("manual");
    expect(project.log.names().filter((name) => name === "SessionStarted")).toHaveLength(1);
  });
});
