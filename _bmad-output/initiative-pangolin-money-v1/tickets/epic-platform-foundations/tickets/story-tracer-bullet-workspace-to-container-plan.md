---
title: 'Tracer bullet: workspace to container'
type: 'feature'
ticket: '1'
created: '2026-09-27'
status: done
baseline_revision: 'af96d17f639346d3fb3c1ca37fbc7f3fa8c16c2e'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/tech-stack.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The repo has no code. Every later story needs the workspace, lint and boundary rules, the migration runner, the container and CI to exist and to be proven end to end.

**Approach:** Scaffold the pnpm workspace with every package from the repo layout. Run one `system.health` use case from the PWA through Hono, `app` and `db` to SQLite via our own migration runner. Package it as a Debian-slim container, and exercise it in CI with lint, types, Vitest, a STRICT-table check and one Playwright test against the container.

## Boundaries & Constraints

**Always:**
- Package graph exactly as the spine's Invariants diagram. Anything not drawn is forbidden and fails `pnpm lint`. `apps/web` imports only `shared`, plus `AppType` from `apps/server` as `import type`.
- `system.health` is `packages/app/src/system/health.ts` with signature `(ctx, input) → output`. It reaches SQLite only through a synchronous port in `packages/app/src/ports/` implemented in `packages/db`. There is no `Viewer` yet (story 1.3 adds it).
- The migration runner follows the spine's Migrations convention step for step. Migrations are committed `.sql` files applied in order, forward-only, each in its own transaction, and recorded in a runner-owned `schema_migration` table (`STRICT`). Schema version = the number of applied migrations.
- The first migration is an empty drizzle-kit custom migration (`drizzle-kit generate --custom --name baseline`). No domain tables in this story.
- TS strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Biome 2 formats and lints. `.nvmrc` = `26`, image base `node:26-trixie-slim`. Code must also run on Node 22.18+ (the local sandbox); use no Node 26-only API.
- Environment variables are parsed by one Zod schema in `apps/server/src/config.ts` (`PANGOLIN_DATA_DIR`, default `/data`; `PORT`, default `3000`).
- The container runs as a non-root user and serves the built PWA and `/api/*` from one Node process.

**Never:** No auth, CSP, jobs, seed, `person`/`household_settings` tables, production `deploy/` Compose or `install.sh` (stories 1.3–1.8). No down-migrations. No SQL outside `packages/db`. No floats or money code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh DB | Empty data dir, server starts | Runner applies `0000_baseline`. `GET /api/system/health` returns `200 {"status":"ok","schemaVersion":1,"writable":true}` | No error |
| Restart | Already migrated DB | Nothing re-applied; same response | No error |
| Bad migration | A migration whose SQL fails, or whose `foreign_key_check` or invariant check fails | Transaction rolled back; `schema_migration` unchanged; `foreign_keys` restored to ON | Runner throws naming the migration; server exits non-zero |
| Non-STRICT table | DB with a table created without `STRICT` | STRICT check lists the table | Check exits non-zero |
| Read-only DB | DB file not writable | `/api/system/health` returns `503` with `writable:false` | No crash |
| Forbidden import | e.g. `packages/domain` imports `packages/db`, or `apps/web` value-imports `apps/server` | `pnpm lint` fails naming file and rule | — |

</intent-contract>

## Code Map

Greenfield: the repo holds only `_bmad*`, `docs/`, `.gitignore` and `LICENSE`. Do not edit `_bmad/` or `_bmad-output/` (except this plan). `.gitignore` already ignores `*.sqlite`, `*.db` and `data/`; keep that.
- Layout: `_bmad-output/specs/spec-pangolin-money/tech-stack.md` (Repo layout) plus spine Source tree: `packages/app/src/{ports,system}`, `packages/shared/src/{period,temporal}` (empty index stubs), `apps/server/src/{http,jobs,admin}`.
- Pinned versions (npm, checked 2026-09-27): typescript 7.0.2, @biomejs/biome 2.5.x, hono 4.13.x, better-sqlite3 13.0.x, drizzle-orm 0.45.x, drizzle-kit 0.31.x, zod 4.x, react 19.3, vite 8.3, @vitejs/plugin-react 6, vite-plugin-pwa 1.3, vitest 5.0, @playwright/test 1.63. Local pnpm is 10.33; set `packageManager` to pnpm 12 only if Corepack can fetch it, otherwise pnpm 10.
- Local sandbox: Node 22, Docker available, Chromium at `/opt/pw-browsers` (older build). Local Playwright runs launch it via `executablePath` from env `PW_CHROMIUM_PATH`; CI runs `playwright install --with-deps chromium`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `biome.json` -- root workspace; scripts `lint` (biome check + boundary check), `typecheck` (`pnpm -r typecheck`), `test` (vitest), `check:strict`, `build`, `e2e` -- one command per CI step
- [x] `apps/*`, `packages/*`, `tools/{mock-llm,mock-prices,seed}` `package.json` + `tsconfig.json` + `src/index.ts` -- every package exists; workspace deps declared only along allowed arrows -- later stories only add code
- [x] `scripts/check-boundaries.ts` + test -- scan every `import`/`export from`/dynamic import in `apps`, `packages` and `tools` against the allowed map; `apps/web` → `apps/server` only as `import type` -- the spine says a lint rule enforces the graph
- [x] `packages/app/src/ports/system-health.ts`, `packages/app/src/system/health.ts` + test -- port `{ schemaVersion(): number; probeWrite(): boolean }`; use case returns `{status, schemaVersion, writable}` -- the one tracer use case
- [x] `packages/db/src/{open,migrate,system-health-repo,strict-check}.ts`, `packages/db/migrations/0000_baseline.sql` + journal, `drizzle.config.ts` + tests -- open with WAL and `foreign_keys = ON`; runner per spine; `probeWrite` = `BEGIN IMMEDIATE` then `ROLLBACK`, false on `SQLITE_READONLY`; invariant suite = STRICT check -- AD-1 and AD-2 and the Migrations convention
- [x] `apps/server/src/{config,main}.ts`, `apps/server/src/http/app.ts` + test -- migrate on boot, then Hono `GET /api/system/health` (`503` when not writable) and static PWA with SPA fallback; export `type AppType`; esbuild bundle to `dist/` with better-sqlite3 external -- composition root
- [x] `apps/web` (Vite React, `index.html`, `src/main.tsx`, vite-plugin-pwa with `injectRegister: false`, manifest, `index.html` not precached) -- `hc<AppType>` fetch renders "Healthy" and "Schema version N", or "Unhealthy" -- PWA shell end of the tracer
- [x] `Dockerfile`, `.dockerignore`, `compose.yaml` -- multi-stage build on `node:26-trixie-slim`; non-root; `/data` volume; port 3000 -- container
- [x] `e2e/` (`playwright.config.ts`, `health.spec.ts`) -- against `E2E_BASE_URL` (default `http://localhost:3000`) -- one Playwright test
- [x] `.github/workflows/ci.yml` -- Node from `.nvmrc`, pnpm, then lint, typecheck, test, check:strict on a freshly migrated DB, docker build, compose up, wait for health, e2e -- CI

**Acceptance Criteria:**
- Given a clean checkout, when `docker compose up --build` runs and a browser opens `http://localhost:3000`, then the page shows "Healthy" and "Schema version 1".
- Given the running container, when `GET /api/system/health` is called, then it returns `200` with `{"status":"ok","schemaVersion":1,"writable":true}`, and the container process runs as a non-root uid.
- Given a source file importing across a forbidden arrow, when `pnpm lint` runs, then it fails naming the file.
- Given the workflow file, when CI runs on a push, then lint, typecheck, Vitest, the STRICT check and the Playwright test against the container are all separate steps that must pass.

## Implementation Notes

- Workspace packages point `exports` at `src/*.ts`; relative imports carry `.ts` extensions, so Node 22.18+ runs TS scripts natively (`scripts/check-boundaries.ts`, `packages/db/src/cli/check-strict.ts`, `apps/server/scripts/build.ts`). `erasableSyntaxOnly` keeps all code strippable.
- `@types/node` is pinned to 22.x so the typechecker rejects Node 26-only APIs.
- pnpm 12.6.0 (Corepack fetched it). pnpm 12 needs `allowBuilds` in `pnpm-workspace.yaml`: esbuild true; better-sqlite3 false (13.x ships N-API prebuilds in the tarball, no compile).
- The server bundle expects `dist/migrations` and `dist/public` next to `dist/main.js`; `apps/server/scripts/build.ts` copies them. `apps/server/src/server.ts` (`startServer`) holds the boot sequence so it is testable; `main.ts` only reads env, logs JSON and handles signals.
- Web uses TanStack Query for the health fetch (spine: server state only in TanStack Query).
- Verified locally: lint, typecheck, 44 Vitest tests, `check:strict`, `docker compose up --build` (health 200, uid 1000, Docker HEALTHCHECK healthy), restart, read-only DB file → 503, bad migration → exit 1 with rollback, Playwright 1 passed.

## Plan Change Log

- **`probeWrite`**: `BEGIN IMMEDIATE` then `ROLLBACK` alone is not enough. SQLite grants `BEGIN IMMEDIATE` on a read-only database and fails only on the first page write, and better-sqlite3's `db.readonly` only echoes the open option (it stays false when SQLite falls back to read-only because the file is not writable; confirmed in the container with `chmod 444`). The probe now rewrites `user_version` with its own value inside the transaction, then rolls back.
- **`typecheck`** is `pnpm -r typecheck && tsc -p tsconfig.json`; the root project covers `scripts/`, which is not a workspace package.
- **`e2e/`** is a workspace package (`@pangolin/e2e`) so it gets its own typecheck; root `e2e` delegates to it.
- **`check:strict`** with no argument migrates a fresh temporary DB with the committed migrations and checks it (the CI step); with a path it checks that DB as it is.
- **Existing files the Code Map did not list**: `.nvmrc` was 22 (now 26); `.dockerignore` was extended; `.github/workflows/ci.yml` was replaced (its jobs called scripts that do not exist), keeping the gitleaks job; `release.yml` untouched (it references `deploy/install.sh`, story 1.8).
- **Dockerfile**: Node 26 images no longer bundle Corepack, so the build stage installs the pnpm named in `packageManager` with npm. An optional BuildKit secret `ca` supports building behind a TLS-intercepting proxy; CI does not use it.
- **compose.yaml** adds `init: true` and `read_only: true` with a `/tmp` tmpfs (spine: non-root, read-only container).
- **Boundary map**: tools are not drawn in the spine, so `tools/*` may import no workspace package; `apps/server` → `packages/shared` is not drawn either, so it is forbidden. Both will need a spine arrow before tools/seed or the server import `shared`.

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 48 findings — high 0, medium 19, low 21, false 5, maybe-false 3
- findings:
  - `[medium]` `[patch]` Blind: ci.yml rewrite dropped still-valid checks (drift check, anchore scan, shellcheck of .githooks, weekly schedule) — restored all four in ci.yml; `db:generate` confirmed a no-op on the current tree.
  - `[medium]` `[patch]` Blind: a missing `/assets/*` 404 inherits `immutable` year-long caching — assets 404 now sends `Cache-Control: no-store`; asserted in app.test.ts.
  - `[low]` `[reject]` Blind: SPA fallback answers `/favicon.ico`, `/robots.txt` etc. with the shell — cosmetic at two users; the fix adds navigation-detection branches.
  - `[low]` `[reject]` Blind: `probeWrite` rethrows SQLITE_BUSY/FULL/IOERR (500, not 503) and can block 5 s — the server is the only writer (spine: one Node process), so contention is not reached in normal use; the fix adds error branches.
  - `[low]` `[patch]` Blind: comments claim the server injects a CSP nonce and no security headers exist — CSP and headers are story 1.5 (intent: Never auth, CSP); reworded the vite.config.ts comments as future behaviour.
  - `[false]` `[reject]` Blind: service-worker updates never reach users — `index.html` is not precached and `navigateFallback: null`, so navigations load the new shell from the network, which references new hashed assets that bypass the precache route.
  - `[low]` `[reject]` Blind: `stripComments` desyncs on a quote inside a regex literal — imports sit at the top of files, before such regexes, so a miss is unlikely; a correct fix needs a real tokenizer.
  - `[medium]` `[patch]` Blind: `e2e` workspace package not covered by the boundary check — grouped with Edge `e2e`/Intent A2; `e2e` is now in ALLOWED (`allow: []`), loaded and scanned; a test rejects an e2e → db import.
  - `[medium]` `[patch]` Blind: no test for the non-writable-file fallback that motivated the `probeWrite` change — grouped with VG gap 1; added a `startServer` chmod-444 case (skipped as root; ran 7/7 as `nobody`).
  - `[medium]` `[patch]` Blind: no web tests for `fetchHealth` unhealthy mapping — grouped with VG gap 2; added apps/web/src/api.test.ts (200 ok and 503 unhealthy).
  - `[low]` `[patch]` Blind: Playwright traces in `e2e/test-results` not uploaded on CI failure — added `e2e/test-results` to the failure artifact.
  - `[low]` `[reject]` Blind: Node 22.18 minimum never tested in CI — the intent names Node 22 as the local sandbox, where every command in Verification ran; CI on 26 matches `.nvmrc`.
  - `[low]` `[reject]` Blind: `loadMigrations` raw ENOENT on a missing file, duplicate idx, `COMMIT; BEGIN;` in a migration — ENOENT fails loudly with the path; the others need a deliberately malformed committed migration.
  - `[low]` `[reject]` Blind: no version ARG/labels in the image and no GHA layer cache — versioned, signed release images are story 1.11.
  - `[false]` `[reject]` Blind: plan triage log empty while `review: thorough` — the review was in progress; this entry fills it.
  - `[false]` `[reject]` Blind: STRICT tests pass by default on a tableless DB — strict-check.test.ts creates STRICT, non-STRICT and FTS5 tables and asserts the listing.
  - `[low]` `[reject]` Edge: `probeWrite` SQLITE_BUSY/CORRUPT → plain 500 — same as the Blind `probeWrite` row.
  - `[low]` `[reject]` Edge: `busy_timeout` 5000 stalls the event loop past the 3 s HEALTHCHECK — same single-writer reasoning.
  - `[maybe-false]` `[reject]` Edge: disk-full not detected because the dirtied page is rolled back — would need a full-disk test to settle; if true it is `low` (the intent's row is read-only files, and a full disk fails loudly on the next real write).
  - `[medium]` `[patch]` Edge: missing asset 404 cached a year — same root cause as the Blind cache row; same patch.
  - `[low]` `[reject]` Edge: SIGTERM then SIGINT during close exits 1 — needs two signals inside the close window; the fix adds state.
  - `[low]` `[reject]` Edge: CI uid check passes on an empty pid — an empty `pidof` makes `stat /proc/` report 0, which fails the step loudly, not falsely passes.
  - `[false]` `[reject]` Edge: `pidof` absent in node:26-trixie-slim — the same command printed uid 1000 from the running container in this run's verification.
  - `[medium]` `[patch]` Edge: `e2e` package unscanned by the boundary check — same patch as the Blind `e2e` row.
  - `[low]` `[reject]` Edge: a directory under apps/packages/tools without package.json is skipped — it is not a workspace package, and relative imports into it are already flagged as reaching outside.
  - `[low]` `[reject]` Edge: regex literal desync — same as the Blind `stripComments` row.
  - `[low]` `[reject]` Edge: interpolated template dynamic import bypasses the check — no such import exists or is planned; flagging adds a new rule.
  - `[low]` `[reject]` Edge: journal lacks entries, has duplicate idx or a missing file → raw error — loud failure on a malformed committed journal.
  - `[low]` `[reject]` Edge: `COMMIT; BEGIN;` inside a migration partially commits — needs a deliberately malformed migration; reviewers read every migration.
  - `[maybe-false]` `[reject]` Edge: two processes migrating at once → PK violation — would need a second migrating process, which AD-16 forbids; if true it is `low`.
  - `[medium]` `[patch]` Edge: drift check removed — same patch as the Blind CI row.
  - `[medium]` `[patch]` Edge: shellcheck removed — same patch as the Blind CI row.
  - `[medium]` `[patch]` Edge: anchore scan removed — same patch as the Blind CI row.
  - `[low]` `[patch]` Edge: weekly schedule removed — same patch as the Blind CI row.
  - `[medium]` `[patch]` VG: chmod-444 "DB file not writable" row never exercised — added the `startServer` test (pre-verified gap).
  - `[medium]` `[patch]` VG: PWA "Unhealthy" mapping unverified — added api.test.ts; rendering "Unhealthy" in `App` needs a DOM environment and stays covered by the mapping test.
  - `[medium]` `[patch]` VG: Docker HEALTHCHECK never observed in CI — added a step that waits for `State.Health.Status` = `healthy`; confirmed `healthy` locally.
  - `[medium]` `[patch]` VG: migrations drift check dropped — restored with the CI group rather than deferred, since `db:generate` is a no-op now.
  - `[medium]` `[patch]` VG other: anchore scan and schedule dropped — same patch as the Blind CI row.
  - `[medium]` `[patch]` Intent: read-only row tested with `{readonly:true}` rather than a non-writable file — same patch as the VG chmod row.
  - `[low]` `[reject]` Intent: "server exits non-zero" tested at `startServer` rejection, not process exit — `main.ts` is a 5-line catch → `process.exit(1)`; the bundled exit was checked by hand.
  - `[maybe-false]` `[reject]` Intent: on a fresh DB the empty `schema_migration` table survives a failed first migration — would need to settle whether "unchanged" means absent; if true it is `low`, since an empty table records the same version (0).
  - `[low]` `[reject]` Intent: `pnpm lint` output and exit code not tested end to end — `main()` maps violations to `exitCode = 1` in five lines; the violation objects are tested.
  - `[medium]` `[patch]` Intent: web "Unhealthy" branch exercised nowhere — same patch as the VG unhealthy row.
  - `[medium]` `[patch]` Intent: `e2e` outside the graph check — same patch as the Blind `e2e` row.
  - `[low]` `[reject]` Intent: Node 22 guarded by types only — same as the Blind Node row.
  - `[medium]` `[patch]` Intent: ci.yml rewrite dropped the schedule, drift check, anchore scan and shellcheck — same patch as the Blind CI row (smoke test and sample check stay removed: their scripts do not exist).
  - `[false]` `[reject]` Intent: compose adds `read_only` and `init` beyond the intent — the spine requires a read-only, non-root container; not a defect.

## Design Notes

Why a runner-owned tracking table and an empty baseline: the epic allows no domain tables here, and `person`/`household_settings` belong to story 1.3. Drizzle-kit does not emit `STRICT`, so every generated migration is hand-edited to add it, and the STRICT check is what catches a miss.

Runner shape per migration:
```text
PRAGMA foreign_keys = OFF
BEGIN
  <statements>; INSERT INTO schema_migration(version, name, applied_at)
  PRAGMA foreign_key_check  -> any row: throw
  invariants (STRICT check)  -> any failure: throw
COMMIT            (on throw: ROLLBACK)
PRAGMA foreign_keys = ON   (always, in finally)
```

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` -- expected: all green
- `pnpm check:strict` -- expected: exit 0 on a migrated DB
- `docker compose up -d --build && curl -fsS localhost:3000/api/system/health` -- expected: the `ok` JSON above
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm e2e` -- expected: 1 passed

## Auto Run Result

Status: built

**Summary:** Ticket 1.1 tracer bullet. The pnpm workspace has every package from the repo layout, TypeScript 7 strict, Biome 2 and a script that enforces the spine's import graph. `system.health` runs from the PWA through Hono, `app` and `db` to SQLite via our own migration runner (empty `0000_baseline`, STRICT invariant). It is packaged as a non-root Debian-slim container and exercised in CI with lint, types, Vitest, the STRICT check and one Playwright test against the container.

**Files changed:**
- Root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, `biome.json` and `vitest.config.ts` set up the workspace and tooling. `.nvmrc` is now 26. `.gitignore` and `.dockerignore` were extended.
- `scripts/check-boundaries.ts` (+ test) enforces the spine's package graph as part of `pnpm lint`.
- `packages/app`: the `SystemHealthPort` and the `system.health` use case (+ test).
- `packages/db`: `openDatabase` (WAL, foreign keys on), the migration runner, the STRICT check and CLI, the health repository with a write probe, the `0000_baseline` migration and `drizzle.config.ts` (+ tests).
- `apps/server`: Zod config, `startServer` composition root, the Hono API plus static PWA, `main.ts` and the esbuild bundle script (+ tests).
- `apps/web`: the React PWA shell showing health via the typed Hono client and TanStack Query, and vite-plugin-pwa (+ `api.test.ts`).
- Placeholder packages: `packages/{shared,domain,importers,connectors,llm}` and `tools/{mock-llm,mock-prices,seed}`.
- `Dockerfile` and `compose.yaml` build and run the non-root `node:26-trixie-slim` container with a `/data` volume.
- `e2e/`: the Playwright config and the health spec.
- `.github/workflows/ci.yml`: separate lint, typecheck, Vitest, STRICT, migrations-drift and shellcheck steps; the container job runs build, image scan, health, Docker health, non-root and e2e; gitleaks and the weekly schedule are kept.

**Review:** 48 findings.
- 22 rows patched, covering 6 root causes.
- 0 deferred.
- 26 rejected, each with its reason in the Review Triage Log above:
  - 5 false: refuted, or plan or in-progress state.
  - 3 maybe-false, each `low` if true.
  - 18 low: unlikely in everyday use and costly to fix, or out of scope for this story.
- Patched entries by verdict: 5 medium (asset 404 caching, `e2e` graph coverage, non-writable-file test, unhealthy-mapping test, CI checks and Docker health), 1 low (CSP comment wording).

**Follow-up review:** recommended (`true`). Two or more medium entries were patched. The named unverified risk is `.github/workflows/ci.yml`: it has never run on GitHub. Four things in it are unproven:
- `pnpm/action-setup@v4` with pnpm 12.6.0.
- A Node 26 runner.
- `playwright install` for 1.63.
- `anchore/scan-action` against `pangolin:local`.

**Verification:**
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass (8 files; 47 passed, 1 skipped as root, and that one passes as `nobody`).
- `pnpm check:strict` exits 0.
- `docker compose up --build` returns `{"status":"ok","schemaVersion":1,"writable":true}`, and the node process runs as uid 1000.
- Docker health reads `healthy`, a restart re-applies nothing, and `pnpm e2e` gives 1 passed.
- Local Docker needed the daemon started by hand and a proxy override that stays outside the repo.

**Residual risks:**
- CI has not yet run on GitHub (above).
- Docker Hub rate limits (429) hit the base image pull once locally.
- The spine draws no arrows for `tools/*` or `apps/server` → `shared`, so both are forbidden until the spine adds them.
- The image is amd64-only until story 1.11.
- `/healthz` does not check the job-runner lease yet; that comes in story 1.4.
