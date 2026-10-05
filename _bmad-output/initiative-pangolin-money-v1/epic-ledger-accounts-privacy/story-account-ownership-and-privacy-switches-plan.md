---
title: 'Account ownership and privacy switches'
type: 'bugfix'
ticket: 15
created: '2026-10-05'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 1
baseline_revision: '3ed41f1c815f1a01539d5f52eb903fb7dfbb5c53'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A partner can strip the other from a public account's owners, make it private, and then read names the other hid there, because hiding only applies on public accounts (retro P1, P6); making an account private ignores partner-beneficiary splits (P6, AD-7); making it public carries owner-scoped payees, tags and activities and the private-era audit history onto a shared account (P5, AD-18, decision 80).

**Approach:** A hiding outlives any privacy or owner change (drop the public-only condition everywhere it applies); only a person can remove themselves from an account's owners; setPrivacy(private) refuses partner-beneficiary splits; setPrivacy(public) refuses while owner-scoped references are in use, naming them and the owners, and otherwise stamps the sole owner onto the account's unscoped audit rows recorded while it was private, so private-era history stays owner-only and earlier joint-era history stays visible to both.

## Boundaries & Constraints

**Always:** Only the hider sees a hidden name until it expires, in transactions and in listAudit (AD-4 as amended). Repo methods take what they need explicitly, have a memory mirror and a parity step. SQL that reads account/transaction/audit_log stays in privacy.ts, ledger-repos.ts or db/unit-of-work.ts. The set_privacy audit row itself stays unstamped, so the partner sees the flip. The system viewer is exempt from the only-remove-yourself rule, as it is from validateOwners. Refusals list names only to people who can already see the account.

**Decisions (2026-10-06, Simon, review loop 1):** The public switch stamps only audit rows recorded while the account was private (decision 80): rows after the account's most recent switch to private, or all rows when it was created private. Rows from a joint period stay unscoped.

**Decisions (2026-10-05, Simon):** Keep the full plan (~1,700 tokens). No exception to only-remove-yourself for a person who is no longer active; deactivation does not exist yet, and the epic that adds it must decide (recorded in deferred work).

**Never:** Change the rule that refuses hiding on a private account (hide-name.ts, seed.ts). Add promotion of scoped rows (epic 3). Touch transfer groups, hide-by-non-owner (entry 16), the manifest (17) or the read rule (18). Rewrite audit content: the stamp sets person_id only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Takeover path | B hid a name on joint; B removes themself; A makes it private | A still sees "Hidden until …" in transactions and listAudit until expiry; on that date A sees the name | none |
| Remove another owner | A sends owners without B | refused, nothing changed | Validation |
| Remove yourself | B sends owners without B (shares to 100%) | accepted, from the next open period (AD-26) | none |
| Private with partner beneficiary | sole owner A; a split's beneficiary is B | refused | Conflict |
| Public with scoped refs | A's private account uses A-scoped payee, tag or activity | refused; message and details name each item and the owners | Conflict |
| Public after removing refs | same, references removed | accepted; private-era unscoped audit rows now person_id = A; B's listAudit shows the joint-era rows and the flips, not the private-era rows | none |

</frozen-after-approval>

## Code Map

- `packages/db/src/privacy.ts` -- delete `is_private = 0` lines in `visibleTxn` hidden (`:97`) and `auditHiddenUntil` (`:171`, `:178`); fix doc comments `:79-82`, `:153-156`. Keep `visibleAccounts :25`, `transferLabel :120`.
- `packages/app/src/testing/memory-uow.ts` -- `nameHiddenFor :727-738` (no account check), `auditHiddenUntil :1035-1059` (drop account lookup); mirrors for the new methods: `hasSharedSplit :714-722`, `auditRepo :1083-1130` (replace readonly rows).
- `packages/db/src/privacy.test.ts:153` -- rename "does not hide anything in a private account" (assertions stay).
- `packages/app/src/ports/unit-of-work.ts` -- `AuditRepo :977-984` add `scopeToPerson(accountId, personId)` that stamps only rows after the account's most recent `set_privacy` audit row whose after JSON has `isPrivate: true` (by `at`, then `id`), or all rows when there is none (created private) (write-only; not in `ReadRepos` Pick `:1029`); AccountRepo: generalise `hasSharedSplit :299-303` to splits whose beneficiary is not the given owner, add `scopedReferences(accountId)` → `{payees, tags, activities: {id, name}[]}` over live rows.
- `packages/db/src/ledger-repos.ts` -- `hasSharedSplit :196-213` (`ne(split.beneficiary, ownerId)`, `ne` imported `:16`); new `scopedReferences` joining `transaction.payee_id`, `split.activity_id`, `split_tag → split → transaction` to rows with `scope_person_id IS NOT NULL`.
- `packages/db/src/unit-of-work.ts:107-143` -- audit repo: `UPDATE audit_log SET person_id = ? WHERE account_id = ? AND person_id IS NULL` with `guard(scope)`; doc comment notes this is the only audit_log update and it changes scope, never content.
- `packages/app/src/accounts/set-privacy.ts` -- `:24` sole owner, `:36-37` beneficiary refusal, public branch: scoped-ref refusal (AppError Conflict with details `{payees, tags, activities, owners}`; wording like split-tags.ts:47-49), then stamp, then the set_privacy audit (`:46`).
- `packages/app/src/accounts/update-account.ts` -- after `:56-59`: person viewer removing any id ≠ itself → Validation; docstring keeps AD-26.
- Tests that encode A removing B and must change to self-removal or system: `packages/db/src/accounts.test.ts:181-184,:248-252`, `packages/app/src/testing/accounts-parity.test.ts:115,:147`, `apps/server/src/http/app.test.ts:822-838`.
- Parity steps: `packages/app/src/testing/repo-parity.test.ts` near `:906-927`; `accounts-parity.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `privacy.ts`, `memory-uow.ts`, `privacy.test.ts` -- hiding outlives privacy change -- P1, P6
- [x] ports, `ledger-repos.ts`, `unit-of-work.ts`, `memory-uow.ts`, `repo-parity.test.ts`, `ledger-repos.test.ts` -- beneficiary check, scopedReferences, audit stamp, each with parity
- [x] `set-privacy.ts`, `update-account.ts` -- the three refusals and the stamp
- [x] Rewrite the four A-removes-B tests; add matrix tests on SQLite (`accounts.test.ts`, `privacy.test.ts`) and memory (`accounts-parity.test.ts` or app tests); server route test for the Validation and Conflict bodies

- [x] Review loop 1 additions: name the beneficiary check for what it is (e.g. `hasSplitForOthers`) everywhere; a parity step soft-deleting a scoped payee, tag and activity still used by a live transaction (still listed, public switch still Conflict); app.test.ts does the self-removal through PATCH with one viewer cast style; tests for a person removing themself from a private account and removing themself while adding an owner; a joint → private → public test on SQLite and memory showing B keeps the joint-era rows and the flips but not the private-era rows

**Acceptance Criteria:**
- Given the takeover path, when A reads transactions or listAudit before expiry, then B's hidden names show only as the placeholder.
- Given setPrivacy(public) succeeds, when B lists audit, then no row recorded before the flip appears; A still sees them all.
- Given the server privacy suite, when it runs, then it passes, with any harness snapshot change explained in Implementation Notes.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean (8 pre-existing warnings)
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm e2e` -- expected: green against a fresh local build (CI order)

## Implementation Notes

- `hasSharedSplit` is renamed `hasSplitForOthers(accountId, ownerId)` (review loop 1) across port, repos, mirror and tests; it is true for any live split whose beneficiary is not `ownerId` (`shared` or the partner).
- `scopedReferences` counts live transactions only; a soft-deleted scoped payee, tag or activity still counts while a live transaction uses it (the owner still sees it on the row, and it must not reach the partner). Lists are distinct, sorted by name then ID, `{id, name}` only (`ScopedReference`, `ScopedReferences` exported from `@pangolin/app`).
- setPrivacy(public) applies the scoped-ref refusal and the stamp only when the account is private now; an already-public account is unchanged and nothing is stamped (stamping it would hide shared history from the partner). Details: `{payees, tags, activities, owners}`, owners as `{personId, displayName}` of the account's owners (the sole owner); the message lists each item as `payee "…"`, `tag "…"`, `activity "…"`.
- Stamp: `AuditRepo.scopeToPerson` (write-only, not in `ReadRepos`), runs before the `set_privacy` row is appended, so that row stays unscoped.
- Only-remove-yourself: `requireOnlySelfRemoved` in update-account.ts after `requireKnownPeople`; message "You can only remove yourself from an account's owners". System viewer exempt.
- repo-parity: new `switch.*` steps; its scoped-origin count rose from 5 to 7 (two new scoped payees in those steps).
- Server privacy suite: passes with no harness snapshot change.
- e2e run locally against a fresh build: the admin socket needs `PANGOLIN_ADMIN_SOCKET` in a user-owned 0700 directory on macOS (default `/run/pangolin` does not exist); 24 passed, 2 skipped, the CSP guard is the expected fail.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-05) — high 0 · medium 2 · low 7 · false 2 · maybe-false 0 (16 findings, 4 lenses)

| # | Lens | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind, edge, vgap(other), intent | scopeToPerson stamps every unscoped audit row of the account, including rows from a period when it was joint, so the partner loses history they already saw | medium | intent_gap | Verified db unit-of-work.ts scopeToPerson WHERE account_id AND person_id IS NULL; accounts-parity asserts auditB = [set_privacy]. Decision 80 and the intent's purpose say private-era rows; the frozen matrix row says all prior rows. Needs Simon. |
| 2 | vgap | Nothing pins that a soft-deleted scoped payee/tag/activity still blocks the public switch | medium | patch | Pre-verified: no test soft-deletes a scoped row on a live transaction; a filter added later would pass every test. |
| 3 | blind | Share-shrinking (keep B at 1 bp) bypasses only-remove-yourself | low | defer | Intent names removal only; the account stays joint, so it cannot go private; a product question about stakes. |
| 4 | blind | hasSharedSplit's name no longer matches its meaning | low | patch | Rename (e.g. hasSplitForOthers) across port, repos, mirror, tests. |
| 5 | blind | Spine/spec not updated for AD-7 partner beneficiary and the first audit_log UPDATE | low | defer | Spec reconciliation, not code. |
| 6 | blind | The rescope leaves no trace and no DB guard limits it to person_id | low | defer | Hardening (trigger or a count on the set_privacy row). |
| 7 | blind | Owner names via listActive fall back to a raw id for an inactive owner | low | defer | Deactivation does not exist; joins the deactivation deferral. |
| 8 | blind | Owners-invariant branch throws plain Error, untested | low | reject | Internal invariant like the codebase's other vanished-row checks; fix adds tests only for an impossible state. |
| 9 | blind | Refusal tells the user to remove items that may be soft-deleted | low | defer | UX copy when deleted payees cannot be picked; epic 12 / epic 3 promotion. |
| 10 | blind | A partner's hiding persists on the owner's private ledger until expiry with no override | false | reject | Intended: AD-4 as amended (decision 79a) and this story's matrix. |
| 11 | blind, intent | HTTP self-removal done via direct use-case call; cast style differs | low | patch | Use PATCH for the self-removal and one cast style. |
| 12 | blind | Memory vs SQL NULL handling in hasSharedSplit | false | reject | beneficiary is NOT NULL (schema split.ts). |
| 13 | blind | Missing parity cases: self-removal from a private account; self-removal while adding an owner | low | patch | Two direct test cases. |
| 14 | edge | Refusal attributes items to the owner when scoped to someone else | low | defer | Only reachable via the system viewer (retro P10, deferred). |
| 15 | edge | Inactive co-owner cannot be removed | low | reject | Simon chose no exception (decision 92b), deferred. |
| 16 | intent | Harness flip now stamps; harness unchanged | low | reject | Suite passes unchanged; the flip account's rows are A's own. |

### Pass 2, review loop 1 (2026-10-06) — high 1 · medium 0 · low 9 · false 2 · maybe-false 0 (17 findings, 4 lenses)

| # | Lens | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | edge, vgap, edge(claim) | A redundant setPrivacy(private) on an already-private account appends a set_privacy row with after.isPrivate true; scopeToPerson takes it as the start of the private era, so earlier private-era rows stay unscoped and reach the partner after the public switch | high | patch | Verified set-privacy.ts audits even when isPrivate is unchanged; both scopeToPerson implementations take the latest after.isPrivate = 1 row. Fix: take the latest transition row (before.isPrivate false, after true), SQL and mirror, with a test of the redundant call. |
| 2 | edge, blind | Clock stepping back could misorder (at, id) | low | reject | at and id both come from the server clock; a backwards step is not an everyday case and the fix adds a sequence column. |
| 3 | edge | Private account with no set_privacy-to-private row but created public | low | reject | Not reachable: accounts are created and switched only through use cases, which always audit. |
| 4 | edge, blind | Sole owner cannot lift a departed partner's hiding | false | reject | carried: #10 of pass 1 (intended per AD-4 as amended). |
| 5 | edge, blind | Owner name falls back to raw id | low | defer | carried: #7 of pass 1. |
| 6 | edge | Scoped refs on soft-deleted transactions ignored | low | reject | No restore path exists; nothing can bring them back onto the account. |
| 7 | edge(claim) | Acceptance criterion wording says no pre-flip row appears | low | reject | Fix would edit this build's plan; the frozen intent and matrix carry the decision. |
| 8 | blind | scopedReferences lists another person's scoped rows and names them to the owner; owner cannot clear them | low | defer | Only reachable through the system viewer (use cases refuse scoped rows outside their owner's private accounts); joins retro P10 / pass 1 #14. |
| 9 | blind | Private switch ignores the departing partner's scoped rows | low | defer | Same reachability as #8; grouped with it. |
| 10 | blind, intent | only-remove-yourself does not stop adding a third person, changing others' shares, or a non-owner adding themself to a public account | low | defer | Shares carried (#3 of pass 1); a non-owner adding themself to a visible public account predates this change; two-person household. |
| 11 | blind | SQL json true vs memory === true parity on isPrivate | low | reject | after JSON is always JSON.stringify of a boolean; numeric 1 is never written. |
| 12 | blind | Conflict message has no size cap | low | reject | Fix adds truncation logic for an unlikely case. |
| 13 | blind | accounts-parity header line over 100 columns | false | reject | pnpm lint passes (Biome does not wrap comments). |
| 14 | blind, intent | Spec/spine not updated (AD-4, decision 80, Conflict details) | low | reject | AD-4 and decision 80 were amended in commits 2ed2919 and the epic notes; remaining wording carried as pass 1 #5 deferral. |
| 15 | intent | Server privacy harness has no takeover scenario | low | defer | Entry 18 widens the privacy suite to owner changes and privacy switches. |
| 16 | intent | No backfill of already-ended private eras | low | reject | Not in the intent; v0.2.0 households have no flipped accounts. |
| 17 | intent | hide-name write rule unchanged (A2 reading) | false | reject | carried: frozen Never list keeps it. |
