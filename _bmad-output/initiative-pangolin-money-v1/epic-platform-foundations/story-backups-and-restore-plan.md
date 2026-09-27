---
title: 'Backups and restore'
type: 'feature'
ticket: '10'
created: '2026-09-27'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/deployment-and-ops.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing backs up the household's data. A lost VM, disk or bad upgrade loses everything, and the recovery bundle install.sh prints has never been proven to restore anything.

**Approach:** Nightly, a `local`-lane job writes a consistent `VACUUM INTO` snapshot plus a manifest (row count and checksum per table), and a `net`-lane job pushes it (and the attachments folder) to the append-only restic REST server. `pangolin backup` runs the same pair on demand; `pangolin restore <snapshot>` stops the stack, verifies the snapshot in a fresh directory, swaps it in under the data-directory lock and cancels pending external-effect jobs. A weekly `restic check` and a monthly restore drill report through `pangolin status` and a household review item on failure. CI backs up and restores the seeded database, and restores onto a clean host from the recovery bundle alone.

## Boundaries & Constraints

**Always:**
- Snapshot first, then attachments (AD-21); `VACUUM INTO` a staging file under `/data/backup/` (never `/tmp`), removed after the push.
- The restic password and app key reach the container as read-only files (0400, uid 1000), never through `.env`; the key file is never inside the backup.
- Restore refuses to swap unless `PRAGMA integrity_check` is `ok`, the manifest's counts and checksums match, the schema version is not newer than the build, and the key-check blob decrypts with the configured app key. The replaced files are kept in `/data/pre-restore-<timestamp>/`.
- After a swap, before the server accepts work: pending and running jobs of kinds with `externalEffects` become `dead` with reason `restored`; schedules re-seed at start (AD-16).
- Backup and drill failures raise one household-scoped review item each (deduped), resolved by the next success.
- Everything runs as `systemViewer("job:<kind>")` or `("cli:<command>")`.

**Never:**
- No pruning, `forget` or retention from the VM: retention runs on the backup server.
- No per-account balance sums in the manifest (epic 2 adds them).
- No blocking the admin socket: `pangolin backup` enqueues jobs with fixed dedupe keys and the CLI polls their outcome.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly backup | schedule fires | snapshot + manifest pushed; `pangolin status` shows its time and snapshot ID | push fails → retries, then dead + review item |
| Manual backup | `pangolin backup` while nightly runs | joins the running backup (same dedupe key); prints the snapshot ID | server down → exit 3 |
| Restore | `pangolin restore latest` | stack stopped, verified, swapped, jobs cancelled, stack started; prints what changed | any check fails → nothing swapped, exit 1, reason named |
| Restore, lock held | server still running | refuses, nothing touched | — |
| No backup server | `PANGOLIN_BACKUP_REPOSITORY` empty | jobs not scheduled; status says "backups not configured" | — |
| Drill | monthly | restores latest into a temp dir, runs the restore checks, deletes it | failure → review item |
| Append-only | `restic forget` from the VM | refused by the server | — |

</frozen-after-approval>

## Code Map

- `apps/server/src/jobs/index.ts` -- `jobKinds`/`schedules` are empty arrays; become a factory taking the household timezone and backup config. Kinds via `defineJobKind` (`packages/app/src/jobs/registry.ts`, `externalEffects` flag, lanes), handlers via `jobHandler`, `defineSchedule({ next })`.
- `apps/server/src/jobs/runner.ts` -- no per-kind timeout or abort signal (deferred from 1.4 to this story); leases renew on the tick, so a long synchronous `VACUUM INTO` can lose its lease: add a per-kind timeout and run restic as a child process.
- `packages/app/src/ports/unit-of-work.ts` `JobRepo` + `packages/db/src/job-repo.ts` + `packages/app/src/testing/memory-uow.ts` -- add `cancelExternal(kinds, reason)`; no `cancelled` status, use `dead`.
- `packages/db/src/open.ts` (WAL), `migrate.ts` (`schemaVersion`, `loadMigrations`), `strict-check.ts` (table list via `pragma_table_list`) -- manifest and verification.
- `apps/server/src/admin/{commands,socket,client,lock}.ts`, `apps/server/src/cli.ts` -- add `backup` (socket, async via jobs) and `restore` (stopped path, like `resetStopped`). Update tests asserting `backup` is unknown (`cli.test.ts:88`, `socket.test.ts:237,255`).
- `deploy/pangolin` -- `restore` must `compose stop` first, run the one-off container, then `compose start`.
- `apps/server/src/config.ts` -- add `PANGOLIN_BACKUP_REPOSITORY`, `PANGOLIN_RESTIC_PASSWORD_FILE`, `PANGOLIN_APP_KEY_FILE`.
- `deploy/compose.yaml`, `deploy/install.sh` (`generate_secrets` :734, `write_bundle` :771) -- mount `restic-password` and `app-key` read-only for uid 1000; bundle stays `KEY=VALUE` lines.
- `Dockerfile` -- runtime has no restic; add a pinned restic 0.19 binary, checksum-verified.
- `apps/server/src/testing/{auth-harness,totp}.ts` -- TOTP login flow for the clean-host test; `createHarness` needs a variant over an existing database and secret.
- `.github/workflows/ci.yml` container job -- add a `restic/rest-server --append-only` service and the restore tests after e2e (a real login with TOTP exists then).

## Open Questions

1. **WireGuard.** Nothing designs the tunnel. (a) Out of scope for now: the backup server must be reachable (LAN, or a tunnel you already run); the allowlist entry covers it. (b) install.sh sets up `wg-quick` on the host from a config file you supply (`--wireguard-config FILE`), and the firewall allows its endpoint. (c) A WireGuard sidecar container. *Recommend (a).*
2. **The "sample blob".** No attachment store exists yet (epic 5). (a) Add a small app-key encryption helper (AES-256-GCM, key-version header) and a key-check blob written at first boot; restore and the drill decrypt it, proving the escrowed key. (b) Defer blob decryption to epic 5; the clean-host test proves only the restic password and TOTP. *Recommend (a).*
3. **Schedule (household time zone).** Nightly backup 02:30, `restic check` Sundays 03:30, drill on the 1st at 04:00? Or your times.
4. **Where results show.** (a) `pangolin status` and review items only. (b) Also a line on the web status page (the spec says the drill shows there). *Recommend (b).*
5. **CI.** (a) Restore tests in the existing CI on every push. (b) A separate workflow on release tags only, as the spec's "every release" wording. *Recommend (a).*
6. **Scope.** Estimated ~2,300 plan tokens. (a) Keep the full ticket. (b) Split: this story does backup, verified restore and the CI restore tests; the weekly check, monthly drill and status/web surfacing become story 1.10b. *Recommend (b)* — the core is already large and high-risk.

## Tasks & Acceptance

**Execution:** (filled in after the questions are answered)

**Acceptance Criteria:**
- Given the seeded database, when CI backs it up to rest-server and restores it, then `integrity_check` is `ok` and every table's count and checksum match the manifest.
- Given a clean host with only the recovery bundle, when it restores the latest snapshot, then the key-check blob decrypts and a seeded person logs in with password and TOTP.
- Given the VM, when `pangolin backup` runs, then a new snapshot appears in the repository and `restic forget` from the VM is refused.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass, including new backup/restore tests
- CI container job -- expected: backup, restore and clean-host restore steps pass against rest-server
