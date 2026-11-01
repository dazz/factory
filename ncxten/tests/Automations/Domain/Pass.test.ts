import { describe, expect, test } from "bun:test";
import { Automation } from "~/Automations/Domain/Automation.ts";
import { Automations } from "~/Automations/Domain/Automations.ts";
import type { Finding } from "~/Automations/Domain/ConsumedInput.ts";
import {
  type AutomationName,
  automationName,
  commitId,
  type Revision,
  revision,
  type SubjectId,
  subjectId,
} from "~/Automations/Domain/Ids.ts";
import { findHit } from "~/Automations/Domain/Pass.ts";

const reactor = automationName("pull-request-reactor");
const walker = automationName("board-walker");
const automations = Automations.of(
  [new Automation(reactor, "react-to-reviews"), new Automation(walker, "walk-the-board")],
  commitId("c1"),
);

function finding(subject: string, rev: string): Finding {
  return { subject: subjectId(subject), revision: revision(rev) };
}

function nothingConsumed(): undefined {
  return undefined;
}

function consumedMap(entries: ReadonlyArray<[AutomationName, string, string]>) {
  const map = new Map(entries.map(([a, s, r]) => [`${a} ${s}`, revision(r)]));
  return (automation: AutomationName, subject: SubjectId): Revision | undefined =>
    map.get(`${automation} ${subject}`);
}

describe("the pass decision", () => {
  test("no findings → the pass is empty", () => {
    expect(findHit(automations, new Map(), nothingConsumed)).toBeUndefined();
  });

  test("the first automation in list order with new input is the hit", () => {
    const findings = new Map([
      [reactor, [finding("pr-7", "r1")]],
      [walker, [finding("ticket-42", "r3")]],
    ]);

    const hit = findHit(automations, findings, nothingConsumed);

    expect(hit?.automation.name).toBe(reactor);
    expect(hit?.input.subject).toBe(subjectId("pr-7"));
    expect(hit?.input.revision).toBe(revision("r1"));
  });

  test("a consumed finding is not new — whatever the session's outcome was (FR-035)", () => {
    const findings = new Map([[walker, [finding("ticket-42", "r3")]]]);
    const consumed = consumedMap([[walker, "ticket-42", "r3"]]);

    expect(findHit(automations, findings, consumed)).toBeUndefined();
  });

  test("a new revision of a consumed subject is new input again", () => {
    const findings = new Map([[walker, [finding("ticket-42", "r4")]]]);
    const consumed = consumedMap([[walker, "ticket-42", "r3"]]);

    expect(findHit(automations, findings, consumed)?.input.revision).toBe(revision("r4"));
  });

  test("consumption is per automation — another automation may still react to the subject", () => {
    const findings = new Map([
      [reactor, [finding("ticket-42", "r3")]],
      [walker, [finding("ticket-42", "r3")]],
    ]);
    const consumed = consumedMap([[reactor, "ticket-42", "r3"]]);

    expect(findHit(automations, findings, consumed)?.automation.name).toBe(walker);
  });

  test("within one automation, the first new finding wins in tracker order", () => {
    const findings = new Map([[walker, [finding("ticket-1", "r1"), finding("ticket-2", "r1")]]]);
    const consumed = consumedMap([[walker, "ticket-1", "r1"]]);

    expect(findHit(automations, findings, consumed)?.input.subject).toBe(subjectId("ticket-2"));
  });

  test("exactly one hit per pass — a lower automation with new input waits for the next pass", () => {
    const findings = new Map([
      [reactor, [finding("pr-7", "r1")]],
      [walker, [finding("ticket-42", "r3")]],
    ]);

    const hit = findHit(automations, findings, nothingConsumed);

    expect(hit?.automation.name).toBe(reactor);
  });
});
