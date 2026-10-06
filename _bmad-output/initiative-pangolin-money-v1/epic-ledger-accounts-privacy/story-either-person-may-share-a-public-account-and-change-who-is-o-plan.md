---
title: 'Either person may share a public account and change who is on it'
type: 'feature'
ticket: '20'
created: '2026-10-06'
status: 'built'
baseline_revision: '2925774b9df7b04f991890dbbf27607d8ad15abc'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `updateAccount` lets a person only remove themself from an account's owners (`requireOnlySelfRemoved`, entry 15), so a person cannot share a public account, remove the other or hand an account over. Simon has decided the relationship is not adversarial: either person may share a public account and change who is on it, a removed person is told and can come back.

**Approach:** Replace that rule with an owner-change rule on public accounts, add a removal marker to the account read model derived from the audit row of the owner change, and a `rejoinAccount` use case that undoes a removal.

## Boundaries & Constraints

**Always:**
- A person who owns a public account may set its owners freely: add the other person, remove themself or the other, change shares. The result keeps at least one owner (at most two) and the shares add up to 100%.
- A person who does not own a public account may only join it: the new list is the current owners plus themself.
- A private account keeps one owner, the person; an owner change on it stays refused as today. The system viewer stays exempt.
- A hiding survives the removal of its hider.
- A removed person still sees the (public) account. Its read model carries `removal: { by, at, previousOwners }` for them, taken from the latest owner-change audit row that dropped them, and `rejoinAccount` puts them back at their previous share, scaling the current owners to fit.
- No migration. The marker is derived from audit rows; the audit read takes the viewer first.
- A transfer is the same two steps (add the other, remove oneself) and keeps the account's history.

**Never:** change privacy switching, the closed-date lock (entry 23), the last-owner wording beyond the non-empty result, or any hiding rule; add a table or column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Share | Owner A sets owners `[A, B]` on a public account | 200; B an owner; audit row with both lists | none |
| Join | Non-owner B sets `[A, B]` on A's sole-owner public account | 200 | none |
| Takeover try | Non-owner B sets `[B]` (drops A) | refused | Validation |
| Remove other | Owner A sets `[A]` on a shared account | 200; B sees the removal marker | none |
| Leave | Owner B sets `[A]` | 200 | none |
| Empty | Owners list empty | refused | Validation (as today) |
| Private | Owner changes on a private account | refused as today | Validation |
| Rejoin | Removed B calls `rejoinAccount` | 200; B owner again at their previous share; marker gone | Validation when B is already an owner |
| Hiding kept | B hid a name, A removes B | name still hidden from A; B rejoins and can unhide | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/accounts/update-account.ts:62,105-117` -- replace `requireOnlySelfRemoved` with the rule above; keep `validateOwners` and `requireKnownPeople` (`inputs.ts:42-70`); doc comment names the rule.
- `packages/app/src/accounts/pool.ts` (`AccountView`, `accountView`) and `list-accounts.ts` (`listAccounts`, `getAccount`) -- add `removal`, computed from the new audit read for a viewer who is not an owner.
- `packages/app/src/ports/unit-of-work.ts:1004-1019` -- `AuditRepo`: add `ownerChanges(viewer, accountId)` returning the account's `update` audit rows with their owner lists, oldest first; takes the viewer first (`tx-repos-viewer.test.ts` enforces it).
- `packages/db/src/unit-of-work.ts:107-175` (SQL, use `visibleAudit`) and `packages/app/src/testing/memory-uow.ts` (mirror) -- implement it; parity step in `testing/repo-parity.test.ts`.
- New `packages/app/src/accounts/rejoin-account.ts`, exported from `packages/app/src/index.ts`; route `POST /api/accounts/:id/rejoin` in `apps/server/src/http/app.ts` near `PATCH /api/accounts/:id`, and its entry in `apps/server/src/privacy/route-manifest.ts:225` area.
- Tests encoding self-removal that change: `packages/db/src/accounts.test.ts:181-184,248-252`, `packages/app/src/testing/accounts-parity.test.ts:115,147`, `apps/server/src/http/app.test.ts:822-838`, and the switch scenario in `apps/server/src/privacy/privacy-scenarios.ts` (steps "B strips A from the joint account", "A removes themself from it") with the status list in `privacy.test.ts` ("owner changes and privacy switches").
- Do not change: `set-privacy.ts`, `hide-name.ts`, `db/privacy.ts` (hiding already ignores ownership), the manifest.

## Tasks & Acceptance

**Execution:**
- [ ] `update-account.ts` -- owner-change rule; doc comment
- [ ] `ports/unit-of-work.ts`, `db/unit-of-work.ts`, `memory-uow.ts` -- `AuditRepo.ownerChanges`; parity test
- [ ] `accounts/pool.ts`, `list-accounts.ts` -- `removal` on the read model for a removed viewer
- [ ] `rejoin-account.ts`, `index.ts`, `http/app.ts`, `route-manifest.ts` -- `rejoinAccount` and its route
- [ ] tests -- update the self-removal tests; add the matrix rows over HTTP (`app.test.ts`) and in `accounts.test.ts` and the parity suite; rework the privacy switch scenario and add a step for join, remove and rejoin with a hiding kept; the paired worlds must still match for B

**Acceptance Criteria:**
- Given the matrix rows, when each is run over HTTP, then the status and owners are as listed.
- Given B was removed, when B reads the account, then `removal` names who and when, and after `rejoinAccount` it is absent.
- Given B hid a name and A removed B, when A reads the transaction, then the name is hidden, and B can unhide it after rejoining.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 1, low 8, false 1, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Removal marker for a person removed twice is untested; reversing the loop in `removalOf` passes every test (VG) | medium | patch | `pool.ts` `removalOf` walks newest-first; every test has one matching change. A stale marker and a rejoin at the first removal's share would follow. |
| A joiner sets any shares, so the owner can be cut to 1 bp (blind, edge x2, VG, intent) | low | rejected | Accepted by Simon: the relationship is not adversarial, and the plan's summary to him named it. A pin test is added with a patch. |
| `rejoinAccount` restores the previous share, so a handed-over account can be taken back at 9999 bp; a previous 10000 bp is trimmed to 9999 (blind, edge) | low | rejected | The plan says restore the previous share and scale the current owner; Simon asked for an easy way back. Raised in the final summary for him; the trim to 9999 is the implementer's documented judgement. |
| HTTP takeover test lost its 400 assertion; join refusals not all covered; one-element loop (blind) | low | patch | Direct test fixes. |
| A db test's title says it checks another person's private account's marker and asserts nothing about it (blind) | low | patch | Add the `getAccount` and `listAccounts` assertions. |
| Share from the audit JSON trusted in `rejoinAccount` (edge) | low | patch | One guard: integer of at least 1. |
| The refusal message is misleading for a dropped owner or a third person (blind) | low | patch | Reword and update the tests. |
| Per-account audit query on every list; `ownersOf` duplicated in two files; `removal.by` may be a raw actor string; ordering by `(at, id)` like `scopeToPerson`; no owner-change lock on a closed account (blind, edge) | low | rejected | Two-person household; the duplicate mirrors the repo's memory-versus-SQL pattern; the actor string is documented on the type; ordering is already the deferred N6; entry 23 adds the closed-date lock. |
| "told" is only a read-model marker; no screen yet (intent) | low | rejected | The plan scopes the screen to epic-ledger-workspace, whose handoff note says so. |
| A removed person loses sight of the account when it goes private (edge claim) | low | rejected | By design: a private account is invisible to the other person. |
| `T2` may be out of scope in `repo-parity.test.ts` (blind) | false | rejected | `pnpm typecheck` and the full suite pass. |

## Design Notes

`removal` is derived, not stored: the latest owner-change audit row whose before-owners hold the viewer and whose after-owners do not, while the viewer is not an owner. Owner lists are in the audit JSON (`update-account.ts` audits `owners` in before and after), so nothing new is written.

## Verification

**Commands:**
- `pnpm vitest run packages/app packages/db apps/server/src/http apps/server/src/privacy` -- expected: pass
- `pnpm lint` and `pnpm typecheck` -- expected: clean
