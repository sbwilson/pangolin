---
title: 'Retrospective fixes: bundle on reinstall, firewall reload order, database copies on the data disk'
type: 'bugfix'
ticket: '11'
created: '2026-10-03'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The hardening epic's retrospective found three cross-ticket defects. (F1) A reinstall over data that `uninstall.sh` kept, with a changed `--backup-server`, writes no recovery bundle: `BACKUP_CHANGED` needs a `.env`, which uninstall removed, and the kept secrets mean none are generated. (F7) `write_files` reloads the firewall from `write_allowlist` before it copies the new `render.sh`, so that reload runs the previous release's script. (F8) `pangolin upgrade` keeps its pre-upgrade and rolled-back copies of the household database under `/opt/pangolin`, on the unencrypted system disk, although the docs say they are in the data volume. Also (F13) the `release.yml` comment says a cancelled waiting run's tag "must be pushed again", which fires nothing.

**Approach:** (F1) Treat a run with kept secrets, no `.env` and a non-empty backup server as a backup change, so it writes a bundle with that repository. (F7) Copy `render.sh` (and the firewall units) before `write_allowlist` runs. (F8) Keep the pre-upgrade and rolled-back copies in a root-owned 0700 `upgrade-copies/` directory inside the data root, and on the next upgrade move any found under `/opt/pangolin` there. (F13) Fix the comment: delete and re-push the tag, or re-run the cancelled run.

## Boundaries & Constraints

**Always:** The copies stay root's and 0700, never readable by the container user; pruning keeps the last two of each kind, as today; a failed move of an old copy warns and leaves it where it is, never deletes it. The upgrade's existing order and rollback guarantees (story 1.15, 11.8) are unchanged apart from the directory. A plain reinstall over kept data with the same backup server still writes no bundle.

**Never:** Put the copies anywhere the backup or restore code reads (`backup/` in the data root) or name them like the live database files. Change the other deferred findings (F2, F4, F5, F9–F12, F14).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kept-data reinstall, new backup server | secrets kept, no `.env`, `--backup-server B` | a bundle with `RESTIC_REPOSITORY=B` and a new id; no "confirm the bundle you already have" | No error |
| Kept-data reinstall, no or same backup server | secrets kept, no `.env` | no bundle (as today, story 11.1) | No error |
| Re-run that changes the allowlist | backup added, changed or turned off | the reload in `write_allowlist` runs the render.sh this run installs | No error |
| Upgrade | data root `/srv/pangolin` | pre-upgrade copy in `/srv/pangolin/upgrade-copies/pre-upgrade-<stamp>/` (0700, root) | copy failures abort as today |
| Rollback | failed health check | the upgraded database kept in `…/upgrade-copies/rolled-back-<stamp>/`; messages name that path | as story 11.8 |
| Old copies present | `/opt/pangolin/pre-upgrade-*` or `rolled-back-*` exist | moved into `upgrade-copies/` on the next upgrade, then pruned to two of each | a failed move warns and leaves it |

</frozen-after-approval>

## Code Map

- `deploy/install.sh` `settle_all` (~579-588) -- `BACKUP_CHANGED` is set only when `.env` exists, on the assumption that "a first install's new secrets already write one". Also set it when there is no `.env`, the secrets are all present (`has_secret` for the three; the kept-secrets case of story 11.1) and `BACKUP` is non-empty. Check `write_env`'s "add an id when missing" branch then skips (it already skips when `BACKUP_CHANGED=1`).
- `deploy/install.sh` `write_files` (~1366-1376) -- `write_allowlist` runs before `cp "$SUPPORT/firewall/render.sh" …`; move the render.sh copy (and the unit copies from `install_files`/the units loop, if `apply_allowlist_now` depends on them; check) before `write_allowlist`. `apply_allowlist_now` (~1088) runs `$INSTALL_DIR/firewall/render.sh` via the allowlist unit.
- `deploy/pangolin` (~100-146 copy, ~192-201 rollback) -- `DATA_VOL` is the host path of the data volume. Set `COPIES_DIR="$DATA_VOL/upgrade-copies"`, created root 0700 (no `-p` reuse of a wrong-mode dir: create if missing, then `chmod 700`, `chown 0:0`); `BACKUP_DIR="$COPIES_DIR/pre-upgrade-$STAMP"`, `ROLLED_DIR="$COPIES_DIR/rolled-back-$STAMP"`; the two prune lines point there. Before creating the new copy, move `"$HOME_DIR"/pre-upgrade-*` and `"$HOME_DIR"/rolled-back-*` into `$COPIES_DIR` (`mv`; on failure warn and continue). The script runs as root on the host; the copies are made by `docker run --user 0` with `$BACKUP_DIR` mounted, as today.
- `apps/server/src/backup/paths.ts` -- the app uses `backup/` and the database file names in the data root; `upgrade-copies/` must not collide. Check nothing in the server lists the data root.
- `.github/workflows/release.yml` ~7-9 -- the comment.
- `docs/install.md` -- the upgrade paragraph (~591-597: "inside the data volume" becomes true; paths `/opt/pangolin/pre-upgrade-*`, `rolled-back-*` → `<data root>/upgrade-copies/…`; old ones moved on the next upgrade).
- Tests: `deploy/install.test.ts` (kept-data reinstall: see the "reinstalls on the data and secrets uninstall.sh kept" test ~1165; the write order: a stub `systemctl`/render.sh recording which render.sh the reload ran is not available under `--root` — test the order by asserting the new render.sh is in place before the allowlist step's reload, e.g. a staged run with `PANGOLIN_INSTALL_STUB_DOCKER` that logs, or by checking `write_files`' order directly if no harness reaches the reload); `deploy/pangolin.test.ts` (copy and rolled-back paths under the data dir, modes, migration of old copies, pruning; the existing rollback tests and S11d).

## Tasks & Acceptance

**Execution:**
- [ ] `deploy/install.sh` -- F1 backup change on a kept-data reinstall; F7 render.sh before the allowlist reload
- [ ] `deploy/pangolin` -- F8 copies under the data root, old ones moved
- [ ] `.github/workflows/release.yml` -- F13 comment
- [ ] tests and `docs/install.md` -- every matrix row

**Acceptance Criteria:**
- Given the full deploy test suite, when it runs, then the existing upgrade, rollback and S11d tests pass with the new paths, and the new tests cover each matrix row.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run deploy` -- expected: pass, except the 2 interactive install tests that fail on macOS
- `shellcheck -S warning deploy/install.sh deploy/pangolin` -- expected: clean
- `pnpm lint` -- expected: the existing 7 warnings
