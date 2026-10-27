---
epic: epic-app-shell-settings-theming
date: 2026-10-20
verdict: accepted-with-open-items
criteria: declared
headless: false
---

# Retrospective: Epic 13 — App Shell, Settings and Theming

## Epic summary

- **Epic:** `epic-app-shell-settings-theming` (Initiative: `initiative-pangolin-money-v1`)
- **Outcome:** Delivered the unified responsive application shell (desktop sidebar and mobile bottom tab bar), the dedicated `/sign-in` route, the complete Settings page framework (`/settings#…`) retiring `HomePage.tsx`, the 6-palette appearance engine with persistent per-person preferences, the modal `ReauthDialog`, and the WCAG 2.2 AA automated axe audit harness in CI across all shipped routes. Released as `v0.2.3` and successfully deployed to `pang-dev`.
- **Tickets & Statuses:**
  - `13.1` App shell: responsive desktop sidebar, mobile tab bar, and `/sign-in` route — `built` (state: `review`)
  - `13.2` Theme engine and preferences persistence — `built` (state: `review`)
  - `13.3` Settings page framework: System status and Signed-in devices — `built` (state: `review`)
  - `13.4` Settings: Sign-in & security, Partner, and Household cards — `built` (state: `review`)
  - `13.5` Re-auth dialog and account lifecycle settings — `built` (state: `review`)
  - `13.6` WCAG 2.2 AA automated axe audit harness — `built` (state: `review`)
  - `13.7` Refactor sweep — `done` (state: `done`)
  - `13.8` End-to-end shell, settings, and theming journey — `built` (state: `review`)
  - `13.9` Release v0.2.3 and deploy — `done` (state: `done`)
- **Tickets at `built`:** 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.8 (7 tickets finished by the build loop; awaiting formal ticket closure via `tickets.py mark`).
- **Unfinished tickets (`pending_tickets`):** None (`[]`). All 9 tickets are finished.
- **Git Evidence Range:** `d1e1e7263afbab9153d150c44190cc2485bb35ec..34be09af54eae3f8f16a90e91c9acf778ab79e5c` (19 commits, 0 merges).
- **Evidence Inventory:**
  - Epic definition: `_bmad-output/initiative-pangolin-money-v1/tickets/epic-app-shell-settings-theming/epic-app-shell-settings-theming.md` (Contains declared Done when 1–5).
  - Initiative requirements: `_bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md` (Covers `CAP-21` and `CAP-16`).
  - Ticket breakdown: `_bmad-output/initiative-pangolin-money-v1/tickets/epic-app-shell-settings-theming/tickets/tickets.toml`.
  - Story plans: 9 plan files (`story-*-plan.md`), all with baselines, triage logs, verification records, and plan change logs.
  - Previous retrospective: `_bmad-output/initiative-pangolin-money-v1/tickets/epic-ledger-workspace/epic-ledger-workspace-retrospective.md`.
  - Deployment record: `docs/release-v0.2.3.md` (fully populated with pre-flight, real-data check, CI release run, signed image digest, pang-dev upgrade, `/healthz`, status schema 15, and format 2 post-upgrade backup).

---

## Findings

### Aggregate Views

1. **Architecture Delta & Boundaries:**
   - **Package Boundaries:** Verified via `node scripts/check-boundaries.ts` (0 violations).
   - **Schema & Migration:** Introduced `0014_person_preference.sql` advancing schema version 14 to 15. Person preferences are strictly partitioned per `person_id` with foreign key cascade.
   - **Layering & Ports:** Added `preferences` repository in `@pangolin/db` and port in `@pangolin/app`, consumed via `GET /api/identity/preferences` and `PUT /api/identity/preferences` in `@pangolin/server`.
   - **Web Component Decoupling:** Retired `HomePage.tsx` cleanly. System status and session management cards moved to self-contained components in `apps/web/src/components/`.

2. **Duplication Map:**
   - **`formatCents` Unification:** Resolved prior duplication between `TransactionsTable.tsx` and `TransactionSheet.tsx` by extracting canonical `formatCents` to `apps/web/src/lib/money.ts` in ticket 13.7.
   - **E2E Helper Overlap:** `e2e/shell.spec.ts` and `e2e/settings.spec.ts` both maintain session revocation cleanup routines. Minor duplication, non-functional risk.

3. **God-Class & Churn Ranking:**
   - `TransactionList.tsx` was successfully decomposed in 13.7 from >800 lines down to ~350 lines by extracting `useBulkSelection.ts`, `useTransactionExport.ts`, and `useTransactionFilters.ts`.
   - New components (`MobileNav.tsx`: 340 lines, `SettingsPage.tsx`: 349 lines, `SystemStatus.tsx`: 334 lines, `SignedInDevices.tsx`: 273 lines) remained within modular limits (<400 lines) with clean prop interfaces.
   - Background churn in `memory-uow.ts` (2,400+ lines) and `unit-of-work.ts` (1,230 lines) grew slightly (+27 lines and +39 lines) to support `personPreference` repository registration; remains tracked for future platform modularization.

4. **Pattern Divergence:**
   - **Missing Cleanup in Household Leave:** In `packages/app/src/accounts/leave-household.ts`, `deleteScopedRows` hard-deletes scoped payees, aliases, tags, and activities, but omits deleting `person_preference` records when a person leaves the household (deferred in `deferred-work.md:395`).
   - *Disposition:* Fix now (Action Item 1) / upstream lesson: when introducing a person-scoped table, add audit/deletion hooks to `leave-household.ts`.

5. **Spec-to-Implementation Reconciliation:**
   - All requirements SH-1 through SH-6 and Done-when 1 through 5 were demonstrably achieved.
   - In ticket 13.5, `ReauthDialog` replaced the inline `ReauthRequired` fallback on CSV export, fully unifying the re-authentication experience across settings and ledger exports as intended by UX design.

### Code & Verification Lenses

- **Blind Hunter / Edge Case Lenses:**
  - Flakiness in `e2e/shell.spec.ts` due to multiple existing remote sessions and bottom-of-page scroll-spy pinning was caught and stabilized in commit `0405f9b` prior to tagging.
  - Escape key handling during bulk selection: pre-existing global Escape handler was retained during hook extraction; modal dismissal vs row deselection can be further coordinated (tracked in `deferred-work.md:408`).
- **Verification Gap Lens:**
  - Extracted hooks (`useBulkSelection`, `useTransactionExport`, `useTransactionFilters`) are thoroughly tested via `TransactionList.test.tsx` integration tests, but lack isolated hook-level unit suites (tracked in `deferred-work.md:400`).

---

## Behavior verification

1. **Comprehensive Journey Test (`e2e/shell.spec.ts`):**
   - Exercised desktop sidebar navigation across `/transactions`, `/accounts`, and `/settings`.
   - Exercised phone viewport bottom tab bar with More popover navigation.
   - Tested theme switching (`clay-linen`, `fern-gully`, `galah-party`, `gelato-bar`, `black-opal`, `harbour-morning`) and light/dark/system mode persistence across separate browser sessions.
   - Navigated settings sections (`#status`, `#devices`, `#security`, `#partner`, `#household`), revoked a remote session, and confirmed immediate redirection of the revoked session to `/sign-in`.
   - Exercised `ReauthDialog` password/passkey challenge and guarded action execution.

2. **Automated Axe Accessibility Harness (`e2e/axe.spec.ts`):**
   - Audited `/transactions`, `/accounts`, `/accounts/:id`, `/settings`, and `/sign-in` across light and dark themes.
   - 0 WCAG 2.2 AA violations detected.

3. **Server Deployment & Production Verification (`pang-dev`):**
   - Upgraded stack from `v0.2.2` to `v0.2.3` via `sudo pangolin upgrade v0.2.3`.
   - Image digest verified against cosign signature: `sha256:7c2efe744ed826e772d12fab8e76f64d646b02fc3167f824eb8f201a46906d9b`.
   - Database migrated from schema 14 to 15.
   - Status verified: `Pangolin Money v0.2.3`, `Schema: 15 (this build expects 15)`, `Readiness: ok`.
   - `/healthz` returned `{"ok":true,"warnings":["recovery-bundle-unconfirmed"]}`.
   - Post-upgrade backup snapshot `e35ea26ba0895ab7ae6ff2fa488b94b7334fe80134dc628452c7dbbd5427790e` taken; format 2 manifest verified from restic repository (`format: 2`, `schemaVersion: 15`).

---

## Previous-retro follow-through

From `epic-ledger-workspace-retrospective.md`:

| Item | Action Text | Owner | Landed? | Evidence |
|---|---|---|---|---|
| **1** | Extract `formatCents` to shared web utility | dev loop | Landed | Commit `d5a8200`: moved to `apps/web/src/lib/money.ts` and imported across all web components. |
| **2** | Decompose `TransactionList.tsx` (<500 lines) | dev loop | Landed | Commit `d5a8200`: extracted `useBulkSelection.ts`, `useTransactionExport.ts`, `useTransactionFilters.ts`. File reduced to ~350 lines. |
| **3** | Formalize bulk undo provenance semantics in SPEC.md | Simon | Open | Awaiting human spec update for bulk undo provenance semantics. |
| **4** | Monitor FTS5 reindex latency on large renames | dev loop | Monitored | No write regressions observed during M1 tests. |
| **5** | God-class splits for `memory-uow.ts`, `unit-of-work.ts`, `http/app.ts` | dev loop | Deferred | Monitored; tracked for future platform hardening. |

---

## Action items

### Remediation (Executed in Post-Retro Pass)
1. **Clean up `person_preference` on household leave:** Added `deleteForPerson()` method to `PersonPreferenceRepo` across `@pangolin/app`, `@pangolin/db`, and `memory-uow.ts`. Updated `packages/app/src/accounts/leave-household.ts` `deleteScopedRows()` to delete the leaver's `person_preference` record. Verified by test in `packages/db/src/accounts.test.ts`.
2. **Dedicated hook unit test suites:** Added dedicated unit test suites `apps/web/src/hooks/useTransactionFilters.test.ts`, `apps/web/src/hooks/useTransactionExport.test.ts`, `apps/web/src/hooks/useBulkSelection.test.ts`, and `apps/web/src/components/SearchBox.test.tsx` (20 tests, all passing).
3. **Stabilize `alexSession` retry catch:** In `e2e/shell.spec.ts`, `e2e/settings.spec.ts`, `e2e/routing.spec.ts`, and `e2e/axe.spec.ts`, wrapped `signInWithPassword` in a try/catch block so transient setup errors do not bypass the retry loop.

### Spec Reconciliations
4. **Reconcile bulk undo provenance in `SPEC.md`:** Carried over from Epic 12; document that bulk actions record user updates with current timestamp rather than restoring original import provenance. Owner: Simon.

### Deferred (Tracked)
5. Refine Escape key coordination between bulk selection and open sheet dialogs (`deferred-work.md:408`).
6. Comprehensive unit coverage for `ReauthDialog` keyboard dismissal and backdrop clicks (`deferred-work.md:414`).
7. God-class decomposition for `memory-uow.ts` (2,400+ lines).

---

## Acceptance verdict

**Verdict: accepted-with-open-items**  
**Criteria:** declared (from `epic-app-shell-settings-theming.md` Done when)

### Evaluation against Done when:
1. **Desktop sidebar and phone tab bar reach every shipped route; `/` redirects to `/transactions`; `/sign-in` signs in:** **Met.** Verified by `e2e/shell.spec.ts`.
2. **`/settings` holds System status, Sign-in & security, Signed-in devices, Partner, empty Household, and Appearance; HomePage retired:** **Met.** Verified by `e2e/settings.spec.ts` and `e2e/shell.spec.ts`.
3. **6 theme sets in light, dark, system mode persisted in `person_preference`, follows person across sessions, no CSP violation:** **Met.** Verified by `packages/app/src/identity/preferences.test.ts` and `e2e/shell.spec.ts`.
4. **Axe e2e check runs on every route in CI and fails build on WCAG 2.2 AA violation; clean on all shipped routes:** **Met.** Verified by `e2e/axe.spec.ts` (0 violations) and green CI run `39304808039`.
5. **Deployed to home server with `pangolin upgrade`, CI green on release tag:** **Met.** Released as `v0.2.3` (run `39314279861`), verified on `pang-dev` with schema 15 of 15, `/healthz` ok, and verified format 2 post-upgrade backup snapshot.

All 9 tickets are completed with no unfinished items in `pending_tickets`. Non-blocking cleanup and hook test items are tracked above.

---

## Open questions

- None blocking. All epic 13 contracts and cross-epic boundaries are satisfied for Epic 3 (`epic-import-dedupe-transfers`).
