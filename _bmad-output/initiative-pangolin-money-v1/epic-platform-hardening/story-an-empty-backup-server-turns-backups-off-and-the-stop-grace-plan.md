---
title: 'An empty --backup-server turns backups off, and the stop grace outlasts the runner'
type: 'bugfix'
ticket: '10'
created: '2026-10-03'
status: 'built'
baseline_revision: '4843b1a523c8f90b91fc6aa75c02f541edb3a631'
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

**Problem:** `install.sh --backup-server ""` is taken as "no answer", so an existing `PANGOLIN_BACKUP_REPOSITORY` is kept with two contradictory warnings and the flag cannot turn backups off (spike 11.2, seam S11f). And no `stop_grace_period` is set, so Docker kills the app at 10 s, the same moment the job runner gives up waiting, before the database closes (seam S11c, harmless today under WAL).

**Approach:** An explicit `--backup-server ""` blanks `PANGOLIN_BACKUP_REPOSITORY` in `.env`, removes the backup host's entry that install.sh added to `allowlist.conf` (and the re-render applies it), and prints one line saying backups are off, in place of the two warnings; a re-run with no flag still keeps the stored value. Set `stop_grace_period: 20s` on the pangolin service in `deploy/compose.yaml` and the root `compose.yaml`.

</frozen-after-approval>

## Implementation Notes

Install.sh's backup settle path, two compose files and turning on the spike's tests: built on the oneshot route.

- `--backup-server ""` sets `BACKUP_OFF` in `settings`, which prints the one "Backups are off" line and skips the "no backup server set" warning. `settle_all` skips `settle` for it (no "kept" warning) and, when `.env` holds a repository, records it as `OLD_BACKUP` and marks the key for `env_replace`: the key stays with an empty value, which the server's config reads as not configured. A first install adds no key, as before. `BACKUP_CHANGED` stays 0, so no bundle is written.
- `write_files` drops `url_entry "$OLD_BACKUP"` from an existing `allowlist.conf` with a new `allowlist_remove` (exact line match, plus the "# Backup server (restic REST)" comment and blank line just above it), unless the Tang entry is the same, then applies the allowlist.
- `stop_grace_period: 20s` on the pangolin service in both compose files; S11f and S11c tests turned on, plus tests for the allowlist/one-line output, a flagless re-run, no bundle, an operator line surviving, and a first install with the empty flag.

## Review Triage Log

Quick review: high 0, medium 1, low 3, rejected 1.

- medium, patched: `allowlist_remove` dropped every line equal to the old backup host:port, including one the operator wrote; it now removes the entry only directly under install.sh's "# Backup server (restic REST)" comment (with the comment), and otherwise keeps the file and says so; a test covers an operator's own `nas.lan:8000`.
- low, patched: "Backups are off" printed before anything changed and claimed none were scheduled even with `--no-docker`; it now prints after `.env` is written, worded for each case.
- low, patched: the no-bundle test passed without the fix; it now checks the bundle id is unchanged and no pending mark remains.
- low, patched (docs): an install pinned by digest gets `stop_grace_period` with its next `pangolin upgrade`, since a re-run takes compose.yaml from the pinned image (story 11.9).
- low, rejected: other lines an operator appends inside install.sh's backup comment block stay after the entry goes: cosmetic, and only the entry and its own comment are install.sh's.
