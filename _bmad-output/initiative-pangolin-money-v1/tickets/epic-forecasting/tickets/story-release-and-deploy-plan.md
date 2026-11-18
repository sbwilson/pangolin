---
title: 'Release v0.2.8 and deploy'
type: 'chore'
ticket: '12'
created: '2026-11-16'
status: done
baseline_revision: '477d955d4e42af771f1548e7c84817417df493bf'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/docs/install.md'
  - '{project-root}/docs/release-v0.2.7.md'
  - '{project-root}/.github/workflows/release.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 8 (forecasting) is built and CI-green on `develop`, but unreleased: `pang-dev` still runs `v0.2.7` at schema 29 and serves no `/planning/forecast`. Ticket 8.12 needs CI green on a release tag and `/planning/forecast` working on the home server. `v0.2.8` now also carries 8.13–8.15, which move the deploy scripts to a reverse-proxy **host list** — the homelab's active/standby Caddy pair at `10.20.5.80` and `10.20.8.80` — so the release doubles as the migration of `pang-dev` onto both proxy nodes.

**Approach:** Author `docs/release-v0.2.8.md` on the proven v0.2.7 page (release notes for epic 8 and the proxy-pair networking change, schema 29 → 33, checklist, empty evidence record), run the agent pre-flight, then support the human through tag → release run → manual backup → `sudo pangolin upgrade v0.2.8` → `pangolin reconfigure` onto the two proxy nodes → verification, filling the record from pasted output.

**Decisions (2026-11-16, human):**
- Dry run: the agent proves 29 → 33 today on the existing `pang-dev-copy.sqlite` (real data, schema 29); the human then takes a fresh read-only copy for checklist step 2 before the tag. Every copy and its sidecars are deleted when both runs are recorded.
- Push authority: the agent commits the page and pushes `develop`, then confirms CI green on that exact tip. The tag is pushed by the human only.
- Step 9 requires a signed-in browser check of `/planning/forecast` and `/planning/forecast?mode=networth`, with what the human sees pasted into the evidence record — the `401` responses alone do not close the ticket.
- Renegotiated the same day, because 8.13–8.15 were added to this epic and now block it: `v0.2.8` is no longer a docs-only release, the page gains a networking section, and the proxy list is applied on the host with `pangolin reconfigure` **after** the upgrade — never by hand before it. The rule behind the ordering: the render.sh installed on `pang-dev` today dies on a comma-separated `PANGOLIN_NPM_HOST` (`deploy/firewall/render.sh:169-171`) and leaves the loaded ruleset stale, so the new renderer must reach the host first. The upgrade itself runs with `.env` still holding the single old proxy address.
- Step 9 proves the pair: `/planning/forecast` reachable through **each** Caddy node, and `PANGOLIN_TRUSTED_PROXIES` holding both addresses so client addresses survive a failover.

## Boundaries & Constraints

**Always:**
- Release only a commit whose `ci.yml` run is green, including `Container and end-to-end`, and which descends from `v0.2.7`. The page is committed to `develop` first; the tag goes on the explicit hash recorded in step 1 (`TAG_COMMIT`).
- All five `release.yml` jobs (`ci`, `image`, `upgrade-test`, `migrate-previous`, `publish`) green on the tag before the upgrade starts.
- A `pnpm check:upgrade` dry run against real `pang-dev` data before tagging, exercising 29 → 33.
- The manual `sudo pangolin backup` on `pang-dev` comes first, snapshot ID recorded. Gate.
- Upgrade only a host reporting `v0.2.7` / schema 29; `Schema: 33 (this build expects 33)` afterwards or the release is rejected.
- The upgrade runs while `.env` still holds one proxy address. The two-node list goes in only through `pangolin reconfigure`, after the tag's renderer is on the host, with its output pasted into the record. Editing a list into `.env` by hand beforehand is a failed step, not a shortcut.
- No evidence field counts as filled without pasted output or a run URL; only the human accepts the release.
- A failed tag is deleted remotely and locally before retrying; a published tag is never reused.

**Never:**
- The agent pushes no tag, takes no backup, runs no `pangolin upgrade`, touches no server (`hitl: true`).
- No `package.json` version bump and no CHANGELOG — the version is the tag.
- No code, schema or workflow change **in the release commit itself**: it adds `docs/release-v0.2.8.md` and nothing else. What it releases is another matter — 8.13–8.15 change `deploy/install.sh`, `deploy/firewall/render.sh` and the `pangolin` CLI, and those reach `develop` before the tag, never through this commit.
- No develop build on `pang-dev`; this page alters no procedure from `docs/install.md` §11 or `deploy/pangolin`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real-data check | `pang-dev` DB copy at schema 29 | `check:upgrade` prints `migrated 29 -> 33`, integrity/manifest/schema ok | Fix before tagging |
| Green release | Tag on the CI-green tip descending from `v0.2.7` | Five `release.yml` jobs `success`; signed image published, `latest` moved | Step 13: delete the tag |
| Upgrade | `sudo pangolin upgrade v0.2.8` on a `v0.2.7` host | Signature verified, pre-upgrade copy taken, schema 33, stack healthy | Automatic rollback; record the message |
| Starting build | `pangolin status` is not `v0.2.7` / schema 29 | Stop and record | Do not upgrade |
| Forecast routes | Unauthenticated `curl` of `/api/planning/forecast`, `/api/planning/forecast-net-worth`, `/api/planning/forecast-assumptions` | `401` each; `/healthz` `{"ok":true…}` | Record as failed |
| Forecast UI | Signed-in browser on `/planning/forecast`, then `?mode=networth` | Projection renders with warnings; net-worth shows headline and assumption chips | Record as failed |
| Proxy pair applied | `pangolin reconfigure` with both Caddy addresses, run after the upgrade | `.env` proxy list and `PANGOLIN_TRUSTED_PROXIES` hold both; the rendered ruleset carries both; the app container is recreated | Record; the host stays on the single-host ruleset until fixed |
| Failover | Requests reaching the app through the standby node `10.20.8.80` | `/planning/forecast` loads and the client address is still the browser's, not the proxy's | Record as failed |
| List before renderer | A comma list in `.env` while the previous render.sh is still installed | `render.sh` refuses at `:169-171` and the loaded ruleset stays as it was | Failed step: restore `.env`, let reconfigure write both files together |

</frozen-after-approval>

## Code Map

- `docs/release-v0.2.8.md` — **new**; same shape as `docs/release-v0.2.7.md`: release notes, Rules, Pre-flight (agent), checklist (v0.2.7's 13 steps plus the proxy-pair reconfigure step), Rollback, Evidence record.
- `docs/release-v0.2.7.md` — template and predecessor (schema 25 → 29); shows the filled evidence-record shape.
- `docs/install.md` §11 (:582) — `pangolin upgrade` semantics, `PANGOLIN_UPGRADE_TIMEOUT`, auto-rollback and upgrade-copy paths.
- `deploy/pangolin` — `status`, `backup`, `upgrade <tag>` (:35+); runs on the server under `sudo`, cosign-verifies `ghcr.io/sbwilson/pangolin:<tag>`.
- `.github/workflows/release.yml` — trigger `v*.*.*`; `ci` re-runs the whole CI on the tag (:17), then `image`, `migrate-previous`, `upgrade-test`, `publish`.
- `.github/workflows/ci.yml` — `check` (lint, types, unit, STRICT, migrations-match-schema) and `container` (build + Playwright + axe).
- `packages/db/migrations/0029_account_low_balance_threshold.sql`, `0030_budget_funding_account.sql`, `0031_forecast_assumption.sql`, `0032_forecast_assumption_mortgage_terms.sql` — the four migrations between tags.
- `packages/db/src/cli/check-upgrade.ts` — dry-run tool; migrates the copy **in place**, prints `migrated N -> M; integrity, manifest, schema ok`.
- `apps/web/src/routes/forecast.tsx:9` (`/planning/forecast`); `apps/server/src/http/app.ts:638,645,466` (the three forecast API routes).
- `pang-dev-copy.sqlite` (repo root, gitignored) — real `pang-dev` data from 2026-11-09, at schema 29 (`schema_migration` count 29, max `0028_goals_savings`).
- `deploy/install.sh`, `deploy/firewall/render.sh`, `deploy/pangolin` — what 8.13–8.15 change before this tag: `--proxy-host`/`PANGOLIN_PROXY_HOSTS` as a list with the `--npm-host` alias, proxy sets in the rendered ruleset, the DNS drift warning, and `pangolin reconfigure`. The page documents those as built; it invents nothing.
- `docs/install.md:121` and `:133` — the flag table the 8.13 alias keeps valid; the page's networking section mirrors the shipped wording.

## Tasks & Acceptance

**Execution:**
- [x] lint gate — done in 7cde9c9: 2 biome format errors in `deploy/install.test.ts` and `deploy/pangolin.test.ts` (from 8.13–8.15) formatted, and the 20 `noNonNullAssertion` warnings in `apps/server/src/http/forecast-seed.test.ts` and `forecast-assumptions-seed.test.ts` rewritten for real. `pnpm lint` green, `pnpm typecheck` clean, 202 deploy tests and 11 seed tests pass.
- [x] `docs/release-v0.2.8.md` — authored from the v0.2.7 template: epic 8 notes (cash-flow projection with low-balance warnings, net-worth projection with editable assumptions, `domain/amortise`, per-account low-balance lines, not-enough-data and all-clear states, lazy-loaded charts) plus `fix(llm): strip pasted route suffixes in buildEndpointUrl`; schema 29 → 33; checklist step 9 checks the three forecast routes.
- [x] `docs/release-v0.2.8.md` Pre-flight — run and record: `v0.2.7` ancestry (`ancestor-ok`), migration count 33, `pnpm lint && pnpm typecheck && pnpm check:strict` green, the release machinery tests (35/35), the green CI run id on the develop tip (run `43745808831` on `b59ebae`, the pushed tip; the unpushed 8.13–8.15 + lint-gate + page commits get their CI on the step-1 push).
- [x] `docs/release-v0.2.8.md` release notes — networking section for 8.13–8.15 added: the proxy host list (`--proxy-host` / `PANGOLIN_PROXY_HOSTS`, `--npm-host` still accepted), the IPv4 and IPv6 proxy sets (`proxy4`/`proxy6`), the DNS-resolver drift warning, and `pangolin reconfigure`, naming `10.20.5.80` and `10.20.8.80`.
- [x] `docs/release-v0.2.8.md` checklist — post-upgrade `sudo pangolin reconfigure --proxy-host 10.20.5.80,10.20.8.80` added as step 8a with its expected output (v0.2.7's 1–13 keep their numbers); step 9 verifies the three forecast routes and the browser views through each Caddy node, and both `.env` keys and the `proxy4` set holding both addresses. `.env` keeps the single old address until step 8a runs.
- [x] `pnpm check:upgrade ./pang-dev-copy.sqlite` — real-data 29 → 33 dry run on the existing copy done 2026-11-18, exact output recorded in the page's pre-flight row. The human's fresh step-2 copy is checked the same way, and both copies plus `*.sqlite-*` sidecars are deleted once recorded (page step 2); neither is deleted yet.
- [ ] `git` — the page is committed locally on `develop` as `docs(release): prepare v0.2.8 release checklist`, the tip commit, with this ticket's bookkeeping commits re-stacked below it. Push `develop`, and confirm CI green on that exact tip; it is `TAG_COMMIT` — deferred to human go-ahead per Implementation Notes.
- [ ] Checklist steps 2–11 — supply commands, read pasted output, fill the evidence record, record acceptance or rejection.

**Acceptance Criteria:**
- Given the `v0.2.8` tag commit, when CI runs, then the `ci.yml` run on that exact commit is green and all five `release.yml` jobs are `success` (ticket verify, half 1).
- Given `pang-dev` after `sudo pangolin upgrade v0.2.8` and `sudo pangolin reconfigure` onto both proxy nodes, then `/healthz` is ok, `pangolin status` reports `Pangolin Money v0.2.8` with `Schema: 33 (this build expects 33)`, `.env`'s proxy list and `PANGOLIN_TRUSTED_PROXIES` both hold `10.20.5.80` and `10.20.8.80`, and `/planning/forecast` works through each node (ticket verify, half 2).
- Given the finished page, then every evidence field holds pasted output or a run URL and the human's decision is recorded.
- Given the release commit, then `docs/release-v0.2.8.md` is the only file it changes.
- Given the finished page, then its notes cover epic 8 **and** the proxy-pair change, and no step asks anyone to put a proxy list into `.env` by hand.

## Implementation Notes

- No remote ops during step-03: the builder commits locally and never pushes. The push of `develop` and the CI-green check on `TAG_COMMIT` (task 7) happen after review, on human go-ahead — `hitl: true` and the workflow's no-push rule both bind here.
- `TAG_COMMIT` is the release page commit, so the page commit must be the tip of `develop` when the human pushes. This ticket's `docs(bmad)` commits land below it: a bookkeeping edit made after the page commit is committed and then re-stacked under it (`git rebase -i` with the page commit last), never left on top — the quick-lens review found exactly that mistake and step 1 now stops on it.
- The lint gate is green from commit 7cde9c9e56ed51a2f7cb9fc94737cbea1b08ff9b. Together with the anonymous-401 guard in 94103259b4ef2c06f22e39c1f236f8a4c00bef03, those are the only two non-page changes this ticket lands; neither is part of the release page commit, and `pnpm lint`, `pnpm typecheck`, `pnpm check:strict` and `apps/server/src/http/forecast-seed.test.ts` were all re-run green on 9410325.

## Matrix Test Audit

Each frozen matrix row against the test that verifies its expected behavior, and whether that test ran in this build. 2026-11-18.

| Row | Covering test | Ran |
| --- | --- | --- |
| Real-data check | `pnpm check:upgrade ./pang-dev-copy.sqlite` on the schema-29 copy, the plan's own verification command: `migrated 29 -> 33; integrity, manifest, schema ok` | yes, passed |
| Green release | `deploy/release-workflow.test.ts` (tag trigger, the five jobs) with `deploy/release-scripts.test.ts` | yes, 35 passed |
| Upgrade | `deploy/pangolin.test.ts` `pangolin upgrade`: signature verified (:184) and refused when bad (:473), pre-upgrade copy 0700 (:226), unhealthy before (:481), rollback when the new image is unhealthy (:488), `PANGOLIN_UPGRADE_TIMEOUT` (:441) | yes, 202 passed with `install.test.ts` |
| Starting build | procedural: step 3 is the human's `pangolin status` read, and no test can prove a human stops. Closest automation: `pangolin.test.ts:511` refuses an upgrade whose digest already runs | n/a, gate |
| Forecast routes | `apps/server/src/http/forecast-seed.test.ts` "refuses all three forecast routes to an anonymous caller" — 401 from cash flow, net worth and assumptions without a session; `/healthz` `{"ok":true…}` is `apps/server/src/http/app.test.ts:189-200` with `apps/server/src/server.test.ts:301`, and the routes being wired rather than only guarded is the authenticated seed reads beside it (`forecast-seed.test.ts`, `forecast-networth-seed.test.ts:161`, `forecast-assumptions-seed.test.ts`) | yes, 401 guard added in 9410325 and passed; the rest passed in the suites above |
| Forecast UI | `e2e/forecast.spec.ts` (journey) and `e2e/axe.spec.ts:381,431` (both modes, chart and table views) | CI run 43745808831 on `b59ebae`: 135 passed. Needs the built image, so not re-run locally; no commit since it touches `apps/web` |
| Proxy pair applied | `deploy/install.test.ts:360-369` (both `.env` keys, one `proxy4` set holding both, the input rule and the `ct status dnat` forward rule, one Proxmox line each), the reconfigure renders at `:1104`, `:1183`, `:1284`, and `deploy/pangolin.test.ts:665+` (extract `install.sh` from the pinned image, delegate with `--reconfigure` and the flags) | yes, within the 202 |
| Failover | `apps/server/src/auth/hooks.test.ts:195`: `clientAddress("10.0.0.2", "1.2.3.4, 10.0.0.3", ["10.0.0.2", "10.0.0.3"])` returns the browser's address with both nodes trusted; `server.test.ts:690` parses the padded comma list, `:694` refuses a hostname | yes, passed |
| List before renderer | no in-repo test reaches the renderer installed on the host, so it was reproduced by hand 2026-11-18: `v0.2.7` `render.sh` on a staged `.env` carrying `PANGOLIN_NPM_HOST=10.20.5.80,10.20.8.80` exits 1 with `not an IP address or network: 10.20.5.80,10.20.8.80`; this release's `render.sh` on the same file renders `set proxy4 { … 10.20.5.80, 10.20.8.80 }` with an empty `proxy6` and exits 0. Both transcripts are in the page's step 8a | yes, manual |

Two rows are inherently live-host (the human's status read, the renderer already installed on the host); each is named above with the closest automation and the manual check that stands in for it. No row is uncovered, and nothing was skipped or filtered.

## Plan Change Log

- 2026-11-18, step-04 review (agent): quick lens run and triaged, 2 of 6 findings kept. Amended outside the frozen block: step 1's `TAG_COMMIT` is now the `docs(release): prepare v0.2.8 release checklist` commit, with this ticket's `docs(bmad)` commits re-stacked below it, so the tag cannot land on a bookkeeping commit; Implementation Notes carries that rule so a later bookkeeping edit gets re-stacked instead of left on top; the "Forecast routes" audit row names `/healthz` (`apps/server/src/http/app.test.ts:189-200`, `apps/server/src/server.test.ts:301`) and the authenticated seed reads beside the new 401 guard; and the Implementation Notes task reference is 7, the `git` task, not 6. Known-bad state avoided: a tag on `docs(bmad)` with the page commit below it, which the page's own step 5 evidence row would then have to describe as the release commit. KEEP instructions for any re-derivation: the page is the sibling of `docs/release-v0.2.7.md` in structure and step numbering with 8a new; its Markdown carries no em dashes and no mid-sentence bold beyond the `**Gate.**` and `**failed**` that page writes; step 8a's ordering proof, the pre-flight rows, and the `9410325` 401 guard all stay; the release commit touches `docs/release-v0.2.8.md` and nothing else.
- 2026-11-18, step-01/step-03 (human decisions): `baseline_revision` restamped from `b59ebae19937247da5dc3bc1ca704626fb13e1fb` (planning-time HEAD) to `477d955d4e42af771f1548e7c84817417df493bf`, so the review diff covers 8.12's own work rather than 8.13–8.15 again. Added the lint-gate task: `pnpm lint` was red at the baseline with 2 biome format errors in `deploy/install.test.ts` and `deploy/pangolin.test.ts` (the deferred-work entry blamed `noNonNullAssertion`, which are warnings), and the human asked for those warnings in `forecast-seed.test.ts` and `forecast-assumptions-seed.test.ts` cleared as well. Both done in 7cde9c9.
- 2026-11-18, step-03 style pass (agent): the page follows the human's Markdown rules, so its 29 em dashes are gone (rephrased with commas, colons or parentheses, none with meaning lost), one more mid-sentence bold emphasis is removed, and the only bold left inside a sentence is the `**failed**` the v0.2.7 page writes verbatim. Headings were already sentence-case and match v0.2.7's shape. Then the stack was reordered so the page commit is the tip of `develop`, as in v0.2.7 whose tag sat on the page commit: `9410325` (the 401 guard) is now below it. The page's pre-flight and step 1 name `9410325` as the code tip the checks ran on, and say plainly that ticket bookkeeping commits may land above it, with `TAG_COMMIT` whatever `git rev-parse develop` prints after the push. Re-verified on `9410325`: `pnpm lint` green, `pnpm typecheck` clean, `pnpm check:strict` "All tables are STRICT", `forecast-seed.test.ts` 6 passed.
- 2026-11-18, step-03 audit (agent): five page edits before review, all checked against the shipped code rather than the draft. `0029_account_low_balance_threshold` now says what it does, rebuild `account` in place copying every row, instead of "only adds tables and columns". Step 8a carries the reproduced ordering proof (v0.2.7 `render.sh` exits 1 on the comma list, this release's renders it). Four mid-sentence bold emphases the draft introduced are gone; the two carried verbatim from `release-v0.2.7.md`, `Gate.` and `failed.`, stay as that page writes them so the sibling pages still match. And `apps/server/src/http/forecast-seed.test.ts` gained the anonymous-401 test matrix row 5 had no owner for (9410325). Nothing in the frozen block changed.

## Review Triage Log

Quick lens, 2026-11-18, diff from `477d955`. One entry patched, one rejected as plan prose with its facts corrected in place, three rejected on their refutation.

| # | Finding | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 + 2 | Page step 1 says `TAG_COMMIT` is "whatever `git rev-parse develop` prints", and the plan claims the page commit is the tip while this ticket's own `docs(bmad)` commit sits above it, so the tag lands on a bookkeeping commit instead of the page commit. | `medium`, patched | Real when filed: the tip was a `docs(bmad)` commit (changes only `_bmad-output/`) with the page commit below it. v0.2.7's tag sits on its page commit (`v0.2.7` = `5dee014`, `docs(release): prepare v0.2.7 release checklist`), and the page's own step 5 evidence row expects "Tag and commit (step 5)" to name that commit, so the human following step 1 verbatim tags the wrong commit and the page contradicts the plan's task 7. Fix: step 1 pins the tag to the page commit, `git log -1 --format='%H %s'` is annotated "must print the page commit, else stop", and the Expected paragraph stops the run if the subject differs; the stack was re-stacked so the `docs(release): prepare v0.2.8 release checklist` commit is the tip with both `docs(bmad)` commits below it. |
| 3 | ACs 1 to 3 are unmet at review time: no tag, no CI on `TAG_COMMIT`, empty human evidence rows, unchecked tasks. | `false` | The state described is what the plan intends, and nothing in the diff claims otherwise: tasks 7 and 8 of `## Tasks & Acceptance` are unchecked, the page's human rows are empty, and Implementation Notes records the deferral to human go-ahead under `hitl: true`. No overclaim to refute at any cited location. |
| 4 | Matrix Test Audit's "Forecast routes" row names only the anonymous-401 test, which covers the `401` half but not `/healthz`, and a 401 from `sessionMiddleware` over `/api/*` (`app.ts:1471`) does not prove the route is wired. | `low`, rejected | Correct that the audit cell names one test for a two-part row, and both halves are covered: `/healthz` in `apps/server/src/http/app.test.ts:189-200` and `apps/server/src/server.test.ts:301`, wiring by the authenticated seed reads in the same `forecast-seed.test.ts` file. Rejected because the fix is to edit this build's plan (the audit is plan text); the cell was still made accurate in the same pass so it no longer overstates. |
| 5 | Evidence row "showing tag and schema 33 of 33" does not match the string `cli.ts:157` prints, so the human has nothing matchable to paste. | `false` | "schema 33 of 33" is the row's label, copied in v0.2.7's own words ("showing tag and schema 29 of 29"), and v0.2.7 filled it with the real line. The expectation the human matches against is step 10's, which prints `Schema: 33 (this build expects 33)`, matching `apps/server/src/cli.ts:157` modulo its column padding (`Schema:    33 (…)`) exactly as v0.2.7's page does. |
| 6 | Implementation Notes cites "task 6" for the push and CI check; the push task is 7. | `low`, rejected | True: task 6 is the `check:upgrade` dry run, task 7 is the `git` task. Rejected because the fix edits this build's plan; the number is corrected with the patch above. |

## Verification

**Commands:**
- `git merge-base --is-ancestor v0.2.7 HEAD && echo ancestor-ok` -- expected: `ancestor-ok`.
- `ls packages/db/migrations/*.sql | wc -l` -- expected: 33.
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean.
- `pnpm exec vitest run deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: all pass.
- `pnpm check:upgrade ./pang-dev-copy.sqlite` -- expected: `migrated 29 -> 33; integrity, manifest, schema ok`.
- `PAGER=cat gh run list --branch develop --event push --commit "$TAG_COMMIT" --limit 1 --json databaseId,headSha,conclusion` -- expected: `headSha` equals `$TAG_COMMIT`, `conclusion` `success`.

**Evidence:**
- 2026-11-18: pushed `develop` `b59ebae..81bb219`; `TAG_COMMIT=81bb219a02640cd1d604f7985a7362c9c215720b` (`docs(release): prepare v0.2.8 release checklist`), `ancestor-ok` against `v0.2.7`.
- 2026-11-18: CI run <https://github.com/sbwilson/pangolin/actions/runs/44280423896> on `headSha` `81bb219a02640cd1d604f7985a7362c9c215720b` -- `success` (`Lint, types, tests, STRICT`, `Secret scan`, `Container and end-to-end` all green). No reruns.
- 2026-11-19: release closed out. Tag `v0.2.8` (annotated, object `20e3cc9`) lands on `d0ee26a`, one `_bmad-output` file past the pinned page commit `81bb219`, accepted as a deviation with green CI (`44282450394`) and a green release run (`44294069370`, all five jobs) on the exact tagged commit. `pang-dev` upgraded to schema 33, proxy pair live through `10.20.5.80` and `10.20.8.80`, digest `sha256:c761805f`. Step 4's manual backup was skipped before the upgrade (recorded, mitigated by scheduled snapshot `544837b5` and the automatic `pre-upgrade-20261119061014` copy). Step 8a ended `Finished with 1 warning(s)`, the pre-existing data-root mount warning. Full evidence in `docs/release-v0.2.8.md`; accepted by sim, 2026-11-19.

