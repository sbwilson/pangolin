---
title: "Leaving the household deletes the leaver's private data"
type: 'feature'
ticket: '26'
created: '2026-10-07'
baseline_revision: 'daf59763540f4e9c37c835fd2830fc543e72af50'
status: 'built'
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

**Problem:** There is no way for a person to leave the household and take their private data with them. Simon decided on 2026-10-06 that leaving hard-deletes the leaver's private data, lifts their hidings, hands shared accounts to the partner and revokes their access.

**Approach:** A `leaveHousehold` use case, behind a recent sign-in and a confirmation, runs one transaction that deletes the leaver's private rows, lifts their hidings, makes the partner sole owner of shared accounts, marks the person as left and revokes their credentials and sessions.

## Boundaries & Constraints

**Always:**
- The input carries a confirmation (`confirm: true`, else `Validation`) and `requireRecentAuth` runs before the write (`ReauthRequired` otherwise). Either missing changes nothing. The partner is the other active person; with none, `Conflict` and nothing changes.
- Hard-deleted: the leaver's private accounts through an internal cascade `deleteAccountRows` (transactions, splits, split tags, snapshots, owners, transfer-group links, account-scoped review items, and the audit rows of those accounts); the leaver-scoped payees, aliases, tags and activities (`scope_person_id`), with references from partner-visible shared rows nulled; the leaver's person-scoped review items; the audit rows with `person_id` of the leaver. The surviving side of a transfer is unlinked (decision 81), audited as the owner's.
- Every hiding the leaver made is lifted, including on an account that has since turned private to the partner, through an owner-audited upkeep write.
- Every shared account and its expenses stay. The leaver is replaced by the partner as sole owner (internal `replaceOwners`; entry 20's last-owner rule is not bypassed in `updateAccount`). A public account the leaver owned alone passes to the partner. Audit rows of shared data, authored by the leaver or not, stay.
- The person is marked left (`person.deleted_at`); credentials, passkeys, two-factor, recovery codes and sessions are revoked and the password made unusable.
- The upkeep writes bypass the closed-date lock. Earlier backups keep the data (accepted).

**Never:** export `deleteAccountRows` or any use case that deletes an account; build the confirmation or re-authentication screens (epic-app-shell-settings-theming); change entry 20's owner rules, the read rule or the closed-date lock.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Leave with private data | Confirmed, recent sign-in; private accounts, hidings, scoped payees | Private rows and their audit rows gone; hidings lifted and readable by the partner; shared accounts kept with the partner as sole owner; no credential or session left | none |
| Leave with none | Same, nothing private | Partner's responses byte-identical to the case above | none |
| No recent sign-in | Session older than the window | Nothing changes | `ReauthRequired` |
| No confirmation | `confirm` missing or false | Nothing changes | `Validation` |
| No partner | Leaver is the only active person | Nothing changes | `Conflict` |
| Shared references | A shared transaction uses a leaver-scoped payee or activity | Reference nulled, transaction kept | none |
| Transfer | Leaver's private entry linked to the partner's | Partner's side kept, unlinked | none |
| Closed account | Leaver's closed private account | Deleted despite the lock | none |
| Hiding on partner-private | Account turned private to the partner | Hiding lifted, audited as the partner's | none |

</frozen-after-approval>

## Code Map

- New `packages/app/src/accounts/leave-household.ts` -- `leaveHousehold` (export from `packages/app/src/index.ts`): `parseInput`, `requireRecentAuth(ctx)` (`identity/reauth.ts:14`), then one `write()` (`write.ts:45`). Internal `deleteAccountRows`, kept off the index and unmatched by `no-delete.test.ts` when exported names are scanned.
- Reuse: `delete-transaction.ts:40-83` (survivors unlink and owner-audited upkeep audit), `rejoin-account.ts:67-77` and `inputs.ts:69` `ownerRows` (owner swap and audit), `identity/re-enrolment.ts:106` `clearCredentials` (add reason `"left-household"`; pass `unusablePasswordHash`, as `identity/reset-user.ts:49`). Do not call `closed-lock.ts` helpers, `unhideTransactionName` or `updateAccount`.
- Ports `ports/unit-of-work.ts`: new viewerless methods, each in `ports/tx-repos-viewer.test.ts` `VIEWERLESS` with a reason: person `markLeft` (`PersonRepo:851`); transactions hide-lift and survivors read; hard deletes for an account's rows, leaver-scoped classify rows and review items; audit delete by person and by account (audit repo, `db/src/unit-of-work.ts:127`). FKs are `no action` with foreign keys on: delete child to parent.
- SQLite in `db/src/ledger-repos.ts`, `classify-repos.ts`, `review-item-repo.ts`, `identity-repos.ts` (only `privacy.ts`, `ledger-repos.ts` and `unit-of-work.ts` may import all scoped schemas; `read-rule.test.ts`, `raw-sql-read-rule.test.ts`). Mirror in `testing/memory-uow.ts`; cover in `repo-parity.test.ts` and `accounts-parity.test.ts`.
- `apps/server/src/http/app.ts`: `POST /api/accounts/leave-household` before `/api/accounts/:id`, `writable()`, `objectBody`; clear the session cookie in the response. Map errors as for `ReauthRequired` (`http/errors.ts:12`).
- Privacy suite: `route-manifest.ts` entry (`write(...)`), `privacy-harness.ts` delta (A's private accounts, a hiding, scoped payee, activity, tag), a leave scenario in `privacy-scenarios.ts` run through `runPair` in `privacy.test.ts`, plus a leak-mode control.
- Tests: `packages/db/src/accounts.test.ts` (matrix at use-case level), `ledger.test.ts`, `app.test.ts` (HTTP, cookie).
- Do not change: `accounts/update-account.ts`, `ledger/closed-lock.ts`, `privacy.ts` read rules, migrations (no schema change).

## Tasks & Acceptance

**Execution:**
- [ ] `ports/unit-of-work.ts`, `db/*-repos.ts`, `memory-uow.ts`, `tx-repos-viewer.test.ts` -- the viewerless methods, both adapters, parity cases
- [ ] `accounts/leave-household.ts`, `identity/re-enrolment.ts`, `index.ts` -- the use case and cascade
- [ ] `apps/server/src/http/app.ts` -- route and cookie clear
- [ ] tests -- the matrix; the privacy suite's paired worlds, manifest entry and leak control

**Acceptance Criteria:**
- Given a leaver with private accounts, hidings and scoped payees, and one with none, when each leaves confirmed and recently signed in, then the partner's responses are byte-identical in the two worlds.
- Given the departure, then the leaver's private accounts, scoped rows and their audit rows are gone, their hidings are lifted and readable by the partner, every shared account and expense remains with the partner as sole owner, and the leaver has no session or credential.
- Given no recent sign-in or no confirmation, when they try to leave, then nothing changes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 1 (patched), low 1 patched, 2 deferred, 15 rejected, false 4, maybe-false 1.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| The cleared session cookies are tested only under an http public URL; `COOKIE_ATTRIBUTES` is a second copy of `cookieSettings`' attributes (VG, blind) | medium | patch | `clearedSessionCookies` has no https test and nothing ties its attributes to `defaultCookieAttributes`; under https a drift leaves `__Host-pangolin.session_token` in the browser. |
| `liftHidings` says each lift is audited with the owner's scope, but lifts scoped to the leaver or to a deleted account are erased in the same write (blind) | low | patch | `deleteForPerson` and `deleteForAccount` run last; fix the comment. |
| Deleted rows stay in SQLite free pages and the WAL (`secure_delete` is off) (blind) | medium | defer | A database-wide setting, not this change's; the plan accepts old backups only. |
| The unlinked survivor of a transfer in a shared account carries an unscoped audit row, and the paired worlds link only private accounts (edge, VG) | maybe-false | defer | Same as decision 81's delete path, and the partner already reads `Transfer from <leaver>`; add a private-to-shared transfer to flavour one to settle it. |
| A leaver whose login has no password row fails with a 500 (edge) | low | rejected | Every real login has one (`clearCredentials` precedent); fixtures only. |
| More than two active people: the partner is the first other (blind, edge) | low | rejected | The household is two people; `ownersInput` allows at most two owners. |
| A live re-enrolment link still checks as valid; the partner's reset item stays open (edge) | low | rejected | `redeemReEnrolmentLink` needs an active person, so a left person cannot redeem; the check page is cosmetic. |
| Survivor scope for an account outside {leaver, partner} (edge) | false | rejected | Only two people can own an account. |
| `deleteForPerson` erases person-scoped audit rows on shared accounts (edge) | false | rejected | The ticket deletes the rows scoped to the leaver; shared-data rows carry no person scope. |
| `two_factor` and `dont_remember` cookies are not cleared (blind, edge) | low | rejected | The session is revoked server-side; cosmetic. |
| The refreshed cookie is untested on a failed leave; other-device cache cookie (blind) | low | rejected | `sessionEnded` is set after the use case returns; sessions are revoked in the database. |
| Shared rows lose payee, tag and activity references with no audit row (blind) | low | rejected | The plan nulls the references and keeps the rest. |
| No generic residue scan; an `origin_account_id` leaving an FK (blind) | false | rejected | Every table with an account or person FK is handled; `scopeFor` stores an origin only for a private account, which is leaver-scoped. |
| Dead `OwnedAccount.deleted`, 500-id chunk and soft-deleted scoped rows untested, undocumented survivors, partner without a login, decision cited by date (blind) | low | rejected | Style or unlikely; the fixes add surface. |
| No UI, and the capability is reachable only by request (intent) | low | rejected | The plan's Never excludes the screens (app shell epic). |
| The deleted-person audit row keeps the full person row, unscoped (blind) | false | rejected | The row is the shared history of a former member, as the ticket says. |

## Design Notes

Shared splits keep a `beneficiary` or `performed_by` that names the leaver; both are text or plain references, shown as a former member. One transaction keeps the cascade all-or-nothing. A hiding lifted on a private account is audited with `personId` of its owner so only they read the row.

## Verification

**Commands:**
- `pnpm vitest run` -- expected: pass; `pnpm lint` and `pnpm typecheck` -- expected: clean
