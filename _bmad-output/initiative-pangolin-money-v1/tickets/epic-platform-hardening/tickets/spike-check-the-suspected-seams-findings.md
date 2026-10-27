---
title: 'Check the suspected seams: findings'
type: 'spike-findings'
spike: '11.2'
plan: spike-check-the-suspected-seams-plan.md
baseline_revision: '4da7f54615af370b5c43eb0352fad491a35e5828'
run_on: 'macOS 27 (arm64), Node 22, 2026-10-03; no Docker, no VM'
---

# Check the suspected seams: findings

The epic 1 retrospective listed seven suspected seams (S10 and the six in S11) found by reading the code only. Each one was run here: a test against the real code, or a scripted run of the real script or server. No product code changed.

## Verdicts

| # | Seam | Verdict | Where | Kept test | Follow-up |
|---|------|---------|-------|-----------|-----------|
| 1 | S10: status after a restore | **real** | app (`apps/server`) | `apps/server/src/cli.test.ts`, `it.fails` "S10: …" | backlog ticket |
| 2 | S11a: lockout check-then-act across scrypt | **real** | app (`apps/server`) | `apps/server/src/auth/auth.test.ts`, `it.fails` "S11a: …" | backlog ticket |
| 3 | S11b: drill `integrity_check` stalls lease renewal | **real but harmless** | app (`apps/server`) | `apps/server/src/jobs/runner.test.ts`, regression test "S11b: …" and its control (both pass) | none for the lease; a backlog check (unverified) for the HTTP stall |
| 4 | S11c: `stop_grace_period` vs the runner's 10 s stop | **real but harmless** | `deploy/compose.yaml` | `deploy/install.test.ts`, `it.fails` "S11c: …" (both compose files) | deploy/ story (small) |
| 5 | S11d: upgrade rollback discards health-wait writes | **real** | `deploy/pangolin` | `deploy/pangolin.test.ts`, `it.fails` "S11d: …" | deploy/ story |
| 6 | S11e: `install.sh` re-run overwrites upgrade's files | **real** | `deploy/install.sh` | `deploy/install.test.ts`, `it.fails` "S11e: …" | deploy/ story |
| 7 | S11f: `--backup-server ""` cannot disable backups | **real** | `deploy/install.sh` | `deploy/install.test.ts`, `it.fails` "S11f: …" | deploy/ story |

`after: [2]` and "entry 7" below are `id`s in this epic's `tickets.toml` (`epic-platform-hardening/tickets.toml`): 2 is this spike, 7 the refactor sweep.

No seam got the "unverified" verdict. Seam 4 (SIGKILL timing) and seam 5 (the rollback) were run against the real server and the real script, with a stub `docker`; neither ran in a real container (see Limits).

## 1. S10: status after a restore

**Run.** `cli.test.ts`, new test "S10": boot a server with the stub restic, `pangolin backup`, stop it, `pangolin restore --keep-credentials`, set the restored snapshot's `taken_at` (the row with that restic snapshot ID) to five days before now, as if an old snapshot had been restored, boot, `pangolin status`.

**Evidence** (the output from the test run with `it` in place of `it.fails`):

```
Backups:   last at 2026-10-03T05:36:34.928Z, snapshot a3e7215e…e7fc80f   (ID trimmed)
Warning:   no good backup in the last 48 hours; check the backup server
```

The snapshot's `taken_at` was `2026-09-28T05:36:34.931Z`. `printStatus` prints `last.pushedAt`, and `admin/restore.ts` records the restored snapshot with `recordBackupPush`, which stamps `pushedAt` with the restore's own clock. Staleness (`backupFreshness`) is judged on `takenAt`. So status says the last backup was just now and, on the next line, that there has been no good backup for 48 hours.

**Verdict: real.** The data is right and the stale warning is right; the "last at" line is misleading after a restore.

**Proposed backlog ticket.**
- type: bug
- title: Status shows the snapshot's time after a restore
- description: Makes `pangolin status` (and `/api/system/backup`, which shares `BackupStatus`) show when the last backup's database was taken, so after a restore "last at" is the restored snapshot's `takenAt` and agrees with the stale warning.
- verify: The `it.fails` S10 test in `apps/server/src/cli.test.ts` is turned into `it` and passes, and a test of `/api/system/backup` after a restore shows the same time (`last.takenAt`, or whatever field the fix shows) as the CLI.
- after: (none in this epic)

## 2. S11a: lockout check-then-act across the scrypt hash

**Run.** `auth.test.ts`: a fresh harness (real HTTP app, real better-auth, SQLite) with one login that has a password and no TOTP, then 20 concurrent wrong-password `POST /api/auth/sign-in/email` requests. Repeated three times, then with a right password as the 20th request, then with the production per-client limit (`rateLimitPerMinute: 10`). The kept `it.fails` test sends 19 wrong passwords and then the right one. It asserts that every status is 401 or 429, that at most `lockout.maxFailures` (from the harness's auth config) are evaluated, and that the right password is refused. As run, it fails on the first of these: `expected [ 200 ] to deeply equal []`.

**Evidence.**

```
S11a: 20 of 20 evaluated (401), 20 failures recorded        (three runs, same result)
statuses (right password last): 401 ×19, 200
statuses (rateLimitPerMinute 10): 401 ×10, 429 ×10;  10 failures recorded
```

The before-hook (`assertLoginAllowed`) reads the attempts, better-auth then hashes the password (async scrypt), and only the after-hook records the failure. Every request in a burst passes the check before any failure is written. In the run with a right password sent last, it signed in after 19 failures, where the lockout should refuse it after 5. The per-client rate limit (10 a minute by default) caps a burst from one client at 10 guesses; a client behind several trusted-proxy addresses, or several clients, are not capped by it.

**Verdict: real.** The lockout lets through about twice `maxFailures` from one client, and more from several clients.

**Proposed backlog ticket.**
- type: bug
- title: Lockout holds under concurrent sign-ins
- description: Makes the login lockout count an attempt before the password hash runs (or serialises attempts per email), so concurrent sign-ins for one email are refused once `PANGOLIN_LOGIN_MAX_FAILURES` failures are recorded or in flight.
- verify: The `it.fails` S11a test in `apps/server/src/auth/auth.test.ts` is turned into `it` and passes: 19 wrong passwords and then the right one, all at once, every status 401 or 429, at most `maxFailures` evaluated, and the right one refused. The existing lockout tests still pass.
- after: (none in this epic)

## 3. S11b: the drill's `integrity_check` stalls lease renewal

**Run.** `runner.test.ts`, new test "S11b": runner A claims a job whose handler awaits (the restic fetch), then blocks synchronously (the `integrity_check`) while the clock passes two leases. Runner B, another owner on the same database, polls every 5 ms throughout. A control is kept beside it as a passing test: the same setup with an `await` after the block and only B's timer running, asserting that B claims the job. It shows that B polls and that the first test would see a claim. Separately, `PRAGMA integrity_check` was timed on a generated 465 MB database (2 million rows, two indexes).

**Evidence.**

```
S11b test: lease_expires_at < now inside the block (expired mid-step); B ran nothing;
           job done, attempts 1; no "lease lost" or "completion rejected" log        -> passes
control (await after the block, only B ticking): expected [ 1 ] to deeply equal []  -> B claimed it
integrity_check: {"sizeMB":465,"rows":2000000,"integrityCheckMs":4328}
```

The lease does expire mid-drill when the check runs past it. But nothing can claim the job meanwhile: the event loop is blocked, so no runner in the process ticks. The drill handler's code after the check (`recordBackupVerification`, `rmSync`) is synchronous, so completion runs in microtasks before any timer fires. Renewal and completion match on the owner, not the expiry (`held` in `packages/db/src/job-repo.ts`). The data-directory lock keeps any other process's runner off the database. At roughly 100 MB/s, the 60 s default lease (renewed every 20 s) would need a database of several GB to lapse at all.

**Verdict: real but harmless** for the lease. The guard holds because of three facts: one runner per process, a synchronous tail after the check, and the data-directory lock. The kept regression test and its control will catch a change to the runner's ordering.

**Also seen, verdict unverified:** while `integrity_check` runs, HTTP and `/healthz` stall as well (4.3 s at 465 MB here). Docker's health check has a 3 s timeout, 10 s interval and 3 retries, and `pangolin upgrade` waits up to 60 s for healthy. A multi-GB database on a slow home-server disk might stall long enough to mark the container unhealthy, or to fail an upgrade that coincides with a drill. Nothing here could settle it: it needs a database of realistic size on the target hardware.

**Follow-up:** none for the lease. For the stall, a backlog check:
- type: spike
- title: Drill stall against the health checks
- description: Times the monthly drill's `integrity_check` and manifest verification on a multi-GB database on home-server hardware, and compares the event-loop stall with Docker's health check (3 s timeout × 3 retries at 10 s) and the upgrade's 60 s health wait.
- verify: A recorded timing per database size, and a verdict on whether the drill must move off the main thread (a worker, as the snapshot does).
- after: (none in this epic)

## 4. S11c: `stop_grace_period` against the runner's 10 s stop

**Run.** Neither `deploy/compose.yaml` nor the root `compose.yaml` sets `stop_grace_period`, so `docker compose stop` (used by `pangolin upgrade`, `restore` and `uninstall.sh`) sends SIGKILL after Docker's default 10 s. `runner.stop()` waits `stopTimeoutMs` (10 s) for running handlers before the HTTP server, database and lock close (`server.ts` `close`). A scripted run (scratch, not kept): the real `startServer` in a child process with main.ts's SIGTERM handler, and one job whose handler ignores its abort signal and commits a row every 100 ms on its own connection. The parent sends SIGTERM, then SIGKILL at 10 s as Docker would. It then reopens the database. A second run used a 15 s grace.

**Evidence.**

```
grace 10 s:  warn "stopped with handlers still running; their leases will expire"
             child exited code=null signal=SIGKILL after 10024 ms; last committed row reported 103
             integrity_check: ok;  rows in spike_tick: 103;  job: status running, attempts 1, leased
grace 15 s:  child: closed;  exited code=0 after 10027 ms;  integrity_check: ok;  rows 102 = reported 102
```

**Verdict: real but harmless.** SIGKILL does land before the database closes, 3 ms after the runner gives up. WAL with `synchronous = NORMAL` keeps every committed row and the file passes `integrity_check`. The kernel lock goes with the process. The interrupted job stays `running` until its lease expires, then it is re-claimed (an existing runner test covers that). Only the clean close is lost. A grace of about 20 s makes the shutdown clean.

**Proposed deploy/ story** (small; could be folded into another deploy/ story):
- type: story
- title: Stop grace outlasts the runner
- description: Sets `stop_grace_period` (e.g. 20s) on the pangolin service in `deploy/compose.yaml` (and the root `compose.yaml`), so a stop lets the runner's 10 s wait end and the database close before Docker sends SIGKILL.
- verify: The two `it.fails` S11c cases in `deploy/install.test.ts` (one per compose file; Compose durations such as `20s`, `1m30s` or a bare number are parsed) are turned into `it` and pass; `docker compose stop` on the dev VM logs the server's clean shutdown.
- after: [2]; placed before the refactor sweep (entry 7), which then waits on it too.

## 5. S11d: the upgrade rollback discards writes made during the health wait

**Run.** `pangolin.test.ts`, new test "S11d". It uses a stub `docker` that runs the script's own one-off `sh -c` steps (the pre-upgrade copy, the hash check, the rollback's `rm -f /data/pangolin.sqlite* && cp -a /backup/…`, the marker) against real host directories, with `/data` and `/backup` mapped. The "new server" appends a line to the live database when `compose up` starts it, and its health check then reports `unhealthy`. The stub matches `compose` subcommands by position (`$6`), not by substring, because a temporary path can contain `ps` or `up`. A `sed` shim gives the script's GNU `sed -i` the BSD empty suffix on macOS, so the test runs here and on Linux.

**Evidence.**

```
Stopping stack for upgrade... / Starting upgraded stack... (new-server-wrote) /
Health check failed, rolling back... / pangolin: upgrade failed during health check. rolled back.
live database after rollback: "before the upgrade\n"
grep -rl "written by the new server" <data dir> <install dir>: (nothing)
```

**Verdict: real.** Anything the new server committed between `compose up` and the rollback is deleted and kept nowhere. That covers a person's edit through NPM (the new server serves while it fails health), a job's record, or a backup push that restic has but the database no longer knows of. The window is the health wait, at most `PANGOLIN_UPGRADE_TIMEOUT` (60 s) and often about 10 s. The writes may be under the new schema, so keeping them live is not the fix; keeping the replaced database aside, and saying where, is.

**Proposed deploy/ story.**
- type: story
- title: Rollback keeps the upgraded database aside
- description: Makes the `pangolin upgrade` rollback move the database it replaces into a 0700 `rolled-back-<stamp>/` beside the pre-upgrade copy, instead of deleting it, and name it in the rollback message, so writes made during the health wait can be recovered. As with the pre-upgrade copies, only the last two `rolled-back-*` directories are kept.
- verify: The `it.fails` S11d test in `deploy/pangolin.test.ts` is turned into `it` and passes (it checks only the start of the rollback message, so the message can name the directory); a test shows a third rollback prunes the oldest `rolled-back-*`; the existing rollback tests still pass in CI.
- after: [2]; placed before the refactor sweep (entry 7).

## 6. S11e: an `install.sh` re-run overwrites the compose.yaml and CLI that `pangolin upgrade` installed

**Run.** A scripted run (`--root`, `--no-docker`): a first install, then the files made to look as `pangolin upgrade` leaves them (the new image's `compose.yaml` and `/usr/local/bin/pangolin`, and its digest pinned in `.env`), then a re-run of `install.sh` from the checkout. The kept test "S11e" in `install.test.ts` re-runs with a stub `docker` and a digest pinned in `.env`. As run, it exits 0 and keeps the digest, then fails because the image was never consulted (`expected 'pull ghcr.io/…@sha256…' to contain 'create ghcr.io/…@sha2…'`, trimmed).

**Evidence.**

```
re-run (seam 6): exit 0
==> Writing compose.yaml, the allowlist and the firewall
Installed the pangolin command to /usr/local/bin/pangolin
compose.yaml line 1: # Production stack for one Pangolin Money server, installed to /opt/pangolin by install.sh.
pangolin line 2:     # pangolin: the Pangolin Money admin CLI on the host, installed to /usr/local/bin by install.sh.
.env: PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin@sha256:111… (kept; digest trimmed)
```

`write_files` copies `$SUPPORT/compose.yaml` and `$SUPPORT/pangolin` with no check. `SUPPORT` is the directory next to the script (a checkout, which `docs/install.md` names as the way to install) or the `--build` clone; only a lone downloaded script takes them from the pinned image (`locate_support`). From a checkout older than the upgrade, the re-run leaves the newer image pinned with the older `compose.yaml` and CLI. The lone-script path was read, not run (it needs `docker create`/`docker cp`, which the stub does not model).

**Verdict: real.**

**Proposed deploy/ story.** Chosen approach: take the files from the pinned image. Keeping whatever files are installed would need install.sh to tell which release wrote them. Refusing would block a routine re-run, for example one that only changes the backup server. Taking `compose.yaml` and the command from the image that actually runs needs no version comparison. It also covers a re-run from a *newer* checkout, which would otherwise pair newer files with an older image, and it reuses the path a lone script already takes (`locate_support`).
- type: story
- title: Re-run takes its files from the pinned image
- description: Makes an `install.sh` re-run take `compose.yaml` and the `pangolin` command from the image `.env` pins by digest (which only `pangolin upgrade` writes), as a lone script does, whenever this run does not replace the image (`--image` or `--build`), so the files always match the image that runs.
- verify: The `it.fails` S11e test in `deploy/install.test.ts` (a stub `docker` whose image carries marked files; `docker create <digest>` is expected) is turned into `it` and passes; a re-run with a tag-pinned image, `--image` or `--build` still writes the checkout's files.
- after: [2]; placed before the refactor sweep (entry 7).

## 7. S11f: `--backup-server ""` cannot disable backups

**Run.** `install.test.ts`, new test "S11f", plus a scripted run. A first install with `--backup-server rest:https://nas.lan:8000/pangolin`, then a re-run with `--backup-server ""`.

**Evidence.**

```
re-run --backup-server "" (seam 7): exit 0
WARNING: no backup server set: add PANGOLIN_BACKUP_REPOSITORY to .env and its host to allowlist.conf before enabling backups
WARNING: kept PANGOLIN_BACKUP_REPOSITORY=rest:https://nas.lan:8000/pangolin in .env (you asked for ): edit /opt/pangolin/.env to change it, then re-run
PANGOLIN_BACKUP_REPOSITORY=rest:https://nas.lan:8000/pangolin
```

`settle_all` replaces the key only for a non-empty `BACKUP`. An explicit empty value goes the "keep .env's" way, and the run prints two warnings that contradict each other. Backups stay on. Editing `.env`, which the second warning names, is the only way to turn them off.

**Verdict: real.** Low impact (there is a documented way out), but the flag does not do what it says.

**Proposed deploy/ story** (small; could share a session with the S11c story):
- type: story
- title: An empty --backup-server turns backups off
- description: Makes `install.sh --backup-server ""` (given explicitly) blank `PANGOLIN_BACKUP_REPOSITORY` in `.env`, remove the backup host's entry that install.sh added to `allowlist.conf` (and re-apply the allowlist), and print one line saying backups are off, in place of the two contradictory warnings. A re-run with no flag still keeps the stored value.
- verify: The `it.fails` S11f test in `deploy/install.test.ts` is turned into `it` and passes; a new test shows the host gone from `allowlist.conf` and the "backups are off" line printed; the existing re-run tests still pass.
- after: [2]; placed before the refactor sweep (entry 7).

## Placement summary (for ticketing; not written to `tickets.toml` or the backlog by this spike)

- **deploy/ stories in this epic, before the refactor sweep (`id = 7` in the epic's `tickets.toml`, whose `after` gains each; each story's `after` is `[2]`, this spike's `id`):** "Rollback keeps the upgraded database aside" (S11d), "Re-run takes its files from the pinned image" (S11e), "An empty --backup-server turns backups off" (S11f), "Stop grace outlasts the runner" (S11c, real but harmless; the human may fold it into another deploy/ story or drop it).
- **Backlog tickets (app code):** "Status shows the snapshot's time after a restore" (S10), "Lockout holds under concurrent sign-ins" (S11a).
- **Backlog check (unverified):** "Drill stall against the health checks" (seen under S11b).
- **No follow-up for the lease:** S11b (real but harmless; the regression test and its control are kept).

## Limits

- Nothing ran in Docker or on a VM (none here, and the plan forbids the dev and prod VMs). Seam 4's SIGKILL was sent by the test harness at Docker's default 10 s, not by `docker compose stop`; seam 5's container steps ran as their `sh -c` commands on host directories.
- On macOS, 14 tests already fail at baseline: 13 in `deploy/install.test.ts` and `deploy/pangolin.test.ts` (GNU `sed -i`, retro process lesson), and `apps/server/src/jobs/backup.test.ts` "kills restic when a push runs past its timeout" (ENOENT on `restic.pid`). They fail the same way at the baseline revision and are unchanged. The new S11d test carries its own `sed` shim, so it runs here and on Linux.
- `it.fails` passes for any failure, including an environment failure. Whoever turns a test on should first check that it fails for the reason given in its comment.
