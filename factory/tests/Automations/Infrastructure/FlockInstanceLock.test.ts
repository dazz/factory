import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlockInstanceLock } from "~/Automations/Infrastructure/FlockInstanceLock.ts";

// Two instances = two open file descriptions: flock treats them as
// independent holders, exactly like two processes. The true cross-process
// case runs by hand inside the container during T036.

let tempDirs: string[] = [];

async function pidfilePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-flock-"));
  tempDirs.push(dir);
  return join(dir, "projects/dazz/foo/factory.pid");
}

afterEach(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("FlockInstanceLock", () => {
  test("the first holder wins and writes its PID; a second is refused while held", async () => {
    const path = await pidfilePath();
    const first = new FlockInstanceLock(path, 200);
    const second = new FlockInstanceLock(path, 200);

    expect(await first.acquire()).toBe(true);
    expect(await readFile(path, "utf8")).toBe(`${process.pid}\n`);
    expect(await second.acquire()).toBe(false);

    first.release();
  });

  test("acquire retries: a lock released within the window is taken", async () => {
    const path = await pidfilePath();
    const holder = new FlockInstanceLock(path, 200);
    const waiter = new FlockInstanceLock(path, 2000);
    await holder.acquire();

    setTimeout(() => holder.release(), 150);
    expect(await waiter.acquire()).toBe(true);

    waiter.release();
  });

  test("a closed fd releases the lock — what the kernel does at process death", async () => {
    const path = await pidfilePath();
    const crashed = new FlockInstanceLock(path, 200);
    await crashed.acquire();
    crashed.release(); // the kernel closes all fds of a dead process

    const next = new FlockInstanceLock(path, 200);
    expect(await next.acquire()).toBe(true);
    next.release();
  });

  test("isHeld probes without taking: true while held, false after, file untouched", async () => {
    const path = await pidfilePath();
    const holder = new FlockInstanceLock(path, 200);
    const probe = new FlockInstanceLock(path, 200);

    expect(probe.isHeld()).toBe(false);
    await holder.acquire();
    expect(probe.isHeld()).toBe(true);
    // The probe took nothing it keeps: the holder still holds.
    expect(await new FlockInstanceLock(path, 100).acquire()).toBe(false);

    holder.release();
    expect(probe.isHeld()).toBe(false);
    // The PID stays in the file — content is only the signal address, never deleted.
    expect(await readFile(path, "utf8")).toBe(`${process.pid}\n`);
  });
});
