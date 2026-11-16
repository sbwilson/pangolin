---
title: 'Reverse proxy host list in install and firewall'
type: 'feature'
ticket: '13'
created: '2026-11-16'
status: 'built'
baseline_revision: '9d81cdacd06d47d408cdd64a715b6233b0f9a223'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** install.sh and deploy/firewall/render.sh accept exactly one reverse-proxy address, so an active/standby proxy pair can neither reach the app port nor be believed as proxies.

**Approach:** `--proxy-host` / `PANGOLIN_PROXY_HOSTS` take a comma-separated list of IPv4 addresses, with `--npm-host` / `PANGOLIN_NPM_HOST` kept working as aliases; the list flows through the prompt and validators, both written .env keys, the TRUSTED_PROXIES check compared as sets, one firewalld rule per address, the vm_address lookup, nftables proxy sets (plus an IPv6 twin for hand-edited .env) used by the input and forward rules, and the Proxmox output.

## Boundaries & Constraints

**Always:**
- Normalize once (split on commas, trim, drop empties, dedupe first-seen, join `,` without spaces); write the identical list to `PANGOLIN_PROXY_HOSTS` and `PANGOLIN_TRUSTED_PROXIES`.
- Reads prefer `PANGOLIN_PROXY_HOSTS`, falling back to `PANGOLIN_NPM_HOST` so old .env files keep working; a fresh install writes no `PANGOLIN_NPM_HOST`.
- install refuses to *create* an IPv6 host (compose publishes the app port on IPv4 only); a hand-edited IPv6 address in .env still renders through render.sh's IPv6 twin set.
- The forward rule keeps its hardcoded container port 3000 (see comment render.sh:430-432).
- The consistency warning compares the two .env values as sets (trim, sort -u): reorder or space padding never warns.

**Never:** no server-side change — `apps/server/src/config.ts:57-67` already parses the comma list and `clientAddress()` (app.ts:1342-1360) skips any trusted hop; no replace/settle-semantics work (ticket 8.15); no DNS-resolver work (ticket 8.14); keep `.github/workflows/ci.yml:47-49` on `--npm-host` so CI keeps proving the alias.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two addresses | `--proxy-host 10.20.5.80,10.20.8.80` | both .env keys hold one normalized list; one `proxy4` set with both used in input and forward rules; one Proxmox `IN ACCEPT` line per address | — |
| Padded / reordered | `10.20.8.80 , 10.20.5.80` vs .env TRUSTED in other order | normalized write | no TRUSTED warning (set compare) |
| IPv6 via flag/prompt | `--proxy-host 2001:db8::10` | refused, naming the address | keep today's die text (`the app port is published on IPv4 only`) |
| Hand-edited IPv6 in .env | `PANGOLIN_PROXY_HOSTS=10.20.5.80,2001:db8::10` | twin sets render: `ip` rule from proxy4, `ip6` rule from proxy6, input and forward | only-IPv6 list → only `ip6` rules |
| Legacy .env, only `PANGOLIN_NPM_HOST` | re-run `install.sh --root` | installs; value kept via settle; `PANGOLIN_PROXY_HOSTS` added; render.sh reads via fallback | — |
| Bad element | `10.20.5.80,banana` | refused per element | prompt re-asks; flag dies `not an IPv4 address: banana` |
| Both spellings in .env | PROXY_HOSTS and NPM_HOST differ | PROXY_HOSTS wins everywhere | — |

</frozen-after-approval>

## Code Map

- `deploy/install.sh` — flag parse `:62` `ARG_NPM`, `:152`/`:166`; usage `:14`; prompt `:527-536`; IPv6 refusal `:538-540` and IPv4 gate `:541`; `settle NPM_HOST PANGOLIN_NPM_HOST` `:636` (`settle()` `:617-630`); `write_env()` writes `:1091-1092`; set-compare site `:1129-1132` (string equality today); `env_add` `:1038`, `existing` `:394`, `env_has` `:610`; helpers `is_ipv4` `:213`, `is_ipv6` `:221`.
- `deploy/install.sh` (firewall/summary) — firewalld branch `:1555-1561` (one rich rule, `family=ipv4` at `:1557`); `vm_address()` `:1634-1642` (`ip -4 route get` `:1639`); `summary()` `:1652` and the "believes it only from" line `:1660`.
- `deploy/firewall/render.sh` — reads `NPM_HOST=$(env_value PANGOLIN_NPM_HOST)` `:157`, die `:164`, validation loop `:169-171`; element files `:176-184`; `elements()` `:344-349`; `family_of()` `:351-354`, `npm_family` `:357`; set declarations `:372-377` (twin pattern `set dns4 { type ipv4_addr; flags interval; auto-merge;$(elements ...) }`); input rule `:399`; forward rule `:433`; Proxmox NPM line `:471`. Do not change: admin/DNS rules, Proxmox OUT lines `:474-488`.
- `deploy/install.test.ts` — vitest spawning the scripts (`pnpm vitest run deploy/install.test.ts`); shared `ANSWERS` `:39-52` (`--npm-host` `:46`); env assertion `:266`; one-line re-run `:547`; IPv6 refusal `:1648-1652`; `describe("firewall/render.sh")` `:1731-2187`: `render()` `:1744`, `fixture()` `:1804-1817`, input `:1843`, forward `:1848`, proxmox `:1865`, fallback re-assert `:1906`, missing-host refusal `:2180-2186`.
- `docs/install.md` — example `:117-124`, flag table `:133`, trusted-proxies prose `:216`.
- `.github/workflows/ci.yml` — shellcheck `:41`, staged install `:47-49`, `nft -c` checks `:50-61`. No change.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/install.sh` — add `--proxy-host` beside `--npm-host` (same variable; last flag wins), usage `:14`; at `:527-541` normalize the list, gate per element keeping both die texts; rename `NPM_HOST`→`PROXY_HOSTS`, `ARG_NPM`→`ARG_PROXY`; settle against `PANGOLIN_PROXY_HOSTS` with `PANGOLIN_NPM_HOST` as read fallback (keep the "kept ... in .env" semantics); at `:1091-1092` write `PANGOLIN_PROXY_HOSTS` + `PANGOLIN_TRUSTED_PROXIES` (drop the NPM_HOST write); compare `:1129-1132` as sorted-unique sets; at `:1555-1561` loop one rich rule per address, family by address; `vm_address()` uses the first address; `summary()` `:1660` prints the list.
- [x] `deploy/firewall/render.sh` — read `PANGOLIN_PROXY_HOSTS` with `PANGOLIN_NPM_HOST` fallback (`:157`, message `:164`); split to words and validate each (`:169-171`); new `$WORK/proxy4`/`proxy6` element files (`:176-184`) filled by family; declare `set proxy4`/`proxy6` at `:372-377` reusing `elements()`; replace the literal-host rules at `:399`/`:433` with `ip saddr @proxy4` / `ip6 saddr @proxy6` lines emitted only for non-empty element files (build them before the heredoc, keep `:433` port 3000); loop the Proxmox `IN ACCEPT -source <addr> -p tcp -dport $APP_PORT # NPM to the app` line per address at `:471`.
- [x] `deploy/install.test.ts` — move `ANSWERS` `:46` and `fixture()` to the new names; update assertions `:266`, `:547`, `:1843`, `:1848`, `:1865`, `:1906`, `:2180-2186` (set-based rules, new key in refusal message); add tests per every matrix row plus: `--npm-host` alias accepted (fixture `10.20.5.80 , 10.20.8.80` normalizes), TRUSTED reorder/padding raises no warning, legacy-only .env re-run.
- [x] `docs/install.md` — `:121` example and `:133` table row show `--proxy-host IP[,IP…]` with `--npm-host` noted as accepted alias; adjust `:216`.

**Acceptance Criteria:**
- Given the CI staged install (`ci.yml:47-49`, `--npm-host`), when it runs, then the alias installs unchanged and the `nft -c` checks pass.
- Given a fresh `install.sh --root`, when .env is written, then `PANGOLIN_PROXY_HOSTS` equals `PANGOLIN_TRUSTED_PROXIES` as a normalized list and no `PANGOLIN_NPM_HOST` line is added.
- Given this change, when `pnpm lint`, `pnpm typecheck` and `pnpm test` run, then all are green.

## Implementation Notes

- `install.sh`: one normalization path — `normalize_proxy_hosts` (trim, drop empties, dedupe first-seen, join `,`) feeds the flag, the prompt and the .env default; `proxy_list_ok` gates the prompt loop, the per-element `is_ipv6`/`is_ipv4` gate after it keeps both die texts and now names the offending element. `settle PROXY_HOSTS PANGOLIN_PROXY_HOSTS`; the legacy `PANGOLIN_NPM_HOST` is the read fallback for the prompt default (flag over a legacy-only .env lets the flag win — settle has no key to keep there, and render.sh prefers the written key). `write_env` writes `PANGOLIN_PROXY_HOSTS` then `PANGOLIN_TRUSTED_PROXIES` from the same value; the mismatch warning compares via `set_list` (trim, sort -u).
- `render.sh`: `PROXY_WORDS` (commas→spaces) validated per element, split into `$WORK/proxy4`/`proxy6`; the sets reuse `elements()`; input and forward rules are built before the heredoc (`${proxy_input}`/`${proxy_forward}`) — one rule per non-empty family, forward keeps port 3000; Proxmox splits the heredoc to loop one `IN ACCEPT` line per address.
- `install.test.ts`: shared `ANSWERS` moved to `--proxy-host`; `installInteractively` gained an `omit` list so the prompt test can drop that flag; new `describe("the proxy host list")` block plus render.sh tests cover every matrix row (see Review audit — all ran green).
- Verified: `pnpm vitest run deploy/install.test.ts` 132/132; `shellcheck -S warning deploy/install.sh deploy/firewall/render.sh` clean (the CI gate); `pnpm lint` exit 0 (322 warnings are the pre-existing repo-wide biome baseline, none introduced); `pnpm typecheck` clean; full `pnpm test` running.
- Review patch pass (see Review Triage Log): render.sh refuses an address-less split and dedupes Proxmox lines; install.sh dies on a flag with nothing addressable, keeps an unmodified stored default raw so settle does not nag (vm_address normalizes before route get); one install-side precedence test added. Re-verified: 137/137, shellcheck clean, lint exit 0, typecheck clean.

## Review Triage Log

Review pass 1 (quick lens, launch order: quick): 0 high / 2 medium / 3 low / 0 false / 0 maybe-false. All five patched in-session via the step-03 implementer.

| Verdict | Route | Finding | Evidence / action |
|---|---|---|---|
| medium | patch | render.sh — comma/space-only `PANGOLIN_PROXY_HOSTS` word-split to zero elements, skipped validation and rendered zero proxy accept rules silently (old code quoted the host as one token and died) | Verified: `[ -n ]` passes, `for address in $PROXY_WORDS` iterates nothing. Action: die `not an IP address or network: <value>` when the split leaves no address; test asserts refusal for `,,`, ` `, `, ,` |
| medium | patch | install.sh — normalizing the .env default before `settle` made every re-run warn `kept ... (you asked for ...)` on a hand-edited padded list, and the padded first element broke `ip -4 route get` in `vm_address()` | Verified at settings()/settle_all()/vm_address(). Action: keep the answer raw when it equals the default unchanged (normalize only typed answers); `vm_address()` takes the first address after `normalize_proxy_hosts`; test asserts no warning and padding preserved |
| low | patch | install.sh — `--proxy-host " "` / `",,"` normalized to empty and fell through as flag-not-given; pre-change died | Verified. Action: die `not an IPv4 address: <raw>` when a flag was given but nothing addressable survived; test covers both spellings |
| low | patch | Matrix row "Both spellings in .env → PANGOLIN_PROXY_HOSTS wins everywhere" tested only in render.sh | Verified no install-side test existed. Action: new install test — both keys disagreeing, non-interactive re-run keeps the PROXY_HOSTS value in .env and ruleset, decoy absent |
| low | patch | render.sh — Proxmox loop over raw PROXY_WORDS printed duplicate `IN ACCEPT` lines for a repeated hand-edited address while nft sets dedupe | Verified. Action: iterate unique addresses (`sort -u`); test asserts one line each |

## Plan Change Log

## Design Notes

render.sh has no proxy set today — the host is inlined at `:399`/`:433`/`:471`. The sets are new, modelled on the `dns4`/`dns6` twins at `:372-377`:

```
set proxy4 { type ipv4_addr; flags interval; auto-merge; elements = { 10.20.5.80, 10.20.8.80 }; }
ip saddr @proxy4 tcp dport 3000 accept
ct status dnat ip saddr @proxy4 tcp dport 3000 accept
```

An empty element file means no rule for that family (both empty is impossible — the non-empty check `:164` stays). `elements()` sorts; only validation and the .env write normalize order.

## Verification

**Commands:**
- `pnpm vitest run deploy/install.test.ts` -- expected: install + render.sh suites green.
- `pnpm lint` -- expected: shellcheck and eslint clean.
- `pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: full suite green (server untouched).

**Manual checks:**
- `nft -c` validation of the rendered ruleset runs only in CI (`ci.yml:50-61`), not on macOS.
