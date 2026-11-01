---
title: Documentation
---

The factory runs **one process per repository** (a *project*). On a schedule — the
*tick* — it checks the tracker for work, runs at most one agent *session* at a
time, and records every decision in an append-only event log **before** acting
on it. Crash it, restart it, and it replays the log and carries on exactly
where it was.

Three files are yours:

- the **policy** (`~/.config/factory/<owner>/<repo>.yaml`) — what the factory
  is allowed to do: how often it ticks, how long a session may run,
- **`automations.yml`** in your repository — what the repo proposes to automate,
- the **event log** (`~/.local/state/factory/events/<owner>/<repo>.jsonl`) —
  what actually happened, one JSON line per event.

The policy allows, the repo proposes, the log remembers.

{{< callout type="info" >}}
The project is in open development. The current slice ships the full control
loop — scheduling, sessions, pause/resume, crash recovery, observability —
with a **fake agent harness**. Real agent harnesses (Claude Code and friends)
arrive in the next slices.
{{< /callout >}}
