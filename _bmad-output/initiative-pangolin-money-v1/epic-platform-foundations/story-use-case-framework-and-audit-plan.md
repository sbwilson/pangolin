---
title: 'Use-case framework and audit'
type: 'feature'
ticket: '3'
created: '2026-09-27'
status: 'built'
baseline_revision: '2202534587d00c58935c9b3cffe43c9841682abf'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/data-model.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every later story writes data. The spine requires one write path (AD-1): a use case opens one short synchronous transaction (AD-2), writes its rows and their `audit_log` rows together, and runs as a `Viewer` or, only from jobs and admin, a `SystemViewer` (AD-6). None of that exists yet, and there is no error contract.

**Approach:**
- Add `Viewer`/`SystemViewer`, with the `SystemViewer` factory on its own subpath that lint bans outside `apps/server/src/{jobs,admin}`.
- Add `AppError` and its HTTP mapping to the spine's JSON error shape.
- Add a synchronous write-transaction helper that stamps and appends audit rows, behind a unit-of-work port implemented in `db`.
- Add migration `0001` creating `person`, `household_settings` (with its default row) and `audit_log`.
- Prove the path with the `system.getHouseholdSettings` and `system.updateHouseholdSettings` use cases.

## Boundaries & Constraints

**Always:**
- **Use cases:** they live at `packages/app/src/<module>/<name>.ts` with the signature `(ctx: UseCaseContext, input) → output`, and parse their input with Zod. `UseCaseContext` is `{ viewer, clock, newId, uow }`, and every field is required.
- **Viewers:**
  - A person viewer is `{ kind: "person", personId: Id<"Person">, authAt: Temporal.Instant }`.
  - A system viewer is `{ kind: "system", actor }`, where `actor` is `job:<kind>` or `cli:<command>`.
  - The audit `actor` is `person:<personId>`, or the system viewer's `actor`.
- **Transactions:** the write helper runs its callback inside `BEGIN IMMEDIATE` via the port, synchronously. A callback that returns a promise or thenable is rolled back and throws.
- **Audit rows:** each has `id`, `at` (UTC ISO from `clock.now()`), `actor`, `entity`, `entity_id`, `account_id?`, `person_id?`, `action`, `before`, `after`, and is written in the same transaction as the change it describes. `before` and `after` are JSON text or NULL.
- **`AppError`:**
  - Codes are exactly `NotFound`, `Validation`, `Conflict`, `Unauthenticated`, `ReauthRequired` and `RateLimited`.
  - The HTTP mapping is 404, 400, 409, 401, 403 and 429 respectively.
  - The body is `{ "error": { "code", "message", "details"? } }`.
  - A `ZodError` maps to `Validation` with its issues as `details`.
  - Any other throw maps to 500 `{ "error": { "code": "Internal", "message": "Internal error" } }` with no internals leaked.
- **Factory placement:** the `SystemViewer` factory is exported only from `@pangolin/app/system-viewer`, never from the `@pangolin/app` root.
- **Tables:** all `STRICT`, `snake_case` and singular, following migration and table conventions from story 1.1. Drizzle table objects stay inside `packages/db`.

**Never:**
- No better-auth, login, sessions or HTTP routes for settings or person (story 1.5).
- No `visibleAccounts`, redaction, re-auth window enforcement, account tables or FKs to future tables (epic 2 and later).
- No `pay_anchor` columns on `person` (spine AD-25 moves them to `planning.pay_anchor`).
- No async repository methods.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh DB | migrations applied | schema version 2. `household_settings` has one row: AUD, `07-01`, `Australia/Sydney`, `contribution` | — |
| Update settings | person viewer, `{ timezone: "Australia/Brisbane" }` | row updated. One `audit_log` row: actor `person:<id>`, entity `household_settings`, action `update`, before/after JSON, `at` = clock instant | — |
| System actor | system viewer `job:period-close` updates settings | audit actor is `job:period-close` | — |
| Audit fails | the audit append throws inside the transaction | settings row unchanged, no audit row | error propagates |
| Async callback | the helper's callback returns a promise | rolled back, nothing written | throws |
| Bad input | unknown timezone, or an unknown field | nothing written | `AppError` `Validation` → 400 with details |
| AppError over HTTP | a route throws each of the 6 codes | status 404/400/409/401/403/429 with the error shape | — |
| Unknown throw over HTTP | a route throws `new Error("db path /x")` | 500 `Internal`; the body does not contain the message | — |
| Lint | `apps/server/src/http/x.ts` imports `@pangolin/app/system-viewer` | `pnpm lint` fails. The same import in `jobs/` or `admin/` passes | — |

</intent-contract>

## Code Map

- `packages/app/src/{ports,system}/`:
  - `ports/system-health.ts` and `system/health.ts` are the existing port-and-use-case pattern to mirror.
  - `clock.ts`, `ids.ts` (`newId`, `IdGenerator`) and `ports/clock.ts` come from story 1.2; reuse them.
  - `packages/app/package.json` `exports` gains `./system-viewer`.
- `packages/shared/src/{ids,temporal}` provide `Id<B>`, `idSchema`, `Temporal` and `PlainDate`.
- `packages/db/src/`:
  - `migrate.ts`, `open.ts` and `strict-check.ts` stay unchanged.
  - `schema/index.ts` is empty today.
  - `system-health-repo.ts` is the repo pattern to follow.
- `packages/db/migrations/`:
  - Generate `0001` with `pnpm --filter @pangolin/db db:generate`.
  - Then hand-add `STRICT` to each `CREATE TABLE`, and append the default `household_settings` `INSERT`.
  - `drizzle-kit` must then show no further changes, because CI runs a drift check.
  - Tests elsewhere assert `schemaVersion: 1`, and these become 2: `apps/server/src/{server,http/app}.test.ts`, `e2e/health.spec.ts` and `packages/db/src/*.test.ts`.
- `apps/server/src/http/app.ts`:
  - `createApi` and `createApp` exist.
  - `notFound` hand-builds the error shape; it should reuse `AppError`.
  - Add `app.onError`.
- `biome.json`:
  - Its `noRestrictedImports` rule has two overrides, and an override replaces options per path.
  - Every override must also carry the new `@pangolin/app/system-viewer` ban, except the `jobs/**` and `admin/**` allowance.
  - `scripts/biome-restrictions.test.ts` probes these bans; extend it.
- Timezone validation reuses `Temporal` from `@pangolin/shared/temporal`, which throws `RangeError` on an unknown zone.
- `README.md` and `e2e/health.spec.ts` mention "Schema version 1", so update them to 2.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/viewer.ts` + `packages/app/src/system-viewer.ts` -- `Viewer` union, `PersonViewer`, `SystemViewer`, `personViewer(personId, authAt)`, `actorOf(viewer)`; `systemViewer(actor)` validating `^(job|cli):[a-z0-9-]+$` in its own module -- AD-6
- [x] `packages/app/src/errors.ts` + test -- `AppError(code, message, details?)`, `errorBody(err)`, the `ErrorCode` type -- Errors convention
- [x] `packages/app/src/ports/unit-of-work.ts` -- `UnitOfWork { transaction<T>(fn: (tx: TxRepos) => T): T }`; `TxRepos` = `{ householdSettings: { get(); update(row) }, audit: { append(row) } }` (sync) -- AD-2 port
- [x] `packages/app/src/write.ts` + test -- `write(ctx, (tx, audit) => T)`: runs `ctx.uow.transaction`; `audit({ entity, entityId, action, before, after, accountId?, personId? })` stamps `id` (ctx.newId), `at` and `actor`; rejects a thenable result -- the single write helper
- [x] `packages/app/src/context.ts` -- `UseCaseContext` -- signature convention
- [x] `packages/app/src/system/household-settings.ts` + test -- `getHouseholdSettings(ctx, {})` and `updateHouseholdSettings(ctx, input)` (partial of `baseCurrency` (3 uppercase letters), `timezone` (valid IANA zone), `sharedAttribution` (`contribution` or `even`)); `fyStart` stays `07-01`, read-only in v1 -- proving use case
- [x] `packages/db/src/schema/{person,household-settings,audit-log}.ts`, `migrations/0001_*.sql` + journal/snapshot -- the three tables. Columns:
  - `person`: `id` TEXT PK, `user_id` TEXT UNIQUE NULL, `display_name` TEXT NOT NULL, `colour` TEXT NOT NULL, `created_at`, `updated_at`, `deleted_at` NULL.
  - `household_settings`: `id` INTEGER PK CHECK (`id` = 1), `base_currency`, `fy_start`, `timezone`, `shared_attribution` CHECK IN (`contribution`, `even`), `updated_at`.
  - `audit_log`: as the Always list, plus indexes on (`entity`, `entity_id`) and `at`.
  - Why: the tables the epic allows.
- [x] `packages/db/src/unit-of-work.ts` + test -- `createUnitOfWork(db)` using `db.transaction(fn).immediate()`, with the settings and audit repos bound to the same connection -- adapter
- [x] `apps/server/src/http/errors.ts` + test, `apps/server/src/http/app.ts` -- `httpStatus(code)`, `onError` handler; `notFound` uses `AppError` -- HTTP mapping
- [x] `biome.json`, `scripts/biome-restrictions.test.ts` -- ban `@pangolin/app/system-viewer` everywhere except `apps/server/src/{jobs,admin}/**`; probes for http (fails), jobs and admin (pass) -- AD-6 lint
- [x] `packages/app/src/index.ts`, `packages/app/package.json` -- export everything except `systemViewer`; add the `./system-viewer` subpath
- [x] Tests asserting schema version 1 → 2, `e2e/health.spec.ts`, `README.md` -- keep the suite honest

**Acceptance Criteria:**
- Given a migrated database and a person viewer, when `updateHouseholdSettings` runs, then the settings row and exactly one matching audit row exist. When the audit append is made to throw, neither exists. Both cases are tested on a real SQLite file.
- Given an `http/` file importing `@pangolin/app/system-viewer`, when `pnpm lint` runs, then it fails; from `jobs/` or `admin/` it passes.
- Given a Hono route throwing `AppError("Conflict", …)`, when requested, then the response is 409 with `{ "error": { "code": "Conflict", "message": … } }`.
- Given the container on a fresh volume, when `/api/system/health` is called, then `schemaVersion` is 2.

## Implementation Notes

- Migration is `0001_person_settings_audit.sql` (generated with `--name`), hand-edited to add `STRICT` to the three tables and to append the default `household_settings` row (`updated_at` = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`). `drizzle-kit generate` reports no further changes.
- `SystemViewer` carries a type-only brand, so it can be built only through `systemViewer()`, never as an object literal.
- `AppError` details use a `declare` field, so an error without details has no `details` key.
- `parseInput(schema, input)` in `app/errors.ts` turns a `ZodError` into `AppError("Validation", …, issues)`; `errorBody` also maps a raw `ZodError` for safety.
- `write` also refuses `audit()` after its transaction ended; the db adapter's repositories do the same, so code after an `await` in a misused callback cannot autocommit.
- `updateHouseholdSettings`: the time zone is canonicalised by Temporal and offset zones (`+10:00`) are rejected; a patch that changes nothing writes nothing and returns the current row.
- `app` may not import `db`, so the real-SQLite use-case tests (success, audit throws, SQLite rejects the audit row) live in `packages/db/src/unit-of-work.test.ts`, with a person viewer (the `system-viewer` subpath is banned in `db`). The system-actor case is tested in `app` against an in-memory UoW (`packages/app/src/testing/memory-uow.ts`, not exported).
- `createApp` takes an optional `logInternalError`; by default a 500 is logged as a JSON line on stderr.
- Verified: lint, typecheck, test (243 passed, 1 skipped as root), `check:strict`, drift check, `pnpm build`, and `docker compose up -d --build` on a fresh volume: `/api/system/health` → `schemaVersion` 2. `pnpm e2e` could not run here: the Playwright Chromium build is not installed in this environment.

## Plan Change Log

- `UnitOfWork` gained `read<T>(fn: (repos: ReadRepos) => T): T` (a deferred transaction with read-only repos), so `getHouseholdSettings` does not take the write lock with `BEGIN IMMEDIATE`.
- `audit_log` gained `CHECK (before/after IS NULL OR json_valid(...))` to enforce "JSON text or NULL" in the schema.

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 36 findings — high 0, medium 9, low 24, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: the SystemViewer ban is bypassed by relative imports — the ban now covers relative and deep paths (`**/system-viewer*`), allowed only in `jobs/**`, `admin/**` and `*.test.ts`; probes cover relative, web, e2e and scripts (fail) and admin/nested and test files (pass).
  - `[medium]` `[patch]` Blind: stored instants have variable precision, which breaks text ordering — added `formatInstant` (exactly 3 fractional digits), used for `audit_log.at` and `updated_at`; a test shows the formatted values sort in time order.
  - `[low]` `[reject]` Blind: audit `at` and the row's `updatedAt` come from two `clock.now()` calls — microseconds apart with the system clock; sharing one instant would widen the callback's API with no consumer that needs it.
  - `[medium]` `[patch]` Blind: Hono `HTTPException` becomes a logged 500 — `createErrorHandler` now returns `err.getResponse()` for it, unlogged; a test throws 413 and gets 413.
  - `[low]` `[patch]` Blind: the 500 logger drops detail and is untested — added a `console.error` spy test for the default logger; stacks stay out of logs by default, per the spine's redacted-logging rule.
  - `[low]` `[patch]` Blind: the timezone comment claims a daylight-saving rationale that `UTC` and `Etc/GMT-10` contradict — reworded the comment: a named IANA zone is required and fixed offsets are rejected.
  - `[low]` `[reject]` Blind: `baseCurrency` is not validated against ISO 4217 — v1 requires the account currency to equal the base currency (multi-currency is deferred), and AUD is the default.
  - `[low]` `[reject]` Blind: no DB CHECKs for `base_currency` and `fy_start` — the only writer is the validated use case, and `fy_start` is read-only in v1.
  - `[low]` `[reject]` Blind: no test migrates an existing v1 database — the runner applies pending migrations generically (tested); the health probe writes no rows; there is no release database yet.
  - `[low]` `[reject]` Blind: audit `entity`, `action` and IDs are plain strings — literal unions would be premature with one use case; later modules add their entities.
  - `[low]` `[reject]` Blind: a no-op update still takes the write lock — settings updates are rare, admin-driven writes; nothing is written or audited.
  - `[low]` `[reject]` Blind: `person.user_id` is unique across soft-deleted rows — re-linking a login to a new person is a story 1.5 decision; no person writes exist yet.
  - `[low]` `[reject]` Blind: the in-memory unit of work lacks the SQLite read guard — it is a test double; the real adapter's guard is tested in db.
  - `[low]` `[patch]` Blind: ban probe gaps (web, e2e, scripts, admin/nested) — added those probes with the relative-import patch.
  - `[false]` `[reject]` Blind: plan bookkeeping and e2e unverified — the review was in progress; e2e has since run and passed (1 passed, schema version 2).
  - `[low]` `[reject]` Blind: 429 responses carry no `Retry-After` header — rate limiting arrives with login in story 1.5.
  - `[medium]` `[patch]` Edge: `HTTPException` → 500 — same patch as the Blind HTTPException row.
  - `[low]` `[reject]` Edge: an AppError code missing from `STATUS` sends 200 — `ErrorCode` is a closed union; reaching this needs a cast.
  - `[low]` `[reject]` Edge: non-serialisable `details` make the handler throw — `details` come from Zod issues or literal objects in our own code.
  - `[low]` `[reject]` Edge: the logger throwing loses the response — the default logger is `JSON.stringify` of strings; a custom logger is test-only.
  - `[medium]` `[patch]` Edge: instant precision breaks ordering — same patch as the Blind precision row.
  - `[low]` `[reject]` Edge: `transaction()` inside `read()` becomes a savepoint in a deferred transaction — no use case nests a write inside a read; that would be a programming error that fails loudly.
  - `[low]` `[reject]` Edge: a returned object wrapping a promise escapes the thenable check — deep-checking returned values is unbounded; AD-2 is a code-review rule, and the top-level check catches the realistic mistake.
  - `[low]` `[reject]` Edge: `actorOf` has no default for an unknown kind — `Viewer` is a closed union under strict TS.
  - `[low]` `[reject]` Edge: `personViewer` accepts an empty `personId` via a cast — `personId` is `Id<"Person">`; reaching this needs a cast.
  - `[low]` `[patch]` Edge: `Etc/GMT` zones are accepted despite the comment — same patch as the Blind timezone-comment row (the comment was wrong, the behaviour is fine).
  - `[medium]` `[patch]` Edge: the SystemViewer ban is bypassed by relative imports — same patch as the Blind SystemViewer row.
  - `[low]` `[patch]` VG: nothing pins `uow.read` as deferred — added a two-connection test: a second connection can `BEGIN IMMEDIATE` during a read.
  - `[low]` `[patch]` VG: the default logger is never exercised — same patch as the Blind logger row (the lens filed it as defer; the fix is one test).
  - `[medium]` `[patch]` VG other: the SystemViewer ban is bypassed by relative imports — same patch as the Blind SystemViewer row.
  - `[medium]` `[patch]` VG other: `HTTPException` → 500 — same patch as the Blind HTTPException row.
  - `[medium]` `[patch]` Intent A: the SystemViewer ban is bypassed by relative imports (enforced at the import name, not the module) — same patch as the Blind SystemViewer row.
  - `[false]` `[reject]` Intent E: lint verified by probe files rather than a real http file — the probes run the repo's real `biome.json` at real repo-relative paths.
  - `[low]` `[reject]` Intent F: AppError mapping tested on a bare Hono app, not `createApp` — `createApp` installs the same `createErrorHandler`; there are no AppError-throwing routes in this story.
  - `[low]` `[reject]` Intent D: system-viewer audit actor tested only in memory — db may not import the factory (the lint ban under review); the actor string comes from `actorOf`, which is tested.
  - `[false]` `[reject]` Intent: scope beyond the one-line intent — it comes from the plan's intent contract; not defects.

## Design Notes

**The audit helper stamps; the use case supplies the content.** `write` builds the `audit` function from `ctx`, so no use case can forget the actor or time, or write audit rows outside the transaction:
```ts
return write(ctx, (tx, audit) => {
  const before = tx.householdSettings.get();
  const after = { ...before, ...patch, updatedAt: ctx.clock.now().toString() };
  tx.householdSettings.update(after);
  audit({ entity: "household_settings", entityId: "1", action: "update", before, after });
  return after;
});
```

**`ReauthRequired` → 403:** the caller is authenticated but must re-authenticate. It carries its own code so the client can tell it from 401.

**The default settings row is inserted by migration `0001`:** a table that must always hold exactly one row is schema, not a use-case write.

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all green
- `pnpm --filter @pangolin/db db:generate && git status --porcelain packages/db/migrations` -- expected: no new migration after `0001`
- `pnpm build` -- expected: success
- `docker compose up -d --build`, then `curl -fsS localhost:3000/api/system/health` -- expected: `schemaVersion` 2 (local Docker may need the scratchpad proxy override; if Docker Hub rate-limits, record it and rely on the build and unit tests)

## Auto Run Result

Status: built

**Summary:** Ticket 1.3, the use-case framework:
- `Viewer`/`SystemViewer`: the factory is on the `@pangolin/app/system-viewer` subpath, and lint bans it by name or relative path outside `apps/server/src/{jobs,admin}` and test files.
- `AppError` with the six codes and the JSON error shape, mapped to HTTP (`ZodError` → 400 `Validation`, unknown errors → 500 `Internal` with nothing leaked, Hono `HTTPException` passed through).
- The synchronous `write` helper: `BEGIN IMMEDIATE` through a unit-of-work port, audit rows stamped with ID, time and actor, and thenables rejected.
- Migration `0001`: `person`, `household_settings` (default row) and `audit_log`.
- The `get`/`updateHouseholdSettings` use cases and `formatInstant`.

**Files changed:**
- `packages/app`:
  - `viewer.ts`, `system-viewer.ts`, `errors.ts`, `context.ts` and `write.ts`.
  - `ports/unit-of-work.ts`.
  - `system/household-settings.ts`.
  - Tests for each, and the `./system-viewer` export.
- `packages/shared/src/temporal`: `formatInstant`.
- `packages/db`:
  - `schema/{person,household-settings,audit-log}.ts`.
  - `migrations/0001_person_settings_audit.sql` and its journal and snapshot.
  - `unit-of-work.ts`.
  - Tests.
- `apps/server/src/http`: `errors.ts`, with `onError` and `notFound` wired into `app.ts`.
- `biome.json` and `scripts/biome-restrictions.test.ts`: the `SystemViewer` ban and its probes.
- Schema version 1 → 2 in the tests, `e2e/health.spec.ts` and `README.md`.

**Review:** 36 findings.
- 15 rows patched, covering 6 root causes.
- 0 deferred.
- 21 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict: 3 medium (`SystemViewer` relative-path bypass, instant precision, `HTTPException` → 500), 3 low (read-lock test, default-logger test, timezone comment).

**Follow-up review:** recommended (`true`, since three medium entries were patched). The named unverified risk:
- `HTTPException` responses now use Hono's own plain-text body, not the spine's `{ "error": { code, message } }` shape.
- No route yet throws one, so it's unproven which shape clients will get once story 1.5 adds request bodies and validators.

**Verification:**
- `pnpm install --frozen-lockfile`, lint, typecheck and `pnpm test` all pass: 21 files, 258 passed, 1 skipped as root.
- `check:strict` passes, and `db:generate` reports no schema changes.
- `pnpm build` passes.
- Playwright against the Node build gives 1 passed, with `schemaVersion` 2.
- The subagent's `docker compose` run on a fresh volume returned `schemaVersion` 2. My rebuild was blocked by a Docker Hub 429 on `node:26-trixie-slim`.

**Residual risks:**
- The `HTTPException` body shape (above).
- The system-viewer audit actor is tested only against the in-memory unit of work.
- `person.user_id` uniqueness across soft-deleted rows is left for story 1.5 to decide.
