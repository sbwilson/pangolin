# Pangolin Money

A self-hosted web app for a two-person household's finances. The spec lives in
`_bmad-output/specs/spec-pangolin-money/SPEC.md`.

## Running locally

Once it's up, open:

- http://localhost:3000 — the app, which should show "Healthy" and "Schema version 4" on the
  sign-in page
- http://localhost:3000/api/system/health — the raw health JSON

Everything else needs a sign-in; see [First login](#first-login) below.

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

The server also runs background jobs. `PANGOLIN_JOB_CONCURRENCY_LLM`, `_NET` and `_LOCAL`
set how many jobs each lane runs at once (defaults 1, 2 and 1). `0` disables a lane: its jobs
are never run, and the server logs a warning at startup. `PANGOLIN_JOB_LEASE_MS` sets how long
a claimed job is held before another runner may take it over (default 60000, at least 3000).
Jobs that fail for good are listed, by kind and time only, at `/api/system/jobs` (signed in) and on the
status page. Demo mode runs no jobs.

If Corepack isn't available, install the same pnpm with `npm i -g pnpm@12.6.0`.

## First login

There is no sign-up page open to the internet. On first boot, while nobody has a login, the
server issues a one-time **setup link**, valid for 24 hours, and writes it to
`setup-link.txt` in the data directory (mode 0600). The log names the file, never the link.

```sh
cat ./data/setup-link.txt                                   # Option B
docker compose exec pangolin cat /data/setup-link.txt       # Option A
```

Open the link and you'll:

1. choose your email, a password (12 characters or more), a display name and a colour;
2. add a passkey (your device's fingerprint, face or PIN);
3. add Pangolin Money to an authenticator app (the page shows the `otpauth://` URI and the
   secret key) and enter a code to confirm it.

After that you sign in with the passkey, or with email, password and an authenticator code.
Until both the passkey and the authenticator are set up, signing in shows only the remaining
setup steps. If the link expires unused, or you delete `setup-link.txt`, restart the server
for a new one. The file is removed once anyone has a login.

To add your partner, choose **Invite partner** on the home page within 5 minutes of signing in
(otherwise you'll be asked to sign in again) and send them the one-time link it shows.
Registration closes once two people have a login.

### Sign-in settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PANGOLIN_PUBLIC_URL` | `http://localhost:3000` | The URL people open, as the browser sees it. Writes must come from this origin, passkeys are bound to its host, and setup links point at it. It must be `https://` with a host name (plain `http://` only for `localhost`; never an IP address). Cookies then get the `__Host-` prefix |
| `PANGOLIN_AUTH_SECRET_FILE` | `<data dir>/auth-secret` | Signs sessions and encrypts TOTP secrets. Created (mode 0600) on first boot; never stored in the database. Back it up with the data: without it, TOTP stops working |
| `PANGOLIN_LOGIN_MAX_FAILURES` | `5` | Wrong passwords or codes for one email that lock it… |
| `PANGOLIN_LOGIN_WINDOW_MINUTES` | `15` | …within this many minutes… |
| `PANGOLIN_LOGIN_LOCKOUT_MINUTES` | `15` | …for this many minutes. Even the right password is refused meanwhile |
| `PANGOLIN_SESSION_IDLE_MINUTES` | `30` | A session unused for this long ends |
| `PANGOLIN_AUTH_RATE_LIMIT` | `10` | Password sign-ins, and two-factor requests, one client may make per minute |
| `PANGOLIN_TRUSTED_PROXIES` | (none) | Comma-separated IPs of your reverse proxy. Only for requests from these addresses is `X-Forwarded-For` believed: the client is then its right-most address that is not one of these proxies. Without it, every client behind the proxy shares the proxy's address, and so one sign-in rate limit |

Session cookies are always `HttpOnly`, `Secure` and `SameSite=Strict` (browsers accept `Secure`
cookies from `http://localhost`). Pages carry a strict Content-Security-Policy with a nonce per
request.

### Front-end development

Keep the Option B server running, then in a second terminal:

```sh
pnpm --filter @pangolin/web dev
```

Open http://localhost:5173. Vite reloads as you edit and forwards `/api` requests to
the server on port 3000. Start that server with `PANGOLIN_PUBLIC_URL=http://localhost:5173`,
so it accepts writes, passkeys and setup links from the Vite origin.

## Seed, demo and mocks

Every test, demo and local run shares one synthetic household, generated by `tools/seed`
from a fixed seed (`pangolin-v1`) and a fixed "today" (`2026-07-15`). The output is
deterministic: two runs give byte-identical files.

```sh
pnpm seed --out /tmp/pangolin-seed          # writes /tmp/pangolin-seed/seed.json
pnpm seed --out /tmp/pangolin-seed --seed other --today 2026-01-31
```

**Demo mode** boots the server on an in-memory database loaded from the seed, and rejects
every write with `Conflict`. There is no sign-in: every request is the first seeded person. It never touches `PANGOLIN_DATA_DIR`. `pnpm build` writes the
seed to `apps/server/dist/demo-seed.json`; set `PANGOLIN_SEED_FILE` to use another. A
relative `PANGOLIN_SEED_FILE` resolves against the working directory, not `dist/`.

```sh
pnpm build
PANGOLIN_DEMO=true node apps/server/dist/main.js
```

**Mock servers** replay fixture files so tests never reach the network. Both take
`--port`, `--host` (default `127.0.0.1`) and `--fixtures <dir>`.

```sh
pnpm mock:llm      # port 4010: POST /v1/chat/completions (OpenAI), POST /v1/messages (Anthropic)
pnpm mock:prices   # port 4020: GET /v8/finance/chart/<ticker> (Yahoo Finance chart shape)
```

- The LLM mock picks `tools/mock-llm/fixtures/<provider>/<model>.json` by the request's
  `model`: `mock-ok`, `mock-malformed-json`, `mock-timeout` (held open), `mock-rate-limit`
  (429) and `mock-refusal`. Any other model returns 404.
- The price mock serves `VAS.AX` and `VGS.AX`, plus `MOCK-MALFORMED.AX`, `MOCK-TIMEOUT.AX`
  and `MOCK-429.AX` for the failure modes. Any other ticker returns 404.

## End-to-end tests

Playwright drives a running server that has **never been set up**: the tests register the
household from its first setup link (with Chromium's virtual passkey authenticator and
computed TOTP codes), so each run needs a fresh data directory. Any Content-Security-Policy
violation fails the test it happens in.

The suite signs in more often a minute than the default rate limit allows, so the server gets
a higher one:

```sh
pnpm build
rm -rf /tmp/pangolin-e2e
PANGOLIN_DATA_DIR=/tmp/pangolin-e2e PANGOLIN_AUTH_RATE_LIMIT=100 node apps/server/dist/main.js &
until curl -fsS http://localhost:3000/api/system/health > /dev/null; do sleep 0.5; done
PANGOLIN_DATA_DIR=/tmp/pangolin-e2e pnpm e2e
```

Against the Compose stack (started with `PANGOLIN_AUTH_RATE_LIMIT=100 docker compose up -d`),
give the tests the link instead:
`E2E_SETUP_LINK_COMMAND="docker compose exec -T pangolin cat /data/setup-link.txt" pnpm e2e`.
