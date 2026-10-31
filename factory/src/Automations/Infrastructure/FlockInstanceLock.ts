import { dlopen, FFIType } from "bun:ffi";
import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { InstanceLock } from "~/Automations/Application/AutomationsPorts.ts";

// flock(2) — same values on Linux and macOS. The kernel releases the lock at
// process death: no staleness logic, a start race has exactly one winner
// (STACK, spike 2026-10-31). macOS still needs its smoke test on first use.
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const LIBC = process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6";
const { symbols } = dlopen(LIBC, {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

/** `acquire` retries this long before giving up: a status probe holds the lock
 * for an instant and a one-shot tick for a whole tick — a project process
 * starting at exactly that moment must not refuse per FR-027 (data-model). */
const ACQUIRE_RETRY_WINDOW_MS = 5_000;
const RETRY_EVERY_MS = 100;

/**
 * flock(2) on the pidfile (`<state-root>/projects/<owner>/<repo>/factory.pid`).
 * Spike pattern: open append — never truncate before the lock; PID
 * truncate+write after acquire; the file is never deleted or renamed. The
 * content is only the signal address, the flock is the authority.
 */
export class FlockInstanceLock implements InstanceLock {
  private fd: number | undefined;

  constructor(
    private readonly path: string,
    private readonly retryWindowMs: number = ACQUIRE_RETRY_WINDOW_MS,
  ) {}

  async acquire(): Promise<boolean> {
    mkdirSync(dirname(this.path), { recursive: true });
    const fd = openSync(this.path, "a");
    const deadline = Date.now() + this.retryWindowMs;
    for (;;) {
      if (symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) {
        ftruncateSync(fd, 0);
        writeSync(fd, `${process.pid}\n`);
        this.fd = fd;
        return true;
      }
      if (Date.now() >= deadline) {
        closeSync(fd);
        return false;
      }
      await sleep(RETRY_EVERY_MS);
    }
  }

  /** Non-blocking probe (FR-025): takes nothing it keeps. */
  isHeld(): boolean {
    if (this.fd !== undefined) return true;
    let fd: number;
    try {
      fd = openSync(this.path, "a");
    } catch {
      return false; // no file: nothing ever locked here
    }
    try {
      if (symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) return true;
      symbols.flock(fd, LOCK_UN);
      return false;
    } finally {
      closeSync(fd);
    }
  }

  /** What process death does — the kernel releases the flock with the fd. */
  release(): void {
    if (this.fd === undefined) return;
    closeSync(this.fd);
    this.fd = undefined;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
