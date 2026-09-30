# syntax=docker/dockerfile:1.7

# ---- build: install, lint-free build of the PWA, the server bundle and the demo seed ----
FROM --platform=$BUILDPLATFORM node:26-trixie-slim AS build
WORKDIR /src

# Workspace manifests first, so the install layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/app/package.json packages/app/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/importers/package.json packages/importers/
COPY packages/llm/package.json packages/llm/
COPY packages/shared/package.json packages/shared/
COPY tools/seed/package.json tools/seed/

# Node 26 images no longer bundle Corepack; install the pnpm pinned in packageManager.
# The optional `ca` secret lets the build run behind a TLS-intercepting proxy.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && npm install --global --no-fund --no-audit "$(node -p 'require("./package.json").packageManager')" \
 && pnpm install --frozen-lockfile --filter "@pangolin/server..." --filter "@pangolin/web..." --filter "@pangolin/seed..."

COPY . .
# The install above is filtered to what the image needs, so pnpm's check before running a script
# would install every other workspace project (the e2e suite, Playwright) first: from the network,
# which the VM's firewall blocks and the image does not need. Nothing below installs.
ENV pnpm_config_verify_deps_before_run=false
RUN pnpm build

# Production node_modules for the bundle: only its runtime dependency (better-sqlite3).
RUN pnpm --filter @pangolin/server deploy --prod --legacy /out

# ---- restic: the pinned release binary for backups (story 1.10), checked against its SHA-256 ----
FROM debian:trixie-slim AS restic
ARG TARGETARCH
ARG RESTIC_VERSION=0.19.0
# From the release's SHA256SUMS (https://github.com/restic/restic/releases/tag/v0.19.0).
ARG RESTIC_SHA256_AMD64=13176fe6d89d4357947a2cd107218ab2873a5f9d8e1ac2d4cd1c8e07e6839c21
ARG RESTIC_SHA256_ARM64=e522ce6bf748d753fee8093e8ec59359972cf5b6bc65fc7c7cf38ae952351d91
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export CURL_CA_BUNDLE=/run/secrets/ca; fi \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates curl bzip2 > /dev/null \
 && case "${TARGETARCH:-amd64}" in \
      amd64) sha="$RESTIC_SHA256_AMD64" ;; \
      arm64) sha="$RESTIC_SHA256_ARM64" ;; \
      *) echo "no restic checksum pinned for $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/restic.bz2 \
      "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${TARGETARCH:-amd64}.bz2" \
 && echo "$sha  /tmp/restic.bz2" | sha256sum -c - \
 && bunzip2 /tmp/restic.bz2 \
 && install -m 0755 /tmp/restic /usr/local/bin/restic \
 && /usr/local/bin/restic version

# ---- runtime: one Node process serving the PWA and /api/* ----
FROM node:26-trixie-slim AS runtime
# The release workflow passes the tag (e.g. v1.2.3); local builds report "dev".
ARG PANGOLIN_VERSION=dev
ARG PANGOLIN_TEST_FORCE_UNHEALTHY
ENV NODE_ENV=production \
    PANGOLIN_VERSION=${PANGOLIN_VERSION} \
    PANGOLIN_TEST_FORCE_UNHEALTHY=${PANGOLIN_TEST_FORCE_UNHEALTHY} \
    PANGOLIN_DATA_DIR=/data \
    PORT=3000
WORKDIR /app

# Application files stay root-owned, so the non-root process cannot modify them.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=restic /usr/local/bin/restic /usr/local/bin/restic
# restic (Go) verifies HTTPS servers against the system CA store, which node:*-slim lacks (Node
# bundles its own); without it every https:// backup server fails with "unknown authority".
COPY --from=restic /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# The production compose file, allowlist and firewall, for an install.sh downloaded on its own.
COPY --from=build /src/deploy ./deploy

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# /healthz: migrations applied, database writable, job runner ticking (demo mode skips the runner).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/main.js"]
