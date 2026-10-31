import { expect, test } from "bun:test";
import { cli } from "~/main.ts";

test("the wiring starts: --help names the factory and its purpose", () => {
  const help = cli().getHelp();

  expect(help).toContain("factory");
  expect(help).toContain("one project process per repository");
});

test("--version is set", () => {
  expect(cli().getVersion()).toMatch(/^\d+\.\d+\.\d+$/);
});
