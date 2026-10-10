# infra

The box-wide services of the factory, one compose project (`compose/`). Today that is Vector.

## Vector → Better Stack

One Vector container for the whole box. It tails each runner's event file (schema v1, one JSON object per line)
and ships every event except `heartbeat` to one Better Stack source. Every event, heartbeats included, also pings
that repository's Better Stack Uptime heartbeat. Nothing else on the box is mounted.

### Start, stop, logs

Run from `infra/compose/`:

```sh
mkdir -p ~/.local/state/factory/events ~/.local/state/factory/vector   # once, before the first `up`
cp .env.example .env                         # once, then fill it in (see below)
docker compose up -d                         # start; restarts by itself unless stopped
docker compose logs -f vector                # watch
docker compose down                          # stop; ~/.local/state/factory/vector keeps checkpoints and the disk buffer
```

**Start order.** Both directories must exist before the first `docker compose up` (the events directory can
also come from starting the runner once). Otherwise Docker creates them, and with a rootful daemon they belong to
root and the runner cannot write its event file. (This box runs rootless Docker, where they would belong to you,
but keep the rule: the README is for every box.)

### `.env`

Better Stack → Telemetry → Sources → Connect source (platform: HTTP / Vector) gives the first two values, the
Uptime heartbeat (see [Alerts](#alerts-create-by-hand)) the third:

| Variable | Value |
|---|---|
| `BETTERSTACK_SOURCE_TOKEN` | the source token |
| `BETTERSTACK_INGEST_HOST` | the ingesting host, without `https://` |
| `BETTERSTACK_HEARTBEAT_URL_DAZZHUB` | the heartbeat URL, `https://uptime.betterstack.com/api/v1/heartbeat/<token>` |

`.env` is git-ignored. Never commit it; the heartbeat URL is a secret too.

`vector.yaml` reads all three with `${VAR}`. Since Vector 0.57 that interpolation is off by default, so
`compose/docker-compose.yml` turns it on with `VECTOR_DANGEROUSLY_ALLOW_ENV_VAR_INTERPOLATION=true`. Without it
Vector 0.59 refuses the config: `validate` and startup both fail (exit 78) because the sink's `uri` has no static host.

**A wrong token fails silently.** Vector retries only on 408, 429 and 5xx. A 401/403 (wrong or revoked token)
drops the events. A wrong heartbeat URL is caught by the heartbeat itself: it stays silent and pushes. A wrong
source token is not caught by any alert: the heartbeat stays up while the logs stay empty.

### Free tier (check once in the account, write the numbers here)

| What | Value |
|---|---|
| Retention | |
| Monthly ingest volume | |
| Push to the Better Stack app included? | |

The error alert's push depends on the last row. If push is not included, the alerts fall back to email.

### Alerts (create by hand)

1. **Error, global, once.** Better Stack → Telemetry → Alerts → Create alert, source: this one. Query
   `level = "error"`, no repository filter. Condition: more than 0 matching events in 1 minute. Notify: push at
   once. This also catches `outcome = "undecodable"` (a line Vector could not decode; it has no `repository`)
   and every future repository. `warn` does not push.
2. **Uptime heartbeat, once per repository.** Better Stack → Uptime → Heartbeats → Create: name
   `factory dazz/dazzhub`, period 5 minutes, grace 10 minutes, notify: push. Copy its URL into `.env` as
   `BETTERSTACK_HEARTBEAT_URL_DAZZHUB`. Any event resets it, and the runner writes at least one every
   5 minutes (dazz/dazzhub#615), so a long walker session never fires it. It goes down when the runner, Vector
   or the heartbeat URL is dead; Vector's death looks like the runner's, on purpose.

**After `make automations-stop` the heartbeat push arrives up to 15 minutes later, on purpose.** Better Stack
cannot tell a wanted stop from a crash, and "the factory is off" is worth a push. It is not a false alarm.
`make automations-start` sets it up again with the next event.

### One-line test

Append an error event to the event file and watch your phone (push within 2 minutes):

```sh
echo '{"schema":1,"time":"'"$(date +%Y-%m-%dT%H:%M:%S.%3N%:z)"'","kind":"automation","repository":"dazz/dazzhub","forge":"github.com","automation":"manual-test","outcome":"error","detail":"one-line test","level":"error"}' >> ~/.local/state/factory/events/dazz/dazzhub.jsonl
```

A non-JSON line (`echo 'not json' >> …/dazzhub.jsonl`) arrives as `outcome: undecodable`, `level: error`, the raw
line in `detail`, and pushes the same way.

### Live tail

Heartbeat events never reach the logs (`split` in `vector.yaml` drops them; they only feed the Uptime heartbeat).
On a long session, the walker's `overdue` warning and the session's `.out` file remain the view. Columns for a
saved view: `dt repository automation issue outcome detail`.

### A second repository

The other runner's `project.paths.events` must live under `~/.local/state/factory/events/` (the only mounted
directory). Then, in `vector/vector.yaml`, one source block and one entry in `inputs`:

```yaml
sources:
  other:
    type: file
    include: ["/events/owner/other.jsonl"]
    read_from: end
transforms:
  decode:
    inputs: [dazzhub, other]
```

Its own Uptime heartbeat (alert 2) and env variable, `BETTERSTACK_HEARTBEAT_URL_OTHER`, in `.env`, `.env.example`
and the CI placeholders. Then route on `.repository` so each heartbeat sees only its repository's events, and move
`uptime_dazzhub` to its route:

```yaml
transforms:
  by_repository:
    type: route
    inputs: [decode]
    route:
      dazzhub: '.repository == "dazz/dazzhub"'
      other: '.repository == "owner/other"'
sinks:
  uptime_dazzhub:
    inputs: [by_repository.dazzhub]
  uptime_other:                                 # a copy of uptime_dazzhub with the other variable
    inputs: [by_repository.other]
```

`docker compose restart vector`. The error alert already covers the new repository.

### Vector version

The image tag is pinned in two places: `compose/docker-compose.yml` and `.github/workflows/validate.yml`. Move both
together, and read the Vector upgrade guides in between. CI runs
`vector validate --no-environment` on every push with placeholder values for the variables; it finds config
mistakes, not a wrong token. It warns that `split.heartbeat` has no consumers: wanted, that route exists to drop
heartbeats.
