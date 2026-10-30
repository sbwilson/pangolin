---
title: 'Milestone M2 gate verification, end-to-end journey, and release v0.2.6 deploy'
type: 'feature'
ticket: '11'
created: '2026-10-29'
status: 'built'
baseline_revision: '754d7c541e40ee63368c7c7cafa613b89f07507e'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context: ['docs/release-v0.2.5.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** M2 gate ticket (LLM-11): no Playwright journey covers LLM categorisation or the /review bulk-accept happy path, and axe never audits `/settings#llm-providers`. Root cause found: `categoriseTransactions()` ships **unwired** — nothing invokes it, so the app can never produce suggestions. Release v0.2.6 then needs its runbook and green gates.

**Approach:** Wire a minimal `pangolin categorise` admin CLI trigger; add an e2e journey import → categorise via mock-llm → bulk-accept on /review → ledger updated; extend axe to `/settings#llm-providers` and the PDF-selected Import popover; write `docs/release-v0.2.6.md` (v0.2.5 pattern) and run all gates locally. The version is the tag: no bumps, no CHANGELOG. Tag, backup, and `pangolin upgrade` on pang-dev stay human-run (runbook: agent prepares and records).

## Decisions (resolved at planning checkpoint, 2026-10-29)

- D1: Trigger = **A** — `pangolin categorise` admin CLI (seed-pattern socket command, run on demand/cron after imports). No job kind, no HTTP route; nightly automation is a possible later ticket.
- D2: Release split confirmed — this build stops at the prepared runbook + green gates; the human pushes tag v0.2.6, takes the backup, and runs `sudo pangolin upgrade v0.2.6` on pang-dev per the runbook.
- D3: Keep the full plan despite ~2,100 tokens (user override; one cohesive gate goal, splitting would fragment it).

## Boundaries & Constraints

**Always:**
- Trigger follows the `seed` precedent: CLI subcommand over the admin socket (`viaSocket`); e2e shells out via `E2E_CATEGORISE_COMMAND` (exported in ci.yml like E2E_SEED_COMMAND).
- New spec runs in the `accounts` project (needs `llm` compose profile) and resolves every review item it creates before `axe`, like pdf-import.spec.
- Dynamic fixtures: e2e writes `tools/mock-llm/fixtures/openai/mock-live-<runid>.json` (host-side; bind-mounted, re-read per request) with category IDs fetched from `GET /api/categories`, deletes it in cleanup; add `mock-live-*` to `.gitignore`.
- Release doc mirrors docs/release-v0.2.5.md: notes, rules, agent pre-flight, human checklist (push → CI → backup gate → tag → watch run → digest → upgrade → healthz/status → backup → record), rollback, evidence record.

**Never:** No auto-applying suggestions; no HTTP route for the engine; no job scheduler change (D1); no version bumps or CHANGELOG; no edits to earlier release docs or `/api/review` contract semantics; do not touch AD-6 guardrails or Settings re-auth; never push tags or touch pang-dev (D2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Categorise journey | 3 imported unclassified rows; mock model `mock-live-<run>` replies 3 indexed suggestions @0.92 | Bulk card "3 we're very sure about" on /review; "Accept all" categorises 3, badge clears | — |
| Unknown category | fixture category_id absent from DB | Suggestion discarded, no card | engine `discardedCount` only |
| Trigger, no provider | purpose unassigned | "No LLM provider configured for categorisation" | non-zero exit |
| Trigger re-run | no unclassified candidates | zero candidates, no duplicate suggestions | clean no-op |
| Axe new targets | llm-providers (row + open add-form); PDF-selected popover; light+dark | zero wcag22aa violations | `expect(violations).toEqual([])` |

</frozen-after-approval>

## Code Map

- `packages/app/src/classify/categorise-engine.ts` — `categoriseTransactions(ctx,{transactionIds})` :54; batches of 20; matches output by `index`; discards unknown category :205; supersede-open on insert. Test-only caller today.
- `apps/server/src/cli.ts` — command whitelist :672-684, `seed`→`viaSocket(config,"seed",{})` :451-457, USAGE :73. `apps/server/src/admin/commands.ts` — seed socket handler; add `categorise` beside it.
- `packages/app/src/classify/defaults.ts` — category IDs are generated (`newId`), never slugs → fixtures must read real IDs at runtime.
- `e2e/pdf-import.spec.ts` — blueprint: provider via `POST /api/llm/providers` + `PUT /api/llm/purposes/:purpose` :48-97, in-page fetch state, `E2E_LLM_BASE_URL` default `http://127.0.0.1:4111`, axe on review card :196-198. `e2e/import.spec.ts` — CSV upload (`import-file`, "Which account is this for?", `import-status`). `e2e/review.spec.ts` — heading "N things need you", `review-badge`.
- `e2e/axe.spec.ts` — `auditPage()` :86, tags incl. `wcag22aa` :67, MODES light/dark :55, `alexSession()`; audits `/settings` but not #llm-providers states.
- `e2e/playwright.config.ts` — chain auth→chromium→reports→accounts→axe; new spec: add to `accounts` testMatch :69 and chromium `testIgnore` :35-45.
- `apps/web/src/components/review/SuggestionCards.tsx` — BulkAcceptCard `aria-label="Bulk accept suggestions"`, "Accept all" → `POST /api/review/bulk-accept-suggestions`; AiSuggestionCard Accept/Dismiss. `apps/web/src/components/LlmProviderSettings.tsx` — "Add provider" form (Name/Provider kind/Base URL/Model name/API key), purpose select `aria-label="Select provider for Transaction categorisation"`.
- `tools/mock-llm/src/server.ts` — replays `fixtures/<provider>/<model>.json` verbatim per request; compose mounts `./tools/mock-llm:/app:ro` (host writes still land). `packages/importers/fixtures/statement-ok.pdf`.
- `docs/release-v0.2.5.md` + `docs/install.md` §11 — checklist pattern; `release.yml` runs full CI (e2e+axe incl.) on tag `v0.2.6`, publishes signed image; `deploy/pangolin` upgrade = pull→cosign verify→DB copy→digest pin→health poll→auto-rollback.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/classify/` (new use case) + `apps/server/src/admin/commands.ts` + `apps/server/src/cli.ts` — implement D1: select up to N transactions with unclassified splits, run through `categoriseTransactions` with the DB-configured provider; expose `categorise` socket+CLI command printing recorded/discarded.
- [ ] `e2e/categorise.spec.ts` (new) — ensure mock provider via API; write `mock-live-<runid>.json` with 3 indexed suggestions @0.92 using live `GET /api/categories` IDs; import 3-row CSV into a new account; run `E2E_CATEGORISE_COMMAND`; expect bulk card → "Accept all" → categories on the 3 ledger rows → badge all clear; cleanup fixture.
- [ ] `e2e/playwright.config.ts` + `.gitignore` + `.github/workflows/ci.yml` — accounts testMatch + chromium testIgnore; ignore `mock-live-*`; export `E2E_CATEGORISE_COMMAND` (~ci.yml:188).
- [ ] `e2e/axe.spec.ts` — in the MODES loop: `/settings#llm-providers` with provider ensured via API (idempotent) and add-form open; Import popover with `statement-ok.pdf` selected.
- [ ] `docs/release-v0.2.6.md` (new) — notes (epic 5 features + refactor sweep), rules, pre-flight (all gates; `pnpm check:upgrade` on fresh pang-dev DB copy; `git merge-base --is-ancestor v0.2.5 HEAD`), human steps 1–13, rollback, empty evidence record.

**Acceptance Criteria:**
- Given fresh compose stack (`COMPOSE_PROFILES=backup,llm`, seeded), when the categorise journey runs, then the bulk card lists 3 suggestions and after "Accept all" the 3 transactions carry the suggested category and the badge reads all clear.
- Given the axe project, then `/settings#llm-providers` (row + add-form) and the PDF-selected popover pass zero violations, light and dark.
- Given `node scripts/check-boundaries.ts && pnpm lint && pnpm typecheck && pnpm check:strict && pnpm test`, then all exit 0.
- Given `pnpm e2e` on the local stack, then the whole suite incl. the new spec and axe passes.
- Given `docs/release-v0.2.6.md`, then agent pre-flight is recorded and the only unchecked steps are the human-gated ones.

## Verification

**Commands:**
- `node scripts/check-boundaries.ts && pnpm lint && pnpm typecheck && pnpm check:strict && pnpm test` -- expected: exit 0.
- `docker compose build && COMPOSE_PROFILES=backup,llm PANGOLIN_ENABLE_SEED=true docker compose up -d`; export `E2E_SETUP_LINK_COMMAND`/`E2E_SEED_COMMAND`/`E2E_CATEGORISE_COMMAND`/`E2E_LLM_BASE_URL=http://127.0.0.1:4111`; `pnpm e2e` -- expected: full suite green incl. journey + axe.
- `pnpm --filter @pangolin/e2e exec playwright test axe.spec.ts --no-deps` -- expected: new audits pass.

**Manual checks:**
- `docs/release-v0.2.6.md` reads as an executable runbook: exact command per human step; agent steps recorded; evidence section empty.

## Implementation Notes

Built and verified 2026-10-29 against base `754d7c5`. Shipped as planned: `categorisePendingTransactions`
(+ `CATEGORISE_PENDING_LIMIT` 200), the async admin `categorise` command, the CLI line, the shared
`createLlmAdapter` factory, `e2e/categorise.spec.ts`, the `axe.spec.ts` extensions, the `ci.yml`
`E2E_CATEGORISE_COMMAND`, and `docs/release-v0.2.6.md`.

Surprises, all pre-existing, all fixed here (CI `Container and end-to-end` was red since epic 5):

- **The pdf.js worker was never shipped.** The server bundle loads `./pdf.worker.mjs` beside
  `main.js` at runtime; `apps/server/scripts/build.ts` never copied it, so every container PDF
  upload died with "Cannot find module '/app/dist/pdf.worker.mjs'". The build now copies the
  worker from the exact `pdfjs-dist` copy `@pangolin/importers` resolves (via
  `import.meta.resolve` + `createRequire`).
- **`pdf-import.spec` ran twice.** `a5b504d` added it to the `accounts` project but never to the
  `chromium` project's `testIgnore`, so it also ran mid-`chromium` — and its failure there
  cascade-skipped `reports`, `accounts` and `axe` (which is why CI's log shows it under
  `[chromium]`). Added to `testIgnore`.
- **`createAccount` read the wrong response shape.** `POST /api/accounts` answers
  `{ account: { id } }`; the helper read `.id`, so every later request carried
  `accountId: undefined` and 400'd `Validation`. Diagnosed with a throwaway probe spec.
- **`settings.spec` assumed a clean job store.** The seed enqueues `logo-fetch` jobs whose
  favicons cannot resolve in CI (or this host), and the kind's frozen one-ever retry lets them
  die. The card now mirrors `/api/system/jobs` whatever it holds.
- **`health.spec:22` is not a failure.** It is the CSP guard's own `test.fail()` self-test; the
  list reporter always prints `✘` for it and it is never counted (CI "2 failed", local "1
  failed" both excluded it).
- **The seeded household categorises your rows for you.** `WOOLWORTHS METRO` fuzzy-matched the
  seeded `Woolworths` payee and took its default category at import, so a 3-row import raised
  only 2 `classify.unclassified` items. The journey now imports three invented merchants.
- **`pangolin categorise` is whole-ledger, and the seed deliberately leaves ~30 rows
  uncategorised** (verified directly in SQLite). A fixture answering only indices 0–2 would have
  suggested categories for newest-first *seeded* rows and missed the spec's import entirely, and
  "Categorised 3 …" could never print. The fixture now answers every batch position (0–19 at
  0.92), so recorded = candidates whatever the ledger holds; the CLI assertion parses its
  numbers, and the bulk-accept + per-row category + badge-clear assertions carry the journey.
- Locator details: `getByText("Row 2")` also matched the "Save row 2" button (anchored to the
  row header); the popover's `Close import` button is the backdrop *outside* the dialog (Esc
  instead); input values are not element text, so listitem filters use the row header.

Host-flow e2e (no container runtime here, README flow): runs 2–6 each surfaced one more of the
above; run 7 on a fresh stack: **exit 0, 117 passed, 2 skipped, 0 failed** — first-ever
executions of `categorise.spec.ts` and the extended `axe.spec.ts` all pass. Unit gates green:
boundaries, biome (677 files), typecheck (all workspaces), STRICT, `pnpm test` 2726 passed /
1 expected fail / 1 skipped. `check:upgrade` smoke-passed `25 -> 25` on a copy of the local e2e
database; the real-data 21 → 25 check remains the human step 2.


## Review Triage Log

Quick lens (session `ses_e7951ddf7ffepSh18UodhGgKWe`), triaged 2026-10-29. Verdicts verified
against the code before routing.

### Root cause A — the trigger was never exercised under production constraints (patch)

- **F1 · high · patch** — `categorise-pending.ts:62–71` selects candidates with `systemViewer`
  without checking account privacy, so one uncategorised private-account row + a non-local
  provider makes the engine throw `PermissionDenied` (engine.ts:116–122) before any batch and the
  whole run exits 1. Confirmed: the seed's household profile categories every private-account
  row (ledger-transactions.ts:342–435) and the perf profile can leave private rows
  uncategorised (:499–504), so the lens's "shared accounts only" caveat is wrong, but the abort
  itself is real for a deployed household. Fix: resolve the provider first and exclude
  private-account candidates when it is not local (AD-6 kept; the engine guard stays for callers
  that pass ids explicitly). Update the unit test that codifies the abort.
- **F3 · high · patch** — `IDLE_TIMEOUT_MS = 10_000` (socket.ts:23) destroys the connection while
  an async command runs, and the CLI client caps at 30 s (`CLIENT_TIMEOUT_MS`, client.ts:19), so
  any `categorise` over ~2 batches severs the CLI while the server keeps recording (exit 1,
  suggestions still land). The docstrings in commands.ts and socket.ts claim it "answers within
  the idle window" — unbounded. Fix: per-connection command ceiling after the request is consumed
  (server), longer `timeoutMs` on `callAdmin` from `categoriseCli` (client already accepts it),
  truthful docstrings.
- **F9b · low · patch (with F3)** — the `handle` docstring omits the ceiling F3 introduces.

### Root cause B — prose asserts more than the code does (patch)

- **F4 · low · patch** — `cli.ts:500` prints "Categorised N unclassified transactions" though
  nothing is applied; reword to what actually happened ("sent … suggestions recorded") and update
  `cli.test.ts` and the `categorise.spec.ts` regex.
- **F9a · low · patch** — `categorise.spec.ts:29–30` says the provider-create route "accepts only
  a safe character set" for model; the route schema only requires a non-empty string
  (llm-provider-use-cases.ts:129). Fix the comment.
- **F8 · low · patch** — the plan's task line asked for release notes covering "epic 5 features +
  refactor sweep"; `docs/release-v0.2.6.md` omits the sweep. Add the line.
- **F6 · low · patch** — release doc :85 references this plan's "Plan Change Log", which did not
  exist; created below.
- **F2 · low · patch (docs)** — the recorded green run used the host flow (`127.0.0.1` →
  `isLocal=true`); CI points at `http://mock-llm:4111`, a DNS name the LAN check classifies
  cloud, so CI executes the cloud classification path for the first time. True but by design
  (pdf-import does the same); after F1's skip the cloud path is deterministic. Note it in the
  runbook pre-flight record.

### Root cause C — frozen I/O matrix deviation (intent_gap → human)

- **F5 · medium · intent_gap** — the matrix row expects "3 suggestions recorded" and exact
  categories on the journey's 3 rows. Whole-ledger selection (the plan's own task line) plus the
  seed's deliberate uncategorised rows make "recorded = 3" impossible; the spec asserts
  `recorded == candidates ≥ 3` and non-null categories, and the badge check is conditional on
  `openBefore === 0`. Patch takes the achievable strengthening: assert the journey's splits equal
  the fixture's category id exactly. The remaining numeric deviation is recorded in the Plan
  Change Log below — **accepted by the human on 2026-10-30**.

### Root cause D — test-state hygiene (defer)

- **F7 · low · defer** — the spec deletes its fixture but leaves the provider row and the
  `categorise` purpose assignment. Deliberate: the axe project shares the stack's provider state
  and clearing it mid-suite invites cross-project flakes; the DB is disposable in e2e. Logged in
  `deferred-work.md`.

Patches P1–P6 (F1–F4, F8, F9, F5-strengthening) applied and re-verified 2026-10-29:
boundaries/lint/typecheck/`check:strict` exit 0; `pnpm test` 2730 passed / 1 expected fail /
1 skipped; full fresh-stack `pnpm e2e` run8 green — 117 passed, 2 skipped, 0 failed
(`categorise.spec.ts:189` included). Only F5's numeric deviation (human) and F7 (deferred)
remain open from the lens.

### Applied (2026-10-29, agent)

All six patches applied and verified. P1: `resolveConfiguredProvider` replaces
`withConfiguredProvider` — the purpose row's locality is read before the candidate query, a
non-local configured provider excludes `isPrivate` accounts' rows inside the same read, the
engine's AD-6 guard is untouched; the abort test became cloud-skip / cloud-no-op /
local-included tests, and `pangolin categorise --help` gained the private-skip line. P2:
`COMMAND_TIMEOUT_MS` (10 min) takes over from the idle timer the moment a request line is
consumed; `categoriseCli` waits a minute past it (`viaSocket` threads `timeoutMs`); new
socket.test.ts timing test (handle resolves 1.2 s after a 300 ms idle window, answer arrives).
P3: the CLI line is exactly `Sent N unclassified transactions to the provider: R suggestions
recorded for the review inbox, D discarded` — asserted against a stub provider in cli.test.ts
(the timeoutMs pass-through has no client mock to observe here; covered end-to-end by the e2e
journey). P4/P5/P6 as routed. Verification: boundaries/lint/typecheck/STRICT green; `pnpm test`
2730 passed / 1 expected fail / 1 skipped; fresh-stack full `pnpm e2e` exit 0 — 117 passed,
2 skipped, 0 failed (`categorise.spec.ts:189` with the new regex, category equality, and the
ceiling code path live).

## Plan Change Log

- 2026-10-30 (accepted by the human at presentation): I/O matrix "3 suggestions recorded" cannot
  hold on the seeded e2e ledger — `categorise` is whole-ledger by design (D1/task line) and the
  seed leaves ~30 uncategorised shared rows on purpose. Accepted form: fixture answers every
  batch position, `recorded == candidates ≥ 3`, exact-category equality asserted on the journey's
  3 rows, badge check runs when the inbox started empty. Rationale also in Implementation Notes.
