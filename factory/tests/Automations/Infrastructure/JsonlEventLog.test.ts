import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event } from "~/Automations/Domain/Event.ts";
import {
  automationName,
  commitId,
  revision,
  sessionId,
  subjectId,
} from "~/Automations/Domain/Ids.ts";
import { Project } from "~/Automations/Domain/Project.ts";
import { JsonlEventLog } from "~/Automations/Infrastructure/JsonlEventLog.ts";

const GOLDEN = join(import.meta.dir, "Fixtures/golden-log.jsonl");
const at = new Date("2026-10-31T12:00:00.000Z");
const walker = automationName("board-walker");
const ticket = subjectId("ticket-42");

let tempDirs: string[] = [];

async function tempLog(forge: () => string | undefined = () => "github.com") {
  const dir = await mkdtemp(join(tmpdir(), "factory-jsonl-"));
  tempDirs.push(dir);
  const path = join(dir, "events/dazz/foo.jsonl");
  return { path, log: new JsonlEventLog(path, "dazz/foo", forge) };
}

afterEach(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

async function replayAll(log: JsonlEventLog): Promise<Event[]> {
  const events: Event[] = [];
  for await (const event of log.replay()) events.push(event);
  return events;
}

/** Every event shape once — the round-trip material. */
const EVERY_SHAPE: readonly Event[] = [
  { name: "ProjectStarted", at },
  { name: "PolicyLoaded", at, tick: "PT15M", limits: { turns: 50, time: "PT20M" } },
  { name: "ProjectPaused", at, reason: "policy unreadable" },
  { name: "ProjectResumed", at },
  { name: "ResumeFailed", at, reason: "still broken" },
  { name: "ResumeIgnored", at },
  { name: "AutomationsLoaded", at, commit: commitId("c1") },
  {
    name: "AutomationsInvalid",
    at,
    problem: "duplicate name",
    commit: commitId("c2"),
    keptCommit: commitId("c1"),
  },
  { name: "AutomationsNeverValid", at, problem: "no automations key", commit: commitId("c0") },
  { name: "ProjectIdled", at },
  { name: "TickSkipped", at, reason: "running", trigger: "manual" },
  { name: "HeartbeatRecorded", at },
  {
    name: "SessionStarted",
    at,
    automation: walker,
    subject: ticket,
    revision: revision("r1"),
    sessionId: sessionId("s1"),
  },
  {
    name: "SessionFinished",
    at,
    automation: walker,
    subject: ticket,
    sessionId: sessionId("s1"),
    outcome: "failed",
  },
  { name: "SessionAborted", at, automation: walker, subject: ticket, sessionId: sessionId("s1") },
];

describe("JsonlEventLog", () => {
  test("round trip: every event shape survives append + replay unchanged", async () => {
    const { log } = await tempLog();
    for (const event of EVERY_SHAPE) await log.append(event);

    expect(await replayAll(log)).toEqual([...EVERY_SHAPE]);
    await log.close();
  });

  test("the lines on disk are schema v1 — kind/outcome identity, no domain names", async () => {
    const { log, path } = await tempLog();
    for (const event of EVERY_SHAPE) await log.append(event);
    await log.close();

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(EVERY_SHAPE.length);
    for (const line of lines) {
      const fields = JSON.parse(line) as Record<string, unknown>;
      expect(fields.schema).toBe(1);
      expect(fields.repository).toBe("dazz/foo");
      expect(fields.forge).toBe("github.com");
      expect(typeof fields.kind).toBe("string");
      expect(typeof fields.outcome).toBe("string");
      expect(["info", "warn", "error"]).toContain(String(fields.level));
      expect(fields.name).toBeUndefined();
    }
    const skipped = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((f) => f.kind === "tick" && f.outcome === "skipped");
    expect(skipped?.detail).toBe("running");
    expect(skipped?.trigger).toBe("manual");
  });

  test("forge is omitted on lines written without a valid policy", async () => {
    const { log, path } = await tempLog(() => undefined);
    await log.append({ name: "ProjectStarted", at });
    await log.close();

    const fields = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    expect("forge" in fields).toBe(false);
  });

  test("appends are queued: parallel appends land complete and in order", async () => {
    const { log } = await tempLog();
    await Promise.all(EVERY_SHAPE.map((event) => log.append(event)));

    expect((await replayAll(log)).map((e) => e.name)).toEqual(EVERY_SHAPE.map((e) => e.name));
    await log.close();
  });

  test("replay drops a truncated last line — a crash mid-append", async () => {
    const { log, path } = await tempLog();
    await log.append({ name: "ProjectStarted", at });
    await log.append({ name: "ProjectIdled", at });
    await log.close();
    await appendFile(path, '{"schema":1,"time":"2026-10-31T12:0');

    expect((await replayAll(log)).map((e) => e.name)).toEqual(["ProjectStarted", "ProjectIdled"]);
  });

  test("no file yet: replay yields nothing", async () => {
    const { log } = await tempLog();
    expect(await replayAll(log)).toEqual([]);
  });

  test("golden log: committed schema v1 lines stay readable forever (append-only tripwire)", async () => {
    const log = new JsonlEventLog(GOLDEN, "dazz/foo", () => undefined);
    const events = await replayAll(log);

    // 23 known lines fold; the future `cost/recorded` line is skipped, not fatal.
    expect(events).toHaveLength(23);
    const project = Project.replay(events);
    expect(project.state()).toBe("idle");
    expect(project.pauseReason()).toBeUndefined();
    expect(project.lastError()).toBe("policy.tick: P15M is above the maximum PT24H");
    expect(project.openSession()).toBeUndefined();
    expect(project.lastValidAutomationsCommit()).toBe(commitId("c1"));
    expect(project.consumedRevision(walker, ticket)).toBe(revision("r9"));
    expect(
      project.consumedRevision(automationName("pull-request-reactor"), subjectId("pr-7")),
    ).toBe(revision("r5"));
    expect(project.lastTick()?.toISOString()).toBe("2026-10-31T12:00:19.000Z");
    expect(project.lastTickSkipped()).toBe("paused");
    expect(project.lastSession()).toEqual({
      automation: walker,
      outcome: "aborted",
      at: new Date("2026-10-31T12:00:17.000Z"),
    });
  });
});
