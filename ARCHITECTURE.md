# ARCHITECTURE

How the factory code is cut, and how the cut is enforced. The decisions behind it live in
`dazz/factory-spec` ▸ `STACK.md` (the constitution); this file is the operational companion:
what each layer may hold, what it may not, and which test catches a violation.

## Layers

```
src/<Module>/Domain          → nothing
src/<Module>/Application     → Domain
src/<Module>/Infrastructure  → Domain + Application
src/<Module>/UI              → Application + Domain (types only, see below)
src/Process                  → the one place that spawns a process
src/Shared                   → the small shared kernel (Clock)
src/main.ts                  → the composition root: wires adapters into use-cases
```

The boundaries test (`tests/Architecture/Boundaries.test.ts`) asserts this over imports. It
sees imports, never semantics. Every rule below is therefore written as an import rule, so the
test can hold it.

## What each layer holds

**Domain.** Events, the replayed `Project`, value objects, the pass decision. No Bun, no
Node, no adapter. Enforced: no `Bun.`, no `bun:*`, no import from Infrastructure, UI or
Process.

**Application.** One use-case per file (`StartProject`, `RunTick`, `RunPass`, `Resume`,
`Status`) and the ports they need (`AutomationsPorts.ts`). A use-case is the only code that
appends an event and applies it to the project (`record()`). Enforced: same import rules as
Domain.

**Infrastructure.** Adapters, one per port, named with a tech prefix (`JsonlEventLog`,
`FlockInstanceLock`, `YamlPolicy`). The only layer besides `Process/` and `main.ts` that
touches the operating system: files, clocks, timers, signals, environment, processes.

**UI.** cliffy commands, exit codes, printed lines. It calls use-cases and formats their result
objects. Nothing else.

## The UI rules, and why

Slice 001 left `AutomationsRoute.ts` with 363 lines: the start flow with scheduler, heartbeat
and signal handlers, PID polling, resume polling, XDG root resolution. All of it is application
or infrastructure logic that the UI layer happened to be allowed to hold, because "UI →
Application + Domain" says nothing about what the UI may do on its own. Three import rules
close that gap. Each one names what it catches today.

### Rule 1 — only Infrastructure, `Process/` and `main.ts` touch the operating system

Forbidden outside those places: `node:*` (except `node:path`), `process.env`, `process.kill`,
`process.once`, `Date.now()`, `setTimeout()`.

**Why.** The hexagon exists so that every external system sits behind a port and can be
replaced in a test without network, filesystem or wall-clock time. A `readFile` or a
`setTimeout` in the UI is an external system without a port: it cannot be faked, so the flow
around it cannot be tested through in-memory adapters, so the flow is tested end to end or not
at all.

**Catches today.** `readPid` (reads the pidfile), `sleep` and the two polling loops
(`Date.now` + `setTimeout`), `resolveRoots` (`process.env`, `homedir`), `waitForSigterm`
(`process.once`).

**Where it goes.** `readPid` becomes `holderPid()` on `FlockInstanceLock`, which owns the
pidfile anyway (behind `InstanceLock`). Polling becomes `sleep()` on the `Scheduler` port, and
the poll is a counted loop, not a wall-clock deadline — a fake scheduler must not spin forever.
SIGTERM joins `SignalControlChannel` as `onShutdown`, next to SIGHUP and SIGUSR1; the same
adapter grows the sending half, `signal(pid, …)`, so `process.kill` has a port too.
`resolveRoots` (env vars, XDG defaults) joins `main.ts`: what the roots fall back to is
composition. `process.exit` may stay in the UI: ending the process with a code is the CLI's job.

```ts
test("only Infrastructure, Process and the composition root touch the OS", () => {
  const OS = /from\s+"node:(?!path")|process\.(env|kill|once)\b|Date\.now\(|setTimeout\(/;
  const offenders = sources()
    .filter((f) => !/\/Infrastructure\/|^Process\/|^main\.ts$/.test(f.path))
    .filter((f) => OS.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});
```

### Rule 2 — the UI talks to use-cases, never to ports

Forbidden in `UI/`: any import from `Application/*Ports.ts`.

**Why.** A port in the UI means the UI is doing a use-case's work by hand. `heartbeat()` is
the example: it builds a `HeartbeatRecorded` event, calls `log.append` and `project.apply`,
which is exactly the `record()` sequence every use-case has. Two places that know how an event
is recorded will drift; the FR-053 rule (no action without a record) is only as safe as its
least careful copy.

**Catches today.** The `EventLog`, `Scheduler`, `ControlChannel` imports and the
`HEARTBEAT_INTERVAL` constant in `AutomationsRoute.ts`.

**Where it goes.** A use-case `RecordHeartbeat` in Application; `HEARTBEAT_INTERVAL` moves
into its file. The start flow (scheduler start, heartbeat cadence, signal wiring, the crash
promise) becomes an Application service, `RunProject`, that the UI calls once and awaits.
The nudge-or-one-shot logic of `factory tick` and `factory resume` (lock probe, holder PID,
signal, result polling) becomes `RequestTick` and `RequestResume`. One carve-out:
`EventLogUnwritable` leaves `AutomationsPorts.ts` for its own Application file — the UI names
that error to map it to exit 74, and the UI imports no ports.

```ts
test("the UI talks to use-cases, never to ports", () => {
  const offenders = sources()
    .filter((f) => /\/UI\//.test(f.path))
    .filter((f) => /from\s+"~\/.*\/Application\/\w+Ports\.ts"/.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});
```

### Rule 3 — the UI imports Domain as types only

Forbidden in `UI/`: a value import (`import { X }`) from any `Domain/` file. `import type` is
allowed, because result objects carry domain types the UI must name.

**Why.** A domain value in the UI is state or a decision the UI holds instead of a use-case.
`DEFAULT_TICK` is the example: the UI decides which interval a paused project ticks at. That
decision belongs to the use-case that starts the scheduler, where it is tested with the
in-memory scheduler. The same rule stops `a.context.project.pauseReason()`: the UI reaches into
the aggregate because `StartResult` does not carry what it wants to print. The fix is a richer
result object, not a wider UI.

**Catches today.** `import { DEFAULT_TICK } from "~/Automations/Domain/Policy.ts"`. The
`context.project` access is caught once `Assembly` stops exposing `context` (Rule 2 removes the
need for it).

```ts
test("the UI imports Domain as types only", () => {
  const VALUE_IMPORT = /^import\s+(?!type\b)\{[^}]*\}\s+from\s+"~\/.*\/Domain\//m;
  const offenders = sources()
    .filter((f) => /\/UI\//.test(f.path))
    .filter((f) => VALUE_IMPORT.test(f.body))
    .map((f) => f.path);

  expect(offenders).toEqual([]);
});
```

## What the UI looks like afterwards

`AutomationsRoute.ts` keeps the cliffy commands, `projectCommand`, the exit-code constants,
`exitCodeOf`, and the `print` formatting of the use-cases' result objects. `Assembly` shrinks
to the use-case entry points (`run`, `tick`, `resume`, `status`) and loses `context`, `log`,
`clock`, `scheduler`, `control`, `pidfile`, `kill`. The UI tests shrink with it: stub
assemblies returning canned result objects — the flows' behavior is tested in Application
(`RunProject`, `RequestTick`, `RequestResume`), through the in-memory adapters.

## Not adopted

A line cap per UI file. It says "too big", not why, and a 120-line file can hold the same
violation. The three import rules name the cause.
