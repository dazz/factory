import { expect, test } from "bun:test";
import { cli, resolveRoots } from "~/main.ts";

test("the wiring starts: --help names the factory and its purpose", () => {
  const help = cli().getHelp();

  expect(help).toContain("ncxten");
  expect(help).toContain("one project process per repository");
});

test("the four commands of contracts/cli.md are wired", () => {
  const help = cli().getHelp();

  for (const command of ["start", "tick", "resume", "status"]) {
    expect(help).toContain(command);
  }
});

test("every command takes the project ID and the two root options", () => {
  const start = cli().getCommand("start");

  expect(start?.getArgsDefinition()).toContain("<project");
  expect(start?.getOption("config-dir")).toBeDefined();
  expect(start?.getOption("state-dir")).toBeDefined();
});

test("--version is set", () => {
  expect(cli().getVersion()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("the roots: flag beats env beats the XDG default", () => {
  process.env.NCXTEN_CONFIG_DIR = "/from/env/config";
  process.env.NCXTEN_STATE_DIR = "/from/env/state";
  try {
    expect(resolveRoots({ configDir: "/from/flag" })).toEqual({
      configDir: "/from/flag",
      stateDir: "/from/env/state",
    });
  } finally {
    delete process.env.NCXTEN_CONFIG_DIR;
    delete process.env.NCXTEN_STATE_DIR;
  }
  const defaults = resolveRoots({});
  expect(defaults.configDir.endsWith(".config/ncxten")).toBe(true);
  expect(defaults.stateDir.endsWith(".local/state/ncxten")).toBe(true);
});
