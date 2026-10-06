---
epic: epic-ledger-accounts-privacy
date: 2026-10-06
verdict: rejected
criteria: declared
headless: false
---

# Retrospective: Ledger core and privacy (epic 2)

Two passes are recorded here. The **second pass** (2026-10-06) follows this line and is the current state; the sections headed "First pass" are the original retrospective of 2026-10-05, kept as the record.

## Second pass (2026-10-06)

The first pass (below, sections headed "First pass") was written at `3219563` and rejected epic 2. Remediation stories 2.14 to 2.19 followed. This pass re-reads the epic after them, focusing on what changed since the first retrospective and on whether the defects it named are closed. Findings carry source references; claims from sub-agents were re-checked against the primary source before routing, and unverified ones are marked as such.

**Run:** interactive. The user asked to focus on the changes since the last retrospective and the defects identified. Evidence: `git_evidence.py` ranges, the six new plans with their triage logs, the first retrospective, and `deferred-work.md`. Five sub-agents ran the re-verification (every first-pass finding re-opened at HEAD with mutation runs in a scratch copy), the action-item follow-through, and three review lenses over the code diff `e8a92b8..HEAD`; a sixth ran a behaviour check over real HTTP. No session logs were read: process findings rest on the plans, commits and CI history.

### Second pass: Epic summary

All 19 tickets are at `built` (board state `review`); `pending_tickets` is empty. Tickets 2.14 to 2.19 are new since the first pass. None has a story file. Covers now include CAP-16 (decision of 2026-10-05, `epic-ledger-accounts-privacy.md:5`).

| Ref | Title | Plan range | Commits (merges) | Files | +/− |
|---|---|---|---|---|---|
| 2.14 | True audit history and hidden-row projection | `e8a92b8..3ed41f1` | 2 (1) | 24 | +852 / −71 |
| 2.15 | Account ownership and privacy switches | `3ed41f1..82ce95d` | 2 (1) | 16 | +1,161 / −68 |
| 2.16 | Cross-partner split and transfer guards | `82ce95d..bfd0abb` | 1 (0) | 18 | +742 / −52 |
| 2.17 | Backup manifest privacy | `bfd0abb..fc36bf7` | 1 (0) | 10 | +294 / −60 |
| 2.18 | Widen the read rule and privacy suite | `fc36bf7..84a6699` | 1 (0) | 13 | +1,953 / −91 |
| 2.19 | Release v0.2.1 and deploy (hitl) | `84a6699..HEAD` (`6541bc7`) | 5 (0) | 4 | +538 / −29 |
| Overall | | `e8a92b8..HEAD` | 12 (2) | 59 | +5,540 / −371 |

- The range end for 2.19 is `HEAD` (inferred; the page and the CI fix `ba762e2` are in it). The 11 docs-only commits between the first cut (`3219563`) and `e8a92b8` (`458f72f`..`283f8af`: UX spines, the UX catch-up proposal, the spec and spine reconciliation, the first retro itself) are outside the plan ranges; the first retro's spec action items landed there.
- 2.14 and 2.15 landed by branch and merge (`3ed41f1`, `82ce95d`); 2.16 to 2.19 landed directly on `develop` with no merge commit.
- The release tag `v0.2.1` is on `ba762e2d01b49b0a49a522e7115d72e769030eb3`, and `docs/release-v0.2.1.md` records the release run `37410053125`, the upgrade of pang-dev from the `v0.2.0` tag, and acceptance by Simon Wilson on 2026-10-06.
- Raw evidence: scratchpad `retro3/` (`evidence-*.json`, `code-diff.patch`).

**Evidence missing or narrowed:** no `## Code Review` blocks (review evidence is each plan's Review Triage Log); no session logs read; the `/api/system/audit` route does not exist, so audit rows were read through the use case and the scratch database, not over HTTP; the backup flows ran with restic stubbed in tests, and pang-dev has no ledger accounts, so the privacy fixes were not seen on a real host.

### Second pass: Findings

**First-pass defects, re-verified at HEAD (`6541bc7`).** Re-opened by reading the code and, for 13 fixes, by reverting each in a scratch copy and running `vitest run apps/server packages/app packages/db` (baseline 994 pass; every revert failed named tests).

| ID | Status | Where it lives now | Test that fails on revert |
|---|---|---|---|
| P1 | fixed | `update-account.ts:62,105-117`; `db/privacy.ts:92-98,173-177` | `accounts.test.ts` self-removal; `privacy.test.ts` "owner changes and privacy switches"; `db/privacy.test.ts` takeover |
| P2 | fixed | `db/privacy.ts:128-129`; `ledger-repos.ts:82-93`; `unit-of-work.ts:122` | `privacy.test.ts` "never shows B the description, payee, fingerprint…" |
| P3 | fixed | `jobs/backup.ts:71-76,172,208,215` | `backup.test.ts` private-account drill; `privacy.test.ts` "a failed restore drill" |
| P4 | fixed | `split-targets.ts:19-25` | `splits.test.ts`, `app.test.ts` 409 |
| P5, P6 | fixed | `set-privacy.ts:45-60,84-107`; `unit-of-work.ts:147-173` | `accounts.test.ts` setPrivacy cases; `privacy.test.ts` era scoping |
| P7 | fixed | `transfer-groups.ts:93-94` | `app.test.ts`, `hidden-names-transfers.test.ts` |
| P8 | fixed, bypassable (N1) | `hide-name.ts:92-94` | `hidden-names-transfers.test.ts`, `app.test.ts` |
| P9, P10, I8 | deferred as decided | P9 settled by Simon; P10, I8 routed to epic-ledger-workspace entry 9 | none (by decision) |
| I1, I2 | fixed | `transaction-view.ts:42-50`; `ledger-repos.ts:305-314`; `redact.ts:36-49` | nine tests; `redact.test.ts` |
| I3 | fixed (decision 81) | `delete-transaction.ts:40-83` | `hidden-names-transfers.test.ts`, `ledger-repos.test.ts` |
| I4 | not fixed, accepted by Simon at 2.14 | `db/privacy.ts:102` | `classify.test.ts:370` pins the visible name |
| I5, I6, I7 | fixed | `payees.ts:143-147`; `set-splits.ts:95-98`; `manifest.ts:66-70,171-176` | named tests |
| V1 | partly fixed | 9 tables in `no-ledger-schema-read.grit`; `raw-sql-read-rule.test.ts`; `tx-repos-viewer.test.ts` | planted violations fail (checked in the scratch copy) |
| V2, V3 | fixed | `privacy.test.ts` hidden-name, switch and drill worlds | the 13 reverts |
| V4 | accepted | worlds run over HTTP on hand-built data, not the demo seed | n/a |

The recorded 2.18 revert table is a claim in a plan; the scratch run reproduced it for P1 to P8, I1 to I3, I6, I7 and decision 80.

**New findings.** Verdicts are fix now, defer, or accept. "Verified" means re-checked against the primary source or reproduced.

**N1. A person who does not own a public account can add themself as an owner, and rewrite the shares.** *Verified; reclassified on 2026-10-06 from fix now to intended behaviour by Simon's decision: the relationship is not adversarial, so either person may share a public account and remove themself or the other, the removed person is told and can add themself back, and the last owner cannot be removed. Entry 20 now implements that rule instead of forbidding the addition.*
- `requireOnlySelfRemoved` only blocks removal (`update-account.ts:105-117`); `updateAccount` needs only `findVisible`, and a public account is visible to both partners.
- Over HTTP on a real server, B (not an owner) PATCHed A's sole-owned public account to owners `[A 1bp, B 9999bp]` and got 200. B then hid a name of A's transaction (200); A saw the placeholder, and A's unhide returned 409 "hidden by someone else". Neither A nor B can remove the other afterwards (removal is self-only), and A cannot make the account private with two owners.
- This defeats P8 (owner-only hiding) and the intent of P1. The 2.15 triage recorded "anyone can add themself as owner of a public account" as a deferred entry without connecting it to P8.
- Sources: `update-account.ts:62,105-117`; behaviour check step 2 (`behave3/calls.log`); the 2.15 deferred entry; also found independently by the edge-case lens and by the re-verification run (reproduced in a copy).
- Prevention: owner changes by a person require the caller to be an owner already, and share changes need the other owners' consent (or are refused); an ownership rule carries a test for each of add, remove and re-share by a non-owner.

**N2. A hiding can lock out the sole owner of the account.** *Open decision, then fix. Verified.*
- Hiding outlives the hider's ownership and the account's privacy (decision of 2026-10-05), and only the hider may lift it (`hide-name.ts:54-58`).
- Over HTTP: B hid a name on a joint account and removed themself; A, now the sole owner, read only the placeholder and got 409 on unhide and re-hide, while B (no longer an owner) still reads the name and can unhide it (200). If A then makes the account private, B cannot see it and A still cannot lift it. Nobody can until the hiding lapses (up to 12 months).
- The decision protected the hider from a takeover; it did not decide what the remaining owner can do. The pinning test is `db/privacy.test.ts` "keeps a partner's hiding after they leave and the account turns private".
- Prevention: a privacy decision names the actors on both sides of the state it creates.
- **Decision (Simon, 2026-10-06):** if one person leaves, the relationship has ended. Leaving prompts for what to do with each shared account, removes all of the leaver's private accounts, and shows the hidden transactions (hidden names are lifted). That settles the person-leaves-the-household case. It does not say what happens when a person removes themself from one account's owners and stays in the household (the case reproduced over HTTP): open question 1.
- **Decision (Simon, 2026-10-06, account lifecycle):** an account is never orphaned, so the last owner of an account cannot be removed from it; ending an account means closing it. A closed account is kept as a historical record: data can be added and amended up to its closed date and is locked after it, until the account is opened again. A non-zero closing balance is a warning state. Deleting an account is done in settings, only for a closed account, clearly marked destructive, and only after confirmation. State at `6541bc7` for the design: `closeAccount` sets `closedOn` and leaves transactions untouched (`close-account.ts:19`), clearing `closedOn` reopens it (`update-account.ts:45`), there is no write lock after the closed date and no delete use case or route.
- **Decisions (Simon, 2026-10-06, answers to the lifecycle questions):**
  1. A hiding is lifted when its hider leaves the household, not when it is removed from or leaves one account; revised on 2026-10-06 to keep hidings after removal, since the hider can add themself back and lift them, which also ends the lock-out.
  2. Leaving the household deletes all of that person's own private data, after a confirmation that it is the intended action. This path deletes the leaver's private accounts itself; the settings-only delete of closed accounts is the separate, everyday route.
  3. When there is evidence of entries in a closed account after its closed date, the app proposes adjusting the closed date, and also prompts to adjust the date of the manually entered entry instead. It does not refuse outright.
  4. A non-zero closing balance is a warning state shown on the account, in settings and, once the inbox exists, as an inbox item.

**N3. Row counts of the whole database, private rows included, reach partner B, through `/api/system/backup`.** *Fix now. Verified by reading; a successful drill was not exercised end to end.*
- A successful drill stores `restored snapshot … verified N tables, M rows` (`jobs/backup.ts:205-207`); `/api/system/backup` returns the latest drill's summary (`system/backups.ts`, `drill: shown(...)`), and the stored `backup_snapshot` rows carry `tableCount` and `rowCount` (`backups.ts:215-216`) in unscoped audit rows. `M` counts A's private rows, so B's response changes when only A's private data changes: Done when 1 is not met on this route.
- The privacy suite cannot see it. `failedDrillWorld` builds two worlds whose private account differs in an amount, not a row count, and covers only a failed drill; the known-gap test pins only the digest and snapshot id. `tx-repos-viewer.test.ts` lists `backups` and `backupVerifications` as "no ledger data".
- Same family as the deferred digest finding (2.18): `manifestSha256` of the whole database and the restic snapshot id in unscoped `backup_snapshot` audit rows.
- Sources: `backup.ts:205-207`; `backups.ts:215-216,531-544`; `privacy.test.ts` known-gap test; `tx-repos-viewer.test.ts` UNSCOPED_REPOS; found by two lenses.
- Prevention: a route's privacy class follows from the figures it can carry, a summary included (the first retro's P3 lesson, applied to the success path); a differential world per summary a job can store.

**N4. Scheduled check and drill failures now discard their detail, and nothing records it elsewhere.** *Defer (a recorded trade-off). Verified.*
- `failureSummary` replaces `verdict.message` and restic's text in both job paths; no log line or operator-only column keeps them (`backup.ts:71-76`). The "operator path keeps the message" test calls `verifySnapshot` directly, which no scheduled job does. Raised by three lenses; the 2.17 plan recorded the trade-off and the user was told.
- Fix when wanted: an operator-only log line or column, with a test that it never reaches a person's read.

**N5. Deleting one side of a transfer unlinks and audits the other side in the partner's private account, while deleting the group is refused (I3 against P7).** *Accept (decision 81). Verified.*
- Over HTTP B's delete of the shared side returned 204 with no body, and A's private row was unlinked and still readable by A. Decision 81 (the user, 2026-10-05) allows it as invariant upkeep, audited with owner-only scope. Residual: the survivor's audit snapshot is a raw `TransactionRow` without `splits` (`delete-transaction.ts:66-83`), unlike every other transaction audit row, and A learns of the change only through an owner-scoped audit row.

**N6. Smaller defects, each reported by a lens and re-read.** *Defer unless noted.*
- `scopeToPerson` stamps the private era by `(at, id)` (`unit-of-work.ts:147-173`): a clock that steps back across the flip leaves a private-era row unscoped. Order by `rowid` instead. Verified by reading.
- The SQL and memory audit scrub pass valid non-object JSON (a bare string or array) through at the repository layer; only `redact` relabels it (`unit-of-work.ts:~122`). Defence in depth.
- `setPrivacy` to public throws a bare `Error` (a 500) when a private account has other than one owner (`set-privacy.ts:~58`); `requireNoScopedReferences` falls back to the raw person id as a display name for a deactivated owner (`set-privacy.ts:94`). Verified by reading.
- Making a public account private is refused while any split's beneficiary is "shared", the default on a public account (behaviour check step 5): a sole-owner account with default splits cannot go private until each split names the owner. Possibly a product decision (open question).
- Legacy soft-deleted group members keep `transfer_group_id` and block a group delete by foreign key (already a deferred 2.16 entry; the reviewer rated it high, but only dev databases can hold such rows).
- Reported, not re-checked: a refusal that tells the owner to remove a scoped payee that cannot be removed; `propertyId` carry-over on a re-save.

**N7. The read rule still has bypasses, now documented.** *Defer.*
- The raw-SQL scan misses comma joins, interpolated table names, `.sql` files and views; the lint exemption for `classify-repos.ts` and `review-item-repo.ts` is file-wide (only `read-rule.test.ts` narrows it per table); the viewer-first test checks the parameter name `viewer`, not its type, and every viewerless read is allow-listed by a reason that nothing verifies; `balanceAsOf` is exported from the db package with no visibility check. The multi-line and qualified forms were fixed in the 2.18 review.

**N8. A global 30 s test and hook timeout was the CI fix.** *Accept, with a deferred cost item.*
- CI failed on six 5 s timeouts (run `37393717950`, `seed.test.ts` and `demo.test.ts`) because each demo-seed application costs about 1.4 s locally and 4 to 6 s on the runner, while `deploy/install.test.ts` alone runs 130 to 220 s beside it. `develop` alternated red and green over three stories (`3ed41f1`, `fc36bf7`, `84a6699` red). Fixed by `ba762e2` (`vitest.config.ts`, 30 s). The seed's cost (about half Drizzle query building and SQLite `prepare`) is in `deferred-work.md`; a lens suggests scoping the long timeout to the seed suites.

**Process findings.**

| ID | Finding | Source |
|---|---|---|
| R1 | CI was red on `develop` for three consecutive landings (2.17, 2.18, and the base of 2.19) and was caught only at the 2.19 pre-flight; first retro L5 and L6 recurred. | `gh run list`; run `37393717950`; `docs/release-v0.2.1.md` Pre-flight 1 |
| R2 | L7 recurred: 2.16 to 2.19 landed directly on `develop`; only 2.14 and 2.15 used branch and merge. | `git log --graph` |
| R3 | The 2.15 deferral "anyone can add themself as owner" was not connected to P8, which the same epic fixed one story later (N1). Deferred entries are read one story at a time. | `deferred-work.md` (2.15 entries); N1 |
| R4 | A defect class fixed in one place was missed in its twin: the P3 fix covered the failure path of the drill summary, not the success path (N3). | `backup.ts:205-207` against `:71-76` |
| R5 | Plan Change Log is empty in all of 2.14 to 2.19, though the plans record decisions (2.19's Implementation Notes record dropped and added steps; decisions 80 to 83 live in the epic file). L11 recurred. | the six plans |
| R6 | No process lesson of the first retro became a mechanism: no change to `_bmad`, `.claude`, `.github` or lint rules since `3219563` apart from the read-rule allow-list and the 30 s timeout (`git diff --stat 3219563 HEAD -- _bmad .claude .github biome.json`: `biome.json` only). | follow-through below |
| R7 | Strengths. Each remediation story ran a four-lens review whose triage log shows real patches (weak assertions, a flaky test, a multi-line scan, a tag-the-wrong-commit hole in the release page); the revert-run proof for P1 to P8 held up under independent re-run; 2.19 made the manual backup a gate, tagged an explicit CI-green commit on `develop`, and recorded pasted evidence for every step. | plans' Review Triage Logs; mutation run; `docs/release-v0.2.1.md` |

**Lens overlap.** Raw-SQL and parser blind spots: three lenses (N7). The drill count and digest leak: three lenses (N3). The hider lock-out and the add-self hole: two lenses each (N1, N2); the add-self hole was also reproduced in the re-verification copy and over HTTP.

### Second pass: Behavior verification

Run on 2026-10-06 against HEAD `6541bc7`, a real server over real HTTP on `localhost`, with a scratch data directory. Both people signed up through `/api/identity/sign-up`, enrolled TOTP and signed in with real session cookies. The one shortcut: no WebAuthn, so the `auth_passkey` row was inserted into the scratch database as the repo's test helper does. The seed was not used; every account and transaction was created through the API. The server was stopped afterwards and no repo file changed. Driver scripts and `calls.log`: scratchpad `behave3/`.

| Check | Observed | Result |
|---|---|---|
| P1: B removes A from a joint account | 400 "You can only remove yourself"; A removing themself 200 | pass |
| N1: B adds themself to A's sole-owner public account | 200, owners `[A 1bp, B 9999bp]`; B then hides A's name (200); A cannot unhide (409) or remove B (400) | **fail** |
| P8: non-owner hides a name | 400 "Only an owner of the account can hide a name" | pass |
| P2, I1: A hides a name; B reads, edits notes and splits | B sees the placeholder with `fingerprint` and `externalId` null; B's edits 200; A sees the real name and B's note; B editing the description 409 | pass |
| P5: private to public with a private activity in use | 409 naming the activity; after clearing it, 200 | pass |
| P6: public to private with a partner-beneficiary split | 409 | pass (see N6: "shared" also blocks) |
| P4, I6: scoped activity on a public split; a `propertyId` | 409 / 400 via both `setSplits` and `setSplitField` | pass |
| P7: B deletes a group reaching A's private account | 404; A's row stays linked | pass |
| I3: B deletes the shared side of such a transfer | 204 no body; A's private row unlinked and readable by A | pass (decision 81) |
| N2: B hides, then leaves; A (sole owner) reads and unhides | placeholder; 409 on unhide and re-hide; B (not an owner) can still unhide | **surprise** |
| `/api/system/backup`, unconfigured; `/api/system/audit` | 200 `configured:false`; 404 (pending) | as expected |

Narrowed: no restic, so a successful or failed drill was not run end to end (N3 rests on the code and the test world); audit rows are not on HTTP, so I1 over the audit route is not exercised; `v0.2.1` itself was upgraded on pang-dev, which holds no ledger accounts, so the fixes were not seen on a real household's data; the home server was not driven.

### Second pass: Previous-retro follow-through

Items of the first retrospective's action list (owner Simon unless noted), with evidence at HEAD:

1. **Privacy-fixes stories (P1, P3 to P8, I1 to I4, I6, I7, V1, V2, docstring and decision log).** Landed: `8142ac1` (2.14), `b362230` (2.15), `bfd0abb` (2.16), `fc36bf7` (2.17), `84a6699` (2.18); the 2.5 decision is in `story-classify-module-plan.md:80`. P1 landed with the hole N1.
2. **P2 fingerprint.** Landed in 2.14 (`8142ac1`).
3. **A1 spine exception.** Landed: `283f8af`, spine line 55, `scripts/check-boundaries.ts:32`.
4. **A11 "Transfer to <owner>".** Landed: `283f8af` (spine AD-4, `data-model.md`, EXPERIENCE.md).
5. **A12 CAP-16 in covers.** Landed: `2ed2919`, `epic-ledger-accounts-privacy.md:5`. The ticketing "covers subset" check does not exist.
6. **A13 AD-19.** Landed: `2ed2919`, spine line 295 amendment; the manifest keeps its system read, now on the read-rule allow-list.
7. **P9 decision.** Landed: `e8a92b8` (hiding does not hide memos, tags or notes; the hide action warns). Epic-ledger-workspace entry 3's text lists only notes: no evidence it was updated.
8. **Refactor sweep (A2 to A8, I8, P10).** Routed to epic-ledger-workspace entry 9 (`2ed2919`), not done in code, as intended. Since then `memory-uow.ts` grew from 2,011 to 2,123 lines, `unit-of-work.ts` from 1,040 to 1,092; `transaction-view.ts` still imports `list-transactions.ts`; bare `throw new Error` remains in the ledger use cases; no cycle check in lint.
9. **A9 paging routed to epic 12 entries 2 and 6.** Partly: entry 2 has keyset paging; no handoff for audit paging was found in entry 6.
10. **Accepted items (A10, I5, V4).** Recorded; not re-flagged.
11. **L1 "fails without the change" check.** Not landed as a mechanism. A recorded revert run did the work for 2.18.
12. **L2 parity in Done.** Partly: plans 2.14 to 2.16 state it under Always; nothing enforces it.
13. **L3 `as never` lint rule.** Not landed (`biome.json` has none).
14. **L4 stale-plan noise, L8 interleaving gate, L14 verify "done" from the diff.** No evidence found.
15. **L5 red baseline.** Not landed; recurred (R1).
16. **L6 CI watch.** Partly (plans say "e2e in CI order" locally); no watch step; recurred (R1).
17. **L7 branch and merge.** Partly: 2.14 and 2.15 only (R2).
18. **L9 hitl change log and review.** Partly: 2.19 had a review (12 findings); its Plan Change Log is empty (R5).
19. **L10 deployed build.** Partly: for this release the page confirms the starting build and records the digest and backup; not a standing rule.
20. **L11 log renegotiated intent.** Partly: the 2.5 decision was logged; decisions 80 to 83 are in the epic file; the new plans' Plan Change Logs are empty.
21. **L12 decision queue.** Not landed: `deferred-work.md` has 85 entries (70 at the first retro, 15 since), about 66 without a disposition.
22. **L13 failing-case test for every guard.** Partly: 2.16 to 2.18 added guard tests; no convention or lint.

Open questions of the first pass: P9 answered (`e8a92b8`); P2 answered (fixed now); A13 answered (spine amended); the "not checked" items (as-built columns against `data-model.md`, the CI run on `v0.2.0`, the 8-to-11 upgrade) were not re-examined in this pass; the re-run condition (differential covers privacy transitions; read rule tested with planted violations) is met.

### Second pass: Action items

Proposed, not applied. Remediation is for the dev loop; spec reconciliations are Simon's.

**Remediation (fix now; one story under epic 2 is enough)**
1. **N1 (reclassified 2026-10-06).** Replace the self-removal-only owner rule with Simon's relaxed rule (entry 20): either person may share a public account and remove themself or the other, the removed person is told and can add themself back, the last owner cannot be removed. Test add, remove and re-add over HTTP, and the last-owner refusal. Owner: dev loop.
2. **N3 (decision: drop the figures, Simon, 2026-10-06).** Remove the whole-database figures from what a person can read: drop `rowCount`, `tableCount` and `manifestSha256` (and the drill's row counts) from the stored summary and the audit `after`, and add paired worlds for a successful drill and for private row counts. Fold in the digest and snapshot-id deferred entry and the `tx-repos-viewer` "no ledger data" reasons. Owner: dev loop.
3. **N2 and the account lifecycle.** Implement Simon's decisions of 2026-10-06 (see N2): the last owner cannot be removed, closing an account locks writes after its closed date until it is opened again, a non-zero closing balance is a warning, closed accounts are deleted from settings with a destructive confirmation, a closed-date adjustment is proposed (with the entry-date alternative) when entries fall after it, a hiding is lifted when its hider leaves the account, and leaving the household deletes the leaver's private data after confirmation. Test hide, leave and read by the remaining owner; add, amend and delete on a closed account either side of its closed date; and the delete confirmation. Larger than a fix: slice it as its own story or epic. Owner: dev loop; ticketing to slice.

**Deferred (tracked in `deferred-work.md` and routed to the next sweep or a hardening story)**
4. N4 (operator-only record of the dropped detail), N6 items (`scopeToPerson` ordering by `rowid`; non-object audit JSON at the repo layer; `setPrivacy` bare `Error` and the raw-id display name; the "shared" beneficiary block), N7 (read-rule bypasses), N8 (seed cost; scope the timeout). Owner: next sweep (epic-ledger-workspace entry 9) or a hardening ticket.
5. **R3 prevention.** Before closing a story, read the deferred entries it added against the stories still ahead of it in the epic. Owner: Simon, ticketing.

**Accepted (recorded so later retros stop re-flagging them)**
6. N5 (decision 81), I4 (Simon, 2.14), P9, the 2.19 release evidence gaps (no step 10 status paste; privacy fixes not seen on real household data). Owner: Simon (recorded here).

**Process lessons (owner: Simon and the next epic's planning)**
7. **R1, R2.** L5, L6 and L7 recurred: add a CI-watch step and a single landing flow to the build workflow instead of repeating them as lessons. No lesson of the first pass became a mechanism (R6).
8. **R5.** Log decisions in the Plan Change Log when they are made (L11 again), including the epic-file decisions that change a plan's frozen intent.

### Second pass: Acceptance verdict

**Verdict: rejected (machine verdict, confirmed by the human).** Criteria **declared**: the epic file's Done when, items 1 to 5. No ticket is unfinished.

1. **Cross-user reads fail through every route; B is byte-identical; private IDs are NotFound; hidden names lift.** **Not met.**
   - Closed since the first pass: P1, P3 to P8, I1 to I3 and P2, each reproduced and covered by a test that fails on revert.
   - Open: N3 (a successful drill's row count and the digest reach B through `/api/system/backup` and the audit rows, so B's response changes when only A's private data changes) and N1 (a non-owner can take ownership and defeat the owner-only hide).
2. **Read rule through the visibility helpers, enforced by lint or test.** **Met, with deferred bypasses (N7).** Nine tables, a raw-SQL scan, a viewer-first test, each with a planted-violation case; viewerless reads are allow-listed by unverified reasons.
3. **API flows on the seeded ledger.** **Met** (unchanged from the first pass; V4 accepted).
4. **Manifest per-account counts, sums and `balanceAsOf`; a format-1 backup restores.** **Met.** `v0.2.1` on pang-dev wrote a format 2 manifest with `balanceDate` 2026-10-06 and 0 accounts, since pang-dev has no ledger accounts.
5. **Deployed with `pangolin upgrade`; CI green on the release tag.** **Met, with evidence.** `docs/release-v0.2.1.md`: release run `37410053125` green on `ba762e2`, pang-dev upgraded from the `v0.2.0` tag after a recorded manual backup, healthy at schema 11. The first retro's L10 concern is closed for this release.

**Human decision:** Simon, interactive, 2026-10-06. He kept the verdict at **rejected**. Epic 12 (epic-ledger-workspace) waits until action items 1 to 3 are done and the retrospective is re-run; the epic then moves to accepted-with-open-items if nothing new blocks. Decisions given with it: N3, drop the figures; N2, the departure rule recorded above.

### Second pass: Open questions

1. **N2 residual: answered (2026-10-06).** A hiding is lifted when its hider leaves the account; the last owner cannot be removed (close the account instead); leaving the household deletes the leaver's own private data after confirmation. Still open for the story's design: what the household-departure flow does to shared accounts by default, and whether it needs a re-authentication step.
2. **N6: should a public account with only "shared" splits be made private without editing every split?** For a sole owner, "shared" arguably already means the owner. If so, the refusal should treat the sole owner's "shared" split as the owner's.
3. **N3: answered.** Simon chose to drop the figures (2026-10-06).
4. **Not checked in this pass:** the as-built schema against `data-model.md` and the categorisation spec after the 2026-10-05 spec edits; the first pass's "not inspected" CI and upgrade-path items (closed for `v0.2.1` by the release page, not re-examined for `v0.2.0`).


---

# First pass (2026-10-05)

## First pass (2026-10-05): Epic summary

**Epic:** `epic-ledger-accounts-privacy` (epic 2, "Ledger core and privacy"), folder `_bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/`, epic file `epic-ledger-accounts-privacy.md`. Covers CAP-3, CAP-18 and CAP-14; risk high. Its Done when has five items, so the verdict criteria are **declared**.

**Run:** interactive, with a standard pass and no special weighting (the user's choice).

### Tickets

All 13 tickets are at `built` (board state `review`). `pending_tickets` is empty: no ticket is unfinished. None has a story file (`story_file` is null on all of them), so each ticket's description and `verify` in `tickets.toml` is the intent the build received.

| Build order | Ref | Title | Status | Covers | Plan |
|---|---|---|---|---|---|
| 1 | 2.1 | Tracer bullet: one account's transactions, seen per viewer | built | CAP-3, CAP-18 | story-tracer-bullet-one-account-s-transactions-seen-per-viewer-plan.md |
| 2 | 2.2 | Ledger and classification schema | built | CAP-3, CAP-14, CAP-18 | story-ledger-and-classification-schema-plan.md |
| 3 | 2.3 | Privacy core: hidden names, redact and the read rule | built | CAP-3 | story-privacy-core-hidden-names-redact-and-the-read-rule-plan.md |
| 4 | 2.4 | Accounts module | built | CAP-3, CAP-14 | story-accounts-module-plan.md |
| 5 | 2.5 | Classify module | built | CAP-18, CAP-14 | story-classify-module-plan.md |
| 6 | 2.6 | Ledger: transactions | built | CAP-18, CAP-3 | story-ledger-transactions-plan.md |
| 7 | 2.13 | Ledger: splits, provenance, beneficiary and tags | built | CAP-18, CAP-14 | story-ledger-splits-provenance-beneficiary-and-tags-plan.md |
| 8 | 2.7 | Ledger: hidden names and transfer groups | built | CAP-3, CAP-18 | story-ledger-hidden-names-and-transfer-groups-plan.md |
| 9 | 2.9 | Backup manifest: per-account balances | built | CAP-16 | story-backup-manifest-per-account-balances-plan.md |
| 10 | 2.8 | Seed the ledger | built | CAP-18 | story-seed-the-ledger-plan.md |
| 11 | 2.10 | Server-side privacy suite | built | CAP-3 | story-server-side-privacy-suite-plan.md |
| 12 | 2.11 | Refactor sweep | built | (none) | story-refactor-sweep-plan.md |
| 13 | 2.12 | Release and deploy (hitl) | built | CAP-16 | story-release-and-deploy-plan.md |

Build order follows the plans' baselines in history. 2.9's baseline comes before 2.8's, although the ticket order lists 2.8 first. Ticket 2.9 covers CAP-16, which is not in the epic's `covers` (CAP-3, CAP-18, CAP-14).

### Ranges

Each plan's range runs from its `baseline_revision` to the next baseline in history order. All baselines lie on one linear chain: each consecutive pair was checked with `git merge-base --is-ancestor`.

**The cut:** the last plan (2.12) has no recorded end. Its range ends at `3219563` (`chore(merge): story 2.12 into develop`, 2026-10-05 17:41), the last commit that belongs to epic 2. It does not run to `HEAD` (`ca5645e`). The 8 commits after the cut are later work that does not belong to this epic: UX spines, a UX catch-up sprint change proposal, spec and architecture updates and an initiative re-slice (`458f72f`..`ca5645e`). The range end is **inferred**, not recorded. The release tag `v0.2.0` points at `e0d24d2`, which lies inside 2.12's range.

**Overall epic range:** `496e09e4d5b50b28951027ef3b698bae675c6599..3219563ae096de21b66a2fe9f0b070c6d983205d`. It holds 48 commits (12 merges, all measured), 191 files, +36,340 / −3,150 lines across non-merge commits, and no binary revisions.

| Ref | Baseline | Range end | Commits (merges) | Files | +/− (non-merge) |
|---|---|---|---|---|---|
| 2.1 | 496e09e | 1697f3f | 1 (0) | 47 | +4,003 / −46 |
| 2.2 | 1697f3f | 0c424d7 | 3 (2) | 41 | +6,384 / −107 |
| 2.3 | 0c424d7 | 85af142 | 2 (1) | 26 | +1,512 / −133 |
| 2.4 | 85af142 | 2a41bbe | 4 (2) | 51 | +3,687 / −627 |
| 2.5 | 2a41bbe | fbea231 | 2 (1) | 24 | +3,312 / −22 |
| 2.6 | fbea231 | 6ecdf2c | 2 (1) | 21 | +1,278 / −44 |
| 2.13 | 6ecdf2c | d942f9d | 2 (1) | 30 | +5,621 / −45 |
| 2.7 | d942f9d | 56ca9ca | 3 (0) | 14 | +1,122 / −3 |
| 2.9 | 56ca9ca | 6fa4f26 | 2 (0) | 11 | +548 / −25 |
| 2.8 | 6fa4f26 | 06a5288 | 2 (1) | 31 | +3,522 / −313 |
| 2.10 | 06a5288 | 530e426 | 2 (1) | 5 | +2,189 / −0 |
| 2.11 | 530e426 | 93a3f19 | 15 (1) | 40 | +2,742 / −1,761 |
| 2.12 | 93a3f19 | 3219563 (cut, inferred) | 8 (1) | 2 | +420 / −24 |

The per-range commit counts add up to 48, which matches the overall range. No commit appears in more than one range.

**Range observations to carry into Phase 2:**

- **2.1 / 2.2.** 2.2's baseline `1697f3f` is the 2.1 tracer commit on its branch, before it merged. 2.2's range therefore also holds `f67482b` (`chore(merge): story 2.1 into develop`), whose first parent is `496e09e`, along with 2.2's own `236e0b3` and merge `0c424d7`.
- **2.4.** The range holds commits from another epic: `c105215` (`feat(web): TanStack Router shell, ...`) and its merge `2a41bbe` (`chore(merge): story 12.1 into develop`, epic-ledger-workspace). 2.4's own commits are `11e7099` and merge `82e0572`. The web-stack churn in this range (`pnpm-lock.yaml`, `apps/web/src/App.tsx` −513, `apps/web/src/pages/HomePage.tsx` +317) belongs to 12.1, not 2.4.
- **2.7.** No merge commit. Besides `4df1f99` (`feat(ledger): hidden names and manual transfer groups`), the range holds two test-fix commits that do not name the ticket: `0e8a8fe` (`test(deploy): run interactive install tests on a pty under macOS`) and `56ca9ca` (`test(jobs): give the restic push timeout test room to start the stub`).
- **2.9.** No merge commit. It holds `50ac2c6` (`feat(backup): manifest format 2 with per-account balances`) and `6fa4f26` (`test(e2e): sign Alex in for the routing specs, ...`).
- **2.11** has the most commits: 15 (11 refactor/fix/test, 2 docs, the plan commit and the merge).
- **2.12** changes only release documentation: `docs/release-v0.2.0.md` and the plan.

### git_evidence summary, top files by churn (added + deleted, non-merge)

- **Overall:**
  - Generated migration snapshots: `packages/db/migrations/meta/0010_snapshot.json` (+3,324), `0009_snapshot.json` (+3,265) and `0008_snapshot.json` (+1,936).
  - Test files: `packages/db/src/classification-repos.test.ts` (+1,251 / −1,121), `apps/server/src/http/app.test.ts` (+1,237 / −8), `packages/app/src/testing/repo-parity.test.ts` (+1,119), `apps/server/src/admin/seed.test.ts` (+781 / −55) and `apps/server/src/privacy/privacy.test.ts` (+819 / −3).
  - Other code: `packages/app/src/testing/memory-uow.ts` (+1,423 / −131) and `apps/server/src/admin/seed.ts` (+685 / −192).
  - Hotspots touched by many tickets: `apps/server/src/http/app.test.ts`, `packages/app/src/testing/memory-uow.ts` and `apps/server/src/admin/seed.ts`.
- **2.1:** `0008_snapshot.json` +1,936, `packages/db/src/ledger-repos.test.ts` +164, `packages/app/src/ledger/ledger.test.ts` +156, `apps/server/src/admin/seed.test.ts` +146/−8, `apps/server/src/admin/seed.ts` +140/−8.
- **2.2:** `0009_snapshot.json` +3,265, `packages/db/src/classification-repos.test.ts` +604, `packages/app/src/testing/memory-uow.ts` +526/−20, `packages/db/src/classify-repos.ts` +396, `packages/db/src/ledger-repos.ts` +247/−48.
- **2.3:** `packages/db/src/privacy.test.ts` +305, `memory-uow.ts` +170/−15, `packages/db/src/privacy.ts` +157/−14, plan +111, `biome.json` +94. The read rule began as biome overrides.
- **2.4:** `pnpm-lock.yaml` +537/−23 (12.1), `apps/web/src/App.tsx` −513 (12.1), `packages/db/src/accounts.test.ts` +428, `apps/web/src/pages/HomePage.tsx` +317 (12.1), `app.test.ts` +239.
- **2.5:** `packages/db/src/classify.test.ts` +665, `packages/app/src/classify/payees.ts` +379, `app.test.ts` +243, `packages/app/src/classify/defaults.ts` +236, `classification-repos.test.ts` +204/−3.
- **2.6:** `packages/app/src/ledger/ledger.test.ts` +251/−18, `ledger-repos.test.ts` +169, `app.test.ts` +152, `packages/app/src/ledger/update-transaction.ts` +113, plan +106.
- **2.13:** `0010_snapshot.json` +3,324, `packages/app/src/ledger/splits.test.ts` +690, `app.test.ts` +245/−1, `packages/app/src/ledger/set-splits.ts` +193, `set-split-field.ts` +183.
- **2.7:** `packages/app/src/ledger/hidden-names-transfers.test.ts` +308, `app.test.ts` +172, `packages/app/src/ledger/hide-name.ts` +140, plan +109, `transfer-groups.ts` +104.
- **2.9:** `packages/db/src/manifest.test.ts` +198/−2, `packages/db/src/manifest.ts` +161/−13, plan +110, `e2e/routing.spec.ts` +43/−6, `apps/server/src/backup/snapshot.test.ts` +13.
- **2.8:** `seed.test.ts` +611/−46, `seed.ts` +497/−72, `tools/seed/src/modules/ledger-transactions.ts` +482, `tools/seed/src/modules/transfers-and-privacy.ts` +313, `e2e/ledger.spec.ts` +241/−29.
- **2.10:** `apps/server/src/privacy/privacy.test.ts` +816, `privacy-harness.ts` +794, `route-manifest.ts` +469, plan +107, `_bmad-output/implementation-artifacts/deferred-work.md` +3.
- **2.11:** `classification-repos.test.ts` +277/−1,110, `packages/app/src/testing/repo-parity.test.ts` +1,119, `memory-uow.ts` +176/−90, `packages/shared/src/seed-references.test.ts` +163/−34, `packages/app/src/testing/accounts-parity.test.ts` +168/−15.
- **2.12:** `docs/release-v0.2.0.md` +329/−23, plan +91/−1.

Commit `stories` are set only on the `chore(merge): story 2.x into develop` merges. Every other commit carries an empty list, so attribution comes from the range. No merges went unmeasured (`merges_measured` equals `merge_count` in every range), and no range has `binary_revisions`.

The raw JSON for each range is at `/private/tmp/claude-501/-Users-sim-dev-pangolin/b0b0aeb1-efc3-4319-a825-0471708973fc/scratchpad/retro2/`: `evidence-<ref>.json` per range, plus `evidence-overall.json`. The list of ranges is in `ranges.txt` in the same folder.

### Evidence inventory

**Available:**

- **Epic file.** It has Description, Outcome, Done when (5 items), Boundaries, References and Notes, with decisions dated 2026-09-27 and 2026-10-04.
- **Entries.** For all 13 tickets, `tickets.py find` returns the description, `verify` and `covers`.
- **Plans.** All 13 are present, at `status: built` and with a `baseline_revision`.
  - Twelve have a non-empty Review Triage Log; 2.12's Review Triage Log is empty.
  - All 13 have a Verification section.
  - Only 2.9 has a Plan Change Log entry.
- **Diff ranges.** All 13 are established (see above), and git_evidence ran on each range and on the overall range.
- **Release artifacts.** The `v0.2.0` tag (at `e0d24d2`) and `docs/release-v0.2.0.md`, which records the release run, the upgrade, backup and restore evidence, and acceptance.
- **Deferred findings.** `_bmad-output/implementation-artifacts/deferred-work.md` was updated by 2.7, 2.10 and 2.11. 2.11 marked the findings it closed.
- **Requirements source.** The initiative file has no Requirements section; it has Description, Outcome, Done when, Boundaries, References and Notes. The CAP ids are defined in `_bmad-output/specs/spec-pangolin-money/SPEC.md` (CAP-3 at line 36, CAP-14 at 69, CAP-16 at 75, CAP-18 at 81). That spec, together with `data-model.md` and the architecture spine, was edited after the epic's last commit (`c8c0d94`, `ca5645e`, both 2026-10-05). To judge the work against what the build was given, read it as of `3219563`.
- **Session logs** in `~/.claude/projects/-Users-sim-dev-pangolin/`. References only; they were not read in full.
  - `9e54967e-245f-486f-a884-7f0dd80a26fd.jsonl` (about 7.0 MB, started 2026-10-03T21:48Z, last written 2026-10-05 17:41) is the main build session. It mentions every ticket, 2.1 to 2.13, and its folder holds 69 sub-agent logs, 90 of which mention the epic.
  - `ce1e6eb4-b0d1-4d4a-bf4f-a34d41c9289a.jsonl` (about 1.9 MB, started 2026-10-04T06:35Z) is a parallel session centred on 2.7 (93 mentions) and 2.9 (12 mentions), and also mentions 2.5, 2.6 and 2.13. Its folder holds 15 sub-agent logs, 19 of which mention the epic.
  - `43b2d2d1-cf4d-4c68-9b98-36363155e02e.jsonl` (about 10 MB, started 2026-10-02T20:47Z) names the epic folder: it is the inception and slicing session. 9 of its sub-agent logs mention the epic.
  - `b0b0aeb1-efc3-4319-a825-0471708973fc.jsonl` is the current session, started 2026-10-04T21:40Z. It mentions 2.11 and 2.12 and holds this retro.
  - `f52e5760-289b-41ae-a26b-79d3ff9d1ea5`: 3 of its sub-agent logs mention the epic.
- **Previous retrospective (epic 1, the epic before epic 2 in the epics order):** `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/epic-platform-foundations-retrospective.md` (2026-10-02, verdict accepted-with-open-items, criteria declared).
- **Also present:** the epic 11 retrospective, `_bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md` (2026-10-03, accepted-with-open-items). Epic 11 comes after epics 2, 12 and 13 in the epics order, but its retro predates this epic's build, so its action items may also bear on epic 2.

**Missing or narrowed:**

- **Code reviews.** No plan has a `## Code Review` section with dated `### <date>` blocks. Review evidence for each ticket is only its Review Triage Log, so the boundaries between build sessions cannot be read from review dates.
- **2.12** has an empty Review Triage Log: no review was recorded for the release ticket.
- **No story files.** No ticket was refined by a person.
- **Ticket attribution through commits** is limited. Only merge subjects name tickets. 2.7 and 2.9 have no merge commit, and their attribution rests on the range alone.
- **Ranges holding unrelated commits:**
  - 2.4's range holds epic 12's 12.1 web stack (`c105215`, `2a41bbe`).
  - 2.7's range holds two test fixes (`0e8a8fe`, `56ca9ca`) that may belong to platform or ops work.
  - 2.9's range holds an e2e routing fix (`6fa4f26`).
- **2.12's range end** is inferred (cut at `3219563`), not recorded.
- **CI run results** are not in the repository. Evidence for "CI green on the release tag" (Done when 5) is limited to what `docs/release-v0.2.0.md` records; the run itself was not inspected in this phase.
- **Runtime behaviour** was not exercised in this phase.

## First pass (2026-10-05): Findings

All code references are at `3219563`, the end of the epic's range. Findings came from five lenses and the behaviour check:

- **ADV:** adversarial
- **EC:** edge cases
- **VG:** verification gaps
- **AGG:** aggregate views across the range
- **BEH:** the behaviour check
- **PROC:** process (plans, triage logs, sessions)

"Verified" means the finding was re-checked against the primary source at `3219563` before it was routed. No finding was dropped: every cited source held when it was re-opened.

Each finding has two dispositions:

- **Instance:** fix now, defer, or accept.
- **Prevention:** what would stop the next one.

The human (Simon) approved the instance dispositions on 2026-10-05.

### By aggregate view

#### Privacy (cross-ticket boundaries)

**P1. Taking over an account's ownership bypasses hidden names.**

- **What happens:**
  - Either partner can replace a public account's owners through `updateAccount`. `validateOwners` only checks that the shares sum to 100% (`packages/app/src/accounts/inputs.ts:44-59`).
  - The new sole owner can then make the account private with `setPrivacy(private)`.
  - The `hidden` expression needs `account.isPrivate = 0` (`packages/db/src/privacy.ts:93`). So every name the other partner hid is shown to the new owner, who can then make the account public again.
- **Lenses:** ADV#1, EC#5. Verified.
- **Instance:** fix now. This bypasses AD-4 and AD-5, so it blocks acceptance.
- **Prevention:** test privacy as state transitions, not only static states. Extend the two-world differential to ownership and privacy changes (L1).

**P2. The fingerprint leaks a hidden description.**

- **What happens:**
  - `viewColumns` returns `fingerprint` and `externalId` raw, even when the name is hidden (`packages/db/src/ledger-repos.ts:62-64`).
  - The v1 fingerprint is an unsalted `sha256(account|date|amount|description)` (`packages/app/src/ledger/fingerprint.ts:116`).
  - The partner knows every input except the description, so a dictionary guess can recover a hidden name.
  - It is dormant today. Every row is v2, which has no content, and no route in this epic creates v1 rows.
- **Lenses:** ADV#3, EC#1, BEH (latent). Verified.
- **Instance:** fix before epic 3 (imports) at the latest. Fold it into the remediation story if that is cheap.
- **Prevention:** redaction should list the columns a viewer may see, so a new column is not exposed by default. Also make the privacy suite assert the column set (V2).

**P3. Backup drill failure messages name private accounts with their figures.**

- **What happens:**
  - The failure messages give private account ids with transaction counts, sums and balances (`packages/db/src/manifest.ts:~312-330`).
  - They go to the stored drill summary, then to `GET /api/system/backup`, and to an audit row that has no scope.
  - The privacy suite classes that route as "no ledger data".
- **Lenses:** VG#2. Verified.
- **Instance:** fix now.
- **Prevention:** a route's privacy class should follow from the data it can carry, including error and summary text, not from its name.

**P4. A split on a public account accepts an owner-scoped activity.**

- **What happens:**
  - `set-split-field.ts:126` and `set-splits.ts:104` only call `requireActivity`, which does not check the activity's scope against the account.
  - The `activityId` is then returned raw to the partner.
  - Tags and payees do have this scope guard.
- **Lenses:** VG#1. Verified.
- **Instance:** fix now.
- **Prevention:** one shared "scope fits account" guard for every scoped reference (payee, tag, activity, category). A table-driven test should cover each one.

**P5. Making a private account public exposes owner-scoped references.**

- **What happens:** `setPrivacy` from private to public carries owner-scoped payee, tag and activity ids onto a shared account. It also exposes them in past audit rows.
- **Lenses:** ADV#7, ADV#12, VG#4, EC#6. Four lens hits.
- **Instance:** fix now: refuse the change, or promote the references.
- **Prevention:** same as P1, test privacy transitions.

**P6. Making an account private ignores hidden names and beneficiaries.**

- **What happens:**
  - An account can be made private while the partner's hidden names on it are active. This has the same root as P1.
  - It can also be made private while a split's beneficiary is the partner. AD-7 says the beneficiary must be the owner.
- **Lenses:** EC#4, EC#5. Overlaps P1.
- **Instance:** fix with P1.
- **Prevention:** same as P1.

**P7. The partner can delete a transfer group that reaches into a private account.**

- **What happens:**
  - The other member of the group is in the owner's private account, so the delete writes to a private row.
  - `members(id)` has no viewer filter and no `deleted_at` filter.
  - It is listed in the privacy suite's `knownGaps`.
- **Lenses:** ADV#5, EC#9, AGG R-DW1.
- **Instance:** fix now. AD-5 says "reads and writes alike".
- **Prevention:** a `knownGaps` entry against a Done-when criterion should block the epic, not be carried through it.

**P8. Hiding a name does not check that the viewer owns the account.**

- **What happens:** `hideTransactionName` does not check that the viewer is an account owner. The seed enforces this rule; the API does not.
- **Lenses:** AGG D4. Also in the privacy suite's `knownGaps` and deferred in 2.7.
- **Instance:** fix now.
- **Prevention:** a rule the seed validator enforces must also be enforced, and tested, in the use case.

**P9. Hiding a name leaves split memo, tags and notes visible.**

- **What happens:** nothing warns the person hiding the name. The UX spec covers a warning for notes only, not for memo or tags.
- **Lenses:** ADV#6.
- **Instance:** defer to a spec decision: either hide the split memo too, or warn about it (open question).
- **Prevention:** the spec should list exactly which fields a privacy feature covers.

**P10. The system viewer can put another person's scoped payee or tag on a private account.**

- **What happens:** the system viewer can put a payee or tag scoped to person X on person Y's private account (`create-transaction.ts:52-59`, `split-tags.ts:38-45`).
- **Lenses:** EC#7.
- **Instance:** defer. It is a system-only path, and the seed validator guards it.
- **Prevention:** the shared scope guard from P4.

#### Data integrity and audit

**I1. Audit snapshots record the actor's redacted view.**

- **What happens:** audit before/after values are built from the actor's projected `VisibleTransaction` (`auditSnapshot` in `transaction-view.ts`). When a partner edits a hidden row, the audit stores `descriptionRaw` and `payeeId` as null, permanently.
- **Lenses:** ADV#2, EC#10, VG#3.
- **Instance:** fix now.
- **Prevention:** audit records the stored state and is redacted on read. Test partner writes on hidden rows (V2).

**I2. `scrubJson` fails open.**

- **What happens:** it fails open on JSON it cannot parse, and it adds `descriptionRaw` to rows that never had one. The SQL `json_remove` throws on malformed JSON.
- **Lenses:** ADV#14.
- **Instance:** fix with I1.
- **Prevention:** redaction helpers fail closed. Test them on malformed input.

**I3. Deleting one side of a transfer leaves the other side linked.**

- **What happens:** the survivor stays linked to a half-dead group and cannot be relinked.
- **Lenses:** ADV#9, EC#8.
- **Instance:** fix now.
- **Prevention:** add edge-case tests for deleting a member of a group or pair.

**I4. A deleted payee is still shown.**

- **What happens:** the `payeeOk` EXISTS check has no `deleted_at` filter (`packages/db/src/privacy.ts:105`), and neither does the memory mirror.
- **Lenses:** EC#3. Verified.
- **Instance:** fix now.
- **Prevention:** a soft-delete convention that every lookup applies. The parity suite should cover deleted rows.

**I5. The `deletePayee` docstring disagrees with the code.**

- **What happens:** the docstring promises a Conflict when the payee is in use, but the code soft-deletes. The user decided in 2.5 to always soft-delete.
- **Lenses:** PROC#13.
- **Instance:** accept the behaviour. Fix the docstring in the remediation story, and record the decision in 2.5's Plan Change Log.
- **Prevention:** a human change to frozen intent is logged when it is made (L11).

**I6. `setSplits` accepts any `propertyId`.**

- **What happens:** there is no foreign key and no scope check.
- **Lenses:** EC#11.
- **Instance:** fix now: refuse a `propertyId` until properties exist (epic 14).
- **Prevention:** reject a reference whose target does not exist yet. Do not store it unchecked.

**I7. The manifest's `balanceDate` defaults to the UTC date.**

- **What happens:** `buildManifest` falls back to `new Date().toISOString().slice(0, 10)` (`packages/db/src/manifest.ts:160`). The jobs path passes the household clock.
- **Lenses:** ADV#13, EC#12, AGG P5. Verified.
- **Instance:** fix now: make `balanceDate` required.
- **Prevention:** no defaults to the system clock outside the Clock port. A lint rule could enforce it.

**I8. The `needs_review` sync is registered as an import side effect.**

- **What happens:** the registration is at `needs-review.ts:15`, run by `import "./needs-review.ts"` in six places.
- **Lenses:** ADV#10, AGG A5. Also deferred in 2.6.
- **Instance:** defer to a story: register it explicitly at composition.
- **Prevention:** spine convention: no module side effects.

#### Enforcement and verification

**V1. The read rule is narrower than Done when 2 declares.**

- **What happens:**
  - The rule only bans imports of the `account`, `transaction` and `audit-log` schemas.
  - It does not catch raw SQL: `packages/db/src/balance.ts:18-26`, `manifest.ts:139-144` and `privacy-harness.ts`.
  - It does not cover the other AD-3 scoped tables: `split`, `split_tag`, `balance_snapshot`, `review_item`, `transfer_group` and `account_owner`.
  - Inside allowed files, reads without a viewer pass: `owners`, `hasSharedSplit`, `members`, `countOpenForEntity`, `any`.
- **Lenses:** ADV#8, VG#5, AGG R-DW2. Verified for the raw SQL in `balance.ts` and `manifest.ts`.
- **Instance:** fix now.
- **Prevention:** write a Done-when enforcement rule against the full scoped-table list in AD-3, and test the rule with a planted violation of each kind.

**V2. The privacy suite's hidden-name check is thin.**

- **What happens:**
  - It uses one manual v2 transaction and matches by substring.
  - It does not cover rows with a payee or imported rows; the `fingerprint`, memo or `payeeId`; partner writes on hidden rows; or the HTTP audit route.
  - Its differential worlds vary only private data.
- **Lenses:** ADV#4, VG#1, VG#3.
- **Instance:** fix now. Extend the two-world differential to hidden names and partner writes.
- **Prevention:** each Done-when privacy clause gets its own differential test.

**V3. Tests that cannot fail.**

- **What happens:** the reviews of 11 of 12 plans found tests that could not fail.
- **Lenses:** PROC#1.
- **Instance:** handled in remediation by V2. The recurrence is a process lesson.
- **Prevention:** L1.

**V4. Done when 3 was reinterpreted.**

- **What happens:**
  - The API flows were tested on hand-built fixtures.
  - On the real seed they were tested through use cases.
  - Only the list was tested over HTTP on the seed.
- **Lenses:** AGG R-DW3, BEH.
- **Instance:** accept. The behaviour check ran every Done when 3 flow over HTTP on the seed, and all of them passed.
- **Prevention:** a Done-when that names the API gets an HTTP-level test on the seed.

#### Architecture and structure

**A1. A new boundary exception: `packages/app` tests import `packages/db`.**

- **What happens:** `check-boundaries` allows it as `testOnly`, but the spine draws no such arrow.
- **Lenses:** AGG A2.
- **Instance:** reconcile the spine to record the test-only exception. Simon applies it.
- **Prevention:** a boundary exception is added to the spine in the same change that adds it to the checker.

**A2. An import cycle between `transaction-view.ts` and `list-transactions.ts`.**

- **What happens:** one side of the cycle imports types only.
- **Lenses:** AGG A3.
- **Instance:** defer to the next sweep.
- **Prevention:** a cycle check in lint.

**A3. Generic Zod helpers live in `accounts/inputs.ts`.**

- **What happens:** they are re-declared in the ledger module (`dayInput`, `idInput`, about 20 inline).
- **Lenses:** AGG A4, D3.
- **Instance:** defer to the next sweep: move them to a shared `app/inputs`.
- **Prevention:** shared helpers get a home on first reuse.

**A4. The private-owner lookup is written three times.**

- **What happens:** the three copies raise inconsistent errors. The ledger copy throws a plain `Error`, which becomes a 500, where the sweep standardised on `AppError`.
- **Lenses:** AGG D2, P3.
- **Instance:** defer to the next sweep.
- **Prevention:** a lint rule against bare `Error` in use cases.

**A5. Several files grew very large.**

- **What happens:**
  - `memory-uow.ts`: 2,011 lines (28 repos plus constraint emulation)
  - `ports/unit-of-work.ts`: 1,040 lines
  - `http/app.ts`: 815 lines, with 69 routes in one file
  - `seed.ts`: 656 lines
- **Lenses:** AGG G1-G6.
- **Instance:** defer. Split `app.ts` into route files per module and `memory-uow` per module, in the next sweep or in epic 12/13's opening refactor.
- **Prevention:** a size watch in each sweep.

**A6. Business rules live in `app`, not `domain`.**

- **What happens:** the split sum, provenance, fingerprint and `poolOf` rules are in `app`. `packages/domain` is unchanged.
- **Lenses:** AGG P4.
- **Instance:** defer: either reconcile the spine or move the rules.
- **Prevention:** plans name the layer each rule belongs in.

**A7. Ledger use-case tests run on the memory unit of work.**

- **What happens:** the spine convention, which the accounts and classify modules follow, is real SQLite.
- **Lenses:** AGG P1.
- **Instance:** defer: reconcile the convention or move the tests.
- **Prevention:** state the convention in each plan's test approach.

**A8. The memory unit of work duplicates the privacy semantics.**

- **What happens:** the duplicate drifted story after story.
- **Lenses:** AGG D1, PROC#2.
- **Instance:** defer to the next sweep.
- **Prevention:** L2.

**A9. List and audit endpoints are not paged.**

- **What happens:** they have no paging, and the hidden `CASE` expression is inlined repeatedly.
- **Lenses:** ADV#11.
- **Instance:** route to epic 12: entry 2 for paging, entry 6 for audit paging.
- **Prevention:** none beyond the routing.

**A10. `payerOf` is exported and tested but unused.**

- **What happens:** `performedBy` is always null.
- **Lenses:** AGG R-CAP14.
- **Instance:** accept. Later epics consume it.
- **Prevention:** none.

**A11. The "Transfer to <owner>" outflow label goes beyond the spec.**

- **What happens:** the spec only defines "Transfer from".
- **Lenses:** AGG R-CAP3.
- **Instance:** reconcile the spec and AD-4. Simon applies it.
- **Prevention:** a UI wording the spec lacks is raised in the plan.

**A12. CAP-16 is covered by 2.9 and 2.12 but is not in the epic's covers.**

- **What happens:** the epic's `covers` list does not include CAP-16.
- **Lenses:** AGG, PROC#9.
- **Instance:** reconcile the epic's covers through ticketing. Simon applies it.
- **Prevention:** ticketing checks that ticket covers are a subset of the epic's covers.

**A13. The manifest reads balances without a viewer.**

- **What happens:** it uses a viewerless `balanceAsOf` and raw SQL (`manifest.ts:139-160`). AD-19 says "under SystemViewer".
- **Lenses:** AGG R-DW4. Verified.
- **Instance:** reconcile: either change the spine, or route the manifest through `accounts.balanceAsOf(SystemViewer)`. Simon decides.
- **Prevention:** V1's wider read rule would have flagged it.

#### Process (PROC)

| ID | Finding | Prevention |
|---|---|---|
| L1 | Tests that cannot fail recur (11 of 12 plans' reviews). | A "fails without the change" check in the implement step. |
| L2 | The memory mirror's parity drifts every story. | Parity is part of each story's Done. |
| L3 | `as never` casts recur. | A lint rule. |
| L4 | Every review reports "plan file stale" as noise. | Refresh the plan at commit, or tell the lenses to ignore it. |
| L5 | Known red tests were carried for 6 stories. | Fix a red baseline in the first story where it appears. |
| L6 | CI was red on develop through 5 landings, and the user caught it. | Check CI after each push before the next story, and run e2e in CI order. |
| L7 | A parallel session bypassed branch-and-merge (2.7 and 2.9 have no merge commit). | One landing flow, and record parallel sessions. |
| L8 | Out-of-order and cross-epic interleaving (12.1 landed in 2.4's range) caused regressions. | A CI gate when work is interleaved. |
| L9 | 2.12 (hitl release) had no review and no Plan Change Log entry, despite real deviations. | hitl stories still log changes, and release docs get a review. |
| L10 | The home server ran develop builds, so migrations hit real data before the release. The real 8→11 upgrade path is untested. | Record the deployed build, and no develop builds between releases. |
| L11 | A human renegotiation of frozen intent (the 2.5 payee delete) was not logged in the Plan Change Log. | Log it when the decision is made. |
| L12 | 21 deferred items are open, many of them product decisions. | A decision queue with an owner. |
| L13 | A sweep refactor regressed a guard. Review caught it. | Keep a failing-case test for every guard. |
| L14 | A subagent reported "done" when it was stale, and the orchestrator caught it by checking the diff. | Keep verifying from the diff. |

For every PROC finding, the instance disposition is "process change", and the owner is Simon or the next epic's planning (action items 11 to 24).

### By lens

| Lens | Findings |
|---|---|
| ADV (adversarial) | P1, P2, P5, P7, P9, I1, I2, I3, I7, I8, V1, V2, A9 |
| EC (edge cases) | P1, P2, P5, P6, P7, P10, I1, I3, I4, I6, I7 |
| VG (verification gaps) | P3, P4, P5, I1, V1, V2 |
| AGG (aggregate views) | P7, P8, I7, I8, V1, V4, A1-A8, A10-A13 |
| BEH (behaviour check) | P2 (latent), V4 (now evidenced) |
| PROC (process) | I5, V3, A8, A12, L1-L14 |

**Overlaps across lenses**

- **Found by three or more lenses:**
  - P5: ADV ×2, VG, EC
  - P7: ADV, EC, AGG
  - I1: ADV, EC, VG
  - I7: ADV, EC, AGG
  - V1: ADV, VG, AGG
  - P2: ADV, EC, BEH
- **Found by two lenses:** P1, V2, I3, I8 and A8.
- **Same root cause:** P1 and P6 share one.
- **Same gap from two sides:**
  - V2 and V3: the suite's blind spots are the instance, and tests that cannot fail are the pattern.
  - V1 and A13: the read rule's narrowness is what let the manifest's viewerless read through.

## First pass (2026-10-05): Behavior verification

Exercised end to end on 2026-10-05, against a fresh local server:

- **Build:** HEAD `ca5645e`. The commits after the cut at `3219563` change only documentation, so the code is the epic's.
- **Server:** schema 11, seed enabled, two people. The repo's own Playwright specs registered both people and loaded the seed: 11/11 passed.
- **Log:** the full log is in the session scratchpad (`retro2/behaviour.md`).

Results:

- **Health.** `/healthz` and `/api/system/health` both returned 200, with schema 11 and writable. PASS.
- **Done when 1: partner B's responses are byte-identical when only A's private data changes.**
  - Snapshotted 30 of Sam's GET responses.
  - Alex then made six kinds of change in his private account: create, edit notes, split, rename, add a snapshot, and edit the notes on an existing transaction.
  - 0 of the 30 responses differed, byte for byte. PASS.
- **Done when 1: private IDs are NotFound to the partner.**
  - 19 routes were tried with A's private account and transaction ids: reads, writes, splits, tags, name-hidden and transfer groups.
  - All returned 404, with the same body as an unknown id.
  - A's data was intact afterwards.
  - PASS.
- **Done when 1: hidden names lift.**
  - The default hide lasts 12 months. 13 months was refused with 400.
  - The partner's unhide was refused with 409.
  - The partner saw "Hidden until …", with `payeeId` null.
  - After `name_hidden_until` was set into the past in the scratch DB, the name showed. The boundary holds: `until` = today shows the name, and tomorrow still hides it.
  - PASS. The expiry was simulated; no real time passed.
- **Done when 3: over HTTP on the seeded ledger.**
  - **Per-viewer lists:** Alex sees 492 transactions and Sam 494. The 35 and 37 transactions only one of them sees are exactly their private accounts' transactions.
  - **Split:** a split that does not sum to the parent was refused with `remainingCents`; one that sums was accepted.
  - **Tag:** applied, and the partner sees the shared tag.
  - **Beneficiary:** set. An unknown beneficiary and a client-supplied `source` were refused.
  - **Hidden name:** see Done when 1 above.
  - **Manual transfer group:** created. A same-account pair (400) and an already-grouped transaction (409) were refused. The group was deleted.
  - PASS.
- **Done when 4: manifest and restore.**
  - **Manifest:** the production snapshot worker produced format 2 with 7 account entries. The counts and sums match SQL, and 7/7 `balanceCents` match the balance API.
  - **Format-1 restore:** a manifest rewritten to format 1 restored through the real CLI with a stubbed `restic`. The restored server came up and served the data.
  - **Negative control:** a manifest with a sum off by 1 cent was refused, and nothing was swapped in.
  - PASS, with the restic transport stubbed.
- **Web `/ledger`.** It shows rows per viewer, and Sam sees "Hidden until …" on Alex's hidden row. PASS.

What the check narrowed or did not show:

- **Narrowed:**
  - The expiry was simulated.
  - `restic` was stubbed.
  - Sam used a saved session, because a lockout test had locked his password sign-in.
  - Done when 5 (home-server deploy and CI on the tag) was not exercised; it rests on `docs/release-v0.2.0.md`.
- **No functional defect reproduced.** The privacy findings P1, P3 to P8 and I1 were not exercised: the check followed Done when's own scenarios, which do not cover ownership takeover, privacy transitions, drill failure text, scoped activities on splits, or partner writes on hidden rows. That gap is itself the substance of V2.
- **Latent:** P2. Every row is v2 today, so the fingerprint leak can only be reproduced once imports create v1 rows. `retro2/fp.ts` is the check to run then.

## First pass (2026-10-05): Previous-retro follow-through

### Epic 1: `epic-platform-foundations-retrospective.md` (2026-10-02, accepted-with-open-items)

Action items (owner Simon unless noted; remediation through the dev loop):

1. **Make the upgrade copy safe (S1-S3).** Landed: `daad9bd` (story 1.15). 11.11 later moved the copies to the data disk (`fbebbe7`).
2. **Decide the remedy for restore and credentials (S4).** Landed: `bc6ad85` (story 1.16, restore asks about credentials).
3. **Protect secrets across uninstall and reinstall (S6).** Landed: `14ac270` (story 11.1).
4. **Give the AD-27 recovery-bundle warning an owner (R4).** Landed: `cf1548a` (story 1.17).
5. **Add the previous-release migration test (R3).** Landed: `0aa0db4`, the `migrate-previous` job in `release.yml` (story 1.18).
6. **Order the release steps (R5).** Landed: `0aa0db4` (tag only after signing and every gate), plus `2cbecd0`.
7. **Reconcile the spec and tickets (R1, R6-R8).** Landed: `6f628ad` (`docs(spec): reconcile the spec and spine after epic 1`).
8. **Install hardening ticket (S7-S9).** Landed as epic 11: `ce87a7f` (11.3), `5297584` (11.4), `e11801e` (11.5).
9. **Check the suspected seams (S10, S11).** Landed: `084d003` (spike 11.2) and `853d7c2`.
10. **Candidate refactors (A1, A2).** Partly landed:
    - `App.tsx` is gone, through 12.1 (`c105215`).
    - The memory-versus-SQLite parity suite was added and moved (`a4d38bc`, `6d45715`).
    - No evidence found that `install.sh` was split or that one logger is shared.

Process lessons:

- **E2E before a migration:** no evidence it became practice. L6 and L10 repeat it.
- **Docker Hub pull retry:** no evidence found.
- **macOS portability of deploy tests:** landed (`0e8a8fe`, interactive install tests on a pty under macOS).
- **Co-Authored-By convention:** landed. The commit-msg hook rejects the trailer, and that convention is settled.
- **hitl evidence record:** landed. `docs/release-v0.2.0.md` records the release run. L9 notes that 2.12 still lacked a review.
- **Reconcile `deferred-work.md` at epic close:** partly. 2.11 marked the findings it closed (`e4b751b`), but 21 items stay open (L12).

### Epic 11: `epic-platform-hardening-retrospective.md` (2026-10-03, accepted-with-open-items)

1. **Fix F1 (dev loop).** Landed: `fbebbe7` (story 11.11, the reinstall over kept data writes a bundle).
2. **Reconcile the spec and spine with epic 11 (S1; Simon).** Not landed. No reconciling commit was found in the range; the parent's check found the resolver allowlist row still missing.
3. **Close the stale deferred-work entry (S2; Simon or the next dev session).** Not landed. The release-concurrency entry in `deferred-work.md:93-95` still has no `disposition` at `3219563`.
4. **Show Done when 6 on a real host (Simon).** Partly landed: `ab8e039` and `2eef7cf` record the dev-VM run and the kept-data reinstall. The resolver-change check is still open.
5. **Track F2, F4 and F5 (Simon; ticketing).** Landed: `376f2f1` (deferred findings).
6. **Fix F7 (dev loop).** Landed: `fbebbe7` (`render.sh` installed before the allowlist reload).
7. **Fix F8 (dev loop; security).** Landed: `fbebbe7` (copies in `upgrade-copies/` on the data disk).
8. **Fix F13 (dev loop).** Landed: `fbebbe7` (`release.yml` comment corrected).
9. **Track F9-F12 and F14.** Landed: `376f2f1`.
10. **Accepted items recorded (Simon).** Landed: recorded in the epic 11 retro itself, and not re-flagged here.
11. **Process L1/L2: state what a stub must model (next epic's planning).** No evidence found in epic 2's plans. 2.9's stubbed restic tests are the place it would show.

## First pass (2026-10-05): Action items

The human approved all of these on 2026-10-05. There are two kinds:

- **Remediation:** work for the normal dev loop. The retrospective did not run it.
- **Spec reconciliation:** proposed changes for Simon to apply. Nothing was written into the spec or the tickets.

**Gate:** fix the fix-now items first, then re-run this retrospective, then mark epic 2 done. Epic 12 waits until then.

**Remediation (approved, fix now)**

1. **"Epic 2 privacy fixes" story or stories under epic 2.**
   - **Covers:** P1, P6, P3, P4, P5, P7, P8, I1, I2, I3, I4, I6, I7, V1 and V2. Also the I5 docstring fix, and recording the 2.5 soft-delete decision in 2.5's Plan Change Log.
   - **V1:** widen the read rule to the AD-3 scoped tables, raw SQL, and reads without a viewer.
   - **V2:** extend the two-world differential to hidden names, partner writes and the audit route.
   - **Owner:** the dev loop. The story is created through `bmad-preview-ticketing`.
2. **P2, the fingerprint leak.** Stop returning `fingerprint`/`externalId` to a viewer for whom the name is hidden, or salt v1 per household.
   - Fix it before epic 3 at the latest. Include it in item 1's story if that is cheap.
   - **Owner:** the dev loop.

**Spec reconciliations (approved as proposed, awaiting Simon's application)**

3. **A1.** Record the test-only `packages/app` → `packages/db` exception in the spine. Owner: Simon.
4. **A11.** Add the "Transfer to <owner>" outflow label to the spec and AD-4. Owner: Simon.
5. **A12.** Add CAP-16 to epic 2's `covers`. Owner: Simon, through ticketing.
6. **A13.** Reconcile the manifest's viewerless balance path with AD-19: amend the spine, or route the manifest through `accounts.balanceAsOf(SystemViewer)`. Owner: Simon.
7. **P9.** Decide whether hiding a name also hides the split memo and tags, or warns that they stay visible. Owner: Simon. A product decision feeds the UX spec.

**Deferred and accepted (approved)**

8. **Next refactor sweep.**
   - **Covers:** A2 (import cycle), A3 (shared Zod inputs), A4 (one private-owner lookup with `AppError`), A5 (split `app.ts` and `memory-uow.ts`), A6 (rules into domain, or reconcile), A7 (use-case test convention), A8 (memory UoW privacy duplication), I8 (explicit `needs_review` registration) and P10 (system-viewer scope guard).
   - **Owner:** the next sweep.
9. **A9.** Route it to epic 12: entry 2 for paging, entry 6 for audit paging. Owner: epic 12's planning.
10. **Accepted, recorded so later retros stop re-flagging them.** Owner: Simon (recorded here).
    - A10: `payerOf` is unused until later epics.
    - I5: soft-delete payees, per the user's 2.5 decision.
    - V4: Done when 3 is now evidenced over HTTP.

**Process lessons (approved; owner: Simon and the next epic's planning)**

11. **L1. Tests that cannot fail.** The implement step checks that each new test fails without the change.
12. **L2. Memory-mirror parity.** Parity with SQLite is part of each story's Done.
13. **L3. `as never` casts.** Add a lint rule against them.
14. **L4. Stale-plan noise.** Refresh the plan at commit, or tell review lenses to ignore staleness.
15. **L5. Red baseline.** Fix a known red test in the first story it appears in.
16. **L6. CI watch.** Check CI after each push before starting the next story, and run e2e in CI order.
17. **L7. Single landing flow.** Every landing goes through branch-and-merge, and parallel sessions are recorded.
18. **L8. Interleaving.** A CI gate when tickets from different epics interleave.
19. **L9. hitl stories.** Log Plan Change Log entries and review release documentation.
20. **L10. Deployed build.** Record the build on the home server, run no develop builds between releases, and test the real previous-release upgrade path.
21. **L11. Renegotiated intent.** Log a human change to frozen intent in the Plan Change Log when it is made.
22. **L12. Deferred decisions.** Turn the open deferred product decisions into a decision queue with an owner.
23. **L13. Guards.** Every guard keeps a failing-case test, so a refactor cannot silently drop it.
24. **L14. Subagent reports.** Keep verifying "done" from the diff, not from the report.

## First pass (2026-10-05): Acceptance verdict

**Verdict: rejected.** The criteria are **declared**: the epic file's Done when, items 1 to 5.

**Machine verdict: rejected.** No ticket is unfinished (`pending_tickets` is empty; all 13 are `built`). The rejection rests on criteria not fully met and blocking findings unresolved.

**Human decision:** Simon, interactive, 2026-10-05. He kept the verdict at rejected. The path forward: fix the fix-now items (action items 1 and 2), re-run the retrospective, then mark epic 2 done. Epic 12 waits.

Evidence for each Done-when item:

1. **Cross-user reads fail through every route; B is byte-identical; private IDs are NotFound; hidden names lift.** **Not fully met.**
   - The scenarios as written pass: the behaviour check and the 2.10 privacy suite (50 tests).
   - But P1, P3, P4 and P5 break cross-user privacy outside what the tests cover. P6, P7 and P8 add writes and owner checks that AD-5 also requires.
   - So "fail through every API route" does not hold.
2. **No query reads `account`/`transaction` except through the visibility helpers; a lint or test rule enforces it.** **Narrower than declared (V1).**
   - The rule bans only schema imports for three tables.
   - Raw SQL (`balance.ts`, `manifest.ts`), the other AD-3 scoped tables, and reads without a viewer inside allowed files are not covered.
3. **API flows on the seeded ledger.** **Met.** The tests themselves used fixtures and use cases (V4). The behaviour check ran every flow over HTTP on the seed, and all passed.
4. **The manifest carries per-account counts, sums and `balanceAsOf`; a format-1 backup restores.** **Met.**
   - The format-2 manifest matches both the DB and the balance API.
   - Format-1 restored through the real CLI, with restic stubbed. The negative control was refused.
   - Open findings I7 and A13 do not defeat the criterion.
5. **Deployed with `pangolin upgrade`; CI green on the release tag.** **Met, per `docs/release-v0.2.0.md`, with notes.**
   - The CI run itself was not inspected.
   - L10: develop builds ran on the home server before the release, so the real previous-release upgrade path was not what was exercised.

## First pass (2026-10-05): Open questions

- **P9:** should hiding a name also hide the split memo and tags, or only warn that they stay visible? The answer sets whether item 1's story grows or the UX spec changes.
- **P2:** does it wait until epic 3, or is it cheap enough to fold into the remediation story now? The decision allows either; whoever writes the story should confirm.
- **A13:** which direction? Amend AD-19 to allow the manifest's own system read, or route the manifest through `accounts.balanceAsOf(SystemViewer)`. The second would also fall under V1's wider rule.
- **Not checked:** whether the as-built columns match `data-model.md` and the categorisation spec as of `3219563`. Both were edited after the epic's last commit (`c8c0d94`, `ca5645e`). A drift there would add spec reconciliations.
- **Not inspected:** the CI run on `v0.2.0` and the home server's real upgrade path from schema 8 to 11 (L10). Done when 5 rests on the release document.
- **2.12's range end** was inferred as `3219563`. If 2.12 recorded a different end, the range attribution would change, though no finding depends on it.
- **The re-run** should confirm, after remediation:
  - the two-world differential covers privacy transitions (P1, P5, P6)
  - the read rule is tested with planted violations (V1)
