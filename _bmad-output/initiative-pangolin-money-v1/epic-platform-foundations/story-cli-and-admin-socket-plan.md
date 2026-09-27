---
title: 'CLI and admin socket'
type: 'feature'
ticket: '9'
created: '2026-09-27'
status: done
baseline_revision: 'fe7da64d32363ec156d9d866ed1b3b3a41241f0a'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Both partners locked out have no way back: `identity.resetUser` exists (story 1.6) but nothing on the VM can run it, and there is no `pangolin status`. AD-16 requires CLI commands to reach a running server over an admin socket, never opening SQLite as a second writer.

**Approach:** The server holds an exclusive lock on its data directory and listens on `/run/pangolin/admin.sock` (dir 0700, socket 0600) with a peer-uid check and a fixed command set (`status`, `reset-user`) run as use cases under `systemViewer("cli:<command>")`. A bundled `dist/cli.js` talks to the socket, or, for `reset-user` on a stopped stack, takes the same lock and runs the use case in-process. A host `pangolin` wrapper (installed by `install.sh`) runs it in the container via Docker Compose.

## Boundaries & Constraints

**Always:**
- The data-directory lock is a kernel lock released on process death: an `EXCLUSIVE` transaction held open on `<dataDir>/pangolin.lock` (a tiny SQLite file, rollback journal) with `busy_timeout` 0. The server takes it before opening `pangolin.sqlite` and holds it until `close()`; it refuses to start when the lock is held. Demo mode takes no lock and opens no socket.
- Peer-uid check without a native addon: each request names a one-time proof file the client created in the socket's 0700 directory; the server `lstat`s it (regular file, owner uid === `process.getuid()`, created within 30 s), deletes it, and refuses the request otherwise. The kernel stamps the owner, so only the server's own uid can pass.
- Protocol: one JSON request line per connection, `{ command, args, proof }`, and one JSON response line: `{ ok: true, result }` or `{ ok: false, error: { code, message } }` (`errorBody` shape). Unknown commands and malformed requests are refused. 64 KiB request cap, 10 s idle timeout.
- `reset-user` names the person by login email or person ID; with neither (or no match) it fails listing the active people with logins (display name, email), never other data. Its output is the re-enrolment URL (`reEnrolmentUrl(publicUrl, token)`) and expiry on the console only: never logged by the server.
- The socket path is `PANGOLIN_ADMIN_SOCKET` (default `/run/pangolin/admin.sock`; empty disables). Failing to create it logs a warning and the server keeps serving.
- The socket's `SystemViewer` construction stays under `apps/server/src/admin/**` (the Biome exemption).

**Never:**
- No Hono app or HTTP router on the socket; no generic query, export or eval command.
- The CLI never opens `pangolin.sqlite` without the exclusive lock; `status` on a stopped stack does not open the database at all.
- No `backup`, `restore`, `upgrade` or setup-link reissue commands (stories 1.10, 1.11); no escrow-confirmation state for AD-27's status warning (deferred).
- No native addon or new lock dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Status, running | `pangolin status` | Version, schema version, readiness (`ok` or failing checks), job counts by status and dead jobs; exit 0 when ready, 1 when not | — |
| Status, stopped | no socket / connect refused | "Pangolin is not running"; exit 3 | — |
| Reset, running | `pangolin reset-user alex@example.com` | URL + expiry printed; person's sign-in cleared; audit and notice as `cli:reset-user` | Unknown person → exit 1 with the list of people with logins |
| Reset, stopped | server down, lock free | Same result, in-process, under the lock | DB schema behind the build → refuse, "start the server once to migrate" |
| Reset, lock held but no socket | a server is running elsewhere | "the server is running but its admin socket is unreachable"; exit 1; nothing opened | — |
| Foreign uid | connection whose proof is missing, foreign-owned or stale | `{ ok:false, error:{ code:"Forbidden" } }`, connection closed, nothing run | — |
| Second server | lock held | server exits with "another process holds <dataDir>" | — |

</intent-contract>

## Code Map

- `apps/server/src/server.ts` -- `openLive` (take the lock first), `startServer` (listen on the socket after the runner starts), `RunningServer.close` (close socket, runner, HTTP, DB, then release the lock). `nodeTokens` from `auth/secret.ts`, `config.auth.publicUrl`.
- `apps/server/src/config.ts` -- `envSchema`/`Config`: add `adminSocket: string | null`; read `PANGOLIN_VERSION` (default `dev`) into `version`.
- `apps/server/src/admin/` -- new `lock.ts`, `socket.ts` (server), `commands.ts` (the fixed set), `client.ts`; export from `index.ts`. Precedents: `setup-link.ts` (`cli:setup-link`), `seed.ts` (`cli:seed`).
- `apps/server/src/cli.ts` -- new entry: `status`, `reset-user`, `--help`; exit codes per matrix.
- `apps/server/scripts/build.ts` -- add `src/cli.ts` → `dist/cli.js` (same esbuild options).
- `packages/app/src/identity/reset-user.ts` -- `resetUser(ctx, { personId })`, actor `RESET_USER_ACTOR`; reuse as is.
- `packages/app/src/system/readiness.ts`, `system/health.ts`, `system/job-status.ts` -- reuse `readiness`, `health`, `deadJobs`; add a read `jobCounts` (pending/running/dead) via a new `JobRepo.countByStatus()` in `packages/app/src/ports/unit-of-work.ts`, `packages/db` (SQLite) and `packages/app/src/testing/memory-uow.ts`.
- `PersonRepo` -- add `listLogins(): { personId, displayName, email }[]` (active people with a login; email from `auth_user`) in the port, db and memory uow.
- `compose.yaml` (root) -- add `/run:mode=0700,uid=1000,gid=1000,size=1m` tmpfs. `deploy/compose.yaml` already has it.
- `deploy/pangolin` -- new POSIX sh wrapper; `deploy/install.sh` installs it to `/usr/local/bin/pangolin` (0755; staged under `--root`).
- `docs/install.md`, `README.md:115-117` -- document the commands.
- `.github/workflows/ci.yml` -- container job: `docker compose exec -T pangolin node dist/cli.js status` must exit 0.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/src/admin/lock.ts` -- `acquireDataDirLock(dataDir)` → `{ release() }`, throws `DataDirLocked` -- one lock for server and CLI.
- [x] `apps/server/src/admin/socket.ts`, `commands.ts` -- listener with proof check, framing, caps; commands `status` and `reset-user` over `{ uow, clock, newId, tokens, publicUrl, systemHealth, expectedSchemaVersion, runner, version }` -- AD-16.
- [x] `packages/app` + `packages/db` -- `JobRepo.countByStatus`, `PersonRepo.listLogins`, `system.jobCounts` use case, with db and memory tests.
- [x] `apps/server/src/admin/client.ts`, `apps/server/src/cli.ts`, `scripts/build.ts` -- client (creates proof 0600 in the socket dir, sends, removes proof on any outcome), in-process stopped path, exit codes.
- [x] `apps/server/src/server.ts`, `config.ts` -- lock, socket lifecycle, config keys.
- [x] `compose.yaml`, `deploy/pangolin`, `deploy/install.sh`, docs, CI -- wrapper: `docker compose -f /opt/pangolin/compose.yaml exec -T pangolin node dist/cli.js "$@"` when the service runs, else `docker compose ... run --rm --no-deps -T pangolin node dist/cli.js "$@"`.
- [x] Tests (`apps/server/src/admin/*.test.ts`, `deploy/install.test.ts`) -- every matrix row; foreign uid via a child process spawned with `uid: 65534` against a test-relaxed socket mode (skip when not root); lock contention across two processes; wrapper staged by `--root`.

**Acceptance Criteria:**
- Given a running server, when `node dist/cli.js status` runs in the container, then it prints readiness and job state from the socket and exits 0.
- Given a running server, when a process of another uid connects (even with the socket mode relaxed), then the request is refused as `Forbidden` and no command runs.
- Given a running server, when `reset-user <email>` runs, then the person's credentials are cleared, a 24-hour link is printed, and the audit log shows `cli:reset-user`.
- Given a stopped server, when `reset-user <email>` runs, then it runs under the exclusive lock with the same result, and a server started meanwhile refuses to start until the CLI releases the lock.

## Implementation Notes

- The raw SQLite part of the lock is `tryExclusiveLock(path)` in `packages/db/src/exclusive-lock.ts` (the db adapter owns better-sqlite3 and its types; `apps/server` has no `@types/better-sqlite3`). `admin/lock.ts` wraps it as `acquireDataDirLock` / `DataDirLocked` ("another process holds <dataDir>"). The lock object must stay referenced: a garbage-collected connection drops the lock.
- AD-1 forbids admin commands from reading repositories, so the people list goes through a new `identity.listLogins` use case (system viewers only) over `PersonRepo.listLogins`; `status` uses `health`, `readiness`, `jobCounts` and `deadJobs`.
- `reset-user` args are `{ person }` (email, case-insensitive, or person ID). No person → `Validation`, no match → `NotFound`; both carry `details.people` = `[{ displayName, email }]`. The socket logs command names and outcomes only; the URL never reaches the server log.
- Socket error code `Forbidden` is local to the admin protocol (`AdminErrorCode`), not added to `ERROR_CODES`, so HTTP's code-to-status map is untouched.
- Proof names must match `^proof-[A-Za-z0-9_-]{16,128}$` (a bare name, never a path, so a request cannot make the server delete a file elsewhere); the check also requires `nlink === 1` and uses `ctime` for the 30 s age. A directory named as a proof is refused and left in place (a first version crashed on it; covered by a test).
- CLI exit codes: 0 ok/ready, 1 failed/not ready, 2 usage, 3 not running. `status` with the socket disabled exits 1. `reset-user` on a stopped stack refuses when there is no database, and when the schema is behind (or ahead of) the build.
- `install.sh` installs the wrapper only when the support files carry `deploy/pangolin` (an older image extracted by a lone `install.sh` gets a warning instead of a failed install); CI also checks the image carries `/app/deploy/pangolin`.
- Verified in containers (overlay of the new `dist/` onto the last local image; Docker Hub rate-limited the base-image pull, so a full `docker compose build` did not run here): `exec … node dist/cli.js status` exit 0; root in the container refused as `Forbidden`; a `run --rm` container while the stack runs gets "admin socket is unreachable"; a second server gets "another process holds /data"; stopped `status` exits 3; the host wrapper works against the staged production compose file.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 37 findings — high 0, medium 10, low 18, false 9, maybe-false 0
- findings:
  - `[medium]` `patch` (verification-gap) `pangolin status` not-ready output and exit 1 untested — added a runCli case: 51 dead jobs, runner stopped; asserts exit 1, the failing line and "newest 50 of 51".
  - `[medium]` `patch` (verification-gap) bundled stopped-stack path never runs — CI now stops the service and runs `dist/cli.js reset-user` (no person: exit 1, lists logins, resets nobody) and `status` (exit 3) in a one-off container.
  - `[low]` `patch` (verification-gap) docs say a server started during a stopped reset "waits" — reworded: it exits with DataDirLocked and Docker restarts it.
  - `[false]` `reject` (intent-alignment) peer uid checked via a proof file, not SO_PEERCRED — the intent contract fixes this mechanism: the kernel stamps the proof's owner, so the request is tied to the client's uid (Node has no SO_PEERCRED).
  - `[medium]` `patch` (intent-alignment) status verified in-process only; CI asserts only its exit code — grouped with the CI steps above and the foreign-uid step below.
  - `[medium]` `patch` (intent-alignment) foreign-uid test skipped on non-root CI — CI now runs `status` as uid 65534 in the real container and expects a permission refusal; non-root checkProof tests added.
  - `[false]` `reject` (intent-alignment) proof ownership instead of peer credentials, untested gap — same refutation as the mechanism row.
  - `[medium]` `patch` (intent-alignment) reset-user never run in Docker, running or stopped — grouped with the stopped-stack CI step (the lock across containers; the running path shares the socket code CI exercises with status).
  - `[false]` `reject` (intent-alignment) status writes no audit row — Design Notes: the audit log records writes; commands run as `cli:<command>` and reset-user's changes are audited so.
  - `[false]` `reject` (intent-alignment) health/readiness run without the viewer — those use cases take the system-health port by design (story 1.8); job reads take the `cli:status` viewer.
  - `[low]` `patch` (intent-alignment) docs lock wording — same fix as the verification-gap row.
  - `[low]` `patch` (blind-hunter) docs lock wording — same fix.
  - `[low]` `reject` (blind-hunter) exit 1 covers not-ready and CLI failures — every non-zero is a problem for a monitor; a new code adds surface for no everyday gain.
  - `[medium]` `patch` (blind-hunter) status says "not running" when the socket failed — on an unreachable socket status now probes pangolin.lock (never the database): held → "running but its admin socket is unreachable", exit 1.
  - `[medium]` `patch` (blind-hunter) prepare() chmods an existing directory — never chmods an existing directory; refuses one with group/other bits (server warns, keeps serving); test added.
  - `[medium]` `patch` (blind-hunter) security property untested in CI; nlink unchecked — hard-link and symlink proof tests (no root) and the CI uid-65534 step.
  - `[low]` `reject` (blind-hunter) proof files left by a killed CLI — empty files on a 1 MiB tmpfs that resets with the container; a sweeper adds code for a rare case.
  - `[low]` `reject` (blind-hunter) wrapper starts a one-off container for status/--help when stopped — correct result, only slower.
  - `[low]` `patch` (blind-hunter) wrapper hides a failing `compose ps` — redirect dropped; it now dies naming Docker/.env, with a test. (The restarting-container race it also raises is safe: the lock lets only one side write.)
  - `[low]` `reject` (blind-hunter) wrapper tests thin; duplicated compose line — exec passes exit codes through; a function cannot be exec'd, so the line repeats deliberately.
  - `[medium]` `patch` (blind-hunter) no real-image test of stopped path or cross-container lock — grouped with the stopped-stack CI step.
  - `[low]` `patch` (blind-hunter) cli.test hard-codes schema 5 — now `loadMigrations(packageMigrationsDir).length`.
  - `[low]` `patch` (blind-hunter) close() can leave the lock held on a rejection — nested try/finally so closeHttp (DB close, lock release) always runs.
  - `[low]` `patch` (blind-hunter) pangolin.lock undocumented — added to the data-root file table (no data; may be left out of backups; do not delete while running).
  - `[low]` `patch` (blind-hunter) dead-job list truncation silent — heading reads "newest N of M" when capped.
  - `[false]` `reject` (blind-hunter) listLogins/resetUser TOCTOU and case-duplicate emails — resetUser re-checks active person and login in its own transaction (NotFound otherwise); auth emails are unique and stored lowercase by better-auth.
  - `[low]` `reject` (blind-hunter) testing/logins.ts helper casts and counter — test-only; never near 999 calls.
  - `[false]` `reject` (edge-case) demo mode status says not running — demo mode is the read-only showcase image, not an installed stack the CLI targets; it has no socket by design.
  - `[medium]` `patch` (edge-case) starting server or failed socket reported as not running — same lock-probe fix.
  - `[low]` `patch` (edge-case) `compose ps` failure hidden — same wrapper fix.
  - `[low]` `reject` (edge-case) lowercase person ID refused — IDs are never shown to the operator (the list shows names and emails); email matching ignores case.
  - `[low]` `reject` (edge-case) empty-string person prints "Invalid arguments" — rare, and still refuses safely.
  - `[low]` `reject` (edge-case) EACCES/ECONNRESET on connect gives a raw errno message — still exits 1 with the reason; the proof write already maps EACCES first.
  - `[false]` `reject` (edge-case) CLI via symlink or without extension does nothing — the wrapper and CI always run `node dist/cli.js`.
  - `[false]` `reject` (edge-case) stale-socket probe hangs — `/run` is a fresh tmpfs per container; a stale socket with a hung listener cannot exist there.
  - `[low]` `patch` (edge-case) header claim overstated for loosened modes — comment now says the 0700 directory keeps proof names private and the proof check is the second barrier.
  - `[false]` `reject` (edge-case) docs "waits" claim — counted with the docs fix above (duplicate of the verification-gap row).

## Design Notes

The lock uses SQLite's own POSIX locking so it is released if either process dies, works across containers sharing the bind-mounted data directory, and needs no new dependency. A `docker compose run` CLI container has its own `/run` tmpfs, so it never sees a running server's socket; the lock is what stops it writing then.

The proof file stands in for SO_PEERCRED, which Node lacks: the socket's 0600 mode already stops other uids connecting, and the proof check refuses any that get past a loosened mode (and root without `CAP_DAC_OVERRIDE`, which the container drops).

`status` is a read and writes no audit row; the audit log records changes (`write`), and `reset-user`'s changes are audited as `cli:reset-user`.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: all pass, including the new admin tests
- `pnpm --filter @pangolin/server build && ls apps/server/dist/cli.js` -- expected: the CLI is bundled
- `shellcheck -S warning deploy/pangolin deploy/*.sh` -- expected: clean
- `docker compose up -d --build && docker compose exec -T pangolin node dist/cli.js status` -- expected: exit 0 with readiness ok

## Auto Run Result

- **Summary:** the server takes an exclusive SQLite-backed lock on its data directory and serves a fixed-command admin socket at `/run/pangolin/admin.sock` (0700 dir, 0600 socket, proof-file uid check); `dist/cli.js` runs `status` and `reset-user` over it, or `reset-user` in-process under the lock when stopped; the host `pangolin` wrapper (installed by install.sh) runs it via Docker Compose.
- **Files:** `apps/server/src/admin/{lock,socket,commands,client}.ts` (+ tests), `apps/server/src/cli.ts` (+ test), `server.ts`, `config.ts`, `main.ts`, `scripts/build.ts`; `packages/db/src/exclusive-lock.ts`, job and identity repos; `packages/app` `jobCounts`, `listLogins`, ports and memory uow; `compose.yaml` `/run` tmpfs; `deploy/pangolin`, `install.sh` (+ tests); `docs/install.md`, `README.md`; CI steps.
- **Review:** 37 findings — 20 patch rows (10 medium, 10 low) applied, 0 deferred, 17 rejected with reasons in the triage log.
- **Follow-up review recommended:** true — ten medium rows were patched; the unverified risk is the new CI container steps (foreign uid, stopped-stack one-off container) which have not yet run on a GitHub runner.
- **Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (61 files, 701 passed, 1 root-only skip), shellcheck, `pnpm --filter @pangolin/server build` (dist/cli.js) all pass; the implementer ran the stack in Docker locally (status over the socket, root refused, lock across containers).
- **Residual risks:** the lock relies on POSIX locks on a local filesystem; AD-27's status warning for an unconfirmed recovery bundle is not implemented; CI's stopped-stack step assumes the e2e run created a login.
