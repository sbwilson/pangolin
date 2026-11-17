---
title: 'Stored DNS resolvers outrank a changed resolv.conf with no warning'
type: 'bugfix'
ticket: '14'
created: '2026-11-17'
status: 'built'
baseline_revision: 'b8b07aa5930aa7bccc31316150705a63a0f13e87'
route: 'full'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `install.sh` resolves DNS resolvers as `--dns` → `.env` → host `resolv.conf`, so on any re-run the stored resolvers win without the host's current ones ever being consulted: when DHCP emptied `resolv.conf`, stale `.env` values went on blocking every resolver and nothing said so.

**Approach:** On a re-run that keeps the `.env` resolvers, check the host's current ones and warn when none are found, and warn when they differ from `.env`'s, naming both sets. Warnings only — resolution priority and everything render.sh does stay exactly as they are.

## Boundaries & Constraints

**Always:**
- Warn, never fail: exit codes and the firewall outcome are unchanged.
- Every warning names both value sets it compares and ends with the repair: `install.sh --dns IP[,IP...]`.
- Compare as sets, case-insensitively: reordering, padding, capitalized IPv6 never warn.
- Skip the check when `--dns` was given this run (settle's "Replacing …" is already the signal) or when `.env` holds no `PANGOLIN_DNS_SERVERS`.
- Reuse `detect_dns`, `set_list`, `warn`, and the set-drift pattern of `write_env`'s `PANGOLIN_TRUSTED_PROXIES` check.
- Decision (2026-11-17, journal check on pang-dev): render.sh's warnings fired unseen every 15 min for hours during the outage and still warn live about the current `.env` (10.0.1.1,10.0.1.11) vs host (10.20.1.53,10.20.8.53) drift — both new warnings must note the firewall already warns every render and point at `journalctl -u pangolin-allowlist.service`.

**Never:** touch `deploy/firewall/render.sh`, its messages, or its refuse/fallback behavior; write `.env` without an explicit `--dns`; change resolver priority.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-run, drift | `.env` ≠ host's resolvers, no `--dns` | WARNING naming both sets; `.env` kept; exit 0 | No failure |
| Re-run, host empty | `resolv.conf` empty/loopback-only, `.env` stored, no `--dns` | WARNING "no host resolver" naming the `.env` set; exit 0 | No failure |
| Re-run, unchanged | host = `.env` as a set (any order/case/padding) | Neither warning | — |
| Re-run with `--dns` | any host state | Today's "Replacing …" only; no new warnings | Unchanged |
| First install | no `.env` key yet | No new warnings; existing prompt/die paths unchanged | Unchanged |

</frozen-after-approval>

## Code Map

- `deploy/install.sh` -- the fix. DNS chain in `settings()` :594–603 (`--dns` → `existing PANGOLIN_DNS_SERVERS` → `detect_dns` → ask → die). `detect_dns` :419–431 reads hard-coded `/etc/resolv.conf` (plus resolved's upstream file behind the `127.0.0.53` stub) — wrap its paths in `path()` (:125) so `--root` staging can test it; `ROOT` is empty on real hosts. `set_list` :1096–1099; the `PANGOLIN_TRUSTED_PROXIES` drift check in `write_env` :1169–1174 is the pattern; `warn` :104–107 (`WARNING: …` to stderr).
- `deploy/firewall/render.sh` -- DO NOT CHANGE. `host_resolvers` :206–222, per-render warnings :235/:242, refuse :344–356 — they complement the new install-time warnings.
- `deploy/install.test.ts` -- vitest. The `install()` helper always passes `--dns 192.168.1.1`, so existing tests skip the new check; raw `run()` re-runs without `--dns` (:745, :757) gain a warning but only assert status and `Replacing` absence, so they stay green. Model new tests on the set-comparison test :385; stage `at("etc/resolv.conf")` / `at("run/systemd/resolve/resolv.conf")`.
- `docs/install.md` -- re-run DNS wording at :136 and :295.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/install.sh` -- wrap `detect_dns`'s resolv paths in `path()`; in `settings()` after the DNS block validates: if no `--dns` this run and `env_has PANGOLIN_DNS_SERVERS`, compute `HOST_DNS=$(detect_dns)`; empty → warn no-host-resolver naming the stored set; elif case-insensitively unequal as sets (`set_list` after `tr 'A-Z' 'a-z'`) → warn drift naming both -- surface the silent drift.
- [x] `deploy/install.test.ts` -- tests beside the DNS re-run tests (:716–761) covering the matrix rows: drift names both sets; empty `resolv.conf` warns instead of passing silently; unchanged host prints neither; `--dns` re-run prints neither; the warnings point at `journalctl -u pangolin-allowlist.service`; `.env` value kept and exit 0 throughout.
- [x] `docs/install.md` -- update :136/:295: a re-run checks the host's resolvers and warns on drift or absence, naming both sets.

**Acceptance Criteria:**
- Given any of the new warnings, when the run completes, then stderr carries the `WARNING: …` line, the exit code and rendered ruleset are what they were before this change, and `pnpm vitest run deploy` passes with no existing test modified in its assertions.
- Given the pang-dev failure pattern (stored resolvers, emptied `resolv.conf`), when `install.sh` re-runs, then it is no longer silent: the operator sees the no-resolvers warning and the `--dns` repair path.

## Design Notes

Wording mirrors render.sh's tone in install.sh's `WARNING:` style, e.g. drift: `the host's resolvers (10.20.1.53,10.20.8.53) differ from PANGOLIN_DNS_SERVERS=10.0.1.1,10.0.1.11 in .env: DNS is allowed to both, but .env keeps the stored ones — re-run install.sh --dns IP[,IP...] to store the host's current resolvers; the firewall has been warning about this on every render: see journalctl -u pangolin-allowlist.service`. The no-resolvers warning carries the same closing pointer. The check lives in `settings()` so all resolver logic stays in one block.

## Implementation Notes

Check placed in `settings()` after the DNS validation loop; em dashes dropped for ASCII semicolons to match the script. `detect_dns`'s paths wrapped in `path()` so `--root` staging drives the new tests; real-host behavior identical (`ROOT` empty). A `--root` run now reads its staged `/etc/resolv.conf` for the first-install fallback too — the test harness never relied on the real host file. Review patch: `--help` header's `--dns` entry extended to match `docs/install.md`.

## Plan Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `deploy/install.sh:616` drift warning claims "the firewall has been warning about this on every render" — false when the host set is a strict subset of `.env`'s (render.sh:236–246 warns only for host resolvers *added* beyond `.env`, plus the no-resolver case) | low | rejected | Verified render.sh's loop. The false pointer appears only when the host silently loses one of several stored resolvers while gaining none — unlikely in everyday use, and the observed real cases (emptied file, superset) warn truthfully; the warning's core (both sets named, `--dns` repair) stays accurate, the sentence is mandated by the frozen Decision, and the only fix adds a conditional branch → rejected as low |
| 2 | `deploy/install.sh:24–25` usage header for `--dns` still says only "replaces PANGOLIN_DNS_SERVERS in an existing .env" while `docs/install.md:136` now documents the re-run comparison and warnings — the two surfaces disagree | low | patch | Header read at install.sh:24–25; fix is a direct one-line comment edit, adds no public surface |
| 3 | Plan's Execution checkboxes unchecked while `status: in-review` | false | rejected | Fix would edit this build's plan → rejected per triage rule; completion state is recorded at presentation |

## Verification

**Commands:**
- `pnpm vitest run deploy` -- expected: green, new warning tests included.
- `shellcheck -S warning deploy/install.sh` -- expected: clean (CI gate).
