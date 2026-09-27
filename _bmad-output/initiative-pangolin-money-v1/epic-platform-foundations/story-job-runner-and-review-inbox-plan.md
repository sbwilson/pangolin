---
title: 'Job runner and review inbox'
type: 'feature'
ticket: '4'
created: '2026-09-27'
status: 'built'
baseline_revision: '179cc7b45bf7089eaa5146b979ec608e0b8f1ad3'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      Job handlers get no timeout or abort signal, so a hung handler holds its lane forever and
      keeps working after its lease is lost or the runner stops.
    evidence: |-
      runner.ts awaits the handler with no timeout and renews its lease for as long as it runs.
      JobContext has no AbortSignal. No job kind exists yet, so this can't happen today. The first
      real kind (story 1.10 backups) should add a per-kind timeout and a signal that fires on
      lease loss, stop and timeout.
    location: >-
      apps/server/src/jobs/runner.ts
    severity: medium
  - summary: >-
      job.dead review items have no resolve path, and the review inbox has no HTTP or PWA surface.
    evidence: |-
      failJob raises job.dead with entity_ref job:<id>, but nothing retries a dead job or resolves
      the item, and listReviewItems has no route. A route needs a person Viewer, which arrives
      with login in story 1.5.
    location: >-
      packages/app/src/system/review-items.ts
    severity: medium
  - summary: >-
      Finished job rows (done and dead) are never deleted, so the table and last_error text grow
      forever.
    evidence: |-
      Nothing prunes the job table. Error text may hold upstream details and stays on disk
      indefinitely.
    location: >-
      packages/db/src/job-repo.ts
    severity: low
  - summary: >-
      No test renders a non-empty dead-jobs list on the status page.
    evidence: |-
      e2e covers only the empty state, and apps/web has no component-test harness.
    location: >-
      apps/web/src/App.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epics 5, 6, 9 and 1.10 all need background work: LLM calls, price fetches, backups and period close. It has to survive crashes, never double-apply effects, and commit through use cases (AD-8). Every epic also needs one shared "needs attention" inbox (AD-17). Neither exists.

**Approach:**
- A `job` outbox table that use cases enqueue into inside their business transaction.
- A kind registry: a Zod payload schema, a lane, a retry policy, and flags for external effects and for needing a person.
- Leased atomic claims per lane, with configurable concurrency.
- Exponential backoff that ends in `dead`.
- Code-defined schedules, ensured at startup.
- A `review_item` table with a kind registry, idempotent raise and resolve, and scoped reads.
- A status endpoint and PWA section listing dead jobs by kind and time only.

## Boundaries & Constraints

**Always:**
- **Enqueue:**
  - `enqueueJob(tx, ctx, kind, payload, { dedupeKey?, runAt? })` runs inside the caller's `write` transaction.
  - It validates the payload with the kind's schema.
  - A second enqueue with a `dedupe_key` that is already pending or running is a no-op and returns the existing job ID. The rule is enforced by a partial unique index.
- **Claim:**
  - One `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING` per claim.
  - The oldest runnable job in the lane is claimed: either `pending` with `run_at <= now`, or `running` with an expired lease.
  - A claim sets `running`, `lease_owner`, `lease_expires_at = now + leaseMs` and `attempts + 1`.
  - Only the lease owner can complete a job, fail it or renew its lease.
- **Handlers:**
  - `(ctx: JobContext, payload) → Promise<void>`. The handler does its I/O first, then commits through use cases with `ctx` (a `SystemViewer` actor of `job:<kind>`).
  - The payload is parsed again at run time; an invalid payload goes straight to `dead`.
  - While a handler runs, the runner renews the lease every `leaseMs / 3`.
- **Retries:**
  - On failure, while `attempts < maxAttempts`, the job goes back to `pending` with `run_at = now + min(maxDelay, base × 2^(attempts-1))`. Otherwise it becomes `dead`.
  - A crash, meaning an expired lease that gets re-claimed, counts as an attempt.
  - A `dead` job whose kind has `needsPersonWhenDead` raises exactly one `review_item` (kind `job.dead`, household scope, `entity_ref` `job:<id>`, dedupe `job.dead:<id>`) in the same transaction.
- **Lanes:** `llm`, `net` and `local`. Concurrency comes from config with defaults `llm = 1`, `net = 2` and `local = 1`, and `leaseMs` defaults to 60 s. Runner timing uses the injected `Clock`. Tests drive the runner with `runner.tick()`, never real timers.
- **Schedules:**
  - `defineSchedule({ name, kind, payload, next(after: Instant) → Instant })`.
  - At startup the runner enqueues each schedule's next run with dedupe `schedule:<name>`.
  - Finishing a scheduled job enqueues its next run in the same transaction, whether it ends `done` or `dead`.
  - The production schedule list is empty until stories 1.10 and later add schedules.
- **Review inbox:**
  - `defineReviewKind({ kind, module, scope: "account" | "person" | "household" })`, where `job.dead` has household scope.
  - `raiseReviewItem(tx, audit, …)` is idempotent on `dedupe_key` among open items. `resolveReviewItem(tx, audit, { dedupeKey, resolution })` sets `resolved_at`.
  - Both write audit rows.
- **Visibility:**
  - `listReviewItems(ctx)` returns open items.
  - A person viewer sees items with no scope, plus items whose `person_id` is theirs.
  - Items with an `account_id` are hidden from person viewers until epic 2 supplies `visibleAccounts`.
  - A `SystemViewer` sees all items.
- **Status:** `GET /api/system/jobs` returns `{ dead: [{ kind, failedAt }] }`, newest first, at most 50. It never includes payload, error text or IDs. The PWA shows the list under the health lines.
- **Ownership:** `job` and `review_item` are owned by `system`, in migration `0002`. All tables are `STRICT`.
- **Audit:** job bookkeeping writes (claim, renew, complete, fail) are not audited, because they are system state and not entity changes. Enqueues are audited by the business use case that causes them, and review-item raises and resolves are audited.
- **Runner lifecycle:** `startServer` starts the runner and stops it on close. It doesn't start in demo mode.

**Never:**
- No real job kinds or schedules beyond test fixtures and `job.dead`.
- No `/healthz` job-runner-lease field (see Design Notes).
- No `restore`-time cancellation of external-effect jobs (story 1.10).
- No redaction or `needs_review` flag (epic 2).
- No auth on the status route (story 1.5 gates `/api/*`).
- No payload or error text in any HTTP response.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enqueue in a transaction | a use case writes a row, enqueues, then throws | neither the row nor the job exists | — |
| Dedupe | two enqueues with the same `dedupeKey` while the first is pending | one job; same ID returned | — |
| Dedupe after done | the first job is `done`, then enqueue again | a new job | — |
| Bad payload | enqueue with a payload that fails the schema | nothing enqueued | `AppError` `Validation` |
| Crash | runner A claims, never finishes; the clock advances past the lease | runner B claims it; `attempts` = 2 | — |
| Not the owner | A's lease expired and B re-claimed; A then completes | A's completion is rejected; the job stays B's | returns false; logged |
| Retry | the handler throws with `maxAttempts` 3 | pending at `now + base`, then `+ 2 × base`, then `dead` | — |
| Dead needing a person | a kind with `needsPersonWhenDead` dies | one open `review_item` `job.dead` | — |
| Concurrency | `llm` = 1 with 3 pending jobs | one running at a time | — |
| Schedules after restart | ensure schedules, stop, restart, ensure again | exactly one pending row per schedule | — |
| Review idempotent | raise the same `dedupeKey` twice | one open item; resolving closes it; raising again opens a new one | — |
| Review visibility | items for person A, person B, household, account | A sees their own and the household's; account-scoped are hidden | — |
| Status | a dead job with error text | `{ dead: [{ kind, failedAt }] }` only | — |

</intent-contract>

## Code Map

- `packages/app/src`:
  - `write.ts` (`write(ctx, (tx, audit) => …)`), `context.ts` (`UseCaseContext`), `errors.ts` (`AppError`, `parseInput`), `ports/unit-of-work.ts` (`TxRepos`, `ReadRepos`, the row types) and `clock.ts` (`fixedClock`, `systemClock`).
  - `system/household-settings.ts` and `identity/create-person.ts` are the use-case pattern to follow.
  - `testing/` holds an in-memory unit of work used by app tests; extend it.
- `packages/app/src/system-viewer.ts` is importable only from `apps/server/src/{jobs,admin}/**` and `*.test.ts` (Biome ban). Jobs run as `systemViewer("job:<kind>")`.
- `packages/db/src`:
  - `unit-of-work.ts` exposes `txRepos` and `readRepos`; add `jobs` and `reviewItems` repos there, or in their own files wired in.
  - Schema files go in `schema/`.
  - Generate migration `0002` with `pnpm --filter @pangolin/db db:generate`, then hand-add `STRICT`, the partial unique indexes and CHECKs. drizzle-kit may not express partial indexes; if not, put them in the SQL and keep the drift check clean.
- `packages/shared/src/temporal` provides `formatInstant` (fixed `.SSSZ`). Stored times use it, so text comparison matches time order.
- `apps/server/src`:
  - `jobs/index.ts` is a placeholder; the runner and registry wiring go in `jobs/`.
  - `server.ts`: `startServer` returns `RunningServer` with `close()`, `clock` and `uow`, plus a `demo` flag. Start and stop the runner here, and never in demo mode.
  - `http/app.ts`: `createApi` chains Hono routes, and `AppType` feeds the web RPC client. Add `GET /api/system/jobs` there.
  - `config.ts` is the Zod env schema; add `PANGOLIN_JOB_CONCURRENCY_{LLM,NET,LOCAL}` and `PANGOLIN_JOB_LEASE_MS`, with defaults.
- `apps/web/src/{App.tsx,api.ts}`: render dead jobs below "Schema version N".
- Test conventions: the `e2e/health.spec.ts` text assertions must keep passing; tests that assert `schemaVersion` go from 2 to 3 (grep `schemaVersion: 2` and "Schema version 2", including `README.md`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/{job,review-item}.ts`, `migrations/0002_*.sql` -- the tables:
  - `job`: `id`, `kind`, `lane` (CHECK in `llm`/`net`/`local`), `payload` (JSON CHECK), `dedupe_key`, `status` (CHECK in `pending`/`running`/`done`/`dead`), `attempts`, `max_attempts`, `run_at`, `lease_owner`, `lease_expires_at`, `last_error`, `created_at`, `updated_at` and `finished_at`. A partial unique index on `dedupe_key` WHERE status IN (`pending`, `running`), and an index on (`lane`, `status`, `run_at`).
  - `review_item`: `id`, `kind`, `account_id`, `person_id`, `entity_ref`, `dedupe_key`, `created_at`, `resolved_at` and `resolution`. A partial unique index on `dedupe_key` WHERE `resolved_at` IS NULL.
  - Why: the AD-8 and AD-17 tables.
- [x] `packages/app/src/ports/unit-of-work.ts` + `packages/db/src/…` (+ db tests on real SQLite) -- sync repos:
  - `jobs`: `insertOrGetPending`, `claimNext(lane, owner, now, leaseUntil)`, `renewLease`, `complete`, `retry`, `markDead`, `listDead(limit)`.
  - `reviewItems`: `raise`, `resolve`, `listOpenFor(viewerScope)`.
  - Why: the adapter.
- [x] `packages/app/src/jobs/{registry,enqueue,lifecycle}.ts` + tests -- `defineJobKind`, `defineSchedule`, `enqueueJob`, and the claim/complete/fail use cases (backoff, dead, the `job.dead` review raise, next schedule enqueue) -- AD-8
- [x] `packages/app/src/system/review-items.ts` + tests -- `defineReviewKind`, `raiseReviewItem`, `resolveReviewItem`, `listReviewItems` -- AD-17
- [x] `packages/app/src/system/job-status.ts` + test -- `deadJobs(ctx)` → `{ kind, failedAt }[]` -- AD-9
- [x] `apps/server/src/jobs/runner.ts` + tests -- `createRunner({ uow, clock, newId, kinds, schedules, concurrency, leaseMs, owner })` with `start()`, `stop()` and `tick()`; handler `ctx` built with `systemViewer`; lease heartbeat -- runner
- [x] `apps/server/src/{server,config}.ts`, `apps/server/src/http/app.ts` + tests -- start and stop the runner (not in demo mode); config; `GET /api/system/jobs` -- wiring
- [x] `apps/web/src/{api,App}.tsx` -- dead-jobs list ("No jobs need attention" when empty) -- status page
- [x] Tests, `e2e/health.spec.ts` and `README.md`: schema version 2 → 3 -- keep the suite honest

**Acceptance Criteria:**
- Given a job claimed by one runner that then stops without finishing, when the injected clock passes the lease, then a second runner claims and completes it.
- Given two enqueues with the same `dedupeKey` while the first is pending, when both commit, then exactly one job row exists.
- Given a kind with `needsPersonWhenDead` whose handler always fails, when it exhausts its attempts, then it is `dead` and exactly one open `job.dead` review item exists.
- Given a schedule, when the runner starts, stops and starts again, then exactly one pending job exists for that schedule.
- Given a dead job, when `GET /api/system/jobs` is called, then the body lists only its kind and failure time.

## Implementation Notes

- **`/healthz` lease check still missing.** The spine's Health convention says `/healthz` includes "the job-runner lease held". Not added here (see Design Notes); it is the one piece of the spine's health definition still missing. Story 1.9 (`pangolin status`) or 1.11 (upgrade health) should add it.
- **Dedupe is lookup-then-insert, with the partial unique index as the backstop.** drizzle 0.45 renders an `ON CONFLICT (col) WHERE …` target with the WHERE after `DO NOTHING`, which SQLite rejects. Both repos look up the live/open row and insert inside the `BEGIN IMMEDIATE` write transaction, so no other writer can interleave; the partial unique indexes (`job_dedupe_key_live_idx`, `review_item_dedupe_key_open_idx`) are generated by drizzle-kit from the schema, so the drift check stays clean.
- **Kinds and handlers are separate.** `defineJobKind` holds schema, lane, retry and flags (what `enqueueJob` needs); `jobHandler(kind, handler)` pairs a handler with it only in the runner's registration list (`apps/server/src/jobs/index.ts`, empty in production). Job kind and schedule names are lowercase-hyphenated so `job:<kind>` is a valid `SystemViewer` actor.
- **A crash on the final attempt goes dead without running.** A re-claim can push `attempts` past `max_attempts`; the runner then records it `dead` ("Lease expired on the final attempt") instead of running it again.
- **Unknown kinds and unparseable payloads go straight to `dead`.** A job whose kind has no handler in this build is dead with no review item (its `needsPersonWhenDead` is unknown).
- **Lease heartbeat is clock-driven inside `tick()`.** Each tick renews any running job whose last renewal is at least `leaseMs / 3` old by the injected clock; `start()` calls `tick()` every `min(1 s, leaseMs / 3)` of real time. `stop()` stops claiming, then waits up to 10 s for running handlers while still renewing their leases. A lane with concurrency 0 is disabled and logs a warning at start.
- **Review-item visibility** is `visibleReviewItems(viewer)` in `packages/db/src/review-item-repo.ts`; it throws without a viewer. Items with an `account_id` are hidden from people until epic 2 composes `visibleAccounts(viewer)` there. `review_item.person_id` has a foreign key to `person`; `account_id` gets one when epic 2 adds `account`.
- **`GET /api/system/jobs`** runs `system.deadJobs` with only the unit of work (no viewer), like `health`; `ApiDeps` now takes `uow`.
- **Status page** shows "No jobs need attention", or a "Jobs that failed" list of kind and time, under the health lines; e2e asserts the empty state.
- **Not done / risks:** finished `job` rows are never pruned (the table grows; `job_finished_idx` keeps the dead list cheap). Redaction of review items (AD-4) and `needs_review` remain epic 2. `restore`-time cancellation of external-effect jobs remains story 1.10.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 37 findings — high 0, medium 13, low 19, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: enqueue validates the payload but stores the caller's raw object (unknown keys, skipped defaults, non-JSON values) — the payload is now round-tripped through JSON and parsed, and the parsed value stored; non-JSON payloads → `Validation`; tests.
  - `[medium]` `[patch]` Blind: self re-claim leaves `run.job.attempts` stale, so `failJob` judges retries on the old count — the runner keeps the re-claimed row; a test fails without the fix.
  - `[medium]` `[defer]` Blind: a hung handler holds its lane forever, and handlers get no abort signal on lease loss or stop — no job kinds exist yet, so this can't happen today; recorded in `deferred` for the first real kind (1.10).
  - `[medium]` `[patch]` Blind: nothing checks that `Schedule.next` moves forward, so a broken schedule loops every tick — non-forward `next` throws a `TypeError` naming the schedule at startup and at next-run enqueue; tested.
  - `[medium]` `[defer]` Blind: `job.dead` items have no resolve path, and the review inbox has no user-facing surface — an inbox route needs a Viewer from login (1.5); recorded in `deferred`.
  - `[low]` `[patch]` Blind: dead-job list React keys collide within a millisecond — the key now includes the index.
  - `[low]` `[reject]` Blind: the status page shows raw UTC times and never refreshes — an ops page; a reload shows new dead jobs; formatting waits for the real UI.
  - `[low]` `[reject]` Blind: three sets of job defaults — consistent today; drift risk is cosmetic; config enforces the stricter lease minimum.
  - `[low]` `[patch]` Blind: concurrency 0 silently disables a lane — one warning per disabled lane at start; README documents 0 and the 3000 ms lease minimum.
  - `[low]` `[patch]` Blind: runner failure paths untested (a dead scheduled job, self re-claim) — added tests for a dead scheduled job enqueuing its next run, and for self re-claim; other paths rejected as low.
  - `[low]` `[patch]` Blind: the DB does not enforce review-item scope — added `CHECK (account_id IS NULL OR person_id IS NULL)` in 0002 with a test; no drift.
  - `[low]` `[defer]` Blind: finished jobs are never deleted — recorded in `deferred` for a retention story.
  - `[low]` `[reject]` Blind: demo `/api/system/jobs` untested — the demo database is migrated by the same runner, so the `job` table exists; list endpoints are tested live.
  - `[medium]` `[defer]` Edge: a hung handler holds its lane forever, and handlers get no abort signal on lease loss or stop — same as the Blind hung-handler row.
  - `[medium]` `[patch]` Edge: `stop()` stops renewing leases while draining, so a lease can expire mid-drain — leases are renewed on an interval during the drain; a fake-timer test shows no re-claim and the job ends `done`.
  - `[low]` `[reject]` Edge: after a stop timeout, `close()` closes the database under a running handler — only after 10 s; at-least-once delivery re-runs the job (AD-8 requires idempotent handlers).
  - `[medium]` `[patch]` Edge: nothing checks that `Schedule.next` moves forward, so a broken schedule loops every tick — same patch as the Blind schedule row.
  - `[low]` `[reject]` Edge: `schedule.next` throwing inside completion rolls back and re-runs — a schedule that throws fails loudly at startup under the new startup check.
  - `[medium]` `[patch]` Edge: enqueue validates the payload but stores the caller's raw object (unknown keys, skipped defaults, non-JSON values) — same patch as the Blind payload row.
  - `[low]` `[patch]` Edge: raising a dedupeKey that is open under another kind returns the other item — now throws a `TypeError` and rolls back; tested.
  - `[low]` `[reject]` Edge: resolve can close another module's item — callers resolve their own prefixed keys; modules are in-repo code.
  - `[low]` `[patch]` Edge: concurrency 0 silently disables a lane — same patch as the Blind lane row.
  - `[medium]` `[patch]` Edge: self re-claim leaves `run.job.attempts` stale, so `failJob` judges retries on the old count — same patch as the Blind stale-attempts row.
  - `[low]` `[reject]` Edge: `pollMs`/`stopTimeoutMs` of 0 or NaN — internal options set only by the server with constants.
  - `[low]` `[patch]` Edge: dead-job list React keys collide within a millisecond — same patch as the Blind keys row.
  - `[false]` `[reject]` Edge: at-least-once delivery can double-apply effects — AD-8 specifies at-least-once and requires idempotent handlers.
  - `[medium]` `[patch]` VG: job config never reaches the runner in any test — a `server.test.ts` case boots with `local: 0` and `leaseMs: 7000` and observes both.
  - `[medium]` `[patch]` VG: no test that `close()` stops the runner and waits for handlers — a test shows `close()` waits for a held handler, and the job is `done` after reopening.
  - `[low]` `[defer]` VG: a non-empty dead-jobs list is never rendered by a test — filed as defer by the lens; no web component harness yet; recorded in `deferred`.
  - `[low]` `[reject]` Intent C2: the crash is simulated in-process, not by killing a process — runners share only the database, so an in-process hung runner is equivalent; the restart test uses real `startServer`.
  - `[false]` `[reject]` Intent D2: concurrent enqueues are untested — SQLite has one writer, and `BEGIN IMMEDIATE` serialises enqueues; the index is a backstop.
  - `[low]` `[reject]` Intent E2: an unknown-kind dead job raises no review item — an unknown kind has no `needsPersonWhenDead` to consult; it is logged and shown on the status page.
  - `[false]` `[reject]` Intent F2/F3: schedules are not stored, and none exist in production — per the plan, schedules are code, and the production list is empty until 1.10.
  - `[medium]` `[defer]` Intent G: `job.dead` items have no resolve path, and the review inbox has no user-facing surface — same as the Blind inbox row.
  - `[false]` `[reject]` Intent H2: pending and running jobs are not shown — AD-9 specifies dead jobs with kind and time only.
  - `[false]` `[reject]` Intent A2: no production use case enqueues yet — no job kinds exist until later stories; the outbox is tested with real `write` transactions.
  - `[low]` `[patch]` Intent B: config wiring unasserted — same patch as the VG config row.

## Design Notes

**`/healthz` lease check deferred.** The spine's Health convention says `/healthz` includes "the job-runner lease held". This ticket doesn't list it, and adding it changes the health contract every test and the e2e check assert, and demo mode's behaviour. Record it in Implementation Notes as the one piece of the spine's health definition still missing; story 1.9 (`pangolin status`) or 1.11 (upgrade health) should add it.

**Claim SQL shape:**
```sql
UPDATE job SET status='running', lease_owner=:owner, lease_expires_at=:until,
  attempts=attempts+1, updated_at=:now
WHERE id = (SELECT id FROM job WHERE lane=:lane AND (
  (status='pending' AND run_at<=:now) OR (status='running' AND lease_expires_at<=:now))
  ORDER BY run_at, id LIMIT 1)
RETURNING *;
```

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all green
- `pnpm --filter @pangolin/db db:generate` -- expected: no new migration after `0002`
- `pnpm build`, then run `node apps/server/dist/main.js` with a temp `PANGOLIN_DATA_DIR`, and `curl localhost:3000/api/system/jobs` -- expected: `{"dead":[]}`

## Auto Run Result

Status: built

**Summary:** Ticket 1.4, the job runner and review inbox:
- **Job outbox:** `job` table with enqueue inside the caller's `write` transaction. The payload is parsed and stored after a JSON round trip, and `dedupe_key` collapses repeat enqueues while a job is live.
- **Kind registry:** each kind has a lane, a schema, a retry policy, and flags for external effects and for needing a person.
- **Claims:** leased and atomic, one `UPDATE … RETURNING` per claim, with only the owner able to renew, complete or fail. Backoff retries end in `dead`, which raises one `job.dead` review item when the kind needs a person.
- **Schedules:** defined in code, ensured at startup, and they must move forward in time.
- **Runner:** `llm`, `net` and `local` lanes with configurable concurrency, lease heartbeat including during the stop drain, and a warning for any disabled lane. It is started and stopped by `startServer`, and never runs in demo mode.
- **Review inbox:** `review_item` with a kind registry, idempotent raise and resolve (audited, and rejecting a key held by another kind), and scoped reads.
- **Status:** `GET /api/system/jobs` returns dead jobs with kind and time only, and the PWA shows them.

**Files changed:**
- `packages/db`:
  - `schema/{job,review-item}.ts`.
  - `migrations/0002_jobs_review_items.sql` and its snapshot and journal.
  - `job-repo.ts` and `review-item-repo.ts`, with tests.
- `packages/app`:
  - `jobs/{registry,enqueue,lifecycle}.ts`.
  - `system/{review-items,job-status}.ts`.
  - The port types and the in-memory testing unit of work.
- `apps/server`:
  - `jobs/{runner,index}.ts`.
  - `server.ts`, `config.ts` and `http/app.ts`.
- `apps/web/src/{api.ts,App.tsx}`: the dead-jobs list.
- Schema version 2 → 3 in the tests, `e2e/health.spec.ts` (plus a jobs e2e) and `README.md`.

**Review:** 37 findings.
- 18 rows patched, covering 12 root causes.
- 6 rows deferred, covering 4 items: handler timeout and abort, inbox surface with `job.dead` resolution, job retention, and a non-empty status-page test.
- 13 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict: 6 medium (payload parsing, stale attempts, forward schedules, lease renewal during drain, config wiring test, `close()` drain test), 6 low (review-kind collision, lane warning and README, list keys, scope CHECK, dead-schedule test, and the matching tests).

**Follow-up review:** recommended (`true`, since several medium entries were patched). The named unverified risk is the runner's real-timer behaviour. The `start()` interval, the stop-drain renewal interval and timeouts are tested only with `tick()` and fake timers, never with real time or under load.

**Verification:**
- `pnpm install --frozen-lockfile`, lint, typecheck and `pnpm test` all pass: 40 files, 451 passed, 1 skipped as root.
- `check:strict` passes, and `db:generate` reports no schema changes.
- `pnpm build` passes.
- The live server returns `{"dead":[]}` from `/api/system/jobs`.
- Playwright gives 2 passed at schema version 3.

**Residual risks:**
- The four deferred items above.
- `/healthz` still lacks the job-runner lease check, which story 1.9 or 1.11 should add.
