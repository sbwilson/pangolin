---
title: 'Refactor sweep (platform hardening)'
type: 'refactor'
ticket: '7'
created: '2026-10-03'
status: 'built'
baseline_revision: '0c970275eea5355737b1b59a61f5bf0598eff85d'
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

**Problem:** The hardening epic's stories added code in a hurry around the same places: `deploy/install.sh` `write_files` grew to 89 lines, a marker string is written three times, test fixtures are copied between tests and files, and one docstring now describes code production no longer calls.

**Approach:** Cleanup only, with no change in behaviour: every existing test passes unchanged in what it asserts. The items are those found in this epic's build records and review findings (Code Map). Anything that would change behaviour, or that a review deliberately rejected, stays out.

## Boundaries & Constraints

**Always:** Behaviour and output are byte-for-byte unchanged: the same `.env`, `allowlist.conf`, units, rulesets and messages. Test assertions are not weakened; test helpers only replace repeated setup.

**Decision (human, 2026-10-03):** include both extras: (a) `deploy/pangolin`'s GNU-only `sed -i` becomes portable (temp file and move), with behaviour on Linux unchanged, so the upgrade tests also pass on macOS; (b) drop the duplicated `family=ipv4` line in `install_firewall`.

**Never:** Merge `detect_dns` with render.sh's `host_resolvers`, or move `BACKUP_CHANGED` into `settle` (both rejected in review). Touch the open backlog bug S10 or its `it.fails` test. Add a systemctl/journalctl harness or alerting (deferred).

</frozen-after-approval>

## Code Map

1. `deploy/install.sh` ~1312, 1316, 1330 -- the "Backup server (restic REST)" label is written three times (two comment lines, one `allowlist_add` label); one variable, so `allowlist_remove` cannot drift from what `allowlist_add` writes.
2. `deploy/install.sh` `write_files` (~1296, 89 lines) -- move the allowlist part (~1304-1344) to `write_allowlist` and the Docker drop-in part (~1366-1383) to `write_data_dropin`; called in the same order.
3. `deploy/install.sh` `install_firewall` ~1402, 1404 -- the `PANGOLIN_RESOLV_CONF=… PANGOLIN_RESOLVED_CONF=…` prefix is repeated on two render.sh calls; set once.
4. `packages/app/src/identity/lockout.ts` ~65-66 -- `assertLoginAllowed`'s docstring says it runs before better-auth sees the attempt; it is now a read-only check the hooks do not use (they use `reserveLoginAttempt`). Reword only; the function stays (backlog bug 1's review kept it).
5. `deploy/install.test.ts` -- the `.env` digest rewrite (~608, ~658, ~687) becomes `pinDigest(n)`; the "save docker as docker-base and wrap it" stub (~615, ~664) becomes `wrapDocker(lines)`.
6. `deploy/release-scripts.test.ts` ~59, ~120 -- the identical git init and empty commit in two `beforeEach` become `initRepo()`.
8. `deploy/pangolin` ~148 -- `sed -i "s|^PANGOLIN_IMAGE=.*|…|" "$HOME_DIR/.env"` is GNU-only; write to a temp file beside `.env` and `mv` it, keeping `.env`'s mode (it is 0600; check `.env.bak` handling nearby) — e.g. `sed … "$HOME_DIR/.env" > "$HOME_DIR/.env.new" && chmod 600 … && mv …`. Check for any other `sed -i` in deploy/ scripts. The pangolin.test.ts rollback tests' local `sed` shim (~456) can then go.
9. `deploy/install.sh` `install_firewall` ~1413, 1415 -- `family=ipv4` set twice in a row; drop one.
7. Deploy tests -- the write-then-chmod stub pattern (13× install.test.ts, 8× pangolin.test.ts, 5× uninstall.test.ts) uses one `stub(dir, name, lines)` helper in a shared module (e.g. `deploy/test-helpers.ts`, modelled on release-scripts.test.ts's `stub` ~195).

## Tasks & Acceptance

**Execution:**
- [x] `deploy/install.sh` -- items 1-3
- [x] `packages/app/src/identity/lockout.ts` -- item 4
- [x] deploy tests -- items 5-7
- [x] `deploy/pangolin` -- item 8; `deploy/install.sh` -- item 9

**Acceptance Criteria:**
- Given the full suite before and after, when it runs, then the same tests pass and fail, except that the `deploy/pangolin.test.ts` upgrade tests that failed on macOS for GNU `sed` now pass, with no assertion removed or weakened.
- Given a staged install (`--root`) before and after, when its files are compared, then they are identical.

## Implementation Notes

- Item 1: `BACKUP_ALLOWLIST_LABEL` sits beside `allowlist_add`/`allowlist_remove`; the remove call passes `"# $BACKUP_ALLOWLIST_LABEL"` (its prefix match is unchanged).
- Item 2: `write_allowlist` and `write_data_dropin` compute their own paths (`path "$INSTALL_DIR/allowlist.conf"`, `path /etc/systemd/system`) rather than relying on `write_files`' globals. The `write_env` comment that named `write_files` now names `write_allowlist`.
- Item 3: the two variables are set and exported once inside a subshell, so they do not leak into the rest of install.sh.
- Item 7: `deploy/test-helpers.ts` `stub(dir, name, lines)` replaces every executable-stub write+chmod in install, pangolin and release-scripts tests. The plan's counts (13/8/5) were `chmodSync` grep hits; the rest are not stubs (secret-file modes, permission toggles, the install.sh/pangolin script copies) and were left as they are, including all of uninstall.test.ts.
- Item 8: `cp -p .env .env.new`, then `sed … .env >.env.new` (the redirect keeps the copy's mode and owner, as GNU `sed -i` did), then `mv`. No other `sed -i` in deploy/.

## Plan Change Log

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 0, medium 2, low 4, false 2, rejected low 3, deferred 0.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | `deploy/pangolin` left `.env.new`, a full copy of `.env`, if `sed` or `mv` failed; the trap and the success cleanup now remove it. |
| medium | patch (done) | Nothing checked `.env` stays 0600 after a successful upgrade (the only mode test takes the rollback path); added. |
| low | patch (done) | `allowlist_remove` took the label with `# ` while `allowlist_add` adds it; both now take the bare label. |
| low | patch (done) | `wrapDocker` hung if called twice; `pinDigest` was a silent no-op without a `PANGOLIN_IMAGE` line; both now throw. |
| low | patch (done) | `dockerStubLines`' `extraCases` came after `exit 0` and was never passed; removed. |
| low | patch (done) | `release-scripts.test.ts` gave `stub` a different signature from the other files; the local closure is now `binStub`. |
| false | rejected | The staged-install comparison is not shown in the diff: the implementation ran eight before/after `--root` installs and compared the trees (Implementation Notes). |
| false | rejected | The Tang re-add on a re-run is not applied at once: the same re-run's firewall step applies the allowlist. |
| low | rejected | The Tang labels differ between first install and re-run: changing either changes `allowlist.conf`'s bytes, outside a no-behaviour sweep. |
| low | rejected | The new functions set script-wide variables: the script's existing style (POSIX sh has no `local`); the values are the same. |
| low | rejected | `assertLoginAllowed` stays exported though unused: kept by backlog bug 1's review; the docstring now says what it is. |

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean (7 existing warnings)
- `pnpm test` -- expected: the same pass/fail set as before
- `shellcheck -S warning deploy/install.sh deploy/pangolin` -- expected: clean
