# syntax=docker/dockerfile:1.7

# ---- build: install, lint-free build of the PWA and the server bundle ----
FROM node:26-trixie-slim AS build
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

# Node 26 images no longer bundle Corepack; install the pnpm pinned in packageManager.
# The optional `ca` secret lets the build run behind a TLS-intercepting proxy.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && npm install --global --no-fund --no-audit "$(node -p 'require("./package.json").packageManager')" \
 && pnpm install --frozen-lockfile --filter "@pangolin/server..." --filter "@pangolin/web..."

COPY . .
RUN pnpm build

# Production node_modules for the bundle: only its runtime dependency (better-sqlite3).
RUN pnpm --filter @pangolin/server deploy --prod --legacy /out

# ---- runtime: one Node process serving the PWA and /api/* ----
FROM node:26-trixie-slim AS runtime
ENV NODE_ENV=production \
    PANGOLIN_DATA_DIR=/data \
    PORT=3000
WORKDIR /app

# Application files stay root-owned, so the non-root process cannot modify them.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/system/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/main.js"]
