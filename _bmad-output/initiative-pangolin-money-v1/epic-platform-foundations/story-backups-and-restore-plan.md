---
title: 'Backups and restore'
type: 'feature'
ticket: '10'
created: '2026-09-27'
status: 'in-review'
baseline_revision: 'b90c532e2d672bff99b8d176600e0a8da52d2b3f'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/deployment-and-ops.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing backs up the household's data, and the recovery bundle has never been shown to restore anything.

**Approach:** Nightly at 02:30 (household time zone), a `local`-lane job writes a consistent `VACUUM INTO` snapshot and a manifest (row count and checksum per table), then a `net`-lane job pushes it with restic to the append-only REST server. `pangolin backup` runs the same on demand; `pangolin restore [snapshot|latest]` stops the stack, verifies the snapshot in a fresh directory, swaps it in under the data-directory lock and cancels pending external-effect jobs. `pangolin status` and the web status page show the last backup. CI backs up and restores on every push, including onto a clean host from the recovery bundle alone.

**Decisions:** No WireGuard: the backup server must be reachable (LAN or a tunnel the operator runs); its allowlist entry covers it. Blob decryption waits for epic 5's attachment store. The weekly `restic check` and monthly drill are story 1.10b.

## Boundaries & Constraints

**Always:**
- Snapshot, then push; the staging directory is `/data/backup/` (never `/tmp`), emptied after a successful push. `/data/attachments/` is pushed too when it exists.
- The restic password reaches the container as a read-only file (0400, uid 1000), never through `.env`.
- Restore swaps only when `PRAGMA integrity_check` is `ok`, every table's count and checksum match the manifest, and the schema version is not newer than the build; the replaced files move to `/data/pre-restore-<timestamp>/`.
- After a swap, before the server starts: pending and running jobs of kinds with `externalEffects` become `dead` with reason `restored`; schedules re-seed at start (AD-16).
- A backup job that dies raises the existing `job.dead` review item (`needsPersonWhenDead`).
- Work runs as `systemViewer("job:<kind>")` or `("cli:<command>")`.

**Never:**
- No `forget`, `prune` or retention from the VM (the server applies retention).
- No per-account balance sums in the manifest (epic 2).
- No long work on the admin socket: `backup` enqueues jobs and the CLI polls.
- No backup when `PANGOLIN_BACKUP_REPOSITORY` is empty: nothing is scheduled and status says so.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly | 02:30 | snapshot pushed; status shows time and snapshot ID | push fails → retries, then dead + review item |
| Manual | `pangolin backup` | prints the snapshot ID when done | already running → joins it (dedupe key); server down → exit 3 |
| Restore | `pangolin restore latest` | stack stopped, verified, swapped, jobs cancelled, stack started | a check fails → nothing swapped, exit 1, check named, stack restarted |
| Restore, lock held | a server holds the data dir | refuses, touches nothing | — |
| Not configured | empty repository | no schedule; status "backups not configured"; `backup` exits 1 saying so | — |
| Append-only | `restic forget` from the VM | refused by the server | — |

</frozen-after-approval>

## Code Map

- `apps/server/src/jobs/index.ts` -- empty `jobKinds`/`schedules`; becomes a factory over timezone and config. `defineJobKind`/`jobHandler`/`defineSchedule` in `packages/app/src/jobs/registry.ts`; `enqueueJob` in `enqueue.ts`; `ensureSchedules` re-seeds at `runner.start()`.
- `apps/server/src/jobs/runner.ts` -- no per-kind timeout or abort (deferred from 1.4 to here); leases renew on the tick, so `VACUUM INTO` must run off the main thread (a worker with its own connection) and restic as a child process.
- `JobRepo` in `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/job-repo.ts`, `packages/app/src/testing/memory-uow.ts` -- add cancelling live jobs of given kinds as `dead`.
- `packages/db/src/{open,migrate,strict-check}.ts` -- WAL, `schemaVersion`, table list.
- `apps/server/src/admin/{commands,cli}` and `apps/server/src/cli.ts` -- add `backup` (socket) and `restore` (stopped path like `resetStopped`); `cli.test.ts:88` and `socket.test.ts:237,255` assert `backup` is unknown today.
- `deploy/pangolin` -- `restore` needs stop → one-off run → start.
- `apps/server/src/config.ts` -- backup repository and restic password file settings.
- `deploy/compose.yaml`, `compose.yaml`, `deploy/install.sh` (`generate_secrets`, docs) -- mount `restic-password`.
- `Dockerfile` runtime -- add restic 0.19 (pinned, SHA-256 from the release's checksums, per `TARGETARCH`).
- `apps/web/src/App.tsx`, `apps/server/src/http/app.ts` `/api/system/*` -- last-backup line.
- `e2e/helpers/account.ts` -- `loadAccount()` gives the e2e login's password and TOTP secret after the suite.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db` + migration -- a STRICT `backup_snapshot` table (restic ID, time, manifest summary); manifest builder (per table: count, SHA-256 of rows in key order) and verifier; job cancel method -- storage and checks.
- [x] `apps/server/src/backup/` -- snapshot (worker `VACUUM INTO` + manifest), push (restic child process, password file, cache under `/data/backup`), restore (restic restore to `/data/restore-<ts>`, verify, swap, cancel) -- the mechanism.
- [x] `apps/server/src/jobs/` -- kinds `backup-snapshot` (local) and `backup-push` (net, `externalEffects`, `needsPersonWhenDead`), nightly schedule, per-kind timeout.
- [x] `apps/server/src/admin/`, `cli.ts`, `deploy/pangolin` -- `backup`, `restore`, status fields.
- [x] `Dockerfile`, compose files, `install.sh`, `docs/install.md` -- restic, secret mount, docs.
- [x] Web status line and `/api/system` field.
- [x] Tests: unit tests of manifest, verify (corrupt db, count mismatch, newer schema), swap and cancel, with a stub restic; CI container job: rest-server `--append-only` container, backup, `restic forget` refused, restore into the running stack's volume, and a clean-host restore into a fresh volume using only the bundle's values, then a Playwright spec signing in with the saved account's password and TOTP.

**Acceptance Criteria:**
- Given the e2e household, when CI backs it up and restores it, then `integrity_check` is `ok` and every table matches the manifest.
- Given a fresh volume and only the bundle's auth secret, restic password and repository, when it restores `latest` and starts, then the e2e person signs in with password and TOTP.
- Given the VM, when `pangolin backup` runs, then a snapshot lands in the repository and `restic forget` from the VM is refused.

## Implementation Notes

- Staging is per snapshot: `/data/backup/staging/<snapshot-job-id>/` (`pangolin.sqlite` + `manifest.json`), written as `<id>.partial` and renamed when complete, so an overlapping nightly and manual backup never share a directory. A successful push removes its own directory and those of snapshots already pushed or whose push died; restic's cache is `/data/backup/cache` and its `TMPDIR` is `/data/backup/tmp` (the container's `/tmp` is a 64 MB tmpfs).
- `backup_snapshot.id` is the snapshot job's ID, which makes the snapshot handler idempotent and lets `pangolin backup` follow one backup (`backup-status { jobId }`); the snapshot job enqueues the push in the same transaction that records the row.
- The worker (`apps/server/src/backup/snapshot-worker.ts`, bundled as `dist/backup-worker.js`) calls `writeSnapshot` from `@pangolin/db/manifest`: `VACUUM INTO` on its own read-only connection, the copy switched to a rollback journal, the manifest built from the copy.
- Manifest checksums hash typed values in primary-key order (every column, `COLLATE BINARY`, for a table without one), never rowid, which VACUUM may renumber.
- Restore finds the database and attachments in a restic snapshot from its recorded paths, so it works whatever data directory pushed it. After the swap it migrates the database under the lock (as the server would at start) before cancelling jobs, and undoes the swap if that fails.
- A `backup-snapshot` job running when the snapshot was taken is in the snapshot as `running`; after a restore its lease expires and it runs again about a minute after start (it has no external effects, so it is not cancelled). Documented in `docs/install.md`.
- Runner: kinds take an optional `timeoutMs`; handlers get `ctx.signal` (a structural `JobSignal`, as `app` has no DOM or Node types), aborted on timeout and when `stop()` gives up.
- CI writes the backup settings to `.env`, so the host's `deploy/pangolin` wrapper (`PANGOLIN_HOME=$PWD`) performs the running-stack restore exactly as on the VM; the root `compose.yaml` gains a `backup` profile with `restic/rest-server:0.14.0 --append-only`.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass, including the backup and restore tests
- CI container job -- expected: backup, append-only, restore and clean-host restore steps pass
