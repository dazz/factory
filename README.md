# factory

The software factory that builds [dazz/dazzhub](https://github.com/dazz/dazzhub) and, later, other repositories.

Today this repo holds one thing: `observability/`, a box-wide Vector container that ships every factory runner's
automations log to Better Stack. Spec: `dazz/dazzhub-spec` ▸ `2026-10-07-factory-observability/`.

What moves here later — the automations runner (`factory/src/Automations` of dazzhub), one runner per
repository, each repository configured as a project with explicit paths (repo, config, state, log; no
conventions) — is parked as dazz/dazzhub#613. Everything else of dazzhub's `factory/` (actors, board, worktree,
gate, skills) is application knowledge and stays there.

## Layout

```
observability/
  docker-compose.yml   one Vector container, box-wide
  vector.yaml          one file source per repository (explicit paths, no globs) → parse → Better Stack
  .env.example         BETTERSTACK_SOURCE_TOKEN, BETTERSTACK_INGEST_HOST
  README.md            start, stop, the two alerts in Better Stack, the one-line test
```

Log fields, the contract every runner keeps: `time repository automation issue outcome detail`.

Commits by agents use the bot identity `dazztronic` and end with the same provenance footer as in dazzhub.
