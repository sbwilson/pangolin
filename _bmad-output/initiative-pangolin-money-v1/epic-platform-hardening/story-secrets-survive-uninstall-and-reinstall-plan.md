---
title: 'Secrets survive uninstall and reinstall'
type: 'bugfix'
ticket: '1'
created: '2026-10-03'
status: 'built'
baseline_revision: 'ef58194756b7325333aad88bb2acaffcb8732e27'
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

**Problem:** `uninstall.sh` keeps the data directory by default but deletes `/opt/pangolin/secrets`. A later `install.sh` then generates new secrets over the kept database, which silently breaks TOTP sign-in, the restic repository and (later) attachments (retro S6).

**Approach:** When `uninstall.sh` keeps the data it also keeps `/opt/pangolin/secrets`, and says so. `install.sh` refuses, before writing any secret, to generate a missing secret when the data root already holds a database. It tells the user how to put the old secrets back from the recovery bundle, or to move the data aside for a fresh install.

## Boundaries & Constraints

**Always:** The refusal happens before anything is written or the stack is started. Existing secrets keep their modes and owners as `generate_secrets` sets them today. A re-run after the secrets are put back works with no extra flag.

**Never:** Keep anything else from `/opt/pangolin` (compose.yaml, `.env`, firewall, the CLI). Change what `--delete-data` deletes beyond also removing the secrets. Add a flag that forces new secrets over a database.

**Decision (human, 2026-10-03):** when the data is kept, `uninstall.sh` keeps the secrets too, rather than warning and requiring a flag.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Uninstall, keep data | data kept (asked, `--keep-data` or non-interactive) | `/opt/pangolin` removed except `secrets/` (contents, modes and owners unchanged); final message names the kept secrets | No error |
| Uninstall, delete data | `--delete-data`, or confirmed | `/opt/pangolin` removed entirely, secrets included | No error |
| Reinstall after keep | secrets kept, database present | `install.sh` keeps all three secrets, writes no bundle, starts on the old database | No error |
| Secrets missing, database present | `pangolin.sqlite` in the data root, any of the three secrets missing or empty | exits non-zero before writing any secret, naming the missing ones and the data root | message: put the files back from the recovery bundle (`PANGOLIN_AUTH_SECRET` → `auth-secret`, `PANGOLIN_APP_KEY` → `app-key`, `RESTIC_PASSWORD` → `restic-password`) and re-run, or move the data root aside for a fresh install |
| Fresh install | no database in the data root | secrets generated as today | No error |

</frozen-after-approval>

## Code Map

- `deploy/uninstall.sh:203-237` `remove_data` and `main` -- today `main` runs `rm -rf "$INSTALL_DIR"`. When `DATA_ACTION=keep` and `$INSTALL_DIR/secrets` exists, remove everything in `INSTALL_DIR` except `secrets/`; otherwise remove it all. Final messages: "Kept the data directory … and the secrets in /opt/pangolin/secrets (a reinstall reuses them)." Update the header comment (lines 1-5) and `--keep-data` help line. `staging`/`path` helpers already handle `--root`.
- `deploy/install.sh` `generate_secrets` (secret loop; `main` calls it after `prepare_dirs`) -- before the loop: if `$DATA_ROOT/pangolin.sqlite` exists (via `path`) and any of `auth-secret app-key restic-password` is missing or empty, `die` with the matrix's message. `DATA_ROOT` is set by `settings`. Reuse `die`, `path`.
- `deploy/uninstall.test.ts:52` -- the "keeps the data when it cannot ask" test expects the install directory gone; it now expects only `secrets/` left. Add: secrets kept with modes, delete-data removes them, keep-data with no secrets dir removes the whole directory.
- `deploy/install.test.ts` -- add: an existing database with a missing secret refuses, writes no secret file and leaves the others untouched; with all secrets present it keeps them (bundle not written); a re-run after placing the files succeeds. Find the existing helpers for a staged root and data root.
- `docs/install.md:532-541` (§12) -- say the secrets are kept with the data, and how a reinstall reuses them; §7 or §10 (restore onto a new host): name the refusal and the bundle-to-file mapping.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/uninstall.sh` -- keep `secrets/` when the data is kept; messages and help
- [x] `deploy/install.sh` -- refuse missing secrets over an existing database, before writing any
- [x] `deploy/uninstall.test.ts`, `deploy/install.test.ts` -- every matrix row
- [x] `docs/install.md` -- uninstall and reinstall wording

**Acceptance Criteria:**
- Given an install whose data was kept by `uninstall.sh`, when `install.sh` runs again, then the household signs in with its existing TOTP and the restic repository still opens with the same password (tests: identical secret files before and after).

## Implementation Notes

- The refusal is `check_secrets_for_database` in `install.sh`, called from `main` right after `check_host` (once `settings`/`settle_all` have set `DATA_ROOT`) and before `check_ssh_session`, `allow_package_mirrors`, `install_packages` and `prepare_dirs`, so a refused run installs, creates and writes nothing (the frozen Always). It is not in `generate_secrets`, despite the Code Map; tests assert a refused run recreates neither `secrets/` nor `firewall/`, leaves `.env` unchanged, and creates no `/opt/pangolin` on a host holding only the data root.
- `uninstall.sh` keeps only `auth-secret`, `app-key` and `restic-password` in `secrets/`, and only when an existing data directory is kept (or an unsafe data root it will not touch); anything else there, `ghcr-token` included, is deleted. With no data directory the whole of `/opt/pangolin` goes. The delete prompt says the secrets go with the data, and a kept non-default data root gets a "Reinstall with --data-root …" line, since `.env` is removed.
- `install.sh` treats a whitespace-only secret file as missing (`has_secret`), both in the refusal and in `generate_secrets`.
- The existing install test "says an account exists when the server has run and removed the setup link" wrote `pangolin.sqlite` before a first install, which is now the refusal case; it now installs first, then adds the database and re-runs.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 3, low 7, false 2, rejected low 4, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | Uninstall deletes `.env`, so a kept non-default data root is forgotten: a plain reinstall starts an empty household on `/srv/pangolin` with the kept secrets (the old database is orphaned, not lost). The Done message and §12 now say to reinstall with `--data-root`. |
| medium | patch (done) | The whole `secrets/` was kept, `ghcr-token` included, though the plan keeps nothing beyond the secrets the data needs. Only the three are kept now. |
| medium | patch (done) | Verification gap: the unsafe-root, mismatched-directory and no-answer tests never asserted the secrets were kept. |
| low | patch (done) | Secrets were kept, and "Kept the data directory" printed, when there was no data directory. |
| low | patch (done) | The delete prompt did not say the secrets go with the data. |
| low | patch (done) | A whitespace-only secret file passed `-s`. |
| low | patch (done) | The refusal hint wrote into a `secrets/` directory that does not exist when `/opt/pangolin` is gone, and put secret values in shell history. |
| low | patch (done) | Docs: the move-aside option did not say the old append-only backup repository can no longer be used with the new restic password, nor that `--bundle` writes a new bundle. |
| low | patch (done) | A refusal test accepted either state for the missing and empty cases. |
| false | rejected | A first install over an existing `pangolin.sqlite` now refuses: that is the intent (a moved data disk without its secrets). |
| false | rejected | Only file equality is tested, not TOTP and restic working: identical secret files are what TOTP and restic need; the running stack is outside these deploy tests. |
| low | rejected | Database detection uses one file (WAL-only or a dangling symlink are missed): unlikely, and widening it adds branches. |
| low | rejected | `/opt/pangolin` as a symlink is not followed by `find`: not a layout install.sh creates. |
| low | rejected | Owners are not tested: the tests run unprivileged; the `find` never touches `secrets/`. |
| low | rejected | "Says so" only in the summary: the delete prompt now says it too (patched above). |

## Verification

**Commands:**
- `npx vitest run deploy/uninstall.test.ts deploy/install.test.ts` -- expected: pass, except the 2 interactive install tests that already fail on macOS
- `shellcheck -S warning deploy/install.sh deploy/uninstall.sh` -- expected: clean
- `pnpm lint` -- expected: no new findings
