---
title: 'DNS drift recovery'
type: 'bugfix'
ticket: '4'
created: '2026-10-03'
status: done
baseline_revision: 'dcb9b71eaca3c89d60c77da60f3517b2905aace6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The firewall allows DNS only to the resolver IPs frozen in `.env` (`PANGOLIN_DNS_SERVERS`). If the host's resolvers change, every allowlist lookup fails, the 15-minute re-render saves a ruleset with empty host sets, and all egress (backups, GHCR) stops. `install.sh --dns` does not fix it: `settle_all` keeps the stored value and warns "kept PANGOLIN_DNS_SERVERS", because DNS is settled without `replace` (`install.sh` ~550) (retro S8).

**Approach:** Reproduce both failures in tests first. Then: `--dns` replaces the stored resolvers; `render.sh` also allows DNS to the resolvers the host currently uses, so the 15-minute re-render follows a resolver change by itself; and `render.sh apply` refuses to load or save a ruleset in which no allowlist host name resolved, keeping the last good ruleset and exiting non-zero with a warning that names the likely cause and the fix.

## Boundaries & Constraints

**Always:** A run where some host names resolve and some do not behaves as today (the unresolved ones are blocked with a warning). The refusal applies only when every host-name entry failed and at least one exists. The saved ruleset and the loaded one never become emptier than the last good one because of a DNS failure. The timer's failure shows in `journalctl -u pangolin-allowlist.service`.

**Never:** Allow DNS to any address other than the resolvers in `.env` and the host's own current resolvers (port 53 only). Change the boot path (`render.sh boot`) or the fail-closed fallback.

**Decision (human, 2026-10-03):** the firewall follows the host's resolvers automatically (option b): `render.sh` allows DNS to the nameservers in the host's current resolver configuration as well as those in `.env`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `--dns` on a re-run | `.env` has old resolvers, `--dns 10.0.0.9` | `.env` gets the new value ("Replacing PANGOLIN_DNS_SERVERS"), firewall re-rendered with it | No error |
| Host resolvers changed | `/etc/resolv.conf` (or systemd-resolved's upstream file) now lists a new resolver; `.env` unchanged | the next re-render (timer or install) allows DNS to the new resolver too; host names resolve again; ruleset applied | No error |
| Host resolver is loopback | only `127.0.0.53` (systemd-resolved stub) in `/etc/resolv.conf` | the upstream file `/run/systemd/resolve/resolv.conf` is read instead, as `detect_dns` does; loopback, link-local and zone-scoped addresses are never added | No error |
| Plain re-run, resolvers unchanged | no `--dns` | unchanged from today | No error |
| Every host name fails to resolve | allowlist has host names, none resolve | ruleset not loaded or saved; last good stays; exit non-zero | warning: "no allowlist host resolved: the DNS resolvers in .env (…) may have changed; re-run install.sh --dns IP[,IP...]" |
| Some host names fail | one of several does not resolve | applied as today, with today's per-host warning | No error |
| Allowlist with only addresses | no host names | applied as today | No error |
| First install, every name fails | no saved ruleset yet | install.sh reports the refusal and stops before starting the stack | install fails with the same guidance |

</frozen-after-approval>

## Code Map

- `deploy/install.sh:550` `settle_all` -- `settle DNS_SERVERS PANGOLIN_DNS_SERVERS` keeps the stored value. When `ARG_DNS` is set, settle with `replace` (as the backup server does at ~553), so `write_env`'s `REPLACE` path writes it (`env_replace`, see ~905-910 for the pattern). `settings` already prefers `ARG_DNS` (~471).
- `deploy/firewall/render.sh` (~176-178, the `dns4`/`dns6` sets) -- also add the host's current resolvers: read nameservers the way `install.sh` `detect_dns` does (~335-346: `/etc/resolv.conf`, falling back to `/run/systemd/resolve/resolv.conf` when it only has loopback; skip loopback, `::1`, link-local `fe80:` and `%`-scoped). Make the resolv.conf paths overridable for tests (an env var, as other paths in render.sh are under `--root`/`DIR`). Validate each with `is_ipv4`/`is_ipv6`; skip invalid ones with a warning rather than dying.
- `deploy/firewall/render.sh` -- the allowlist loop (~206-246) records unresolved names in `$WORK/notes` (`did not resolve: …`). Count host-name entries and resolved ones; in `apply` (~402) and `ruleset`, when names > 0 and resolved == 0, `die`/exit non-zero before `nft -f` with the matrix's warning. `proxmox` output follows the same rule only if it shares the path (do not save `proxmox-firewall.txt` either).
- `deploy/install.sh` firewall step (`install_firewall`, find `render.sh apply` ~1209) -- surface render.sh's refusal as an install failure with the same guidance (today `set -e` stops; check the message reaches the user).
- `deploy/firewall/pangolin-allowlist.service` -- no change expected (a non-zero exit marks the run failed in the journal); check.
- Tests: `deploy/install.test.ts` (settle tests for `--image`/`--backup-server` replace show the pattern; `--root` staging, render.sh runs with `--no-docker`?) and the firewall render tests (find them: `deploy/firewall/*.test.ts` or in `install.test.ts`); `getent` is stubbed or overridable for render.sh tests — find how existing tests feed resolution.
- `docs/install.md` §8 (firewall) -- a "resolvers changed" paragraph: the firewall follows the host's resolvers within 15 minutes; `--dns` sets extra or replacement ones in `.env`; the refusal and its message.

- **Order of a render (loop 1):** names are resolved through the ruleset in force, which only allows DNS to the resolvers it was built with. So `render.sh apply`, before resolving any name, adds every resolver it will allow (`.env` plus the host's) to the live `inet pangolin` `dns4`/`dns6` sets with `nft add element` (when the table exists; skip silently when it does not, as on a first install where the table is not loaded yet). Only then resolve, count, and apply or refuse. A refusal leaves those added DNS elements in place (they are a strict widening limited to port 53 to resolvers `.env` or the host names), so the next run can resolve. `install.sh --dns` gets the same effect because its `pangolin-allowlist.service` start runs `render.sh apply`.
- **Tests model the firewall (loop 1):** the render tests' `getent` stub answers only when the resolver the test host uses (the fixture resolv.conf's first nameserver) is allowed: in the `dns4` elements of the last ruleset `nft -f` loaded, or added by `nft add element` (both read from the stub `nft`'s log). The drift test starts with a loaded ruleset for the old resolver, switches the fixture resolv.conf to a new one, and shows the next `apply` loads a ruleset allowing it and the hosts resolve; a `--dns` re-run is shown the same way.
- `host_resolvers` also drops `0.0.0.0`, `::` and IPv4-mapped (`::ffff:`) addresses; lower-case IPv6 before comparing, so one resolver written two ways is added once.
- When a host resolver not in `.env` is added, `render.sh` prints a warning naming it (it lands in the timer's journal), since it widens DNS egress beyond `.env`.
- `render.sh proxmox` refuses like `ruleset` and `apply` when no name resolved.
- An install test writes `<root>/etc/resolv.conf` (and the stub-plus-upstream pair) and asserts the staged `pangolin.nft` `dns4` set and `proxmox-firewall.txt` DNS lines include those resolvers.
- `docs/install.md` §8: the Proxmox host's rules are pasted by hand, so they do not follow a resolver change; re-paste `proxmox-firewall.txt` after one.

## Tasks & Acceptance

**Execution:**
- [x] tests first -- reproduce `--dns` being kept, a changed host resolver left blocked, and an all-unresolved apply saving empty sets
- [x] `deploy/install.sh` -- `--dns` replaces
- [x] `deploy/firewall/render.sh` -- allow the host's current resolvers; refuse an all-unresolved ruleset
- [x] docs -- §8 paragraph

**Acceptance Criteria:**
- Given a host whose resolvers changed, when the next re-render runs (with no operator action), then the loaded ruleset allows the new resolvers and the allowlist hosts resolve again.

## Implementation Notes

## Plan Change Log

- Loop 1 (review pass 1, `bad_plan`): the plan did not order a render. Names are resolved through the ruleset in force, which blocks DNS to a changed resolver, so every lookup failed, the all-unresolved guard refused, and the ruleset allowing the new resolver was never loaded; `install.sh --dns` hit the same refusal. The tests missed it because the `getent` stub ignored the firewall. Amended the Code Map: `apply` first adds the resolvers it will allow to the live DNS sets, then resolves; the stub `getent` answers only when the resolver is allowed by the stub `nft`'s state; plus the low findings below (filters, de-dup, warning, proxmox refusal, staged-root test, Proxmox docs). Known-bad state avoided: a host whose resolvers changed stays blocked forever, and the documented repair fails. KEEP: `--dns` settled with `replace` and written by `env_replace`; `host_resolvers` (resolv.conf, the systemd-resolved upstream file behind `127.0.0.53`, `PANGOLIN_RESOLV_CONF`/`PANGOLIN_RESOLVED_CONF` overrides, address-only validation with a warning, not added to the fail-closed rulesets); the `NAMES`/`RESOLVED` count and the exact refusal message, `--no-resolve` names not counted; install.sh printing that run's `render.sh:` journal lines when the allowlist unit fails, and the reworded die; staged `--root` installs reading resolver files under the root; the stub `getent`/`id`/`nft` harness with fixture resolver files; the §8 paragraph, the `--dns` options row and the "Re-running" list. The first diff is saved as `story-11-4-pass1.diff` in the scratchpad.

## Review Triage Log

Pass 1 (thorough; blind-hunter, edge-case-hunter, verification-gap, intent-alignment): high 1, medium 2, low 6, false 0, rejected low 3, deferred 2.

| Verdict | Route | Finding and evidence |
|---|---|---|
| high | bad_plan | Lookups run through the ruleset in force, which blocks a changed resolver: every name fails, the guard refuses, and the new resolver is never loaded; `install.sh --dns` hits the same refusal. The `getent` stub answered regardless of the firewall, so the tests passed. Loop 1. |
| medium | bad_plan (moot) | A staged `--root` install's resolver wiring had no test. Folded into loop 1. |
| medium | bad_plan (moot) | DNS egress widened to whatever resolv.conf says without any log line. Folded into loop 1 (a warning). |
| low | bad_plan (moot) | `0.0.0.0`, `::` and `::ffff:` addresses passed the filter. |
| low | bad_plan (moot) | IPv6 resolvers written two ways were added twice. |
| low | bad_plan (moot) | `render.sh proxmox` did not refuse like `ruleset`/`apply`. |
| low | bad_plan (moot) | Docs said the firewall follows resolvers; the Proxmox rules, pasted by hand, do not. |
| low | rejected | The resolv.conf parsing is copied from `detect_dns`: render.sh runs alone on the host from the timer and cannot source install.sh; both copies carry a comment naming the other. |
| low | rejected | One retired host name in a one-name allowlist makes every apply refuse with DNS advice: real allowlists hold several providers' names; all failing means DNS is broken. |
| low | rejected | `--dns` with an invalid value or an IPv6 list is untested on replace: `settings` already validates `--dns` before `.env` is touched. |
| defer | defer | The install.sh journal-surfacing block on a real (non-`--root`) install has no test; needs a systemctl/journalctl harness. |
| defer | defer | A refusing timer run only fails its unit: no alert reaches the operator. |

Pass 2 (loop 1 re-derivation; same four lenses): high 0, medium 2, low 7, false 1, rejected low 5, deferred 0 new (2 carried).

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch (done) | A `--dns` re-run that adds a package-mirror entry applies the firewall before `write_env` stores `--dns`; on a stuck host the render refuses and the install dies before the fix lands. The early apply now warns and continues. |
| medium | patch (done) | The refusal message named only `.env`'s resolvers though the host's were tried too, and an upstream outage reads the same; it now lists every resolver tried and both causes. |
| low | patch (done) | `host_resolvers` dropped real nameservers listed beside `127.0.0.53`, missed an indented stub, and matched only `fe80:` for link-local; a host with only a local forwarder gave no hint. |
| low | patch (done) | `detect_dns` and `host_resolvers` filtered differently although both say to keep in step. |
| low | patch (done) | The install failure excerpt could miss unflushed journal lines, show an earlier invocation's, or push out the fatal line. |
| low | patch (done) | Docs: "follows by itself" needs the Proxmox caveat; the widening also reaches a live fail-closed table and the containers; a refused re-run leaves the stack on its old settings. |
| low | patch (done) | Missing tests: `nft add element` failing, `ruleset`/`proxmox`/`fallback` never calling `nft`, the stub without an upstream file, duplicate and mixed nameservers, `fe90::`. |
| false | rejected | An opt-out from following the host's resolvers: the human chose option (b) on 2026-10-03; the widening is logged and documented. |
| low | rejected | Canonical comparison of differently written addresses (`2001:db8:0::53`, leading zeros): only a duplicate element and a repeated warning; canonicalising in POSIX sh adds a parser. |
| low | rejected | `/etc/hosts` or a resolver cache can satisfy one name and pass the guard: the guard is a backstop for a total failure; per-name blocking is today's behaviour. |
| low | rejected | `render.sh ruleset`/`proxmox` run by hand refuse where `apply` would widen first: they are read-only previews; the message names the fix. |
| carried | defer | The install.sh journal-surfacing block on a real install has no test (pass 1). |
| carried | defer | A refusing timer run raises no alert (pass 1). |
| carried | rejected | The resolv.conf parsing exists in render.sh and install.sh (pass 1); the filters are now aligned. |

## Verification

**Commands:**
- `npx vitest run deploy` -- expected: pass, except the macOS-only failures (GNU `sed`, `script`)
- `shellcheck -S warning deploy/install.sh deploy/firewall/render.sh` -- expected: clean
