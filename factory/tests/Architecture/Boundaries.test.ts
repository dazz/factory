import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The layering, asserted (ported from the dazzhub factory, adapted to Bun).
 * Domain → nothing, Application → Domain, Infrastructure → Domain+Application,
 * UI → Application+Domain. Plus the STACK extras: Bun is replaceable
 * infrastructure, and every source file has a test.
 */

interface SourceFile {
  path: string; // e.g. "Automations/Domain/Pass.ts"
  body: string;
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // no src/ yet — every check below holds vacuously
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function sources(): SourceFile[] {
  return walk("src")
    .map((path) => ({
      path: path.replace(/^src\//, "").replaceAll("\\", "/"),
      body: readFileSync(path, "utf8"),
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

const SPAWNER = "Process/BunProcessRunner.ts";

test("no file but the ProcessRunner adapter spawns a process", () => {
  const spawners = sources()
    .filter((file) => /Bun\.spawn|node:child_process/.test(file.body))
    .map((file) => file.path);

  expect(spawners.filter((path) => path !== SPAWNER)).toEqual([]);
});

test("Domain and Application know nothing about Bun or about adapters", () => {
  for (const file of sources()) {
    if (!/\/(Domain|Application)\//.test(`/${file.path}`)) continue;

    expect(file.body.includes("Bun."), `${file.path} reaches for Bun.*`).toBe(false);
    expect(/from\s+"bun:/.test(file.body), `${file.path} imports bun:*`).toBe(false);
    expect(
      /from\s+"~\/(Process\/|.*\/Infrastructure\/|.*\/UI\/)/.test(file.body),
      `${file.path} imports an outer layer`,
    ).toBe(false);
  }
});

test("only the UI layer knows the CLI framework", () => {
  const allowed = new Set(["Automations/UI/AutomationsRoute.ts", "main.ts"]);
  const importers = sources()
    .filter((file) => file.body.includes(`from "@cliffy/command"`))
    .map((file) => file.path);

  expect(importers.filter((path) => !allowed.has(path))).toEqual([]);
});

test("only Infrastructure, Process and the composition root touch the OS", () => {
  // An OS call without a port cannot be faked, so the flow around it cannot
  // be tested through in-memory adapters (ARCHITECTURE.md, rule 1).
  const OS = /from\s+"node:(?!path")|process\.(env|kill|once)\b|Date\.now\(|setTimeout\(/;
  const offenders = sources()
    .filter((f) => !/\/Infrastructure\/|^Process\/|^main\.ts$/.test(f.path))
    .filter((f) => OS.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});

test("the UI talks to use-cases, never to ports", () => {
  // A port in the UI means the UI does a use-case's work by hand — a second
  // copy of "no action without a record" (FR-053) drifts (ARCHITECTURE.md, rule 2).
  const offenders = sources()
    .filter((f) => /\/UI\//.test(f.path))
    .filter((f) => /from\s+"~\/.*\/Application\/\w+Ports\.ts"/.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});

test("the UI imports Domain as types only", () => {
  // A domain value in the UI is a decision the UI holds instead of a
  // use-case (ARCHITECTURE.md, rule 3).
  const VALUE_IMPORT = /^import\s+(?!type\b)\{[^}]*\}\s+from\s+"~\/.*\/Domain\//m;
  const offenders = sources()
    .filter((f) => /\/UI\//.test(f.path))
    .filter((f) => VALUE_IMPORT.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});

/**
 * One direction only: every source file has a test; extra test folders
 * (tests/Architecture/, tests/Integration/, tests/Fakes/) are allowed.
 */
test("every source file has a mirrored <Subject>.test.ts", () => {
  const missing = sources()
    .map((file) => file.path.replace(/\.ts$/, ".test.ts"))
    .filter((mirror) => !existsFile(`tests/${mirror}`));

  expect(missing).toEqual([]);
});

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
