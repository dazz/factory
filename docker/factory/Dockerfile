# The factory container (STACK Deployment, from 001). Build context: the repo root.
# Build stage: Bun exists only here — the runtime gets a single binary (bun build --compile).
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY factory/package.json factory/bun.lock factory/.npmrc ./
RUN bun install --frozen-lockfile
COPY factory/ ./
RUN bun build --compile src/main.ts --outfile /factory-bin

# Runtime: Debian slim, not Alpine — Claude Code under musl needs extra libraries (STACK).
# Image contents in 001: the factory binary and git (GitAutomationsSource runs it).
# Harness CLIs, Node and the Docker client join with 002/003.
FROM debian:bookworm-slim
ARG S6_OVERLAY_VERSION=3.2.0.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates xz-utils \
  && rm -rf /var/lib/apt/lists/*
# Checksums pin the release artifacts (verified against the published .sha256 files);
# bumping S6_OVERLAY_VERSION means updating both.
ADD --checksum=sha256:6dbcde158a3e78b9bb141d7bcb5ccb421e563523babbe2c64470e76f4fd02dae \
  https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD --checksum=sha256:59289456ab1761e277bd456a95e737c06b03ede99158beb24f12b165a904f478 \
  https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz \
  && rm /tmp/s6-overlay-*.tar.xz

COPY --from=build /factory-bin /usr/local/bin/factory
# One s6 service per project; service names are the flattened project ID (s6 allows no slash).
COPY docker/factory/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

# Deliberately no USER: this box runs rootless Docker, where root in the container IS the
# host user — files on the volumes then belong to the host user. A dedicated USER would
# write them under a foreign UID. A rootful daemon needs `user:` in compose instead
# (infra/README.md).
ENTRYPOINT ["/init"]
