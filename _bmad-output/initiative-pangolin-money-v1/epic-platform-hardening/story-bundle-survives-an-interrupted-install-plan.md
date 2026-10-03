---
title: 'Bundle survives an interrupted install'
type: 'bugfix'
ticket: '3'
created: '2026-10-03'
status: done
baseline_revision: '44f6f1edeb5944c5847f0a441a826c0b1fa0164c'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `install.sh` writes the recovery bundle only in the run that generated the secrets (or with `--bundle`). If a first install dies after generating them and before `write_bundle`, every re-run keeps the secrets and never writes or announces a bundle, and since story 1.17 it even adds a bundle id and asks the user to confirm a bundle that does not exist. A bundle written before a backup server was configured lacks `RESTIC_REPOSITORY` and is never rewritten when one is added (retro S7).

**Approach:** Mark generated secrets as "bundle pending" until a bundle has been written for them, and have a re-run write and announce the bundle while that mark is present. A re-run that sets or changes the backup server writes a new bundle (new id) so it carries `RESTIC_REPOSITORY`.

## Boundaries & Constraints

**Always:** The pending mark is created in the same run step that generates a secret, before anything later can fail, and removed only after the bundle file is in place. Each bundle written gets a new id, as today, so the storage warning returns until it is confirmed. An existing install with no pending mark and no backup change behaves exactly as today (no bundle written).

**Never:** Write a bundle on every re-run. Keep the mark anywhere the container can read (it stays root's, beside the secrets). Change the bundle's contents or format beyond what it already writes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Interrupted first install | secrets generated, run died before `write_bundle` | the re-run writes the bundle, sets its id, shows the bundle notice in the summary, and clears the mark; no "confirm the bundle you already have" message | No error |
| Normal first install | uninterrupted | bundle written once; mark removed; a plain re-run writes nothing | No error |
| Backup added later | first install without `--backup-server`, re-run with one | new bundle with `RESTIC_REPOSITORY` and a new id; notice shown | No error |
| Backup changed | re-run with a different `--backup-server` | new bundle with the new repository and a new id | No error |
| Backup unchanged | re-run with the same value, or no flag | no bundle written | No error |
| Pre-existing install | no mark, no backup change | unchanged from today (an id is added if missing, no bundle) | No error |

</frozen-after-approval>

## Code Map

- `deploy/install.sh` `generate_secrets` (~770-795) -- when a secret is generated (`GENERATED=1`), create `$INSTALL_DIR/secrets/.bundle-pending` (0600, root's) right after the `mv` of the new secret.
- `deploy/install.sh` `write_bundle` (~828) -- write when `GENERATED=1`, `BUNDLE=1`, the pending mark exists, or the backup repository changed this run (new flag, e.g. `BACKUP_CHANGED=1`); remove the mark after `mv "$bundle.new" "$bundle"`.
- `deploy/install.sh` settings/`settle BACKUP PANGOLIN_BACKUP_REPOSITORY` (~405-420, ~552) and `write_env` (~905-925) -- set `BACKUP_CHANGED=1` when the run's non-empty `BACKUP` differs from `existing PANGOLIN_BACKUP_REPOSITORY` before `.env` is updated.
- `deploy/install.sh` `write_env` (~928) -- the "add an id when missing" branch must also skip when a bundle will be written this run (mark present or `BACKUP_CHANGED=1`), so `NEW_BUNDLE_ID` and its "confirm the bundle you already have" summary never fire alongside a real bundle.
- `deploy/install.sh` `summary` (~1360-1380) -- the existing bundle notice (keyed on `BUNDLE_PATH`) covers the new cases; for a backup change say the bundle was rewritten to include the backup repository.
- `deploy/uninstall.sh` -- keeps only the three secret files when the data is kept (story 11.1); the mark is deliberately not kept. Check nothing there needs changing.
- `deploy/install.test.ts` -- the bundle-id tests (`describe("install.sh, recovery bundle id")`) and the `bundles()` helper; simulate an interrupted install by running a first install, then deleting the bundle and its id from `.env` and creating the mark (or failing a later step with a stub, if the test harness has one).
- `docs/install.md` §7 (recovery bundle) and the `--backup-server` row -- one sentence each.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/install.sh` -- pending mark, backup-change rewrite, write_env guard, summary wording
- [x] `deploy/install.test.ts` -- every matrix row
- [x] `docs/install.md` -- the two cases

**Acceptance Criteria:**
- Given any of the matrix's runs, when `.env` and `/root` are read afterwards, then `PANGOLIN_RECOVERY_BUNDLE_ID` names the bundle last written and that bundle's `Bundle id:` line matches it.

## Implementation Notes

- `BACKUP_CHANGED` is set only when `.env` already exists. With no `.env` the run is either a first install (the new secrets already write a bundle) or a reinstall over secrets `uninstall.sh --keep-data` kept, where today's behaviour (an id, no bundle) is kept, per the "pre-existing install" row and the existing reinstall test.
- The summary's "Rewritten to include the backup repository" line is keyed on `BACKUP_CHANGED`.
- Review fixes: the pending mark is made before a new secret is written, before `write_env` saves a changed backup server, and at the start of every `write_bundle`, so any interrupted bundle write is retried; `uninstall.sh --keep-data` keeps `.bundle-pending` with the secrets.
- The interrupted-install test makes a real interruption: `/root` staged as a file, so `write_bundle` fails after the secrets and `.env` are written.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 2, low 5, false 1, rejected low 2, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | A re-run that changed the backup server and died after `write_env` saved it, before the bundle was in place, was never retried (the next run sees `.env` current); the same for `--bundle` dying after the id was written. The mark is now set whenever a bundle is due. |
| medium | patch (done) | `uninstall.sh --keep-data` deleted `.bundle-pending`, so an interrupted install reinstalled over the kept secrets never got a bundle. The mark is now kept. |
| low | patch (done) | The mark was created after the new secret's `mv`: a kill in between left a secret with no mark. |
| low | patch (done) | The "Rewritten to include the backup repository" line keyed on the first reason only, so `--bundle` plus a backup change dropped it. |
| low | patch (done) | Summary and docs did not mention the interrupted-install retry; the mark was described as first-install only. Docs now also point an install interrupted before this change, or one with a hand-edited backup server, to `--bundle`. |
| low | patch (done) | The `BACKUP_CHANGED` guard in `write_env` was unpinned (it only affects stdout). |
| low | patch (done) | Missing edge tests: a later regenerated secret sets the mark; `--backup-server ""` is not a change; the unchanged run leaves no mark and no "Rewritten" line. |
| false | rejected | A pre-existing install interrupted before this change still takes the id-only path: the frozen matrix keeps pre-existing installs unchanged, and nothing tells it from a normal pre-1.17 install; the docs now point it to `--bundle`. |
| low | rejected | A backup server added by editing `.env` by hand is not detected (state rather than event): the frozen Approach is event-based; the docs point to `--bundle`. |
| low | rejected | `BACKUP_CHANGED` repeats `settle`'s comparison: one line beside it; moving it into `settle` adds a key-specific branch there. |

## Verification

**Commands:**
- `npx vitest run deploy/install.test.ts deploy/uninstall.test.ts` -- expected: pass, except the 2 interactive install tests that already fail on macOS
- `shellcheck -S warning deploy/install.sh` -- expected: clean
