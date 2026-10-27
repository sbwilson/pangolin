---
epic: epic-import-dedupe-transfers
date: 2026-10-21
verdict: rejected
criteria: declared
headless: false
---

# Retrospective: Import, dedupe and transfer matching (epic 3)

## Epic summary

**Tickets (11), from `tickets.py status`:** 3.1 to 3.10 are `built` (state `review`, nobody has called them done); 3.11 (Release v0.2.4) was closed `done` on 2026-10-21 (`5e8e94c`) before this run. `pending_tickets` is empty, so nothing forces the machine verdict. The user first declined to retro with 3.11 open, then closed it.

**Un-ticketed follow-ups built inside the epic's window** (plans in `_bmad-output/v6-archive/implementation-artifacts/`, not in the tree): derived opening-balance snapshots, join check and `opening-balance` command (`3d6a901`, `plan-m1-opening-balance.md`); ledger balance line in `m1-report` (`1253a8f`, `plan-m1-closing-balance.md`); e2e fixes `e41b6d4`, `30f1256`, `f495879`.

**Plan ranges** (each plan's `baseline_revision` to the next baseline in history order; one commit per ticket except where noted; git evidence JSON for each range was derived with `git_evidence.py`):

| Ticket | Range | Commits | Volume |
| --- | --- | --- | --- |
| 3.1 | `a137429..f83666c` | 1 | +3,068 / −11, 27 files |
| 3.2 | `f83666c..7e9fb1d` | 1 | +2,804 / −69, 24 files |
| 3.3 | `7e9fb1d..d8fb8ad` | 1 | +2,964 / −792, 21 files |
| 3.4 | `d8fb8ad..ae88689` | 4 (incl. fixes `7d6dbce`, `22a1e74`, tooling `ae88689`) | +11,754 / −54, 50 files |
| 3.5 | `ae88689..f6933d1` | 1 | +1,158 / −0, 15 files |
| 3.6 | `f6933d1..187f748` | 1 | +5,584 / −8, 25 files |
| 3.7 | `187f748..db50e8e` | 1 | +5,032 / −115, 37 files |
| 3.8 | `db50e8e..391d9e4` | 1 | +2,992 / −285, 52 files |
| 3.9 | `391d9e4..171a4d2` | 1 | +1,774 / −35, 24 files |
| 3.10 | `171a4d2..e41b6d4` (recorded cut: ticket work ends at `db68f5d`; `3d6a901` and `e41b6d4` are follow-ups) | 3 | +11,832 / −887, 57 files |
| 3.11 | `e41b6d4..HEAD` (inferred; release docs, e2e fixes, ledger balance, closure) | 11 | +617 / −44, 13 files |

No merges in any range (`merge_count` 0). 3.4's and 3.10's ranges carry volume that includes generated test fixtures and the 3.10 parser move.

**Evidence inventory.** Available: epic file with Done when; initiative requirements; every ticket's plan with Review Triage Log; commits; CI run history (`gh run list`); the release record `docs/release-v0.2.4.md`; deferred-work ledger (127 entries). Missing or narrowed: no per-session logs as files (process findings below rest on commits, CI runs, plans and this conversation's record, and are marked as such); no dependency-cruiser or madge (a custom import-cycle script was used); the behaviour check could not run the system (see Behavior verification); the previous-retro check read the previous epic's file only (`epic-platform-hardening`).

## Findings

Each finding has a source and two dispositions: this instance (**fix now**, **defer**, **accept**) and what would prevent the next one. Sub-agent reports were re-checked against primary sources where marked *verified*.

### Spec and boundary findings

**F1. Overlapping CSV imports re-commit rows (blocking). Fix now.** *Verified by running a probe test.* File A (3 rows) then overlapping file B (2 shared rows plus 1 new), both `commbank_csv` without ids, gave `r1 = 3 new / 0 dup`, `r2 = 3 new / 0 dup`, 6 transactions where 4 were correct. Cause: `occurrenceMap` is seeded from existing ledger rows (`packages/app/src/imports/import-statement.ts:279-346`), so a shared row gets occurrence 1 and a fingerprint that matches no existing one; only rows with an `externalId` (OFX) dedupe across files. Epic Done when 2 and spine AD-20 require an overlapping range to add zero rows. The tests that claim to cover overlap use OFX with FITIDs (`import-statement.test.ts:267`, `:705`). The 3.5 implementer's hand-back flagged exactly this ("a different file that overlaps an earlier import can still re-commit identical rows"); it was treated as existing behaviour and never routed (see P3). *Would prevent:* dedupe tests without external ids; route every "known, not touched" note from a hand-back into the ledger at triage.

**F2. Undo cannot be followed by a corrected re-import, and undo is unreachable. Fix now (or reconcile the docs).** *Verified.* Dedupe reads include soft-deleted rows (`ledger-repos.ts` `listForDedupe` has no `deletedAt` filter, by AD-20) and the file-hash gate returns the old batch for any non-failed status (`import-statement.ts:197`). So "undo the import, then import a corrected file", which the Balance gap card says (`apps/web/src/components/review/ReadOnlyCard.tsx:12`) and `docs/m1-gate.md:82` tells the operator, silently drops every unchanged row of the corrected file and blocks an identical one. Separately `undoImportBatch` has no route, CLI command or UI, so the remedy is also unreachable (no hit in `apps/server/src/http/app.ts` or `admin/commands.ts`); `import.balance_gap` has no action in `review-actions.ts`, so the item and the partner chip's count never clear on a shared account. The user chose "re-import blocked in v1" at 3.7 planning; the later remedy text contradicted that choice. *Would prevent:* test each documented remedy end to end before writing it into a card or runbook.

**F3. `importStatement` ignores the closed-account lock; the epic's own handoff required it. Fix now.** *Verified (no `requireOpenOn`/`closedOn` in the file).* The epic Notes (Handoff 2026-10-06) say an import must not commit entries dated after `closedOn` and must surface the choice or skip them to review. `set-aside.ts:136` and `undo-batch.ts:61` enforce the lock, so rows an import commits after `closedOn` cannot then be fixed or undone, and the opening snapshot dated after it would be refused by `recordBalanceSnapshot`. No test covers a closed account. A requirement carried in epic Notes was dropped by every ticket; none of the 3.x plans cite it. *Would prevent:* copy epic handoff Notes into the covering ticket's entry.

**F4. Ambiguous-transfer items can disclose a partner's private transaction. Fix now.** *Verified in code.* `matchTransfersForBatch` builds its candidate pool from every account the importer can see, private ones included (`match-transfers.ts:130-139`), and raises an account-scoped `import.transfer_ambiguous` item on the new transaction (`:146-152`). When that transaction is on a shared account the partner sees the item and the shared-count chip, which reveals that a private opposite-amount transaction exists within three days. The 3.5 triage cleared only the auto-link case. *Would prevent:* each new review kind states which viewers see it and what the existence of the item reveals.

**F5. Set-aside fix path diverges from the import path. Defer.** `fixSetAsideRow` passes an empty claimed set to the probable-duplicate check (`set-aside.ts:228`), never updates `firstPostedOn`/`lastPostedOn`, never recomputes reconcile (a batch that ever had set-aside rows stays `unavailable` and counts under `joinsUnchecked` in `m1-report.ts`), and does not check `batch.undoneAt` (`set-aside.ts:109`, `:349`; *verified: no `undoneAt`/status check there*). Reachable from HTTP only via an open item, which undo resolves, so exposure is low.

**F6. Sign convention and liabilities. Defer.** *Verified.* `parsers/generic-csv.ts:177-190` inverts the amount for `signConvention: "inverted"` but not the printed balance; nothing in import or reconcile reads `account.type`, so a credit-card CSV could reconcile as `gap` or derive a positive opening (AD-12 says liabilities are negative). The generic format is not reachable from the UI (3.9 plan), so exposure is low today.

**F7. Admin commands are not privacy-minimised. Defer; ask the human.** `m1GateReport` runs as the system viewer and prints private accounts' names, ids and balances; `opening-balance` returns "already has a snapshot dated X" for any account id (`admin/commands.ts`, `cli.ts` `printM1Report`; reported by the boundary review, not re-run). Safe if the operator is trusted; a leak if the operator is one partner and the other's private accounts matter.

**F8. Hand-off status is unobservable over HTTP and AD-5 is only proven at use-case level. Defer.** `listMyHandoffs` has no route (*verified*); the byte-identical check compares the sender's use-case reads before and after accept (`handoff.test.ts:123-146`); the HTTP privacy test checks status codes only (`privacy.test.ts:1072-1105`). Done when 5 is met in substance but not through a route.

**F9. Accepted dropped boundaries (ledgered).** The Needs review chip and "N need review" link on `/transactions` (`TransactionList.tsx:234` still disabled), the Import button beside Transactions search, the stale-row Import shortcut, undo from Needs review, the generic-CSV mapping UI. All appear in `deferred-work.md`. Recorded so later retros stop re-flagging them.

### Aggregate views

**A1. Duplicated parsers (accept with a decision).** Seven formats exist twice: `packages/importers/src/parsers/*` (1,192 lines, exercised by `importers.test.ts` and `cli.test.ts` only) and `packages/app/src/imports/parsers/*` (686 lines, production). The 3.10 plan excluded deduplication because the boundary rules bar `app` from importing `importers` (`story-milestone-m1-gate-…-plan.md:36`). Two copies will drift. *Decision needed:* delete the importers parsers (keep generators and fixtures) or move them into a package `app` may import.

**A2. Other duplication. Defer.** `sha256Hex` (about 60 hand-rolled lines) in `packages/domain/src/dedupe/fingerprint.ts:43` and `packages/app/src/ledger/fingerprint.ts:46`, with `FINGERPRINT_VERSION` defined in both; the exported `dayKey()` in `match-transfers.ts:43` bypassed by two inline copies in `import-statement.ts` (`:292`, `:315`); occurrence counting and the transaction/split literal repeated between `import-statement.ts` and `set-aside.ts:143-190`; `plural`/"need review" text in `ImportSummary.tsx:23` and `ReviewPage.tsx:7`.

**A3. Size growth. Defer.** Real sizes: `packages/app/src/testing/memory-uow.ts` 3,052 lines (+498 this epic), `ports/unit-of-work.ts` 1,679 (+313; 32 repo interfaces), `apps/server/src/http/app.ts` 1,005 (+132, with 15 near-identical `/api/review/*` routes), `db/src/ledger-repos.ts` 1,109, `app/src/index.ts` 836, `cli.ts` 785. `import-statement.ts` fell from about 1,250 to 564 after the 3.10 split. No new file is large.

**A4. Architecture delta (checked and clean).** `scripts/check-boundaries.ts` and `biome.json` unchanged in the range; no new layering exceptions; no cycles; no `app` to `db` imports outside parity tests. One note: `packages/app/package.json` gained `./testing/*` exports consumed by server test harnesses, and no rule stops production code importing them.

**A5. Pattern divergence (mostly clean).** `AppError` for use-case errors, plain `Error` only for invariants (pre-existing pattern); every mutating import use case audits; repos take the viewer first. The VIEWERLESS allow-list in `tx-repos-viewer.test.ts` grew by about 20 entries, all with reasons; its section comment "Reads with no viewer: the only ones" is stale.

**A6. Spec reconciliation.** Met: PDF all-or-nothing untouched; transfer ±3 days (`domain/transfers/match-transfers.ts:4`); partner-pending counts shared-visible items only (`review-view.ts:262`); identity notices migrated and `/api/identity/notices` removed; freshness from `import_batch` (`list-accounts.ts:45`); release done and CI green on the tag. Partly met: see Done when below. Reconciliation proposed: the epic text "restoring unlinked transfers" on undo appears nowhere in code (the survivor is unlinked, not restored); `docs/m1-gate.md` should state the accepted start and Mastercard exception.

### Process findings (from commits, CI runs and plans; no session-log files)

**P1. Green CI was not a condition of "built"; e2e specs were written but never run.** CI failed on `7d6dbce` (3.4 follow-up: lint/types), then on `391d9e4` (3.8), `171a4d2` (3.9) and `db68f5d` (3.10) in `Container and end-to-end`, then on `1f62e5d` and `30f1256`, and went green only at `f495879` (CI run IDs in `docs/release-v0.2.4.md` pre-flight, item 4). Four ticket plans recorded "e2e not run" in their hand-backs. Three tickets shipped red and the failures (a duplicate CSP guard registration, an e2e that polluted the seed, a too-strict assertion) surfaced only at release prep. *Would prevent:* a CI-green check before a ticket moves to `built`, or a way to run Playwright in the dev loop.

**P2. Plans carried semantic gaps that review, not planning, found.** The 3.9 plan defined "N need review" as `dupCount + setAsideCount` (wrong: skipped duplicates raise no item), which needed a human amendment of the frozen intent mid-review (`story-import-popover-…-plan.md` Triage Log); the hand-off copy said "her" from the UX spec; "unexplained gap" was never defined in any spec before 3.10; remedy text (F2) was never tested. *Would prevent:* plans state the meaning of any derived count and test any remedy they document.

**P3. Hand-back risks were not routed.** The 3.5 hand-back stated the F1 overlap defect plainly; the 3.6 and 3.7 hand-backs listed other known gaps. Triage judged each "existing behaviour", and only some reached `deferred-work.md`. F1 survived to release.

**P4. The deferred-work ledger has 127 entries and no owner or triage rhythm** (`grep -c "^- source_plan"`). Several entries are fixes the epic's own Done when needed (F3). `bmad-loop-sweep` exists for this.

**P5. Release page assumed a starting state nobody had checked.** `docs/release-v0.2.4.md` was drafted for `v0.2.3` / schema 15; `pang-dev` was on the develop build `db68f5d` (image `pangolin:local`) at schema 20 because the M1 data had been imported ahead of the release. The pre-upgrade snapshot ID was not recorded and was recovered afterwards from `restic snapshots` (`4aad527d`). An early mid-session inference that the real data was not on pang-dev was wrong and was corrected. *Would prevent:* read the host's `pangolin status` before drafting the release page; record the snapshot ID in the same command that takes it.

**P6. Real design work happened outside tickets.** Derived opening balances, join checks and the `opening-balance` command (migration 0020), and the ledger balance line, were decided and built between 3.10 and 3.11 with plan files in `implementation-artifacts/` only. They were reviewed and tested, but the tree does not list them. *Would prevent:* file them as tickets before building.

**What worked.** One squashed commit per ticket made ranges exact; each ticket's four-lens review found real defects (privacy of hand-offs, closed-lock in undo, set-aside false gaps, stale review items on sender leave); the M1 tooling found real holes and led to the opening-balance decision with actual data; the Needs review inbox, notices migration and import popover shipped and passed CI e2e and axe; v0.2.4 deployed with `check:upgrade`, signature verification and a backup chain.

## Behavior verification

Runtime behaviour was **not exercised by this retro** (no running system here). Observed evidence from the record, not re-run: (1) CI run 39576002990 on `f495879`: all jobs green, including the Playwright specs for import, review and axe; (2) the release run 39579069460 green on `v0.2.4`; (3) on `pang-dev`: `pangolin upgrade v0.2.4` succeeded, `pangolin status` reports `v0.2.4` / schema 21 / readiness ok, `/healthz` ok, post-upgrade backup manifest `format 2` / `schemaVersion 21`; (4) `pangolin m1-report` on four real (de-identified) accounts reported 0 holes, 0 broken batches, 0 join breaks after the accepted opening balances. The one behaviour I did run was the F1 probe, in the memory unit of work. Not checked anywhere: overlapping CSV import against the real stack, a closed-account import, an undone-then-corrected import.

## Previous-retro follow-through

Previous epic in order: `epic-platform-hardening` (`epic-platform-hardening-retrospective.md`, verdict accepted-with-open-items). Its 11 action items:

1. Fix F1, write a bundle on reinstall with a changed backup server (dev loop): **landed**, `deploy/uninstall.sh:221-239` keeps `.bundle-pending` when it keeps secrets.
2. Reconcile spine and ops docs with the epic (user): **no evidence found.**
3. Close the stale deferred-work entry for release concurrency (user): **no evidence found** for that entry (other entries carry `disposition: fixed`, `deferred-work.md:4`).
4. Show Done when 6 on a real host (user): **partly landed**, a tagged release and `pangolin upgrade` of `pang-dev` are recorded (`docs/release-v0.2.3.md`, `docs/release-v0.2.4.md`); no record found of the uninstall/reinstall (11.1) or resolver change (11.4) on the host.
5. Track deferred cross-ticket findings F2, F4, F5 (user): **no evidence found.**
6. Fix F7, copy `render.sh` before the allowlist reload (dev loop): **landed**, `deploy/install.sh:1404-1408`.
7. Fix F8, keep pre-upgrade and rolled-back copies on the data root (dev loop): **landed**, `deploy/pangolin:104-108` uses `$DATA_VOL/upgrade-copies`; the live host shows `/srv/pangolin/upgrade-copies/`.
8. Fix F13, correct the `release.yml` comment (dev loop): **landed**, `.github/workflows/release.yml:9`.
9. Track F9 to F12 and F14 (user): **no evidence found.**
10. Accepted deviations recorded (DNS widening, `latest` from tags, mixed deploy versions): recorded, nothing to land.
11. Process: plans that stub a system state what the stub models; deleting steps name whose state they touch (next epic's planning): **no evidence found** in this epic's plans.

## Action items

Proposed, not applied. "Dev loop" means a story or fix for the normal build loop.

1. **Fix F1** (blocking): dedupe for sources without external ids across files, with CSV overlap tests, including identical same-day rows; re-check Done when 2. Owner: dev loop. Priority before the next real overlapping import.
2. **Fix F3**: apply the closed-account lock in `importStatement` (surface the choice or send rows to review); test a closed account; cite the epic handoff. Owner: dev loop.
3. **Fix F4**: scope ambiguity items so a private candidate never creates a partner-visible signal. Owner: dev loop.
4. **Resolve F2**: either route and button for undo plus a defined re-import-after-undo (dedupe ignoring rows soft-deleted by an undo), or change the Balance gap card and `docs/m1-gate.md` to say what actually works. Owner: user decides the direction, then dev loop.
5. **Decide A1**: delete the `packages/importers` parsers or move them behind a package `app` may import. Owner: user (architecture).
6. **Spec reconciliation (human applies):** correct the epic's "restoring unlinked transfers" wording; record in `docs/m1-gate.md` the accepted "start from an opening balance" and the Mastercard exception; record the sign-off in the gate's decision row (still "Open" in the repo, `docs/m1-gate.md:134-140`). Owner: user.
7. **Mark tickets 3.1 to 3.10 done or reopen them** per this verdict; close the epic through ticketing. Owner: user.
8. **Triage `deferred-work.md`** (127 entries): run `bmad-loop-sweep`, give F3 and F5 to the dev loop. Owner: user.
9. **File F5, F6, F7, F8 and A2 to A3** as backlog stories or deferred entries with the evidence above. Owner: user decides; ticketing files them.
10. **Process:** (a) require green CI (including Playwright) before a ticket reaches `built`, or add a local way to run it; (b) at triage, route every "known, not touched" note from a hand-back into the ledger; (c) plans define derived counts and test documented remedies; (d) file out-of-ticket design work as tickets first; (e) read the host's real state before drafting a release page. Owner: next epic's planning and the loop configuration.

## Acceptance verdict

**Rejected (machine verdict), criteria declared.** No ticket is unfinished, so the rejection comes from the criteria and a blocking finding, not from `pending_tickets`. Done when from the epic file:

1. *Twelve months of real data, no unexplained balance gaps (M1 gate):* **not met as written.** Four accounts imported (22, 10, 22, 25 months covered); machine check is zero holes, broken batches and join breaks only after accepted opening balances, none starts on 1 July 2024 (first statements 2024-10-18, 2025-01-02, 2025-01-03, 2026-01-13), and Mastercard has no balance chain. The gate's decision row is still open in the repo. The user stated acceptance of "starting from somewhere" in the conversation; nothing in the repo records it.
2. *Each format imports its sample; re-import and overlapping range add zero rows; set-aside works:* **not met.** Samples, identical re-import and set-aside are tested; overlapping CSV is broken (F1).
3. *Identical coffees stay two; transfers linked or sent to review; categorisation order; rule offer:* **met** (3.4, 3.5 tests; F4 is a privacy defect inside it).
4. *Needs review shows every registered kind, e2e clears an item, partner count shared-only, notices migrated:* **met** (CI e2e green; the clearing test depends on a notice left by `recovery.spec`).
5. *Hand-off visible only to the partner; sender responses byte-identical (AD-5):* **met at use-case level, not over HTTP** (F8).
6. *Deployed with `pangolin upgrade`, CI green on the tag:* **met** (with recorded deviations).

A human decision overrides this verdict.

**Human decisions recorded 2026-10-21 (Simon Wilson):** the epic is **held until fixed**, so the verdict stays **rejected** and is not overridden. The fixes F1, F3 and F4, the re-import-after-undo change (F2) and the admin-command privacy change (F7) are to be done before the epic is accepted.

## Open questions

Answered by the user on 2026-10-21:

1. **Verdict override.** Hold until fixed. The verdict stays rejected.
2. **F2 direction.** An undone batch's rows must be re-importable: dedupe ignores rows an undo soft-deleted, and the file-hash gate no longer blocks an undone batch's file. (This reverses the 3.7 planning choice "blocked in v1".)
3. **F7.** Yes: the operator commands (`m1-report`, `opening-balance`) must respect privacy. How the operator is identified to the system is still to be designed.

Still open (the user found the question unclear; clarified in the conversation):

4. **A1.** Which parser copy survives. Recommendation: keep the copy in `packages/app/src/imports/parsers/` (the one production runs), delete the parsers in `packages/importers`, keep its generators and fixtures, and port its parser unit tests to the app copy.
5. **M1 gate record.** What the repo's gate record should say and who signs it. Recommendation: fill `docs/m1-gate.md` from the `m1-report` output and the user's decisions: accounts begin at their first CSV statement with an opening balance because bank CSV exports reach back only so far, the Mastercard opening of $0.00 is the user's own assertion, the later PDF statements may extend history; the decision row is signed by the user.

## Follow-up since the retrospective (2026-10-22)

The user held the epic until the blocking findings were fixed. What landed, each with its own plan, four-lens review and green suite, on `develop` (local commits, not yet pushed at the time of writing):

| Finding | Fix | Commit |
| --- | --- | --- |
| A1 duplicate parsers | One copy kept (`packages/app/src/imports/parsers/`), importers parsers deleted, 49 parser tests ported | `0fa5efc` |
| F1 overlapping CSV re-commits rows; F2 re-import after undo | Occurrence numbered by file position only; undo tombstones the keys of the rows it undoes (hand-deleted lines stay blocked); probe reproduced and fixed; SQLite and OFX covered | `faabe17` |
| F3 closed-account lock; F4 private transfer candidates | Rows after `closedOn` set aside with a reason; private-involved ambiguities raise a person-scoped item with its own entity ref; paired-world privacy test | `5f9d281` |
| F7 operator commands | `m1-report` and `opening-balance` require `--as <name>` and run as that person's viewer | `7053571` |

Still open (deferred, in `deferred-work.md` or this document): F5 (set-aside fix path), F6 (sign convention and liability accounts), F8 (hand-off status over HTTP), the set-aside occurrence rule, the AD-20 spec reconciliation, the importer popover's count omitting the private ambiguity item, ticket status (3.1 to 3.10 still `built`), and the M1 gate decision row, which the user signs. Done when 2 (overlapping range adds zero rows) is now met in tests; Done when 1 remains an accepted exception pending the user's sign-off; Done when 5 is met in substance but not over HTTP.

The verdict above is unchanged (**rejected**, machine) because only the user may override it. Its blocking cause (F1) is fixed.
