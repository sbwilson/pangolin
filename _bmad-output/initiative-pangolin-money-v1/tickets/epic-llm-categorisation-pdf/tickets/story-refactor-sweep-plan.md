---
title: 'Refactor sweep'
type: 'refactor'
ticket: '10'
created: '2026-10-29'
status: 'built'
baseline_revision: '99fb8b556c4956967fc8486b198aaa02f3951f68'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 5 shipped nine features fast; `packages/llm`, `packages/importers`, `packages/app` and `apps/web` accumulated dead exports, copy-pasted helpers with drift risk, stale dependency manifests, and hardcoded test invariants. `pnpm lint` currently fails at HEAD (5 biome errors).

**Approach:** A hygiene-only sweep: delete dead code, consolidate duplicated helpers into single sources, bring biome to zero warnings repo-wide, converge the web API client's types, fix the test-only issues, then restore green gates (`node scripts/check-boundaries.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm check:strict`, `pnpm test`). No feature behavior changes.

## Decisions (resolved at planning checkpoint)

- D1: Fix **all** biome diagnostics repo-wide — the 5 errors plus every warning, including the ~98 `noNonNullAssertion` and ~25 `noExplicitAny` in test files. No lint-disable suppressions; fix assertions for real.
- D2: Hoist `isVisionCapableModel` to `packages/shared` as the single source (app + importers both consume it), accepting the fifth package in scope.
- D3: Converge `apps/web/src/api.ts` hand-rolled response interfaces to `InferResponseType` derived types now, in this sweep.

## Boundaries & Constraints

**Always:**
- Behavior-preserving changes only; existing tests pass unmodified unless the test itself is the target (network-dial stub, schema-version derivation).
- Respect `scripts/check-boundaries.ts` edges; new cross-package imports only along allowed edges (app→shared and importers→shared are allowed).
- `getLlmRequestPreview` output stays byte-identical per purpose (T6/T7 triage settled structure-only consolidation; the `cloudPdf`/`cloudRows: true` sample bypass semantics are preserved).
- Run every gate command below before finishing.

**Never:**
- Do not trim `packages/app/src/index.ts` bulk exports, the `packages/llm/src/eval/` subtree (spec LLM-2 deliverable), the `Llm*Error` class exports, or `@pangolin/importers` mock-generator exports (`generateCommBankCsv`, `generateTwelveMonthStatements` are used by `apps/server/src/cli.test.ts:28`).
- Do not rename `pages/*`, change `api.ts` runtime behavior (types only), or fix accepted household-scale findings (N+1 `listReviewCards`, non-atomic bulk accept, unbounded set-aside batch).
- No DB schema or migration changes. No new e2e tests. No new dependencies. Do not modify `biome.json` or `check-boundaries.ts` rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Adapter contract suite | mock-llm fixtures (ok, malformed, 429, timeout, refusal) | Both adapters behave exactly as before; suite green unchanged | Same error classes/fields thrown |
| Settings preview | any purpose (categorise / row_interpret / pdf_extract) | Request preview output byte-identical to baseline | Same PermissionDenied semantics |
| PDF import default vision check | model name string, no injected `isVisionCapableModel` | Uses the single shared pattern list; known-model verdicts unchanged | Empty/unknown model → false |
| Provider-connection test offline | no LAN responder | Passes deterministically via injected fetch stub | Stubbed, no real network |

</frozen-after-approval>

## Code Map

- `scripts/check-boundaries.ts` — whitelist model + manifest audit; reads `ALLOWED` (:27-59). Passes today; do not change rules.
- `packages/llm/src/openai.ts` / `anthropic.ts` — `buildEndpointUrl`, `parseRetryAfter`, `extractErrorMessage` byte-identical (:48-93 each); ~65 lines of identical fetch/abort/timeout + 429 mapping (:161-227 / :147-213); tautology `didTimeout || (controller.signal.aborted && didTimeout)` (openai:201, anthropic:187); `NodeJS.Timeout` handle type.
- `packages/llm/src/index.ts` — dead type re-export block :2-7 (no consumer imports these from `@pangolin/llm`); dead `evaluateProvider` alias (defined `eval/harness.ts:128`).
- `packages/llm/package.json` — declares `@pangolin/shared`, zero imports.
- `packages/importers/src/pdf/model-vision.ts` — `VISION_MODEL_PATTERNS` :8-19 (single-source candidate).
- `packages/importers/src/index.ts` — organizeImports error at :1. `packages/importers/package.json` — `@pangolin/app`/`@pangolin/shared` used only from test files; description stale (package now owns PDF extraction).
- `packages/app/src/classify/llm-provider-use-cases.ts` — `getLlmRequestPreview` :472-631: three purpose branches duplicate the return shape, hardcode `cloudPdf: true` (:500) / `cloudRows: true` (:541); unused import :1, unused variable :395, organizeImports error.
- `packages/app/src/classify/categorise-engine.ts:67-76`, `imports/pdf-import.ts:204-216`, `imports/set-aside.ts:480-491` — provider-flag resolution `ctx.providerX ?? providerRow?.X ?? default` copy-pasted 3×.
- `packages/app/src/imports/pdf-import.ts:101-103` — `defaultIsVisionCapable` inline regex, duplicate of `model-vision.ts`.
- `packages/app/src/classify/few-shot-search.ts:35` — dead aliases `fewShotSearch`/`searchFewShot` (+ `packages/app/src/index.ts:152,154`).
- `packages/app/src/imports/set-aside.ts:250,314,401` + `ledger/set-split-field.ts:207,220` — hardcoded dedupe-key strings; good pattern to follow: `pdfFailedDedupeKey` (`imports/pdf-review.ts:27`).
- src-file lint warnings to clear: `few-shot-search.ts:29` + `set-aside.ts:580` (useOptionalChain), `domain.ts:36`, `pdf-verify.ts:160,163`, `categorise-engine.ts:198` (non-null), `apps/web/src/components/LlmProviderSettings.tsx:1` (unused import), `apps/server/src/jobs/logo-fetch.ts:163` (non-null, fixable), `packages/db/src/repositories/suggestion.ts:4` (unused import).
- `apps/web/src/RecoveryViews.tsx` — `RegenerateRecoveryCodes` component: zero consumers (file's other four exports are used by `LoginView.tsx`, `SignInSecurity.tsx`, `RootLayout.tsx`, `routes/recover.tsx`).
- `apps/web/src/components/review/index.ts` and `components/import/index.ts` — dead barrels; every consumer imports concrete files.
- apps/web input class string `h-9 w-full min-w-0 rounded-md border…` copied 8×: `ui/combobox.tsx:12`, `ui/select.tsx:12`, `ui/date-input.tsx:10`, `review/PdfStatementCard.tsx:23`, `review/SetAsideCard.tsx:16`, `SearchBox.tsx:85`, `pages/AccountSheet.tsx:256`, `pages/TransactionSheet.tsx:179`.
- `packages/db/src/system-health-repo.test.ts:28,40` + `migrate.test.ts:75-77` — hardcoded schema-version head `25`; journal-derived pattern exists: `manifest.test.ts:102` uses `migrations.length` (25 entries).
- `apps/server/src/http/app.test.ts:3653` — test-connection step (:3728) dials real `http://192.168.1.50:11434/v1` via unstubbed global fetch; sibling stub pattern at :3344.
- `apps/web/src/api.ts` — hand-rolled response interfaces to convert to `InferResponseType<(typeof api.api...)>` (pattern already used from :229 onward): `Health` :7, `DeadJob` :21, `BackupStatus` :41, `Me` :112, `RecoveryCodes` :175, and the ~30 exported types used only inside this file (drop the dead `export`). Every `/api` route is on the typed hono `AppType`, so all are derivable; keep each interface's consumers compiling unchanged.
- Biome warning population (repo-wide, `npx biome check . --max-diagnostics=500 --diagnostic-level=warn` lists them): 98 `lint/style/noNonNullAssertion` and 25 `lint/suspicious/noExplicitAny`, mostly `*.test.ts(x)` across all packages; plus the src-file items above.
- `biome.json` — config; do not change. Format errors: `apps/web/src/pages/ReviewPage.test.tsx`, `packages/app/src/imports/set-aside.test.ts`; organizeImports errors also in `packages/importers/src/index.ts`.

## Tasks & Acceptance

**Execution:**
- [x] (5 files above) -- apply `biome check --write` to fix the format/organizeImports errors.
- [x] repo-wide (`*.test.ts(x)` mainly) -- fix every remaining biome warning (D1): replace `!` with type-narrowing guards or `expect(...).toBeDefined()`-then-narrow patterns that keep the assertion's strength; replace `any` with real types. Zero suppressions.
- [x] `apps/web/src/api.ts` -- convert hand-rolled interfaces to `InferResponseType` derivations from the typed hono client (D3); un-export file-local types; runtime behavior unchanged.
- [x] `packages/llm/src/http-helpers.ts` -- new: `buildEndpointUrl`, `parseRetryAfter`, `extractErrorMessage`, and a `postJson` fetch/abort/timeout helper; rewire both adapters; simplify tautology; `ReturnType<typeof setTimeout>`.
- [x] `packages/llm/src/index.ts` + `eval/harness.ts` -- delete dead re-export block and `evaluateProvider` alias.
- [x] `packages/llm/package.json` -- remove unused `@pangolin/shared` dependency.
- [x] `packages/shared/src/vision-models.ts` -- new: `VISION_MODEL_PATTERNS` + `isVisionCapableModel` moved from importers; re-export from importers' index (server wiring unchanged); `packages/app/src/imports/pdf-import.ts:101-103` default delegates to it.
- [x] `packages/importers/package.json` -- move `@pangolin/app` to devDependencies; refresh description. (`@pangolin/shared` stays a runtime dependency -- see Implementation Notes.)
- [x] `packages/app/src/classify/llm-provider-use-cases.ts` -- `getLlmRequestPreview` → per-purpose table `{sample, bypass flag, builder}` + single return path; output byte-identical; clear unused import/variable.
- [x] `packages/app` (classify/categorise-engine.ts, imports/pdf-import.ts, imports/set-aside.ts) -- extract one provider-flag resolution helper; use at all three sites.
- [x] `packages/app` (imports/set-aside.ts, ledger/set-split-field.ts) -- add `classifyUnclassifiedDedupeKey`/`setAsideDedupeKey` helpers beside `pdfFailedDedupeKey`; replace 5 hardcoded strings.
- [x] `packages/app/src/classify/few-shot-search.ts` + `src/index.ts` -- delete dead aliases; clear remaining src-file warnings listed in Code Map.
- [x] `apps/web` -- delete `RegenerateRecoveryCodes`; hoist input class string to a shared const in `components/ui/` and use at all 8 sites; clear `LlmProviderSettings.tsx` unused import. (Barrel deletion dropped -- see Implementation Notes: the barrels are not dead at baseline.)
- [x] `packages/db` -- clear `suggestion.ts` unused import; derive head schema version from `loadMigrations(...).length` in `system-health-repo.test.ts` and `migrate.test.ts` header asserts (keep per-migration stepwise pairs).
- [x] `apps/server/src/http/app.test.ts` -- inject fetch stub for the provider-connection test (pattern at :3344); no real network.

**Acceptance Criteria:**
- Given a clean checkout at this revision, when running `node scripts/check-boundaries.ts && pnpm lint && pnpm typecheck && pnpm check:strict && pnpm test`, then every command exits 0.
- Given the llm contract suite and all pre-existing tests (except the two test-target files), when run after the sweep, then they pass with no assertions changed.
- Given any LLM purpose, when calling `getLlmRequestPreview`, then output matches baseline byte-for-byte (existing tests prove it).
- Given the test suite runs with no LAN responder, then the provider-connection test still passes.
- Given a future migration is added, then the schema-version head assertions need no manual bump.
- Given `npx biome check . --max-diagnostics=500` after the sweep, then zero errors and zero warnings, with no new ignore/disable directives.
- Given any apps/web page after the `api.ts` conversion, then every request and rendered response is unchanged (type-level change only; existing web tests prove it).

## Implementation Notes

- Task 1 (format/organizeImports): applied `biome check --write` to the 4 files carrying those
  diagnostics (ReviewPage.test.tsx, set-aside.test.ts, llm-provider-use-cases.ts,
  importers/src/index.ts). Diff verified formatting-only.
- Task 2 (biome warnings): all 98 `noNonNullAssertion` + 25 `noExplicitAny` + useOptionalChain +
  unused vars cleared repo-wide, zero suppressions.
  - Repeated idiom: a local `defined<T>(value, what)` narrowing helper (throws → fails the test
    loudly) added per test file (app.test.ts, domain-link/payees/set-aside/logos/review-items/
    review-view tests). Left the 4 public API surfaces untouched to avoid new package exports.
  - Web test files can't import from `@pangolin/app` (boundary), so there the fix is the plan's
    golden idiom: existing/all-added length `expect` + `as HTMLElement` casts.
  - Surprise 1: `as any` in categorise-engine.test.ts hid stale FIXTURES from an old schema
    (`type: "cash"`, `savingsPool`, `accountNumberLast4`, `searchId`, `deletedAt` on
    account/transaction rows, missing `externalId`/`importId`/`isHidden`/`shareBp`/`sort`).
    Removing the casts forced them to current `AccountRow`/`AccountOwnerRow`/`CategoryGroupRow`/
    `TransactionRow` shapes; suite passes (isHidden:false ≡ prior undefined-falsy runtime
    behavior). suggestion-parity.test.ts had the same staleness.
  - Surprise 2: biome's "unsafe fix" for `!` is `?.` which can silently weaken `toBeNull()`-style
    asserts — deliberately not applied; used guards instead per the Design Notes idiom.
  - Provider-connection test (app.test.ts): now stubs globalThis.fetch (openai chat-completions
    ping shape, same pattern as sibling mockFetchData) and asserts the deterministic
    `{ ok: true, latencyMs: expect.any(Number) }` — no LAN dial. (This was also its own task below.)

- Task 3 (api.ts, D3): `DeadJob`, `BackupStatus`(+`BackupVerification` as `NonNullable<…["check"]>`),
  `RecoveryBundleStatus`, `Me`, `RecoveryCodes` (status 201) now derive from the hono client.
  - `Health` could NOT become a bare `InferResponseType`: it is a client-MAPPED view
    (`status`→`healthy`, `writable` dropped) that api.test.ts asserts on; kept the union,
    un-exported it with a comment (no external consumer names it).
  - `Me`: the route response carries branded `Id<"Person">` fields; web tests construct Me
    literals with plain strings, so the derivation relaxes `personId`/`partner.personId` to
    `string` via Omit & intersection (brand-free strings match today's consumers exactly).
  - Un-exported 22 file-local types; deleted 5 wholly dead aliases (`MerchantRow`,
    `NetWorthSubtotals`, `ReviewSuggestion`, `ReviewSetAsideRowProposal`,
    `ReviewPdfRowCorrection`). No runtime code touched (web suite 366 tests green).

## Plan Change Log

## Review Triage Log

| # | Finding (quick lens) | Verdict | Evidence |
|---|----------------------|---------|----------|
| 1 | `vision-models.ts` `trim()` flips padded-model-id verdicts vs deleted app default (" gpt-4o " old→false, new→true) | `false` | Baseline `defaultIsVisionCapable` regex was unanchored (`/gpt-4o\|…\|\bvl\b/i`, no `^`), so `" gpt-4o "` already returned true; `trim()` strips only edges, and unanchored/`\b` patterns treat string-start ≡ whitespace, so no input flips. Sole real widening is `qwen.*vl`, disclosed in Implementation Notes; `" "`→false holds. |
| 2 | `## Plan Change Log` empty despite five recorded deviations | `false` | The implement handoff directs deviations/surprises into `## Implementation Notes` (lens verified all five entries accurate there); Plan Change Log records plan-revision loopbacks, and no loopback occurred this review. |
| 3 | AC "pass with no assertions changed" conflicts with D1's repo-wide test edits (~30 files, stale fixtures rewritten) | rejected | The finding's own remedy is re-wording this build's plan, which triage rejects outright; the lens itself concedes the AC holds under its intended reading — every spot-checked edit preserves assertion semantics (`defined()` keeps failure loudness), and fixtures are not assertions. |
| 4 | Green-gates AC not independently verified by the lens | `false` | All five gates were run independently after implementation, outside the lens: `check-boundaries` ok; biome 0 errors/0 warnings (673 files); `pnpm typecheck` exit 0; `pnpm check:strict` all STRICT; `pnpm test` 186 files / 2712 passed / 1 expected fail / 1 skipped — identical counts to the pre-sweep baseline. |

## Design Notes

Test `!` fix idiom — keep assertion strength, don't silently skip:

```ts
// before
const row = screen.getAllByRole("row")[1]!;
// after — fail loudly if absent, then narrow
const rows = screen.getAllByRole("row");
expect(rows.length).toBeGreaterThan(1);
const row = rows[1] as HTMLElement; // or restructure with findByRole({ name })
```

`InferResponseType` derivation golden example (already the file's pattern at :229):
`export type Health = InferResponseType<(typeof api.api)["api"]["health"]["$get"], 200>;`

## Verification

**Commands:**
- `node scripts/check-boundaries.ts` -- expected: `Package boundaries: ok`
- `npx biome check . --max-diagnostics=500` -- expected: zero errors, zero warnings
- `pnpm lint` -- expected: exit 0 (biome + boundaries)
- `pnpm typecheck` -- expected: all workspace projects pass
- `pnpm check:strict` -- expected: `All tables are STRICT`
- `pnpm test` -- expected: full vitest suite green
- Task 3 (api.ts, D3): hand-rolled response interfaces converted to `InferResponseType`
  derivations off the typed hono client; 22 file-local types un-exported; 5 dead aliases deleted
  (`MerchantRow`, `NetWorthSubtotals`, `ReviewSuggestion`, `ReviewSetAsideRowProposal`,
  `ReviewPdfRowCorrection`). `Health` stays a non-exported client-mapped union (tests assert the
  mapped shape; not derivable); `Me` derived with `personId`/`partner.personId` relaxed to
  `string` (tests build literals; `Id` is branded); `RecoveryCodes` derived at status 201.
  Runtime behavior untouched.
- Task 4 (llm http-helpers): new `packages/llm/src/http-helpers.ts` with `buildEndpointUrl`,
  `parseRetryAfter`, `extractErrorMessage`, `postJson` (fetch + abort + timeout → LlmTimeoutError)
  and `throwHttpError` (429 → LlmRateLimitError, else LlmHttpError). Both adapters rewired; the
  byte-identical duplicate blocks deleted (~90 lines). Tautology `didTimeout ||
  (controller.signal.aborted && didTimeout)` simplified to `didTimeout` (equivalent). Timer typed
  `ReturnType<typeof setTimeout>` (biome's earlier `NodeJS.Timeout` inference dropped).
- llm dead exports: `@pangolin/app` type re-export block removed from `index.ts` (no external
  consumer; adapters keep importing the types directly); `evaluateProvider` alias deleted from
  `eval/harness.ts` + its index re-export. `@pangolin/shared` removed from llm package.json (no
  import anywhere in the package); lockfile regenerated (`pnpm install`).
- Vision helper hoist (D2): `VISION_MODEL_PATTERNS`/`isVisionCapableModel` moved verbatim to
  `packages/shared/src/vision-models.ts` + re-exported from shared's index. Importers' index now
  re-exports from `@pangolin/shared` (public surface unchanged); pdf-import's local
  `defaultIsVisionCapable` (a merged one-regex variant) deleted — the classifier default is now
  the shared function at the `??` chain. Intended behavior delta: model names matching
  `qwen.*vl` but not `\bvl\b` (e.g. `qwen-vlmax`) now classify as vision-capable in app too;
  no test asserted the old divergence.
- Importers manifest deviation: `@pangolin/app` moved to devDependencies (tests only), but
  `@pangolin/shared` must STAY a runtime dependency — after the vision hoist,
  `importers/src/index.ts` re-exports `isVisionCapableModel` from shared at module level, so it is
  now a genuine runtime import, not a test-only one. Description refreshed to
  "CSV/OFX/QIF/PDF statement fixtures, generators and text extraction".
- getLlmRequestPreview: the heterogeneous builders (different arg shapes per purpose) made a
  literal table need casts; implemented as per-purpose branches that compute exactly
  `{sampleItems, structuredPrompt, isLocal}` plus one shared `preview()` closure that is the only
  place the result shape is assembled (single return path for every purpose). Per-purpose
  semantics preserved: pdf_extract/row_interpret keep `cloudPdf`/`cloudRows: true` sample bypass
  and isLocal fallback `true`; categorise keeps DB-sampled public transactions and fallback
  `false`. Output byte-identical (llm-provider-use-cases.test + server preview tests green).
- Provider-flag helper: `providerSetting(override, rowValue, fallback)` in
  `packages/app/src/ports/llm-provider.ts` — encodes the ctx-override → row → default precedence
  in one place; used at all three sites (categorise-engine, pdf-import, set-aside). A bundled
  `{isLocal, cloud, model}` helper was rejected: the cloud key differs per site
  (`providerCloudPdf` vs `providerCloudRows`) and categorise has no cloud flag, so a bundle forced
  renames/adapters while the value-level helper captures the shared logic directly.
- Dedupe keys: `classifyUnclassifiedDedupeKey`/`setAsideDedupeKey` added beside
  `pdfFailedDedupeKey` in `imports/pdf-review.ts`. Replaced the 5 listed strings plus 3
  additional identical-template sites found while wiring (undo-batch.ts:72,
  import-statement.ts:287+445) — byte-identical output, and leaving them hardcoded next to a
  helper invites drift.
- Web barrels deviation: the Code Map calls `components/review/index.ts` and
  `components/import/index.ts` "dead barrels; every consumer imports concrete files" — this is
  false at baseline 99fb8b5: 10 files import through them (MobileNav, AppSidebar, RootLayout,
  NetWorth/CashFlow/Spending/ReviewPage, ReviewPage.test, NetWorthPage.test,
  ImportPopover.test), verified with `git grep` on the baseline. Deleting them would force edits
  to 6 source files and 2 frozen test files, violating the tests-unchanged constraint, so they
  were left in place. Recommend a follow-up ticket to redirect consumers and delete them.
- Input class const: new `apps/web/src/components/ui/input-class.ts` with `INPUT_CLASS` (base)
  + `INPUT_CLASS_RING` + `INPUT_CLASS_RING_DISABLED`; used at all 8 sites. The sites actually
  carry 3 distinct variants (5 with disabled, 2 ring-only, 1 base+tabular-nums), so the shared
  consts are composed to reproduce every original class string byte-for-byte (the
  TransactionSheet split-amount input is base + ` tabular-nums`, not a ring variant).
- db: `repositories/suggestion.ts` unused type imports removed (`SuggestionOutcome`, `Viewer`);
  head schema version derived from `loadMigrations(packageMigrationsDir).length` in
  system-health-repo.test.ts (both head asserts) and the migrate.test.ts header asserts
  (per-migration stepwise pairs kept as planned).
- Final verification: check-boundaries ok; `biome check . --max-diagnostics=500` → 0 errors,
  0 warnings (no new directives); `pnpm lint` exit 0; `pnpm typecheck` exit 0 (root + all
  workspace projects); `pnpm check:strict` → All tables are STRICT; `pnpm test` → 186 files,
  2712 passed, 1 expected fail, 1 skipped, 0 failures — including the web jsdom suites and
  the provider-connection test with no LAN responder.
