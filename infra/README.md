# infra

The box-wide services of the factory, one compose project (`compose/`). Today that is Vector.

## Vector → Better Stack

One Vector container for the whole box. It tails each runner's event file (schema v1, one JSON object per line)
and ships every event to one Better Stack source. Nothing else on the box is mounted.

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

Better Stack → Telemetry → Sources → Connect source (platform: HTTP / Vector). Copy the two values into `.env`:

| Variable | Value |
|---|---|
| `BETTERSTACK_SOURCE_TOKEN` | the source token |
| `BETTERSTACK_INGEST_HOST` | the ingesting host, without `https://` |

`.env` is git-ignored. Never commit it.

`vector.yaml` reads both with `${VAR}`. Since Vector 0.57 that interpolation is off by default, so
`compose/docker-compose.yml` turns it on with `VECTOR_DANGEROUSLY_ALLOW_ENV_VAR_INTERPOLATION=true`. Without it the
config would still validate, but Vector would send to the literal string `${BETTERSTACK_INGEST_HOST}`.

**A wrong token fails silently.** Vector retries only on 408, 429 and 5xx. A 401/403 (wrong or revoked token)
drops the events. Only the absence alert below catches that, which is why it says "no events", not "no pass".

### Free tier (check once in the account, write the numbers here)

| What | Value |
|---|---|
| Retention | |
| Monthly ingest volume | |
| Push to the Better Stack app included? | |

The error alert's push depends on the last row. If push is not included, the alerts fall back to email.

### Alerts (create by hand)

Better Stack → Telemetry → Alerts → Create alert, source: this one.

1. **Error, global, once.** Query `level = "error"`, no repository filter. Condition: more than 0 matching
   events in 1 minute. Notify: push at once. This also catches `outcome = "undecodable"` (a line Vector could
   not decode; it has no `repository`) and every future repository. `warn` does not push.
2. **No events, once per repository.** Query `repository = "dazz/dazzhub"`. Condition: 0 matching events in
   20 minutes. Notify: push, titled "dazz/dazzhub: no events for 20 minutes". Needs the runner's 5-minute
   heartbeat (dazz/dazzhub#615); without it every long walker session would fire.

**After `make automations-stop` the "no events" push arrives 20 minutes later, on purpose.** Better Stack cannot
tell a wanted stop from a crash, and "the factory is off" is worth a push. It is not a false alarm.

### One-line test

Append an error event to the event file and watch your phone (push within 2 minutes):

```sh
echo '{"schema":1,"time":"'"$(date +%Y-%m-%dT%H:%M:%S.%3N%:z)"'","kind":"automation","repository":"dazz/dazzhub","forge":"github.com","automation":"manual-test","outcome":"error","detail":"one-line test","level":"error"}' >> ~/.local/state/factory/events/dazz/dazzhub.jsonl
```

A non-JSON line (`echo 'not json' >> …/dazzhub.jsonl`) arrives as `outcome: undecodable`, `level: error`, the raw
line in `detail`, and pushes the same way.

### Live tail

Save a default view that hides `outcome = "heartbeat"` (the runner writes one every 5 minutes). Columns:
`dt repository automation issue outcome detail`.

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

`docker compose restart vector`, then add that repository's own "no events" alert (alert 2). The error alert
already covers it.

### Vector version

The image tag is pinned in two places: `compose/docker-compose.yml` and `.github/workflows/validate.yml`. Move both
together, and read the Vector upgrade guides in between. CI runs
`vector validate --no-environment` on every push with placeholder values for the two variables; it finds config
mistakes, not a wrong token.
