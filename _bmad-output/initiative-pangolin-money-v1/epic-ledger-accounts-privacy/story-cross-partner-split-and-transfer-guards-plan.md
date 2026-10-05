---
title: 'Cross-partner split and transfer guards'
type: 'bugfix'
ticket: 16
created: '2026-10-06'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
baseline_revision: '82ce95d5fd26809b496ec9a824a514228ee58f33'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A partner can put an owner-scoped activity on a shared split, delete a transfer group that reaches into the other's private account, and hide names on accounts they do not own (retro P4, P7, P8). Deleting one side of a transfer leaves the survivor linked to a dead group (I3), and `setSplits` stores any `propertyId` unchecked (I6).

**Approach:** Add the missing guards at the use cases, with the repo changes each needs and a memory mirror and parity step for each. Deleting a transaction unlinks and deletes its group, through a viewerless upkeep read.

## Boundaries & Constraints

**Always:** A refusal reveals nothing about a row the viewer cannot see (NotFound). Repo methods take what they need explicitly, have a memory mirror and a parity step. SQL that reads `transaction` or `audit_log` stays in privacy.ts, ledger-repos.ts or db/unit-of-work.ts. The upkeep read lives on the repo port, never behind `SystemViewer` on the HTTP path (AD-6), and is not in `ReadRepos`. Unlinking a survivor in a private account is audited with owner-only scope (`personId` = that account's owner), content unchanged (decision 81). The suite's `knownGaps` entries for name-hidden and transfer-group delete are removed.

**Never:** Touch the manifest (17), the read rule or its lint (18), payee/category scope guards (P10 stays deferred), or hide-name's private-account refusal. Add a shared scope-guard abstraction for every reference kind; the activity guard is inline like tags and payees. Change unhide.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scoped activity, shared split | public account, activity scoped to A, A or B sets it (setSplitField or setSplits) | refused, no change, no audit row | Conflict |
| Scoped activity, private account | A's private account, A's activity | accepted | none |
| Group delete, private member | B deletes a group whose other live member is in A's private account | refused, A's row unchanged | NotFound |
| Group delete, all visible | every live member visible to the viewer | links cleared, group deleted, one audit per member | none |
| Non-owner hide | public account, viewer is not an owner | refused | Validation |
| Delete one side | one side deleted; survivor in a public account | survivor and deleted row unlinked, group deleted, survivor audited with its account; survivor can join a new group | none |
| Delete one side, private survivor | survivor in A's private account, B deletes | same, audit carries `personId` = A; B's listAudit omits it | none |
| Property | setSplits with non-null `propertyId` | refused, nothing written | Validation |

</frozen-after-approval>

## Code Map

- `packages/app/src/ledger/split-targets.ts:16` -- `requireActivity(tx, viewer, id)`: NotFound only. Add `isPublic`; after the find, a public account with `scopePersonId !== null` is Conflict "This activity cannot be used on a shared account yet" (wording of `create-transaction.ts:55`, `split-tags.ts:41-50`). `privateOwner :46` returns null for public.
- `packages/app/src/ledger/set-split-field.ts:107` -- activity branch; `before.accountId` in hand. `set-splits.ts:99,:115` -- `owner === null` means public; `propertyId` written near `:168`: refuse non-null `s.propertyId` Validation (nothing exists to reference until epic-loans-property).
- `packages/app/src/ledger/transfer-groups.ts:86-113` -- `deleteTransferGroup`: use viewer-aware `members`; any live member the viewer cannot see → NotFound before writing. Audit pattern `:102-111` (raw before/after) to reuse.
- `packages/app/src/ports/unit-of-work.ts:565-582` -- `TransferGroupRepo`: `members(id)` becomes `members(viewer, id)` (live rows only, and reports how many live members the viewer cannot see); add viewerless `upkeepMembers(id)` (live, raw). Only caller of `members` is `:92`.
- `packages/db/src/ledger-repos.ts:557-599` -- both reads (`find` uses `liveVisibleTxn`, `privacy.ts:33`). `packages/app/src/testing/memory-uow.ts:1361,:1389` -- mirrors.
- `packages/app/src/ledger/delete-transaction.ts:21-47` -- soft-deletes, no group handling. After `softDelete`: when `before.transferGroupId` is set, `upkeepMembers` (live, others), `setTransferGroup` clear on survivors and the deleted row's own link (foreign key before group delete), `transferGroups.delete`, survivor audit via `audit({..., accountId, personId})` (`write.ts`; `personId` only when the survivor's account is private, owner from `tx.accounts.owners`). The delete audit's `after` carries `transferGroupId: null`.
- `packages/app/src/ledger/hide-name.ts:86-90` -- after the private refusal, require `tx.accounts.owners(account.id)` to include `me`, else Validation "Only an owner of the account can hide a name". Seed rule: `apps/server/src/admin/seed.ts:285-296`.
- `apps/server/src/privacy/route-manifest.ts:203,:219` -- remove the two `knownGaps`; `apps/server/src/privacy/privacy.test.ts:496-497` count 4 → 2.
- Tests: `packages/app/src/ledger/splits.test.ts` (setup `:57`, Conflict template near `:516`), `hidden-names-transfers.test.ts` (`:103`, `:280`), `ledger.test.ts:445`, `packages/db/src/ledger-repos.test.ts:430-518`, `testing/repo-parity.test.ts`, `apps/server/src/http/app.test.ts:394-503`.

## Tasks & Acceptance

**Execution:**
- [x] `split-targets.ts`, `set-split-field.ts`, `set-splits.ts` -- scoped-activity Conflict on public accounts; non-null `propertyId` Validation -- P4, I6
- [x] `ports/unit-of-work.ts`, `ledger-repos.ts`, `memory-uow.ts` -- `members(viewer, id)`, `upkeepMembers(id)`, each with a parity step including soft-deleted members -- P7, I3
- [x] `transfer-groups.ts`, `delete-transaction.ts`, `hide-name.ts` -- visible-members rule, survivor unlink with scoped audit, owner check -- P7, I3, P8
- [x] `route-manifest.ts`, `privacy.test.ts` -- drop the two gaps, count 2; add partner probes for both closed routes if the suite's shape needs them
- [x] Tests on memory and SQLite for every matrix row; server route test for the Conflict (409), NotFound and Validation bodies

**Acceptance Criteria:**
- Given A's scoped activity on a shared split, when either partner sets it, then Conflict and no audit row exists.
- Given one side deleted, when the survivor is linked to a new group, then it succeeds; a survivor in A's private account is unlinked and only A's listAudit shows the row.
- Given the server privacy suite, when it runs, then it passes with `knownGaps` at 2.

## Implementation Notes

- `members(viewer, id)` returns `{ rows, hidden }` (live visible rows; count of live rows the viewer cannot see). `upkeepMembers(id)` is live-only and raw, on the port, not in `ReadRepos`.
- `deleteTransaction` clears the deleted row's own link as well as each survivor's (foreign key before the group goes) and puts `transferGroupId: null` in the delete audit's `after`. Survivors are audited with raw before/after rows (as `deleteTransferGroup` does; redacted on read, 2.14); `personId` is the private account's owner.
- Not done: a soft-deleted member that still carries a link from before this change is not cleared by `deleteTransferGroup` or `deleteTransaction` (live-only reads), so such a group cannot be deleted (foreign key). Released data holds no ledger rows; deferred.
- `setSplits` refuses any non-null `propertyId`; `setSplitField` has no property field.
- A partner cannot see the other's scoped activity, so they get NotFound, not Conflict; Conflict is for the actor's own scoped activity on a shared account (the Always clause: nothing reveals a row the viewer cannot see).
- Local `pnpm e2e` could not run clean (no Docker; the seed needs the admin socket in the container): 18 passed, 2 failed (`ledger.spec.ts:213`, `routing.spec.ts:64`, both seed-dependent), plus the expected CSP-guard fail. Run in CI order before release. No web code changed.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-06) — high 0 · medium 0 · low 9 · false 5 · maybe-false 0 (4 lenses)

| # | Lens | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | vgap | No test has the owner delete a shared side with a private survivor, so the `account.isPrivate` arm that sets `personId` is unasserted | low | patch | Verified: existing cases have B delete (`account === undefined` arm only). |
| 2 | blind, edge | A soft-deleted member linked before this change makes group delete / survivor delete hit the foreign key; old `members` cleared it | low | defer | Real for pre-change data only; released data has no ledger rows (epic note); fix needs a new repo method or a migration. |
| 3 | blind | No backfill for survivors already stuck in a dead group (I3) | low | defer | Same as #2. |
| 4 | edge | Owner lookup `owners()[0]` with no owner would leave the audit unscoped | false | reject | A private account always has exactly one owner (`privateOwner` throws otherwise); not reachable. |
| 5 | edge | `setTransferGroup` count ignored in `deleteTransaction` | low | reject | A miss would surface as a foreign key error; guard adds branching for an unreachable case. |
| 6 | edge, blind | Scoped activity already on a public split is not re-checked when unchanged; private-to-public switch | low | reject | The switch refuses scoped refs (2.15); legacy rows predate the guard, and released data has none. |
| 7 | edge | B gets NotFound, not Conflict, for A's scoped activity | false | reject | B cannot see A's activity; NotFound is the Always rule. Conflict is the actor's own scoped activity. |
| 8 | blind | Survivor audit uses raw rows, so a hidden name could leak | false | reject | `scrubJson` redacts `descriptionRaw` and `payeeId` on read for raw rows too (redact.ts:47); same pattern as `deleteTransferGroup`. |
| 9 | blind | Group-delete refusal tells B a hidden member exists | false | reject | B already sees the transfer label; NotFound for a group with a private member is the intent. |
| 10 | blind, intent | No privacy-suite probe for name-hidden; I3 not exercised over HTTP | low | reject | The suite probes both routes with the gap entries gone and passes; I3 is covered on memory and SQLite; test-only extra. |
| 11 | blind | Other soft-delete paths (account deletion, merge, import) can strand survivors | false | reject | No such paths exist yet. |
| 12 | blind | `requireActivity` positional boolean, two-query SQLite count, test smells, no API spec update, overlong JSDoc | low | reject | Cosmetic; fixes add churn. |
| 13 | blind | Plan unfinished (tasks, notes) | low | reject | Fix edits this build's plan. |
| 14 | intent | Group delete refuses wholesale; blanket property refusal; unlink applies to any group size | low | reject | Descriptive; each matches the intent and matrix. |

## Design Notes

`members(viewer, id)` could return `{ rows, hidden }` (live rows the viewer sees, count of live ones it does not); the use case refuses when `hidden > 0`. `find` already refuses a group none of whose live members is visible.

Hide-name: a non-owner who can see a public account is neither NotFound nor a private-account case, so Validation matches the private refusal's code.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean (8 pre-existing warnings)
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm e2e` -- expected: green against a fresh local build (CI order)
