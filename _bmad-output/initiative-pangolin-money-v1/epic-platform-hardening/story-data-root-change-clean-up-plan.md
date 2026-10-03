---
title: 'Data-root change clean-up'
type: 'bugfix'
ticket: '5'
created: '2026-10-03'
status: done
baseline_revision: 'fa1fc018e998ca17e8952ce9ca07f7467c50ba2b'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `install.sh` writes a `RequiresMountsFor=<data root>` Docker drop-in only when the data root is a mount point, and never removes it. After `--data-root` moves to a path that is not a mount point, the old drop-in still names the old path, so Docker can be held at boot waiting for a disk that is gone. And a changed data root starts the app on an empty database with no warning, while the household's database sits in the old one (retro S9).

**Approach:** When the data root is not a mount point, remove a drop-in left from an earlier run (the one file `pangolin-data.conf`; when it is a mount point it is rewritten for the new path, as today). When `--data-root` changes the stored value, and the old data root holds `pangolin.sqlite` while the new one does not, warn before anything is started, naming the old data root and saying the app will start on an empty database there.

</frozen-after-approval>

## Implementation Notes

The change is small (two branches in `deploy/install.sh` plus tests), so it is built on the oneshot route.

- `deploy/install.sh` `settle_all`: records the stored data root before `settle ... replace` and warns when it held `pangolin.sqlite` and the new one does not. `install_files`: when the data root is not a mount point, removes a `pangolin-data.conf` drop-in left by an earlier run (and the directory if empty).
- `deploy/install.test.ts`: drop-in removed for a data root that is no longer a mount point; one drop-in rewritten for a new mounted data root; the warning shown for a database left behind, and not for a new root that has one.
- `docs/install.md`: the `--data-root` row.

## Review Triage Log

Quick review: high 1, medium 1, low 3, false 0.

- high, patched: the drop-in was removed whenever the data root was not a mount point, including a re-run with the same data root while its disk failed to mount, which deleted the guard that keeps Docker off the empty system disk. Now only a drop-in naming another data root is removed; a test covers the same root unmounted.
- medium, patched: the warning told the operator to move the data "first", but the installer carries on and starts the app; it now gives the recovery steps that work afterwards (stop, replace the new root's contents, start).
- low, patched: the "Docker waits for the disk" docs paragraph did not mention the removal.
- low, patched: the second run in the warning test was not checked for success.
- low, patched: the removal test did not check the empty `docker.service.d` directory goes.
