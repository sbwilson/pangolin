---
title: 'Widen the read rule and privacy suite'
type: 'chore'
ticket: '18'
created: '2026-10-06'
status: 'built'
baseline_revision: 'fc36bf7033db54ddb959496fc371950ed6bd3002'
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

**Problem:** The read rule covers only `account`, `transaction` and `audit_log` schema imports, so scoped tables (split, split_tag, balance_snapshot, review_item, transfer_group, account_owner) and raw SQL escape it, and `TxRepos` reads can omit the viewer. The two-world differential misses hidden names, B's writes on hidden rows, owner and privacy switches, audit reads and a failed drill, so reverting fixes P1–P8, I1, I2 and decision 80 would pass (retro V1, V2).

**Approach:** Widen the static rule to every AD-3 scoped table and to raw SQL with a reasoned allow-list, and require every `TxRepos` scoped read to take the viewer first or be allow-listed with a reason. Add the missing worlds to the differential, then prove it by temporarily reverting each fix and recording the run in this plan.

## Boundaries & Constraints

**Always:** each allow-list entry carries a one-line reason. The raw-SQL allow-list is balance.ts, manifest.ts (amended AD-19), the privacy harness, and the viewerless `upkeepMembers` read (decision 81). Audit is exercised through `listAudit` (`packages/app/src/system/list-audit.ts`); `/api/system/audit` stays `pending` for epic 12 entries 6 and 7. I3, I5, I6 and I7 are outside the revert check, and so is I4: decision 2.14 leaves it unfixed (a soft-deleted payee keeps its name and logo), so there is nothing to revert and no test pins it. `classify-repos.ts` and `review-item-repo.ts` are allow-listed for the widened schema rule, each with the reason that it applies its own viewer filter (`visibleTxnId`, `visibleReviewItems`).

**Never:** change product behaviour or fix a leak here; a world that exposes one is reported, not patched. Do not register an audit, search or export route. Leave reverted fixes restored: no revert survives in the tree.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Schema import | A non-allow-listed file imports any scoped table's schema | Lint and the db grep test flag it | Fails the build |
| Raw SQL | A non-allow-listed file names account, transaction or audit_log in SQL | The new test names the file and line | Fails the test |
| Viewerless read | A `TxRepos` scoped read without a leading viewer, not allow-listed | The test names the method | Fails the test |
| Hidden-name worlds | Worlds differ in a hidden description and payee on a shared, payee-bearing, imported transaction | B's reads byte-identical | Differential reports the keys |
| B writes on hidden rows | B edits, splits, deletes, tags that row | Same outcome in both worlds | As above |
| Owner change and setPrivacy | Worlds differ by an owner change, or by setPrivacy either way | B's reads and `listAudit(B)` identical | As above |
| Failed drill | Worlds differ in a private account's sum | Stored drill summary and `/api/system/backup` identical for B | As above |
| Fix reverted | Any of P1–P8, I1, I2, decision 80 reverted | The suite or the rule fails | Recorded in Implementation Notes |

</frozen-after-approval>

## Code Map

- `tools/lint/no-ledger-schema-read.grit` + `biome.json:~211-224` -- schema-import rule (regex names three tables; allow-list is `includes` globs). `scripts/biome-restrictions.test.ts:~35-136,~235` -- probe cases to extend.
- `packages/db/src/read-rule.test.ts` -- `DIRECT_READ` regex and `ALLOWED` (privacy.ts, ledger-repos.ts, unit-of-work.ts); asserts account-owner is NOT matched today. Also home of the new raw-SQL test.
- Scoped-table importers: `classify-repos.ts:27-28` (split, splitTag), `review-item-repo.ts:5` (reviewItem), `ledger-repos.ts`, `privacy.ts`, `unit-of-work.ts`. Raw SQL: `balance.ts:13-30`, `manifest.ts:89-155,460`, `privacy.ts`, `unit-of-work.ts:158-168`, `apps/server/src/privacy/privacy-harness.ts` (l.236-281, 527, 617, 763).
- `packages/app/src/ports/unit-of-work.ts:1022-1081` -- `TxRepos` and `ReadRepos`. Without a viewer: `AccountRepo.any, owners, hasSplitForOthers, scopedReferences`; `TransferGroupRepo.upkeepMembers, delete`; `ReviewItemRepo.countOpenForEntity, resolveOpenForEntity`; `AuditRepo.append, scopeToPerson`; `TransactionRepo` write helpers. Each is allow-listed with a reason.
- `apps/server/src/privacy/privacy-harness.ts` -- `buildWorld(seed, variant)` :312, `applyDelta` :662, `World` :179, `leakyWorld` :490. `privacy.test.ts` -- `readTranscript` (~:50, adds `listAudit(B)`), `identicalProblems`, deliberate-leak group :694+. `route-manifest.ts` -- `knownGaps`, `pending` :339-355.
- `apps/server/src/jobs/backup.test.ts:362-600` -- drill helpers (`runner`, `backUp`, tamper stored copy) are file-local; no world builder. Factor into a shared test helper for the drill world.
- Fix locations to revert: `packages/app/src/accounts/{update-account,set-privacy}.ts`, `packages/db/src/privacy.ts` (+ `testing/memory-uow.ts` mirror), `packages/db/src/ledger-repos.ts` and `packages/app/src/redact.ts` (P2, I2), `findStored` users in `packages/app/src/ledger/*` (I1), `ledger/{set-splits,set-split-field,split-targets,delete-transaction,transfer-groups,hide-name}.ts` (P4, P7, P8), `apps/server/src/jobs/backup.ts` (P3).
- Do not change: product code, `write.ts`, the manifest format.

## Tasks & Acceptance

**Execution:**
- [ ] `tools/lint/no-ledger-schema-read.grit`, `biome.json`, `read-rule.test.ts`, `scripts/biome-restrictions.test.ts` -- cover all six scoped tables; allow-list with reasons; probes
- [ ] `packages/db/src/read-rule.test.ts` (or a sibling) -- raw-SQL scan with a reasoned allow-list; proves failure on a planted read
- [ ] `packages/app/src/ports/` test -- every `TxRepos` scoped read takes `viewer` first or is allow-listed; proves failure on a planted method
- [ ] `apps/server/src/privacy/privacy-harness.ts`, `privacy.test.ts` -- worlds: hidden-name, B's writes on hidden rows, owner change, setPrivacy both ways, `listAudit(B)` reads, failed drill
- [ ] Revert run -- revert each of P1–P8, I1, I2, decision 80 in turn, run the suite, restore, record in Implementation Notes

**Acceptance Criteria:**
- Given a deliberate raw-SQL read or a viewerless scoped read outside the allow-list, when lint and tests run, then they fail.
- Given any listed fix reverted, when the privacy suite runs, then it fails, shown by the recorded revert run.
- Given the restored tree, when `pnpm lint`, `pnpm typecheck` and `pnpm test` run, then all pass.

## Implementation Notes

**Rule.** `no-ledger-schema-read.grit` now names all nine scoped tables; `biome.json` allow-lists `classify-repos.ts` (viewer filter `visibleTxnId`) and `review-item-repo.ts` (`visibleReviewItems`), with the reasons in the grit header and in `read-rule.test.ts` (biome.json takes no comments). `read-rule.test.ts` has the same regex, a reasoned `ALLOWED` map, a planted-import failure case and a stale-entry check. `scripts/biome-restrictions.test.ts` probes every table and the two exceptions (a sibling file is still flagged). The widened grit was run against the old probe file set with the old regex and failed 13 cases, so the probes can fail.

**Raw SQL.** `packages/db/src/raw-sql-read-rule.test.ts` scans every non-test source under apps, packages, tools, scripts, e2e and deploy for FROM, JOIN, INTO, UPDATE, TABLE or REFERENCES followed by a scoped table. The scan finds exactly `balance.ts`, `manifest.ts` and `privacy-harness.ts`, which are the allow-list; a planted read names its file and line. `upkeepMembers` is drizzle, not text, so the scan cannot see it: it is allow-listed in the TxRepos test (decision 81).

**TxRepos.** `packages/app/src/ports/tx-repos-viewer.test.ts` reads `ports/unit-of-work.ts` as source. Ten scoped repositories (audit, reviewItems, accounts, transactions, balanceSnapshots, transferGroups, tags, activities, payees, payeeAliases) must take `viewer` first or be in `VIEWERLESS` with a reason, writes included; every other `TxRepos` key must be listed as unscoped with a reason, so a new repository cannot slip past. It also fails on a stale entry. Beyond the plan's list, `PayeeRepo.clearDefaultCategory` and `PayeeAliasRepo.softDeleteForPayee` (the two route-manifest known-gap cascades) and the four `insert` methods of the classification repos are allow-listed.

**Worlds.** New `privacy-scenarios.ts` (no SQL) and additions to `privacy-harness.ts` and `privacy.test.ts`; `testing/backup-drill.ts` is the shared drill helper, and `backup.test.ts` now uses it. Each scenario runs in two worlds that differ in one flavour, compares B's reads at checkpoints (all GET routes, extra paths, the repo row, `listAudit(B)`) and asserts the outcomes:
- hidden-name: description, payee, external ID and v1 fingerprint of a shared imported transaction; B edits, splits, categorises, tags and deletes it; the audit rows must keep the stored description and payee; planted audit rows (bare string, array, object without name keys) must fail closed.
- switch: B strips A from a joint account (400), A removes themself, B makes it private and public (name stays hidden); a private account with a private activity refuses to go public (409) and goes public once cleared (private-era audit rows stay A's); a public account refuses a private activity on a split (setSplitField and setSplits), B hiding a name on an account B does not own, and going private with a shared or B-owned split (all refused); its joint-era audit rows stay readable by B and its private-era rows do not.
- failed drill: a private account's sum differs per flavour, the stored copy is altered, the drill fails; the stored summary, `/api/system/backup`, backup audit rows and review items must match for B and name no figure or account id.
`audit_log` has a CHECK that `before` and `after` are valid JSON, so text that is not JSON cannot be planted; that path is covered by `redact.test.ts` only. P7 (transfer-group delete) is held by the existing cascade test, which already expects the 404.

**Revert run** (each fix reverted in turn in the product code, `pnpm vitest run apps/server/src/privacy/privacy.test.ts`, then `git checkout` of the file; the tree was clean after). Every row failed the suite:

| Fix | Revert applied | Failing tests |
|---|---|---|
| P1 owners | drop `requireOnlySelfRemoved` call (`update-account.ts`) | switch: step outcomes |
| P1/P6 hiding outlives switches | reverse-apply `privacy.ts` hunks of b362230 | switch: checkpoints, hidden name stays hidden |
| P2 fingerprint | `viewColumns` returns raw fingerprint and external ID | hidden-name: reads, B's writes, never shows secrets |
| P2 audit read | `json_replace` no longer nulls fingerprint and external ID | hidden-name: reads, never shows secrets |
| P3 drill summary | summary carries `verdict.message` (`backup.ts`) | drill: summary, figures, B's reads |
| P4 activity scope | `requireActivity` ignores `isPublic` | switch: steps, checkpoints, audit rows |
| P5 scoped refs | drop `requireNoScopedReferences` | switch: steps, checkpoints, audit rows |
| P6 beneficiary | `ne(owner)` back to `eq(shared)`; and check removed | switch: steps, audit rows |
| P7 transfer group | drop `hidden > 0` refusal | cascade test (404 expected) |
| P8 hide name | drop owner check (`hide-name.ts`) | switch: steps, audit rows |
| I1 audit true row | `storedTransaction` returns the actor's nulled view | hidden-name: stored audit rows |
| I2 scrubJson | old fail-open `scrubJson` | hidden-name: fail closed, reads, never shows secrets |
| Decision 80 | drop `scopeToPerson`; and stamp every row (no `since`) | switch: checkpoints and audit rows; audit rows |

I3, I4, I5, I6 and I7 were not reverted, as agreed.

**Findings for the human (not patched).** The manifest digest (`manifestSha256`) and the restic snapshot id sit in unscoped `backup_snapshot` audit rows that B reads. The digest covers the whole database, private rows included, so it differs between the paired drill worlds. It cannot be inverted, but it is a byte difference B can see. The drill comparison names both as `<digest>` and does not compare them.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough: blind-hunter, edge-case-hunter, verification-gap, intent-alignment). Counts: high 0, medium 3, low 9, false 7, maybe-false 0. verification-gap found no gap of its own; its other findings are triaged below.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Digest and restic snapshot id are masked in the drill comparison, so the known leak is tracked only in a comment (blind, edge, VG, intent) | medium | patch | The mask makes the suite green on a channel B can read; pin it with a known-gap test that fails when the leak closes. |
| The leak itself: `manifestSha256` of the whole database reaches B in unscoped `backup_snapshot` audit rows | medium | defer | Pre-existing product behaviour, verified by the new drill world (the digest differs between worlds). Not this change's to fix (plan Never). Logged in deferred-work. |
| Exemptions for `classify-repos.ts` and `review-item-repo.ts` are file-wide; the reason is prose (blind, edge, VG) | medium | patch | Either file could import `account` or `audit_log` and pass lint and the grep test. The test gets a per-file table list; lint stays per file (grit cannot narrow by table). The classify reason is also inexact (`replaceForSplit` reads `split_tag` under the tag scope filter): reworded. |
| Raw-SQL scan is line-by-line, misses multi-line and qualified names, skips any dir named `schema`/`migrations` (blind, edge, VG) | medium | patch | A template with `FROM` and the table on separate lines passes. Match across lines, accept a qualifier, skip two paths only. Comma joins and interpolated table names stay out: a comma rule would flag JS arrays. |
| `DIRECT_READ` lacks `require(`, unlike the grit plugin (edge) | low | patch | One-token correction; the two rules should agree. |
| `TxRepos` parser skips a member not written `readonly name: Type;` (edge) | low | patch | A repository added in another form is silently unchecked; report unmatched statements. |
| listAudit key branch can be skipped on a rename; a non-200 `B splits it` crashes opaquely; drill test title claims counts (blind, edge) | low | patch | Three one-line hardenings in the test files. |
| Viewer param checked by name only; trailing `//` comments can corrupt the parser (blind, edge) | low | rejected | The port file has no such comment; typing the first parameter adds a rule the port does not need. |
| payee, tag, activity not in the schema rule though `SCOPED_REPOS` treats them as scoped (blind, edge) | false | rejected | AD-3 names account-scoped tables (transaction, split, balance_snapshot, review_item, audit_log); payee, tag and activity are person-scoped under AD-18/22 and not AD-3 tables. |
| Grit omits the schema barrel (blind) | false | rejected | `DIRECT_READ` in `pnpm test` flags the barrel and always did; lint never did. |
| No negative control for the switch and drill worlds (blind) | low | rejected | The recorded revert run is the control: reverting P1/P4–P6/P8/decision 80 and P3 fails those worlds. |
| Hidden-name world does not probe search, payee merge, re-import dedupe (blind) | false | rejected | Search is `pending` for epic 12 and dedupe belongs to epic 3; the intent names none of them. |
| Weak bounds (`>= 12`), hand-built rows, copied fingerprint formula (blind) | low | rejected | The bounds follow the writes the scenario makes; building the row by hand is what makes an imported, payee-bearing, fingerprinted row possible without the importer. |
| `String(1000)` substring may false-positive (blind, edge) | false | rejected | Ids are deterministic in the harness and the test passes on both worlds; a collision would be stable, not flaky. |
| Cleanup order, tamper changing zero rows, spread world, hardcoded timezone, pass-through wrappers (blind, edge) | false | rejected | A zero-row tamper makes the drill pass and fails the "fails the manifest check" test; the timezone and wrappers copy the old `backup.test.ts`; lint passes (no unused imports). |
| Raw-SQL allow-list omits `upkeepMembers` though the plan lists it (edge, intent) | false | rejected | It is drizzle, not text; allow-listed in `tx-repos-viewer.test.ts` and stated in the header. |
| Revert proof is not a repeatable artifact; no semantic enforcement (intent) | false | rejected | The intent says the revert run is recorded in the plan; it is, and B1 is what the approach states. |
| Housekeeping: unused `_id`, `Flavour` doc, probe line numbers, no AD-3 text change (blind) | low | rejected | Cosmetic; lint passes; AD-3 already states the rule. |

## Design Notes

The `TxRepos` check is an AST or source scan of `ports/unit-of-work.ts`: a method without a leading `viewer` must be in the allow-list, writes included, so an addition cannot slip past. A world that finds a real leak is a finding for the human, not a patch here.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean
- `pnpm typecheck` -- expected: no errors
- `pnpm vitest run` -- expected: pass
