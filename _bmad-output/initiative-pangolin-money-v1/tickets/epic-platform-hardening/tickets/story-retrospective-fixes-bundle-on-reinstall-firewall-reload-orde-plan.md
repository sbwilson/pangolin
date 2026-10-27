---
title: 'Retrospective fixes: bundle on reinstall, firewall reload order, database copies on the data disk'
type: 'bugfix'
ticket: '11'
created: '2026-10-03'
status: done
baseline_revision: '5c2dbc92ba5158edc16e43f9d6aae11c062e5172'
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
- [x] `deploy/install.sh` -- F1 backup change on a kept-data reinstall; F7 render.sh before the allowlist reload
- [x] `deploy/pangolin` -- F8 copies under the data root, old ones moved
- [x] `.github/workflows/release.yml` -- F13 comment
- [x] tests and `docs/install.md` -- every matrix row

**Acceptance Criteria:**
- Given the full deploy test suite, when it runs, then the existing upgrade, rollback and S11d tests pass with the new paths, and the new tests cover each matrix row.

## Implementation Notes

- F1: `settle_all` sets `BACKUP_CHANGED=1` when there is no `.env`, every secret is kept (`kept_secrets`) and `BACKUP` is non-empty, unless uninstall.sh's record names the same server (see the change log). `write_env`'s id-only branch already skips on `BACKUP_CHANGED=1`, so the "bundle you already have" message does not appear.
- F7: `write_files` installs `render.sh` (via `render.sh.new` + `mv`) before `write_allowlist`. The unit copies stay after it: `apply_allowlist_now` only runs `systemctl start pangolin-allowlist.service` with no `daemon-reload`, so copying new unit files earlier would change nothing but make systemd warn that the loaded unit changed on disk; the unit's `ExecStart` path is fixed. The earlier reloads (`allow_package_mirrors`, `allow_build_hosts`, before `locate_support`) still run the installed render.sh; out of scope.
- F8: `deploy/pangolin` creates `$DATA_VOL/upgrade-copies` (refused if it is a symlink or not a directory, before anything is stopped), `chmod 700`, `chown 0:0` as root only (as install.sh's `own`), moves old `/opt/pangolin/{pre-upgrade,rolled-back}-*` there (an existing name or a failed `mv` warns and leaves it), prunes rolled-back copies to two right after the move, and pre-upgrade ones after the new copy as before. Nothing in `apps/server` lists the data root (only `backup/` and its staging dir), and the copy/hash/restore commands glob `pangolin.sqlite*` only.
- F8 review fixes: `upgrade-copies/` is set up only after `compose stop` and re-checked (not a symlink, a directory, root's when running as root) before creating each copy, before each move, before each prune, and in the rollback after its stop; old copies are moved and both kinds pruned only after the new pre-upgrade copy is verified; moves go through `.moving-<name>` (a failed move removes the partial copy, keeps the original; the prune globs never match `.moving-*`). The CI `upgrade-test` pre-creates `upgrade-copies` as 1000:1000 0755 and asserts `0 700` after the upgrade.
- F1 review fix: the backup-server prompt (and the non-interactive default) uses uninstall.sh's record when there is no `.env`.
- F13: comment fixed in `release.yml`; the matching sentence in `docs/install.md` §10 now says the same.

## Plan Change Log

- 2026-10-03: the frozen intent asks for no bundle on a kept-data reinstall with the *same* backup server, but with `.env` removed nothing recorded the old server, and the existing "reinstalls on the data and secrets uninstall.sh kept" test passes the same `--backup-server`. To honour both rows, `uninstall.sh` now keeps `.env`'s `PANGOLIN_BACKUP_REPOSITORY=` line as `secrets/.backup-repository` (0600, in the 0700 secrets dir; the URL may hold credentials) when it keeps the secrets; `install.sh` compares against it (no record: treated as a change) and `write_env` removes it once `.env` holds the server. `deploy/uninstall.sh`, `deploy/uninstall.test.ts` and the uninstall paragraph of `docs/install.md` were touched for this.

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 1, medium 3, low 5, false 1, rejected low 2, deferred 1, accepted 2.

| Verdict | Route | Finding and evidence |
|---|---|---|
| high | patch (done) | `upgrade-copies/` sits in the data root the container user owns; its checks, chmod/chown, moves and prunes ran while the container was up (and after the new server ran during the health wait), so a swapped-in symlink would be followed by root's `mkdir`, `mv` and `rm -rf`. Now done only after `compose stop`, with a re-check before each use. |
| medium | patch (done) | Old copies were moved and rolled-back copies pruned before the upgrade proved it could proceed; an aborted upgrade still deleted copies. Now after the new copy is verified. |
| medium | patch (done) | A partial cross-disk move could leave a copy that blocks later moves and counts toward "keep two"; now moved through a `.moving-` temp name. |
| medium | patch (done) | On a kept-data reinstall the interactive prompt defaulted to nothing, so Enter dropped the kept backup server; it now defaults to the record, for `--non-interactive` runs too, so a kept-data reinstall without `--backup-server` keeps the recorded server and writes no bundle. |
| low | patch (done) | Tests: the name-collision branch; the symlink test could not fail; a regular file at `upgrade-copies`; no prune on an early abort; no partial move left. |
| low | patch (done) | Tests: the record removed when no server is given, a stale record removed by uninstall, none left with `--delete-data`. |
| low | patch (done) | Nothing checked the `chown 0:0`; the CI `upgrade-test` now pre-creates a container-owned `upgrade-copies/` and asserts `0 700`. |
| low | patch (done) | Docs: a cross-disk move only unlinks the old copies' blocks; the copies' data-disk space; `upgrade-copies/` and uninstall. |
| low | patch (done) | F13 docs sentence aligned with the comment. |
| false | rejected | The same-server reinstall with a record is untested: the existing story-11.1 test reinstalls with the same server and, with uninstall now writing the record, asserts no bundle. |
| low | rejected | The F7 test extracts `write_files` by regex and may break on unrelated edits: it fails loudly, never silently. |
| low | rejected | The new `render.sh` runs under the previous release's loaded units until `install_firewall`: the reload does not re-read unit files; commented. |
| accepted | accept | A same-server reinstall after a pre-11.11 uninstall (no record) writes a bundle: nothing records the old server; documented. |
| accepted | accept | The `uninstall.sh` record (`secrets/.backup-repository`, 0600) goes beyond the plan's Code Map: the only way to meet the matrix's "same server, no bundle" row once `.env` is gone (Plan Change Log). |
| defer | defer | `allow_package_mirrors` and `allow_build_hosts` still reload the firewall with the previous release's `render.sh` before `write_files` copies the new one. |

## Verification

**Commands:**
- `npx vitest run deploy` -- expected: pass, except the 2 interactive install tests that fail on macOS
- `shellcheck -S warning deploy/install.sh deploy/pangolin` -- expected: clean
- `pnpm lint` -- expected: the existing 7 warnings
