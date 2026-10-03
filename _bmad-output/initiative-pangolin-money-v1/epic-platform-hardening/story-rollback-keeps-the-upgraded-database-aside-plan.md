---
title: 'Rollback keeps the upgraded database aside'
type: 'bugfix'
ticket: '8'
created: '2026-10-03'
status: done
baseline_revision: '4c82d199b854f2854ff989fda264b25fd04cca15'
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

**Problem:** When `pangolin upgrade` rolls back after a failed health check, it deletes the live database (`rm -f /data/pangolin.sqlite*`) and restores the pre-upgrade copy, so anything the new server wrote during the health wait (a person's edit through NPM, a job's record) is lost and kept nowhere (spike 11.2, seam S11d).

**Approach:** Before the restore, copy the database files the upgraded server was using into a new 0700 `rolled-back-<stamp>/` beside the pre-upgrade copy; if that copy fails, keep the live database and stop with a message, as the restore does today. The rollback message names the directory. Only the last two `rolled-back-*` directories are kept, as with the pre-upgrade copies.

</frozen-after-approval>

## Implementation Notes

The change is one rollback step in `deploy/pangolin`, a prune line, the message and tests, so it is built on the oneshot route.

- `deploy/pangolin` rollback: creates `rolled-back-$STAMP` (0700, `mkdir` without `-p`, as the pre-upgrade copy), copies `/data/pangolin.sqlite*` into it with a read-only data mount (missing files skipped, any failed copy dies before the restore with "the live database was not touched"; the exit trap restarts the previous stack), prunes to the last two, then restores as before. The final message names the directory.
- `deploy/pangolin.test.ts`: S11d turned on, plus the directory's mode, contents and the message; a pruning test; a keep-failure test (stub switch `STUB_KEEP_FAIL`). The existing rollback tests need GNU `sed`; run on macOS with a `sed -i ''` shim on PATH, all 31 pass.
- `docs/install.md`: the rollback paragraph.

## Review Triage Log

Quick review: high 0, medium 2, low 2, rejected 1.

- medium, patched: a failed keep left an empty `rolled-back-*` behind, which the next prune counted as one of the last two, so it could delete a real kept copy. The directory is now removed on failure; the test checks none is left.
- medium, patched: on a failed keep the message named only the rolled-back directory, though the exit trap restarts the previous stack on the upgraded database; it now says so and names the pre-upgrade copy, and the docs say how to restore it.
- low, patched: the docs said "moves" where the script copies.
- low, patched: the keep-failure test did not check the exit trap restored `.env` and ran `compose up`.
- low, rejected: when `compose stop` fails, the copy may be taken while the server runs: the rollback already continues in that case by design, and the restore it precedes overwrote the same running files before this change.
