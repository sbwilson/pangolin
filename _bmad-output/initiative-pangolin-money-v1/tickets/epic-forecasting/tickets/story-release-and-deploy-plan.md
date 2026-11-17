---
title: 'Release v0.2.8 and deploy'
type: 'chore'
ticket: '12'
created: '2026-11-16'
status: 'in-progress'
baseline_revision: '477d955d4e42af771f1548e7c84817417df493bf'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] `git` — the page is committed locally on `develop` as `docs(release): prepare v0.2.8 release checklist` (the tip; this ticket's bookkeeping commits land before it). Push `develop`, and confirm CI green on that exact tip; it is `TAG_COMMIT` — deferred to human go-ahead per Implementation Notes.
- [ ] Checklist steps 2–11 — supply commands, read pasted output, fill the evidence record, record acceptance or rejection.

**Acceptance Criteria:**
- Given the `v0.2.8` tag commit, when CI runs, then the `ci.yml` run on that exact commit is green and all five `release.yml` jobs are `success` (ticket verify, half 1).
- Given `pang-dev` after `sudo pangolin upgrade v0.2.8` and `sudo pangolin reconfigure` onto both proxy nodes, then `/healthz` is ok, `pangolin status` reports `Pangolin Money v0.2.8` with `Schema: 33 (this build expects 33)`, `.env`'s proxy list and `PANGOLIN_TRUSTED_PROXIES` both hold `10.20.5.80` and `10.20.8.80`, and `/planning/forecast` works through each node (ticket verify, half 2).
- Given the finished page, then every evidence field holds pasted output or a run URL and the human's decision is recorded.
- Given the release commit, then `docs/release-v0.2.8.md` is the only file it changes.
- Given the finished page, then its notes cover epic 8 **and** the proxy-pair change, and no step asks anyone to put a proxy list into `.env` by hand.

## Implementation Notes

- No remote ops during step-03: the builder commits locally and never pushes. The push of `develop` and the CI-green check on `TAG_COMMIT` (task 6) happen after review, on human go-ahead — `hitl: true` and the workflow's no-push rule both bind here.
- The lint gate is green from commit 7cde9c9e56ed51a2f7cb9fc94737cbea1b08ff9b, which is the only non-release-page change the agent lands for this ticket, and it is not part of the release commit.

## Plan Change Log

- 2026-11-18, step-01/step-03 (human decisions): `baseline_revision` restamped from `b59ebae19937247da5dc3bc1ca704626fb13e1fb` (planning-time HEAD) to `477d955d4e42af771f1548e7c84817417df493bf`, so the review diff covers 8.12's own work rather than 8.13–8.15 again. Added the lint-gate task: `pnpm lint` was red at the baseline with 2 biome format errors in `deploy/install.test.ts` and `deploy/pangolin.test.ts` (the deferred-work entry blamed `noNonNullAssertion`, which are warnings), and the human asked for those warnings in `forecast-seed.test.ts` and `forecast-assumptions-seed.test.ts` cleared as well. Both done in 7cde9c9.

## Review Triage Log

## Verification

**Commands:**
- `git merge-base --is-ancestor v0.2.7 HEAD && echo ancestor-ok` -- expected: `ancestor-ok`.
- `ls packages/db/migrations/*.sql | wc -l` -- expected: 33.
- `pnpm lint && pnpm typecheck && pnpm check:strict` -- expected: clean.
- `pnpm exec vitest run deploy/release-workflow.test.ts deploy/release-scripts.test.ts` -- expected: all pass.
- `pnpm check:upgrade ./pang-dev-copy.sqlite` -- expected: `migrated 29 -> 33; integrity, manifest, schema ok`.
- `PAGER=cat gh run list --branch develop --event push --commit "$TAG_COMMIT" --limit 1 --json databaseId,headSha,conclusion` -- expected: `headSha` equals `$TAG_COMMIT`, `conclusion` `success`.

