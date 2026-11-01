---
title: Getting started
weight: 1
---

The factory ships as a container image with an s6 supervisor inside; the CLI
is a single binary. Everything lives under two roots on your machine, mounted
into the container at the same paths:

```
~/.config/factory/<owner>/<repo>.yaml      # policies — one file per project
~/.local/state/factory/                    # state root
├── events/<owner>/<repo>.jsonl            # the event log (schema v1)
└── projects/<owner>/<repo>/factory.pid    # pidfile — the instance lock lives on it
```

## 1. Write a policy

```yaml {filename="~/.config/factory/dazz/foo.yaml"}
repo:
  repository: dazz/foo
  paths:
    checkout: /home/you/checkouts/foo   # a local git checkout on its default branch
policy:
  tick: PT15M          # ISO 8601 duration, PT1M–PT24H
  limits:
    turns: 50
    time: PT20M
```

See [Configuration](../configuration) for every field.

## 2. Declare automations in the repo

```yaml {filename="automations.yml"}
automations:
  - name: pull-request-reactor
    skill: react
  - name: board-walker
    skill: implement
    gate: make ci
```

Committed to the default branch — the factory reads it at the branch head
every tick. See [Automations](../automations).

## 3. Start it

```sh
cd infra/compose
docker compose up -d
docker compose logs -f factory
```

The service starts `factory start <project>` under s6. Check on it from the
same PID namespace (signals must reach the right process):

```sh
docker exec factory-infra-factory-1 factory status dazz/foo
docker exec factory-infra-factory-1 factory tick dazz/foo     # tick now, don't wait
```

## 4. Watch the event log

```sh
tail -f ~/.local/state/factory/events/dazz/foo.jsonl
```

Every line is one event: `{"schema":1,"time":…,"kind":"tick","outcome":"idle",…}`.
The log is the source of truth — delete everything else and the factory
rebuilds its state from it.
