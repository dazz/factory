import { expect, test } from "bun:test";
import { EventLogUnwritable } from "~/Automations/Application/EventLogUnwritable.ts";

test("the FR-053 marker: an Error the UI maps to exit 74", () => {
  const error: unknown = new EventLogUnwritable("event log unwritable: disk full");

  expect(error).toBeInstanceOf(Error);
  expect(error instanceof EventLogUnwritable).toBe(true);
  expect((error as Error).message).toContain("disk full");
});
