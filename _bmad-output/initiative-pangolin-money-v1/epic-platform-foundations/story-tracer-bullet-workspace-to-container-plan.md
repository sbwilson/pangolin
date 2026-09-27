---
title: 'Tracer bullet: workspace to container'
type: 'feature'
ticket: '1'
created: '2026-09-27'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
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
- [ ] `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `biome.json` -- root workspace; scripts `lint` (biome check + boundary check), `typecheck` (`pnpm -r typecheck`), `test` (vitest), `check:strict`, `build`, `e2e` -- one command per CI step
- [ ] `apps/*`, `packages/*`, `tools/{mock-llm,mock-prices,seed}` `package.json` + `tsconfig.json` + `src/index.ts` -- every package exists; workspace deps declared only along allowed arrows -- later stories only add code
- [ ] `scripts/check-boundaries.ts` + test -- scan every `import`/`export from`/dynamic import in `apps`, `packages` and `tools` against the allowed map; `apps/web` → `apps/server` only as `import type` -- the spine says a lint rule enforces the graph
- [ ] `packages/app/src/ports/system-health.ts`, `packages/app/src/system/health.ts` + test -- port `{ schemaVersion(): number; probeWrite(): boolean }`; use case returns `{status, schemaVersion, writable}` -- the one tracer use case
- [ ] `packages/db/src/{open,migrate,system-health-repo,strict-check}.ts`, `packages/db/migrations/0000_baseline.sql` + journal, `drizzle.config.ts` + tests -- open with WAL and `foreign_keys = ON`; runner per spine; `probeWrite` = `BEGIN IMMEDIATE` then `ROLLBACK`, false on `SQLITE_READONLY`; invariant suite = STRICT check -- AD-1 and AD-2 and the Migrations convention
- [ ] `apps/server/src/{config,main}.ts`, `apps/server/src/http/app.ts` + test -- migrate on boot, then Hono `GET /api/system/health` (`503` when not writable) and static PWA with SPA fallback; export `type AppType`; esbuild bundle to `dist/` with better-sqlite3 external -- composition root
- [ ] `apps/web` (Vite React, `index.html`, `src/main.tsx`, vite-plugin-pwa with `injectRegister: false`, manifest, `index.html` not precached) -- `hc<AppType>` fetch renders "Healthy" and "Schema version N", or "Unhealthy" -- PWA shell end of the tracer
- [ ] `Dockerfile`, `.dockerignore`, `compose.yaml` -- multi-stage build on `node:26-trixie-slim`; non-root; `/data` volume; port 3000 -- container
- [ ] `e2e/` (`playwright.config.ts`, `health.spec.ts`) -- against `E2E_BASE_URL` (default `http://localhost:3000`) -- one Playwright test
- [ ] `.github/workflows/ci.yml` -- Node from `.nvmrc`, pnpm, then lint, typecheck, test, check:strict on a freshly migrated DB, docker build, compose up, wait for health, e2e -- CI

**Acceptance Criteria:**
- Given a clean checkout, when `docker compose up --build` runs and a browser opens `http://localhost:3000`, then the page shows "Healthy" and "Schema version 1".
- Given the running container, when `GET /api/system/health` is called, then it returns `200` with `{"status":"ok","schemaVersion":1,"writable":true}`, and the container process runs as a non-root uid.
- Given a source file importing across a forbidden arrow, when `pnpm lint` runs, then it fails naming the file.
- Given the workflow file, when CI runs on a push, then lint, typecheck, Vitest, the STRICT check and the Playwright test against the container are all separate steps that must pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

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

Status: ready-for-dev
Halted after planning: the epic sets `plan_checkpoint = true` on entry 1 (inception decision, 2026-09-27), so the plan waits for human review before implementation.
- Invocation `epic 1` resolved to the epic's only ready ticket, 1.1 (`tickets.py next`); one ticket per run.
- Resume with `/bmad-build-auto` pointing at this plan file.
