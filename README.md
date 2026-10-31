# factory

The software factory that builds [dazz/dazzhub](https://github.com/dazz/dazzhub) and, later, other repositories.

Specified in `dazz/factory-spec` (slice `001-tick` onward). Of dazzhub's `factory/` only the generic
runner moves here; everything else (actors, board, worktree, gate, skills) is application knowledge
and stays there (see dazz/dazzhub#613).

## Layout — three spaces

```
docker/factory/   Dockerfile, s6 service files, start script (the container the factory runs in)
factory/          the Bun app: package.json, bun.lock, .npmrc, tsconfig.json, biome.json, Makefile, src/, tests/
infra/            the box-wide services: compose and Vector → Better Stack (see infra/README.md)
```

One runner per repository, each repository configured as a project; the project ID is
`owner/repo`. The policy file (`<config-dir>/<owner>/<repo>.yaml`) names no path but the repo
checkout: everything else derives from the project ID under two configurable roots — the event
file at `<state-root>/events/<owner>/<repo>.jsonl` (the only directory Vector mounts), lock and
all other state under `<state-root>/projects/<owner>/<repo>/`.

Log lines keep **schema v1**, the contract every runner keeps and Vector ships:
`schema time kind repository forge automation issue outcome detail level`.

Commits by agents use the bot identity `dazztronic` and end with the same provenance footer as in dazzhub.
