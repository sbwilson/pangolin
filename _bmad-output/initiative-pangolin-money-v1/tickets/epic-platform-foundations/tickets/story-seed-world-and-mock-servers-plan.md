---
title: 'Seed world and mock servers'
type: 'feature'
ticket: '7'
created: '2026-09-27'
status: done
baseline_revision: '55969ba2f67b823ad0cf2756d0ef29164808c611'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
warnings: [oversized]
deferred:
  - summary: >-
      The spine's Invariants diagram lacks the tools/seed → shared arrow this story added.
    evidence: |-
      scripts/check-boundaries.ts now allows tools/seed to import packages/shared, per AD-15's
      need for shared dates. The spine's Invariants diagram draws no tools/* arrows. Fixing it
      means editing the architecture spine, which is outside this build.
    location: >-
      _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md
    severity: low
---

<intent-contract>

## Intent

**Problem:** Every later epic needs one synthetic household it can extend without shifting others' data (AD-15). CI must also stay offline, so LLM and price calls need mock servers that replay fixtures, including the failure modes. A read-only demo mode needs that same seed.

**Approach:**
- `tools/seed` becomes a pure, deterministic generator: a world model, the `SeedModule` contract, per-module random streams, a fixed "today", and emitted expectations. It serialises canonical JSON, and its first module is `people-and-household`.
- The server's `admin` entry applies a seed file through `app` use cases (a new `identity.createPerson`, plus the existing `updateHouseholdSettings`) under a `SystemViewer`.
- Demo mode boots an in-memory database from the seed and refuses writes.
- `tools/mock-llm` and `tools/mock-prices` are small `node:http` servers that replay fixture files.

## Boundaries & Constraints

**Always:**
- **Seed contract:**
  - `SeedModule = { name, dependsOn: string[], generate(world, rng) → { events, expectations } }`.
  - Modules run in dependency order, with ties broken by name.
  - Each module's `rng` comes from a hash of `seed + ":" + name`, so adding or removing a module never changes another module's output.
  - Nothing reads `Math.random`, `Date` or the real clock.
  - The default seed is `"pangolin-v1"` and the fixed today is `2026-07-15`.
- **Seed output:**
  - `{ seed, today, events, expectations }`, where each event and expectation key carries its module's name.
  - Serialised with sorted keys and a trailing newline, so two runs are byte-identical.
  - The CLI (`pnpm seed`) writes `seed.json` to an output directory.
- **People and household module:** two people with display names and `#RRGGBB` colours, plus the household settings. The settings are `Australia/Sydney`, `AUD` and `contribution`. Expectations include the people count, their names and the time zone.
- **Import rules:** `tools/seed` may import only `packages/shared`, and the mock tools may import no workspace package. `scripts/check-boundaries.ts` gains that one arrow.
- **Applying a seed:**
  - Only the server's `apps/server/src/admin/seed.ts` does it. It parses `seed.json` with Zod and calls `identity.createPerson` and `system.updateHouseholdSettings` as `systemViewer("cli:seed")`.
  - Every write is audited.
  - An unknown event type fails the whole apply.
- **Demo mode:**
  - Turned on by `PANGOLIN_DEMO=true`.
  - The server migrates a `:memory:` database, applies the seed file (`PANGOLIN_SEED_FILE`, default `dist/demo-seed.json`, which `pnpm build` generates), and then wraps the unit of work so that every write throws `AppError("Conflict", "Demo mode is read-only")`.
  - Health stays 200.
  - Demo mode never touches `PANGOLIN_DATA_DIR`.
- **Mock LLM server:**
  - Handles `POST /v1/chat/completions` (OpenAI) and `POST /v1/messages` (Anthropic).
  - The request's `model` value picks a fixture from `tools/mock-llm/fixtures/<provider>/<model>.json`.
  - Fixtures cover `mock-ok`, `mock-malformed-json`, `mock-timeout`, `mock-rate-limit` and `mock-refusal`, in each provider's real response format.
  - Each fixture has `{ status, headers, body (raw text), delayMs? }`.
  - An unknown model returns 404 in the provider's error format.
- **Mock price server:**
  - `GET /v8/finance/chart/{ticker}` returns Yahoo-chart-shaped JSON from `tools/mock-prices/fixtures/<ticker>.json`.
  - The tickers `MOCK-MALFORMED.AX`, `MOCK-TIMEOUT.AX` and `MOCK-429.AX` cover the failure modes.
  - An unknown ticker returns 404 in Yahoo's error shape.
- **Mock lifecycle:** both export `start…({ port, fixturesDir? }) → { url, close() }`. `close()` destroys open sockets, including a request held open by a timeout scenario. Each also has a CLI.

**Never:**
- No statement-file rendering, accounts, merchants or bills in the seed (epics 2 and 3 add them as modules and events).
- No unit-price or NAV mocks (epic 9 adds them with their connectors).
- No LLM adapters or contract tests (epic 5).
- No real network calls, and no `Math.random` in the seed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Determinism | two `pnpm seed` runs | byte-identical `seed.json` | — |
| Module isolation | modules `[people]` vs `[people, dummy]` | the people module's events and expectations are identical | — |
| Order | a module depending on an unknown or cyclic module | — | throws naming the module |
| Apply | the default seed applied to a migrated database | 2 `person` rows plus settings matching the expectations; audit rows with actor `cli:seed` | — |
| Bad seed file | an unknown event type or malformed JSON | the whole seed is validated before any write | apply throws naming the problem, and demo boot fails |
| Demo | `PANGOLIN_DEMO=true` boot | health 200, people seeded | any write → `AppError` `Conflict` |
| LLM ok | OpenAI and Anthropic `mock-ok` | 200 in the provider's format | — |
| LLM malformed | `mock-malformed-json` | 200 whose content is not valid JSON | — |
| LLM 429 | `mock-rate-limit` | 429 with `retry-after` | — |
| LLM timeout | `mock-timeout` with a client abort after 200 ms | the client aborts; `close()` still resolves promptly | — |
| LLM refusal | `mock-refusal` | the provider's refusal shape (OpenAI `message.refusal`; Anthropic `stop_reason: "refusal"`) | — |
| Prices | `VAS.AX`; the MOCK-* tickers; an unknown ticker | chart JSON; malformed / held open / 429; 404 | — |

</intent-contract>

## Code Map

- `tools/{seed,mock-llm,mock-prices}/` are placeholder packages from story 1.1 (`src/index.ts`, and `tsconfig` with Node types). Add `bin` or scripts as needed. The root `package.json` gains `seed`, `mock:llm` and `mock:prices` scripts.
- `scripts/check-boundaries.ts`:
  - `ALLOWED["tools/seed"]` becomes `{ allow: ["packages/shared"] }`, with a comment that the spine diagram needs that arrow.
  - Update its test.
  - `tools/seed/package.json` declares `@pangolin/shared`.
- `packages/shared`:
  - `temporal` (`PlainDate`, `parseDate`, `formatDate`).
  - `ids` (`Id<B>`).
  - `period`, if the seed needs dates.
- `packages/app`:
  - `write.ts`, `context.ts` and `system/household-settings.ts` are the use-case pattern to copy for `identity/create-person.ts`.
  - The `UnitOfWork` port and `TxRepos` gain `person.insert(row)`, implemented in `packages/db/src/unit-of-work.ts`.
  - The `person` table exists from migration `0001`, so no new migration is needed.
- `apps/server/src`:
  - `server.ts`: `startServer` gains the demo branch.
  - `config.ts`: the Zod env schema gains `PANGOLIN_DEMO` (boolean) and `PANGOLIN_SEED_FILE`.
  - `scripts/build.ts`: copies migrations and the PWA, and now also generates `dist/demo-seed.json` by spawning the seed CLI (no import).
  - `admin/` is the only place that may import `@pangolin/app/system-viewer`.
- **Tests:** colocated and picked up by the root `vitest.config.ts`. Mock servers bind port 0.
- **Conventions:** `.ts` import extensions, pinned versions, and commits through the `.githooks`.

## Tasks & Acceptance

**Execution:**
- [x] `tools/seed/src/{rng,world,module,run,serialize,cli}.ts` + tests -- seeded PRNG (e.g. sfc32 from a string hash) with `next`, `int` and `pick`; the world model types (people, household, plus empty collections for accounts, pay anchors, merchants and bills); `runSeed({ seed, today, modules })` with topological order; a canonical JSON serialiser; a CLI with `--out`, `--seed` and `--today` -- the AD-15 contract
- [x] `tools/seed/src/modules/people-and-household.ts` + test -- the first module and its expectations -- the story's module
- [x] `tools/seed/src/modules/index.ts` -- `defaultModules` -- the list later epics append to
- [x] `packages/app/src/identity/create-person.ts` + test, and the ports/db `person.insert` -- `createPerson(ctx, { displayName, colour })` → `Id<"Person">`, audited, `colour` matching `^#[0-9a-f]{6}$`i -- the write path for seeded people
- [x] `apps/server/src/admin/seed.ts` + test -- `applySeed(uow, deps, seedJson)`: Zod-parse, then apply each event through the use cases as `systemViewer("cli:seed")` -- the seed loader
- [x] `apps/server/src/{config,server}.ts`, `apps/server/scripts/build.ts` + tests -- demo mode (`:memory:`, migrate, apply, read-only unit-of-work wrapper); the build generates `dist/demo-seed.json` -- demo mode
- [x] `tools/mock-llm/src/{server,cli}.ts`, `tools/mock-llm/fixtures/{openai,anthropic}/*.json` + tests -- the replay server and five fixtures per provider -- the mock LLM
- [x] `tools/mock-prices/src/{server,cli}.ts`, `tools/mock-prices/fixtures/*.json` + tests -- the Yahoo-chart replay server with `VAS.AX` and `VGS.AX` (a few days of deterministic prices each) plus the three MOCK-* tickers -- the mock prices
- [x] `scripts/check-boundaries.ts` (+ test), root `package.json` scripts, `README.md` (a short "Seed, demo and mocks" section) -- wiring

**Acceptance Criteria:**
- Given two runs of `pnpm seed --out <dir>`, when the files are compared, then they are byte-identical.
- Given a dummy module added to the module list, when the seed runs, then every event and expectation from `people-and-household` is unchanged.
- Given `PANGOLIN_DEMO=true`, when the server boots, then `/api/system/health` returns 200, the database holds the seeded people, and a settings update is rejected with `Conflict`.
- Given each mock scenario, when requested over HTTP, then the response matches the matrix; the timeout scenario is observed by a client-side abort.

## Implementation Notes

- **Spine propagation (needed):** `scripts/check-boundaries.ts` now allows `tools/seed → packages/shared`. The spine's Invariants diagram should gain that arrow. The mock tools still import no workspace package.
- **Seed contract:**
  - Events are `person.created` (`key`, `displayName`, `colour`) and `household.settings` (`timezone`, `baseCurrency`, `sharedAttribution`). The runner stamps each with `module`, and prefixes expectation keys as `<module>.<name>`.
  - Each module's world holds only the events of its transitive `dependsOn`, not every earlier module. Together with the per-module stream, an unrelated module can never change another's output.
  - Colours are uppercase `#RRGGBB`; `createPerson` accepts either case and stores the value as given.
- **Applying a seed:** `applySeed` reuses `createPersonInput` and `updateHouseholdSettingsInput` inside its Zod event schemas, so every use-case rejection is caught before the first write. Each event is its own transaction; an unexpected failure mid-apply (not a validation failure) would leave earlier events written. The default settings already match the seed, so applying the default seed audits only the two `person` creates.
- **Demo mode:** `apps/server/src/demo.ts` holds `openDemoDatabase` and `readOnlyUnitOfWork`. `RunningServer` now exposes `demo` and `uow` (the unit of work later HTTP routes will get), which is how the tests prove a write is rejected, since no write route exists yet. Demo mode runs on `fixedClockAt(seed.today)` (a new `@pangolin/app` helper, since `apps/server` may not import `shared/temporal`), so its audit rows are stamped at midnight UTC on the seed's today; `RunningServer.clock` exposes it. `parseSeed` also rejects a `today` that is not a real calendar date.
- **Build:** `apps/server/scripts/demo-seed.ts` spawns `tools/seed/src/cli.ts` (no import) and copies the result to `dist/demo-seed.json`. The Dockerfile now installs `@pangolin/seed...` so the image build can do that.
- **Mocks:** LLM fixtures are `{ status, headers, body, delayMs? }`. Price fixtures take `json` or a raw `body`, so the chart data stays readable. The timeout fixtures wait one hour; `close()` clears the timers and destroys the sockets. Model and ticker names are checked against a safe character set before they become file paths.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 43 findings — high 0, medium 5, low 33, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: demo health reports `writable: true` while writes are refused, and the raw database stays writable — the plan says health stays 200 in demo; the `writable` probe is truthful about SQLite; AD-1 already forbids writes that bypass the unit of work; no consumer reads `writable`.
  - `[low]` `[reject]` Blind: read-only covers only the unit of work, not the raw db — same as the demo-health row: AD-1 forbids raw-db writes.
  - `[low]` `[reject]` Blind: the demo `Conflict` acceptance criterion is tested below HTTP — no write routes exist yet (routes are out of scope); `createApp` gets the same unit of work once routes arrive in 1.5.
  - `[medium]` `[patch]` Blind: `runSeed` accepts duplicate person keys, or two household-settings events, from unrelated modules — `runSeed` now checks both globally after all modules run, naming both modules; two tests.
  - `[low]` `[reject]` Blind: the seed tool never validates event shape — the server's Zod schemas are the single validator; a bad seed fails `pnpm build`, which CI runs.
  - `[low]` `[reject]` Blind: `applySeed` is neither atomic nor idempotent — its only caller is demo mode on an empty `:memory:` database; recorded in Implementation Notes.
  - `[false]` `[reject]` Blind: no admin command applies a seed to a real data dir — the plan scopes the loader to demo mode; no command was specified.
  - `[low]` `[patch]` Blind: `parseSeed` accepts impossible dates — `today` must now round-trip as a real UTC calendar date; `2026-02-30` is rejected in a test.
  - `[medium]` `[patch]` Blind: demo mode runs on the real clock, not the seed's fixed today — added `fixedClockAt(isoDate)` in app; demo applies the seed on it; tests assert audit `at` starts with the seed's today.
  - `[false]` `[reject]` Blind: tests sort people by ID and may be flaky — `newId` comes from `monotonicFactory`, which is strictly increasing within one process.
  - `[medium]` `[patch]` Blind: the malformed-JSON fixtures model truncation, so an adapter's truncation branch pre-empts the parse-failure path — both fixtures now end normally (`stop` / `end_turn`) with invalid JSON content.
  - `[low]` `[reject]` Blind: no 5xx, overloaded or streaming scenarios — the spec lists malformed JSON, timeouts, 429s and refusals; epic 5 adds scenarios with the adapters.
  - `[low]` `[reject]` Blind: an oversized request gets a 400 on a destroyed socket — test-only mock; the fixed-size request bodies come from our own adapters.
  - `[low]` `[patch]` Blind: the MOCK-TIMEOUT.AX fixture copies VAS's names — renamed to Mock Timeout ETF.
  - `[low]` `[patch]` Blind: `generateSeedFile` has no timeout — added `timeout: 60_000`, a clear spawn-error message and an output-exists check.
  - `[low]` `[patch]` Blind: README omits `--host` and relative seed-file resolution — both documented; the spine arrow is deferred (see `deferred`).
  - `[medium]` `[patch]` Edge: `runSeed` accepts duplicate person keys, or two household-settings events, from unrelated modules — same patch as the Blind duplicate-key row.
  - `[low]` `[patch]` Edge: `parseSeed` accepts impossible dates — same patch as the Blind date row.
  - `[low]` `[reject]` Edge: a `__proto__` person key is swallowed — keys come from our own seed modules; not reachable in practice.
  - `[low]` `[reject]` Edge: `applySeed` against an already seeded database — same as the Blind atomic/idempotent row.
  - `[low]` `[patch]` Edge: spawn failure hides the real error — same patch as the Blind spawn-timeout row.
  - `[low]` `[patch]` Edge: `spawnSync` hangs forever — same patch as the Blind spawn-timeout row.
  - `[low]` `[patch]` Edge: the CLI exits 0 without writing, surfacing as ENOENT — the output file is now checked before copying.
  - `[low]` `[reject]` Edge: a symlinked `argv[1]` skips the CLI main — every invocation (pnpm script, build spawn, tests) uses the real path.
  - `[low]` `[reject]` Edge: demo health reports `writable: true` while writes are refused, and the raw database stays writable — same as the Blind demo-health row.
  - `[low]` `[reject]` Edge: `PANGOLIN_SEED_FILE` without demo mode is silently ignored — documented as a demo setting in the README.
  - `[low]` `[reject]` Edge: a mock-llm `delayMs` above 2^31 fires at once — fixtures are ours; the longest is 3,600,000 ms.
  - `[low]` `[reject]` Edge: a mock-prices `delayMs` above 2^31 fires at once — same as the mock-llm delay row.
  - `[low]` `[reject]` Edge: a mixed-case Content-Type fixture header duplicates the header — fixtures are ours and use lowercase.
  - `[low]` `[reject]` Edge: mock-llm `--port ''` binds a random port — a developer tool; an empty port is an obvious typo.
  - `[low]` `[reject]` Edge: mock-prices `--port ''` binds a random port — same as the mock-llm port row.
  - `[low]` `[reject]` Edge: the cycle error lists modules that aren't in the cycle — the error still names the modules and fails loudly.
  - `[low]` `[reject]` Edge: circular expectations overflow the stack — expectations are JSON data produced by our modules.
  - `[low]` `[reject]` Edge: a `__proto__` key is dropped from canonical output — not produced by any module.
  - `[medium]` `[patch]` VG: nothing boots the built image in demo mode — added a CI container step, run locally against the rebuilt image: health 200, exit 0.
  - `[low]` `[patch]` VG: the CLI `--fixtures` option is untested — each mock CLI test now serves a custom fixture from a temp directory.
  - `[low]` `[reject]` VG other: demo health reports writable — same as the Blind demo-health row.
  - `[low]` `[reject]` Intent A2: the seeded database is not byte-identical — database IDs are ULIDs by design (AD-5); timestamps are now pinned by the fixed clock; the intent's byte check is on the seed output.
  - `[low]` `[reject]` Intent B2: the dummy module is added to an ad-hoc list, not `defaultModules` — the CLI passes `defaultModules` straight to the same `runSeed`.
  - `[false]` `[reject]` Intent C2: the fixtures are authored, not recorded — the plan specifies fixtures in each provider's real response format; no recorded traffic exists offline.
  - `[false]` `[reject]` Intent C3: the timeout is shown by a harness abort, not a product client — no adapters exist yet (epic 5).
  - `[low]` `[reject]` Intent D2: demo is tested at the unit-of-work level and health says writable — same as the Blind demo-health row.
  - `[false]` `[reject]` Intent: scope beyond the one-line intent (loader, createPerson, boundary arrow, Dockerfile) — it is the plan's chosen route to demo mode; not a defect.

## Design Notes

**Why the seed is data and the server applies it.** It keeps `tools/seed` pure and `shared`-only. It also keeps every write on the `app` use-case path (AD-1) and the `SystemViewer` inside `admin/` (AD-6). When epic 3 arrives, the same loader swaps from calling ledger use cases to importing rendered files, and the modules' expectations don't change (AD-15 bootstrap).

**Per-module streams:**
```ts
const rngFor = (seed: string, module: string) => sfc32(...hash128(`${seed}:${module}`));
```

**Spine propagation.** The spine's Invariants diagram has no `tools/*` arrows. This story adds `tools/seed → shared`. Record it in Implementation Notes so the spine's diagram can be updated.

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all green
- `pnpm seed --out /tmp/a && pnpm seed --out /tmp/b && cmp /tmp/a/seed.json /tmp/b/seed.json` -- expected: identical
- `pnpm build && PANGOLIN_DEMO=true PORT=3000 node apps/server/dist/main.js`, then `curl -fsS localhost:3000/api/system/health` -- expected: 200 ok

## Auto Run Result

Status: built

**Summary:** Ticket 1.7:
- **Seed generator:** `tools/seed` is pure and deterministic. It has a world model, the `SeedModule` contract with a random stream per module, a fixed today (`2026-07-15`) and expectations. Output is canonical `seed.json` from `pnpm seed`. The first module is `people-and-household`.
- **Seed checks:** duplicate person keys and more than one household-settings event are now rejected across modules.
- **Seed loader:** the server's `admin/seed.ts` validates the whole file, then applies it through `identity.createPerson` and `updateHouseholdSettings` as `cli:seed`.
- **Demo mode:** `PANGOLIN_DEMO=true` loads the seed into an in-memory database on a fixed clock at the seed's today. Writes are refused with `Conflict`, health stays 200, and the data dir is never touched.
- **Mock servers:** replay servers for OpenAI and Anthropic, with the ok, malformed-JSON, timeout, 429 and refusal scenarios. The Yahoo-chart price server serves VAS.AX and VGS.AX plus three MOCK-* failure tickers.

**Files changed:**
- `tools/seed/src/**`: the generator, its modules, CLI and tests.
- `tools/mock-llm/**` and `tools/mock-prices/**`: the servers, CLIs, fixtures and tests.
- `packages/app`: `identity/create-person.ts`, `fixedClockAt`, and `person.insert` on the port.
- `packages/db`: `person.insert`.
- `apps/server`:
  - `admin/seed.ts` and `demo.ts`.
  - `server.ts` and `config.ts` for demo mode.
  - `scripts/demo-seed.ts` and `build.ts`, which write `dist/demo-seed.json`.
- `scripts/check-boundaries.ts`: the `tools/seed → shared` arrow.
- `Dockerfile`: installs `@pangolin/seed`.
- `.github/workflows/ci.yml`: a demo-boot step.
- Root `package.json` scripts and `README.md`.

**Review:** 43 findings.
- 16 rows patched, covering 9 root causes.
- 1 deferred: the spine diagram arrow.
- 26 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict: 4 medium (cross-module duplicate checks, demo fixed clock, malformed fixtures, CI demo boot), 5 low (real-date check, spawn hardening, `--fixtures` tests, MOCK-TIMEOUT names, README).

**Follow-up review:** recommended (`true`, since four medium entries were patched). The named unverified risk: the CI `container` job, including the new demo-boot step and the anchore scan, has never run on GitHub.

**Verification:**
- `pnpm install --frozen-lockfile`, lint, typecheck and `pnpm test` all pass: 32 files, 359 passed, 1 skipped as root.
- `check:strict` passes.
- Two `pnpm seed` runs match byte for byte (`cmp`).
- `pnpm build` passes.
- Shellcheck reports nothing across every `ci.yml` `run` block.
- `docker compose build` passes, and the image generates `demo-seed.json`.
- The CI demo step, run locally against the image, exits 0 with health 200.
- The container is healthy both normally and in demo mode on a read-only root filesystem.
- Playwright against the Node build gives 1 passed.

**Residual risks:**
- `applySeed` is non-atomic and non-idempotent, which is fine for an empty in-memory database but unsafe elsewhere.
- Demo health reports `writable: true`.
- The spine diagram still needs the new arrow (deferred).
