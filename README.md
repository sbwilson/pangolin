# Pangolin Money

A self-hosted web app for a two-person household's finances. The spec lives in
`_bmad-output/specs/spec-pangolin-money/SPEC.md`.

## Running locally

Once it's up, open:

- http://localhost:3000 — the app, which should show "Healthy" and "Schema version 1"
- http://localhost:3000/api/system/health — the raw health JSON

### Option A: Docker

Needs only Docker.

```sh
docker compose up --build
```

Stop it with `Ctrl+C`. `docker compose down --volumes` also deletes the database volume.

### Option B: Node, without Docker

Needs Node 22.18 or newer.

```sh
corepack enable          # gets the pnpm version pinned in package.json
pnpm install             # also points git at the hooks in .githooks
pnpm build               # builds the web app and the server bundle
PANGOLIN_DATA_DIR=./data node apps/server/dist/main.js
```

The SQLite database is created in `./data`, which git ignores. Without
`PANGOLIN_DATA_DIR` the server uses `/data`. Set `PORT` to use a port other than 3000.

If Corepack isn't available, install the same pnpm with `npm i -g pnpm@12.6.0`.

### Front-end development

Keep the Option B server running, then in a second terminal:

```sh
pnpm --filter @pangolin/web dev
```

Open http://localhost:5173. Vite reloads as you edit and forwards `/api` requests to
the server on port 3000.
