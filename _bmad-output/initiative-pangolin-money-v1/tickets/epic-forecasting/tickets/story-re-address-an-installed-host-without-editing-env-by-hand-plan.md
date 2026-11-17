---
title: 'Re-address an installed host without editing .env by hand'
type: 'feature'
ticket: '15'
created: '2026-11-17'
status: 'built'
baseline_revision: '30d265497a0e6d2856427584f729e6c7a98dc661'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On an installed host, `settle` keeps `PANGOLIN_PROXY_HOSTS` and `PANGOLIN_ADMIN_NETWORK` (it only warns "edit .env to change it"), and `PANGOLIN_TRUSTED_PROXIES` is only ever appended once — so re-addressing the proxy pair, admin network, or DNS resolvers means hand-editing .env, where a comma-separated value kills the pre-8.13 render.sh on the host and leaves the running ruleset stale.

**Approach:** An `install.sh --reconfigure` mode in which those three keys take replace semantics through the existing settle path, TRUSTED_PROXIES is replaced with the identical normalized proxy list, and the SSH lockout check is promoted from warning to gate (refuses unless `--force`). `pangolin reconfigure` extracts the deploy support files from the pinned image and delegates to the same code path.

## Boundaries & Constraints

**Always:**
- Reconfigure reuses the whole main pipeline: the firewall re-apply (`install_firewall`) and `compose up -d --force-recreate` (`start_stack`) already run every run — do not add a new apply/recreate path.
- Under `--reconfigure`, `PANGOLIN_PROXY_HOSTS`, `PANGOLIN_ADMIN_NETWORK` and `PANGOLIN_DNS_SERVERS` settle as replace (typed or flagged values win over .env); a replaced `PROXY_HOSTS` also replaces `PANGOLIN_TRUSTED_PROXIES` with the identical normalized list. Without `--reconfigure`, today's keep semantics are unchanged everywhere.
- Load-bearing order: the new render.sh must reach the host before .env carries the proxy list — the installed pre-8.13 render.sh dies on comma-separated values (its :169-171) and the running ruleset stays stale.
- The SSH gate fires only on a reconfigure that replaces the admin network, only when an IPv4 `SSH_CONNECTION` client lies outside the new network; it refuses before .env is written and before any firewall or container change, unless `--force`.
- `--reconfigure` on a host with no .env yet is refused ("nothing to reconfigure") before any change.
- render.sh's apply-time resolver widening already lets a changed resolver answer: one apply is enough, no render.sh change.

**Never:** change `deploy/firewall/render.sh`; change the server (config.ts already parses the comma list); rewrite TRUSTED_PROXIES on a run that did not replace the proxy list; change the prompt default chain (`flag > .env > detect`); touch CI's staged install invocation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Proxy change | `--reconfigure --proxy-host A,B` on installed host | .env: PROXY_HOSTS = TRUSTED_PROXIES = normalized list; host render.sh replaced before .env write; firewall re-applied; container force-recreated; no TRUSTED drift warning | — |
| DNS change via prompt | `--reconfigure`, type new resolvers (no `--dns`) | .env replaced with typed values | invalid element re-asks, today's texts |
| SSH lockout | reconfigure over SSH, new admin net excludes the recorded client | dies at the gate before .env is written, naming client, network and `--force` | nothing written |
| Lockout forced | same + `--force` | warns, proceeds; new network lands in .env | — |
| SSH client inside / no SSH | client in new net, or `SSH_CONNECTION` unset | gate silent, proceeds | — |
| Nothing changed | `--reconfigure`, accept every default | no replace lines, TRUSTED_PROXIES untouched, ordinary re-run | — |
| No .env | `--reconfigure` before any install | refused before any change | die "nothing to reconfigure" |
| Keep semantics preserved | `--proxy-host` / `--admin-network` without `--reconfigure` | today's "kept ... in .env" warn path | — |
| CLI entrypoint | `pangolin reconfigure --proxy-host A,B [--admin-network N] [--dns D] [--force]` | extracts `/app/deploy` from the .env-pinned image into a staging dir, execs `sh <staging>/install.sh --reconfigure` with the flags passed through | extraction failure dies pointing at `pangolin upgrade` |
| CLI, not installed | `pangolin reconfigure` with no compose.yaml/.env | existing CLI precondition die | unchanged |

</frozen-after-approval>

## Code Map

- `deploy/install.sh` — the mode. Flags: `parse_args` :147-205 (booleans :185-189), usage header :1-45 (the "Safe to re-run" claim :3-5 must learn the new keys). `settle` :668-681 (replace = record in `$REPLACE` :675; keep = warn+overwrite :679-680); `settle_all` :683-745 — PROXY_HOSTS :687, ADMIN_NETWORK :688 become replace under the mode; `$REPLACE` append pattern :704. `write_env` REPLACE case :1134-1143 (`env_replace` :1097-1110); TRUSTED_PROXIES `env_add` :1150; drift warning :1187-1192 (set compare via `set_list` :1114). `check_ssh_session` :841-849 (warn-only today; client parse :843, `ipv4_in_network` :831-839). `main` :1790-1820: settings :1801 → settle_all :1802 → check_ssh_session :1805 → write_env :1810 → locate_support :1813 → take_pinned_files → write_files :1815 → install_firewall :1816 → start_stack :1817. render.sh atomic copy :1554-1559 (extract to a function). Reuse: `normalize_proxy_hosts` :253-258, `path()` :128, `warn` :104.
- `deploy/pangolin` — POSIX sh; inline subcommand dispatch (:35 upgrade, :279 restore); header command list :8-14; preconditions :25-28 (compose.yaml + .env readable); `HOME_DIR` :18; extraction pattern to copy: upgrade :95-96 (`docker run --rm --user 0 -v "$HOME_DIR/staging:/staging" "$TARGET_REF" sh -c 'cp ... /staging/'`); pin lives in .env `PANGOLIN_IMAGE=repo@sha256:...` (written :207-212).
- `deploy/firewall/render.sh` — DO NOT CHANGE. Comma-list validation :157-179, apply-time resolver widening :254-270, proxy4/proxy6 sets :410-411.
- `deploy/install.test.ts` — vitest, `--root` staging. `run(cmd,args,env)` :72 (sets `SSH_CONNECTION=""` — gate tests override via env), `install(...extra)` :82, `installInteractively` :159, `pinDigest` :203, `wrapDocker` :213; `describe("install.sh, re-run")` :619 is the neighbourhood.
- `deploy/pangolin.test.ts` — `PANGOLIN` :24, stub docker with staging-extraction emulation :125-135, `runUpgrade` :161.
- `docs/install.md` — `### Re-running` :182-197 (:192 is the "edit .env and re-run" sentence this replaces for these keys), `sudo pangolin` list :391-396, Troubleshooting :572.
- Do not change: `.github/workflows/ci.yml`, `apps/server`.

## Tasks & Acceptance

**Execution:**
- [ ] `deploy/install.sh` — add `--reconfigure` and `--force` booleans to `parse_args` + usage header (and refresh the header's re-run claim); die on `--reconfigure` with no .env before any change; in `settle_all` pass replace for PROXY_HOSTS and ADMIN_NETWORK when reconfiguring, and let a DNS answer differing from .env record replace too when reconfiguring (today only `--dns` :693-697 does), so a typed-at-prompt change wins; a replaced PROXY_HOSTS also records PANGOLIN_TRUSTED_PROXIES for replacement; extend `write_env`'s REPLACE case to env_replace PROXY_HOSTS, ADMIN_NETWORK and TRUSTED_PROXIES from the same normalized `$PROXY_HOSTS` (DNS_SERVERS already has its case); extract the write_files render.sh copy (:1554-1559) into `install_render_script` and, when reconfiguring, run `locate_support; take_pinned_files; install_render_script` between `check_ssh_session` and `write_env` in `main` (write_files keeps calling it — idempotent); in `check_ssh_session`, when reconfiguring with the admin net replaced and the IPv4 SSH client outside the new net, die naming client/network/`--force` unless `--force` (warn and proceed then) — gate precedes the early render copy and write_env.
- [ ] `deploy/pangolin` — new `reconfigure` subcommand before the restore branch: read `PANGOLIN_IMAGE` from `$HOME_DIR/.env`, `docker run --rm --user 0 -v` a reconfigure staging dir (not upgrade's `$HOME_DIR/staging`) and `cp -r /app/deploy` into it, then `exec sh <staging>/install.sh --reconfigure "$@"`; die on extraction failure pointing at `pangolin upgrade`; extend the header list :8-14.
- [ ] `deploy/install.test.ts` — new `describe("install.sh, --reconfigure")` covering every matrix row: fresh die; proxy replace + TRUSTED sync + no drift warning; DNS typed-at-prompt replace; SSH gate refuse / `--force` / client-inside / SSH_CONNECTION unset; accept-all-defaults no-op; keep semantics intact without the flag. Stage a pre-8.13-style host render.sh to prove the ordering fix (staged host render.sh ends up the new one).
- [ ] `deploy/pangolin.test.ts` — `describe("pangolin reconfigure")`: stub docker emulating the extraction (per :125-135), assert the extracted install.sh is exec'd with `--reconfigure` plus pass-through flags; no-.env precondition die.
- [ ] `docs/install.md` — :192 hands over to `install.sh --reconfigure` for proxy hosts/admin network/DNS (both entrypoints, `--force` caveat about SSH lockout); add `sudo pangolin reconfigure` to the admin list; update Troubleshooting :572.

**Acceptance Criteria:**
- Given the repo's suites, when `pnpm vitest run deploy`, `shellcheck -S warning deploy/install.sh deploy/pangolin`, `pnpm lint`, `pnpm typecheck` run, then all green and no existing test's assertions modified.
- Given a staged installed host, when `install.sh --reconfigure --proxy-host A,B` runs, then staged .env has `PANGOLIN_PROXY_HOSTS` equal to `PANGOLIN_TRUSTED_PROXIES` as the normalized list, and the staged host render.sh parses that comma list (proves new render.sh precedes .env content).
- Given a reconfigure refused at the SSH gate, when it exits, then .env, firewall state and containers are untouched.

## Review Triage Log

Review pass 1 (quick lens, launch order: quick): 0 high / 1 medium / 6 low / 1 false / 0 maybe-false.

| Verdict | Route | Finding | Evidence / action |
|---|---|---|---|
| low | defer | AC1's `pnpm lint` not green — 2 `noNonNullAssertion` errors in apps/server seed tests | Verified: biome reports the diagnostics in `forecast-seed.test.ts`/`forecast-assumptions-seed.test.ts`, which `git diff --name-only 30d2654` proves untouched by this change. Pre-existing baseline red, recorded to deferred-work.md |
| low | patch | docs/install.md :211-212 — missing blank line merges the new reconfigure paragraph with "To change any other setting…" | Verified in file; Markdown renders one paragraph. Action: insert blank line |
| low | patch | docs/install.md --dns row — claims re-ask fires only "with --reconfigure and no --dns"; install.sh re-asks whenever RECONFIGURE, the flag only seeds the default | Verified settings() :614-621 (`DNS_SERVERS=$ARG_DNS` feeds the prompt). Action: correct the row wording |
| low | patch | install.sh :1195-1197 — generated .env header comment still lists the old replace set, omitting --reconfigure's keys | Verified the printf text. Action: extend the comment (operator-facing promise of what a re-run replaces) |
| low | patch | install.sh :736-741 — legacy TRUSTED sync compares normalized `$PROXY_HOSTS` to the raw stored `PANGOLIN_NPM_HOST`; a same-set-but-differently-written value records a spurious TRUSTED replace | Verified raw string compare vs `normalize_proxy_hosts` at :565; 8.13 precedent compares such lists as sets. Action: compare via existing `set_list` |
| low | patch | install.sh main — reconfigure's early block calls `take_pinned_files` and main calls it again; `docker cp` into existing `$WORK/pinned` nests a copy, doubles the docker cycle and the "Taking compose.yaml…" line | Verified :1499 `docker cp "$container:/app/deploy" "$WORK/pinned"` (dir-exists nesting) and both call sites :1902/:1913; result stays correct but the "idempotently" comment overstates. Action: drop the early `take_pinned_files` (only SUPPORT is needed early; PINNED is consumed by write_files after the original call) and fix the comment |
| medium | patch | deploy/pangolin :290-293 — a pinned image whose install.sh predates --reconfigure extracts fine and dies with a bare "unknown option: --reconfigure", unhelpful at first rollout | Verified the exec path and install.sh :206 die text. Action: after the install.sh guard, check the extracted script supports reconfigure and die pointing at `pangolin upgrade`; update the docker stub and add the case |
| false | rejected | AC1's "no existing test's assertions modified" stretched by the harness-test extension (new `expect(installRenderScript).toBeDefined()`) | Refuted at the harm level: the test's original assertions are byte-identical; the extension is a mechanical consequence of the extraction the plan itself directs. The only fix would edit this build's plan → rejected per triage rule |

## Plan Change Log

## Design Notes

The ordering fix reorders steps already in `main`, no new plumbing: for `--reconfigure`, between `check_ssh_session` and `write_env` run `locate_support; take_pinned_files; install_render_script`. Support files are adjacent in both entrypoints (repo checkout, or pangolin's staging dir), so no image pull is needed. The old on-host render.sh only ever *warns* during the window today (`apply_allowlist_now` :1258-1266), but a mid-flow abort would strand a comma-list .env against a render.sh that dies — hence render.sh first, .env second.

Gate shape (inside `check_ssh_session`, after the existing parse):

```sh
if [ "$RECONFIGURE" -eq 1 ] && replace_of PANGOLIN_ADMIN_NETWORK \
   && [ "$FORCE" -eq 0 ] && ! ipv4_in_network "$client" "$ADMIN_NETWORK"; then
  die "... refuses SSH from $client ... --force to override"
fi
```

## Verification

**Commands:**
- `pnpm vitest run deploy` -- expected: install/pangolin/render suites green incl. new reconfigure tests.
- `shellcheck -S warning deploy/install.sh deploy/pangolin` -- expected: clean (CI gate).
- `pnpm lint` / `pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: full suite green (server untouched).

**Manual checks:**
- `nft -c` validation runs only in CI (`ci.yml:51-60`), not on macOS.

## Implementation Notes

Shipped as planned; no design deviation except two notes below (the pre-gate "Replacing" log, and
one existing harness test extended to extract a function).

**deploy/install.sh**
- `--reconfigure` / `--force` flags + usage text; header claim updated. Refuses before any write
  when `$INSTALL_DIR/.env` does not exist yet (right after `require_root`).
- `replace_of KEY` helper over `$REPLACE`; settle-then-check so `PANGOLIN_TRUSTED_PROXIES` moves
  with the proxy list: recorded when the key exists AND (`PANGOLIN_PROXY_HOSTS` was replaced, or
  `.env` predates that key and this run's list differs from the stored `PANGOLIN_NPM_HOST` the
  answer defaulted from — the pre-8.13 legacy case, added at diff review). Same normalized
  `$PROXY_HOSTS` written to both keys — they cannot drift. Absent-TRUSTED: left to the existing
  `env_add` (recording it there would claim a "Replaced" that `env_replace` never performed).
  Accepting the legacy default verbatim leaves TRUSTED untouched.
- `settle_all`: under `--reconfigure` the proxy/admin settles run with `replace`; the DNS settle
  runs with `replace` when `--dns` was given or `--reconfigure` is on. Keep-and-warn semantics are
  untouched without the flag (existing tests prove it).
- DNS under `--reconfigure`: the resolver question re-fires with default = flag > .env > detect;
  an invalid element is re-asked with today's text (`not a DNS resolver IP: X`).
- SSH gate inside `check_ssh_session`: fires only when `--reconfigure` replaces
  `PANGOLIN_ADMIN_NETWORK` and the IPv4 client lies outside the new network. Dies naming client,
  network and `--force`; `--force` downgrades to a warning. Existing warn text kept verbatim for
  every other path.
- Ordering fix: `install_render_script()` extracted from `write_files`; `main` runs
  `locate_support; take_pinned_files; install_render_script` right after `check_ssh_session`
  when `--reconfigure` (so the gate precedes all writes, and a pre-8.13 on-host render.sh never
  sees a comma-list `.env`). `write_files` keeps calling it (idempotent).
- Note: `settle()` prints "Replacing X in .env: ... (asked for on this run)" at settle time — a
  pre-existing convention (shared with `--data-root` & friends) — so a gate-refused run shows
  that line before dying. The proof nothing was written is the absence of write_env's
  "Replaced X in .env" line plus untouched files; the test asserts exactly that.

**deploy/pangolin**
- `reconfigure` subcommand: image from `.env` (quote-stripped, last wins), extracts via
  `docker run --rm --user 0 -v "$STAGING:/staging" IMAGE sh -c 'cp -r /app/deploy/. /staging/'`
  into `$HOME_DIR/reconfigure-staging` (never upgrade's `$HOME_DIR/staging`), then
  `exec sh "$STAGING/install.sh" --reconfigure "$@"`. Dies pointing at `pangolin upgrade` when
  the image is missing/unextractable or carries no install.sh. Usage header line added.

**Tests**
- `deploy/install.test.ts`: new `describe("install.sh, --reconfigure")` (13 tests: fresh-host
  refuse, proxy replace + TRUSTED sync + no drift, pre-8.13 fake render.sh ordering proof, DNS
  re-ask at the prompt, gate refuse + untouched .env/ruleset/allowlist/render.sh, --force warn,
  client-inside silence, no-SSH silence, accept-all-defaults no-op, force-recreate, keep-semantics
  without the flag, legacy `.env`: stale TRUSTED follows a new proxy list, and keeping the stored
  NPM_HOST default leaves TRUSTED untouched).
- Extended one existing harness test ("installs the new render.sh before write_allowlist can
  reload the firewall"): its regex-extracted script now also extracts `install_render_script`,
  because `write_files` delegates to it. Its assertions are unchanged.
- `deploy/pangolin.test.ts`: new `describe("pangolin reconfigure")` (7 tests) with a docker stub
  that plays the image copy-out.

**docs/install.md**: flag table (`--proxy-host`/`--admin-network` reconfigure notes, new
`--reconfigure`/`--force` rows, `--dns` re-ask), Re-running section (replace semantics, SSH
lockout gate, `sudo pangolin reconfigure` examples), admin command list + bullet, Troubleshooting
"A setting is ignored on re-run".

**Verification**
- `pnpm vitest run deploy` — 260 passed (5 files).
- `shellcheck -S warning deploy/install.sh deploy/pangolin` — clean.
- `pnpm exec biome lint deploy` — 0 errors, 0 warnings.
- `pnpm typecheck` — green.
- `pnpm lint` — fails on 2 pre-existing `noNonNullAssertion` errors in apps/server test files
  (`forecast-seed.test.ts:241`, `forecast-assumptions-seed.test.ts:293`, committed in `f2e1895`,
  ancestor of the baseline). apps/server is out of this story's scope; unrelated to this change.

**Review patch pass** (quick lens, see Review Triage Log):
- `settle_all` legacy TRUSTED sync compares `$PROXY_HOSTS` vs stored `PANGOLIN_NPM_HOST` as sets
  (`set_list`) — a same-set list written differently no longer records a spurious replacement.
- Early reconfigure block runs `locate_support; install_render_script` only: `take_pinned_files`
  stayed at its original call site, because a second `docker cp` would nest inside `$WORK/pinned`
  and double the "Taking compose.yaml…" line; the comment now says exactly which steps repeat.
- Generated `.env` header comment lists `--reconfigure`'s replaced keys alongside the old set.
- `pangolin reconfigure` greps the extracted install.sh for `--reconfigure` support and dies
  pointing at `pangolin upgrade` when it predates the flag (the rollout case: an older pinned
  digest); docker-stub carries the marker, new test for the predating installer.
- docs: blank line restored before "To change any other setting…"; `--dns` row now matches the
  code (the re-ask fires on `--reconfigure`; the flag only seeds the default).
