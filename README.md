# factory

The software factory that builds [dazz/dazzhub](https://github.com/dazz/dazzhub) and, later, other repositories.

Today this repo holds one thing: `infra/`, the box-wide services. Its first and only service is a Vector container
that ships every factory runner's event file to Better Stack. Spec: `dazz/dazzhub-spec` ▸ `2026-10-07-factory-observability/`.

What moves here later — the automations runner (`factory/src/Automations` of dazzhub), one runner per
repository, each repository configured as a project with explicit paths (repo, config, state, log; no
conventions) — is parked as dazz/dazzhub#613. Everything else of dazzhub's `factory/` (actors, board, worktree,
gate, skills) is application knowledge and stays there.

## Layout

```
infra/
  compose/
    docker-compose.yml   one compose project for the box; today one Vector container
    .env.example         BETTERSTACK_SOURCE_TOKEN, BETTERSTACK_INGEST_HOST
  vector/
    vector.yaml          one file source per repository (explicit paths, no globs) → decode → Better Stack
  README.md              start, stop, the two alerts in Better Stack, the one-line test
```

Log fields, the contract every runner keeps: `time repository automation issue outcome detail`.

Commits by agents use the bot identity `dazztronic` and end with the same provenance footer as in dazzhub.
