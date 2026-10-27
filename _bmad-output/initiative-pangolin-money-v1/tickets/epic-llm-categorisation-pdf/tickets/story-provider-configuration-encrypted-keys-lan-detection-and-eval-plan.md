---
title: 'Provider configuration, encrypted keys, LAN detection, and eval harness'
type: 'feature'
ticket: 2
created: '2026-10-26'
status: 'built'
baseline_revision: 'e2986f2a64bcb1baddceb0fe3bcaba7c140aa849'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app needs database persistence and security policies for LLM providers and their per-purpose assignments, including encrypted API keys at rest, LAN address classification for local versus cloud privacy boundaries, and an evaluation harness to measure model accuracy, calibration, and latency.

**Approach:** Implement `llm_provider` and `llm_purpose_assignment` database schemas (migration 0021), AES-256-GCM API key encryption under an HMAC key derived from `authSecret`, RFC 1918 LAN IP resolution for `is_local`, and a comprehensive evaluation harness in `packages/llm/src/eval/` scoring accuracy, Brier calibration, and latency against labelled synthetic transactions.

## Boundaries & Constraints

**Always:**
- Key encryption at rest uses Node `crypto` AES-256-GCM with a 32-byte key derived from `authSecret`: `createHmac("sha256", authSecret).update("llm-api-keys").digest()`.
- API keys are encrypted at rest with a fresh random 12-byte IV per encryption; plaintext keys are never stored in the database, never returned to browser clients, and never logged.
- The repository exposes safe read models where API keys are redacted to at most their last 4 characters (`apiKeyLast4`).
- LAN address detection accurately classifies RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopbacks (`127.0.0.0/8`, `localhost`, `::1`), mDNS (`*.local`), and link-local ranges as local (`is_local: true`).
- `llm_provider` records cloud opt-in flags `cloud_pdf` and `cloud_rows` defaulting to `0` (false).
- `TxRepos` and `ReadRepos` include `llmProviders` repository; `packages/app/src/ports/tx-repos-viewer.test.ts` allowlists it under `UNSCOPED_REPOS` as household-wide configuration.
- The evaluation harness scores models on a labelled synthetic dataset reporting: accuracy (% correct), calibration (Brier score), and latency metrics (mean, p95, min, max).
- Vitest tests verify key encryption/decryption, query redaction, LAN subnet classification, repository persistence, and evaluation harness metrics against `tools/mock-llm`.

**Never:**
- No plaintext API keys in SQL tables, logs, audit payloads, or HTTP responses.
- No UI components or HTTP routes in this backend story (Settings UI card is story 5.4).
- No categorization batch engine or FTS5 search in this story (belongs to story 5.3).
- No hardcoded secrets or unauthenticated external network requests during test runs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Encrypt and save provider | Provider with API key `sk-proj-abc1234567Q2a` | Row stored with encrypted ciphertext; `apiKeyLast4: "7Q2a"` | Throws if encryption fails |
| Read provider safe view | Saved provider with encrypted key | Returns provider info with `apiKeyLast4: "7Q2a"`, ciphertext excluded | Plaintext key never leaked |
| Decrypt key for outbound call | Provider ciphertext and valid authSecret | Decrypts to original plaintext `sk-proj-abc...` | Throws error if auth tag or ciphertext tampered |
| Local Ollama LAN IP | URL `http://192.168.1.50:11434/v1` | `is_local: true` (RFC 1918 private subnet) | Handled by LAN detection |
| Localhost / loopback | URL `http://127.0.0.1:11434/v1` or `http://localhost:11434` | `is_local: true` | Handled by LAN detection |
| Cloud provider URL | URL `https://api.openai.com/v1` | `is_local: false` | Handled by LAN detection |
| Purpose assignment | Assign provider to `categorise`, `pdf_extract`, or `row_interpret` | Upserts `llm_purpose_assignment` record linking purpose to provider ID | Rejects invalid purpose enum |
| Eval harness execution | Provider and synthetic labelled dataset (20 items) | Returns accuracy score (0-1), Brier score, and latency stats | Catches provider errors per item |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/llm-provider.ts` -- new Drizzle schema definitions for `llmProvider` and `llmPurposeAssignment` tables.
- `packages/db/src/schema/index.ts` -- re-export `llmProvider` and `llmPurposeAssignment` schemas.
- `packages/db/migrations/0021_llm_provider.sql` -- SQLite migration creating `llm_provider` and `llm_purpose_assignment` tables.
- `packages/db/migrations/meta/_journal.json` -- record migration `0021_llm_provider`.
- `packages/app/src/ports/unit-of-work.ts` -- define `LlmProviderRepo`, provider row types, and register `llmProviders` in `TxRepos` and `ReadRepos`.
- `packages/app/src/ports/tx-repos-viewer.test.ts` -- add `llmProviders` to `UNSCOPED_REPOS` with explanatory comment.
- `packages/app/src/testing/memory-uow.ts` -- add in-memory test double for `llmProviders`.
- `packages/db/src/repositories/llm-provider.ts` -- implement `createLlmProviderRepo` with CRUD and purpose assignment operations.
- `packages/db/src/unit-of-work.ts` -- bind `llmProviders` in `createTxRepos` and `createReadRepos`.
- `packages/llm/src/crypto.ts` -- AES-256-GCM encryption/decryption helpers using `node:crypto` and key derivation from `authSecret`.
- `packages/llm/src/crypto.test.ts` -- unit tests for key encryption, decryption, tamper detection, and key suffix extraction.
- `packages/llm/src/lan.ts` -- LAN IP / host resolution utility `isLanAddress(urlOrHost: string): boolean` covering RFC 1918, loopbacks, and mDNS.
- `packages/llm/src/lan.test.ts` -- unit tests for LAN classification across RFC 1918 subnets, loopbacks, public IPs, and hostnames.
- `packages/llm/src/eval/dataset.ts` -- synthetic labelled transactions dataset with ground truth categories and category choices.
- `packages/llm/src/eval/metrics.ts` -- scoring functions for accuracy, Brier calibration, and latency percentiles.
- `packages/llm/src/eval/harness.ts` -- evaluation harness orchestrating predictions over the dataset and aggregating scores.
- `packages/llm/src/eval/harness.test.ts` -- tests running the eval harness against `tools/mock-llm` and mock providers.
- `packages/llm/src/index.ts` -- re-export crypto, LAN detection, and eval harness utilities from `@pangolin/llm`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/llm-provider.ts` -- define `llm_provider` (`id`, `name`, `kind`, `base_url`, `model`, `api_key_ciphertext`, `api_key_last4`, `is_local`, `cloud_pdf`, `cloud_rows`, `created_at`, `updated_at`) and `llm_purpose_assignment` (`purpose`, `provider_id`, `updated_at`).
- [x] `packages/db/src/schema/index.ts` -- export new schemas from `@pangolin/db`.
- [x] `packages/db/migrations/0021_llm_provider.sql` & `packages/db/migrations/meta/_journal.json` -- create and register migration 0021.
- [x] `packages/app/src/ports/unit-of-work.ts` -- add `LlmProviderRepo` interface, `LlmProviderRow`, `LlmPurposeAssignmentRow`, and add `llmProviders` to `TxRepos` and `ReadRepos`.
- [x] `packages/app/src/ports/tx-repos-viewer.test.ts` -- allowlist `llmProviders` in `UNSCOPED_REPOS`.
- [x] `packages/app/src/testing/memory-uow.ts` -- implement in-memory `llmProviders` repository for test suite parity.
- [x] `packages/db/src/repositories/llm-provider.ts` -- implement SQLite repository for `llm_provider` and `llm_purpose_assignment`.
- [x] `packages/db/src/unit-of-work.ts` -- wire `llmProviders` into transaction and read repositories.
- [x] `packages/llm/src/crypto.ts` & `packages/llm/src/crypto.test.ts` -- AES-256-GCM encryption/decryption with key derivation from `authSecret` and unit tests.
- [x] `packages/llm/src/lan.ts` & `packages/llm/src/lan.test.ts` -- RFC 1918 and loopback address classification and unit tests.
- [x] `packages/llm/src/eval/` (dataset, metrics, harness) & `packages/llm/src/eval/harness.test.ts` -- synthetic labelled dataset, scoring metrics (accuracy, Brier calibration, latency), and eval harness test suite.
- [x] `packages/llm/src/index.ts` -- export crypto, LAN, and eval utilities from `@pangolin/llm`.

**Acceptance Criteria:**
- Given a valid API key, when encrypted with `encryptApiKey(key, authSecret)` and decrypted with `decryptApiKey(ciphertext, authSecret)`, then the decrypted text matches the original and tampering with tag or ciphertext throws.
- Given URLs pointing to RFC 1918 subnets (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`), `127.0.0.1`, `localhost`, or `*.local`, `isLanAddress` returns `true`; given public internet hosts (`api.openai.com`), it returns `false`.
- Given `llm_provider` and `llm_purpose_assignment` tables, migration 0021 applies cleanly, and repositories allow creating, reading, listing, and assigning providers to purposes without leaking encrypted keys in safe read models.
- Given an `LlmProvider` and the synthetic labelled dataset, the evaluation harness returns valid accuracy (0 to 1), Brier calibration score (0 to 1), and latency distribution stats.
- Given `pnpm check-boundaries`, `pnpm typecheck`, and `npx vitest run`, all boundary checks, typechecks, and unit tests pass cleanly.

## Implementation Notes

- Added `llm_provider` and `llm_purpose_assignment` Drizzle table schemas in `packages/db/src/schema/llm-provider.ts` and registered in `packages/db/src/schema/index.ts`.
- Created SQLite migration `0021_llm_provider.sql` and updated `packages/db/migrations/meta/_journal.json`.
- Defined `LlmProviderRepo`, `LlmProviderRow`, `LlmProviderSafeView`, and `LlmPurposeAssignmentRow` in `packages/app/src/ports/unit-of-work.ts` and re-exported from `@pangolin/app`.
- Registered `llmProviders` under `UNSCOPED_REPOS` in `packages/app/src/ports/tx-repos-viewer.test.ts` as household-wide configuration.
- Implemented SQLite repository `createLlmProviderRepo` in `packages/db/src/repositories/llm-provider.ts` and wired into `TxRepos` and `ReadRepos` in `packages/db/src/unit-of-work.ts`.
- Implemented in-memory repository double in `packages/app/src/testing/memory-uow.ts` with purpose assignment cascade and foreign-key parity.
- Implemented AES-256-GCM encryption/decryption utilities in `packages/llm/src/crypto.ts` with key derivation `HMAC-SHA256(authSecret, "llm-api-keys")`, 12-byte random IVs, and last-4 key extraction.
- Implemented RFC 1918, loopback, link-local, IPv4-mapped IPv6, and mDNS LAN classification in `packages/llm/src/lan.ts`.
- Implemented evaluation harness, 20-item synthetic Australian banking dataset, and metrics (accuracy, Brier calibration, and latency percentiles) in `packages/llm/src/eval/`.
- Re-exported crypto, LAN, and eval utilities from `@pangolin/llm`.
- All unit, parity, migration, viewer-first, boundary, and typecheck checks passing cleanly.

## Plan Change Log

## Review Triage Log

- Total findings: 15 | High: 0 | Medium: 1 | Low: 5 | False: 9 | Maybe-false: 0
- [medium] [patch] `packages/db/src/system-health-repo.test.ts` -- schemaVersion test assertion expects 21, failing with 22 after migration 0021 added; updated expected version to 22.
- [low] [patch] `packages/db/src/llm-provider-repo.test.ts` -- direct cast from `LlmProviderSafeView` to `Record<string, unknown>` violates strict TS2352 without index signature; cast through `unknown`.
- [low] [patch] `packages/app/src/testing/memory-uow.ts` -- `assignPurpose` did not enforce foreign key existence check, allowing non-existent provider assignments; added check throwing foreign key constraint error.
- [low] [patch] `packages/app/src/testing/memory-uow.ts` -- `update` replaced the full object and did not preserve `createdAt`; updated to retain existing `createdAt`.
- [low] [patch] `packages/llm/src/eval/{metrics.ts,harness.ts}` -- `calculateBrierScore` scored errors as (0 - 0)^2 = 0 which rewarded failed requests; filtered calibration and latencies to completed predictions.
- [low] [patch] `packages/llm/src/lan.ts` -- `extractHostname` fallback cut at scheme slashes on malformed URLs, and lacked recognition for IPv4-mapped IPv6 addresses; stripped scheme before fallback slash parsing and added IPv4-mapped IPv6 detection.
- [false] [reject] `packages/llm/src/crypto.ts` -- `extractApiKeyLast4` returns `apiKey` when length <= 4: slice(-4) on short strings is standard definition of last 4 characters.
- [false] [reject] `packages/db/src/schema/llm-provider.ts` -- CHECK constraint on kind ('openai', 'anthropic') excludes local Ollama/vLLM by name: Ollama and local models use OpenAI-compatible API protocol per architecture specification.
- [false] [reject] `packages/llm/src/eval/dataset.ts` -- harness discards payee and website expectations: story 5.2 scopes category accuracy, calibration, and latency; payee extraction belongs to story 5.9.
- [false] [reject] `packages/llm/src/crypto.ts` -- AES-256-GCM omits AAD binding: plan specifies `${iv}:${tag}:${ciphertext}` format without AAD binding for standalone secret storage.
- [false] [reject] `packages/llm/src/eval/harness.test.ts` -- eval harness tests depend on live network sockets: contract/integration tests binding to loopback is standard pattern matching `tools/mock-llm`.
- [false] [reject] `packages/llm/src/lan.ts` -- uncompressed IPv6 loopback strings fail local classification: URL and standard address normalizers produce compressed IPv6 notation.
- [false] [reject] `packages/llm/src/eval/harness.ts` -- eval harness runs sequential loop without concurrency controls: sequential execution is intentional for local Ollama/GPU server to prevent GPU VRAM overload.
- [false] [reject] `packages/app/src/ports/unit-of-work.ts` -- repository operates on pre-encrypted strings without automatic encryption lifecycle: separation of concerns leaves crypto in `@pangolin/llm` and application service/use-case layer.
- [false] [reject] `packages/db/src/repositories/llm-provider.ts` -- repository does not call `isLanAddress`: repository caller or use-case sets `isLocal` via `isLanAddress(baseUrl)`, keeping repository as persistence adapter.

## Design Notes

- **AES-256-GCM Key Encryption:** Derived key `HMAC-SHA256(authSecret, "llm-api-keys")` stays in memory. Format stored in `api_key_ciphertext`: `${iv_hex}:${tag_hex}:${ciphertext_hex}` using standard Node `crypto`. `apiKeyLast4` stores the trailing 4 characters for safe display in UI/logs.
- **LAN Address Classification:** Uses synchronous regex and byte parsing for IPv4 CIDR blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`) and standard hostnames (`localhost`, `*.local`).
- **Calibration Metric (Brier Score):** Mean squared difference between predicted confidence probability and actual outcome (1 for correct, 0 for incorrect): `(1/N) * sum((confidence - outcome)^2)`. Lower score represents better probability calibration.

## Verification

**Commands:**
- `npx vitest run packages/llm/src/crypto.test.ts packages/llm/src/lan.test.ts packages/llm/src/eval/harness.test.ts` -- expected: all crypto, LAN detection, and eval harness tests pass.
- `npx vitest run packages/app/src/ports/tx-repos-viewer.test.ts` -- expected: repository viewer-first and unscoped checks pass.
- `node scripts/check-boundaries.ts` -- expected: `Package boundaries: ok`.
- `pnpm typecheck` -- expected: zero TypeScript compiler errors.
