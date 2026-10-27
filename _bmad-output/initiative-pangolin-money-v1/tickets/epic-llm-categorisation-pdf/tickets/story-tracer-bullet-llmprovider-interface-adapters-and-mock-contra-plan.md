---
title: 'Tracer bullet: LlmProvider interface, adapters, and mock contract tests'
type: 'feature'
ticket: 1
created: '2026-10-26'
status: 'built'
baseline_revision: '9cd8a2552935c63117a6e956dbdc31cac29b5295'
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

**Problem:** The app lacks an LLM provider abstraction and structured output pipeline, preventing upcoming categorisation, PDF statement parsing, and row interpretation features from querying models across local (Ollama/vLLM) and cloud (OpenAI/Anthropic) backends with schema validation and resilient error handling.

**Approach:** Implement the `LlmProvider` port interface in `packages/app/src/ports/llm-provider.ts` and adapters in `packages/llm` for OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) APIs supporting structured output with Zod validation, verified by a contract test suite against `tools/mock-llm` covering malformed JSON, timeouts, 429 rate limits, and refusals.

## Boundaries & Constraints

**Always:**
- `LlmProvider` is an asynchronous outbound port (AD-2) called before database transactions open.
- Structured output is typed and validated with Zod: OpenAI adapter uses response format `json_schema` (or JSON mode fallback), Anthropic adapter uses forced tool calling with tool schema.
- Re-export the port, adapters, and errors from `@pangolin/llm` and `@pangolin/app`.
- Errors must be classified into distinct typed error classes: `LlmRateLimitError` (with retryAfterSeconds when available), `LlmTimeoutError`, `LlmRefusalError`, `LlmMalformedJsonError`, `LlmValidationError`, and `LlmHttpError`.
- Update `scripts/check-boundaries.ts` so `packages/llm` allows `testOnly: ["tools/mock-llm"]` for contract test suite fixtures.
- Contract test suite must run against `tools/mock-llm` and verify both OpenAI and Anthropic adapters against all 5 fixtures: `mock-ok`, `mock-malformed-json`, `mock-rate-limit`, `mock-refusal`, and `mock-timeout`.

**Never:**
- No database tables or schema migrations (provider configuration and encrypted keys at rest belong to story 5.2).
- No UI components or HTTP routes in this tracer bullet story.
- Adapters must never log raw API keys, full prompts, or untrusted payload contents in unredacted logs.
- No direct external network calls during automated test runs; contract tests rely strictly on `tools/mock-llm`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| OpenAI structured completion | OpenAI adapter, model `mock-ok`, valid Zod schema | Validated typed output object matching schema, token usage | No error expected |
| Anthropic forced tool call | Anthropic adapter, model `mock-ok`, valid Zod schema | Validated typed output object extracted from tool call, token usage | No error expected |
| OpenAI 429 rate limit | OpenAI adapter, model `mock-rate-limit` | Throws `LlmRateLimitError` with `retryAfterSeconds: 2` | Handled via typed error |
| Anthropic 429 rate limit | Anthropic adapter, model `mock-rate-limit` | Throws `LlmRateLimitError` with `retryAfterSeconds: 2` | Handled via typed error |
| OpenAI refusal | OpenAI adapter, model `mock-refusal` | Throws `LlmRefusalError` with message from `message.refusal` | Handled via typed error |
| Anthropic refusal | Anthropic adapter, model `mock-refusal` | Throws `LlmRefusalError` with refusal explanation | Handled via typed error |
| OpenAI malformed JSON | OpenAI adapter, model `mock-malformed-json` | Throws `LlmMalformedJsonError` | Handled via typed error |
| Anthropic malformed JSON | Anthropic adapter, model `mock-malformed-json` | Throws `LlmMalformedJsonError` | Handled via typed error |
| Schema validation failure | Either adapter, valid JSON response that fails Zod schema | Throws `LlmValidationError` with Zod issues | Handled via typed error |
| Request timeout | Either adapter, model `mock-timeout`, client timeout set | Aborts HTTP request and throws `LlmTimeoutError` | Handled via typed error |

</frozen-after-approval>

## Code Map

- `packages/app/src/ports/llm-provider.ts` -- new port definition: `LlmProvider`, `StructuredPrompt<T>`, `StructuredResponse<T>`, and port interfaces.
- `packages/app/src/ports/index.ts` (or `packages/app/src/index.ts`) -- export LLM port types.
- `packages/llm/src/errors.ts` -- error classes: `LlmError`, `LlmRateLimitError`, `LlmTimeoutError`, `LlmRefusalError`, `LlmMalformedJsonError`, `LlmValidationError`, `LlmHttpError`.
- `packages/llm/src/schema-converter.ts` -- converts a Zod schema to a JSON Schema object for OpenAI `json_schema` and Anthropic `input_schema`.
- `packages/llm/src/openai.ts` -- `OpenAiAdapter` implementing `LlmProvider` for OpenAI-compatible endpoints (`POST /v1/chat/completions`).
- `packages/llm/src/anthropic.ts` -- `AnthropicAdapter` implementing `LlmProvider` for Anthropic-compatible endpoints (`POST /v1/messages`).
- `packages/llm/src/index.ts` -- main package export for `@pangolin/llm`.
- `packages/llm/src/contract.test.ts` -- contract test suite replaying `tools/mock-llm` against both adapters covering ok, malformed JSON, timeouts, 429 rate limits, and refusals.
- `scripts/check-boundaries.ts:37` -- package boundary rule: add `testOnly: ["tools/mock-llm"]` to `packages/llm`.
- `tools/mock-llm/src/server.ts` & `tools/mock-llm/fixtures/` -- mock LLM server and fixtures for OpenAI and Anthropic.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/ports/llm-provider.ts` -- define `LlmProvider` port, `StructuredPrompt<T>`, `StructuredResponse<T>`, and `LlmUsage` -- the application port contract.
- [x] `packages/app/src/index.ts` -- export LLM provider port types from `@pangolin/app`.
- [x] `packages/llm/src/errors.ts` -- implement `LlmError` hierarchy (`LlmRateLimitError`, `LlmTimeoutError`, `LlmRefusalError`, `LlmMalformedJsonError`, `LlmValidationError`, `LlmHttpError`).
- [x] `packages/llm/src/schema-converter.ts` -- utility to transform Zod schemas into JSON schema representations for OpenAI `response_format` and Anthropic tool `input_schema`.
- [x] `packages/llm/src/openai.ts` -- `OpenAiAdapter` implementing `LlmProvider` targeting `/v1/chat/completions` with JSON schema structured output, rate limit headers parsing (`retry-after`), refusal detection, and timeout cancellation.
- [x] `packages/llm/src/anthropic.ts` -- `AnthropicAdapter` implementing `LlmProvider` targeting `/v1/messages` with forced tool call, rate limit headers parsing, refusal stop reason detection, and timeout cancellation.
- [x] `packages/llm/src/index.ts` -- export `OpenAiAdapter`, `AnthropicAdapter`, and error classes from `@pangolin/llm`.
- [x] `scripts/check-boundaries.ts` -- update `ALLOWED["packages/llm"]` to include `testOnly: ["tools/mock-llm"]`.
- [x] `packages/llm/src/contract.test.ts` -- comprehensive contract test suite booting `startMockLlm` and executing all 5 scenarios for both adapters.

**Acceptance Criteria:**
- Given `tools/mock-llm` running, when `OpenAiAdapter` and `AnthropicAdapter` call `mock-ok` with a Zod schema, then both return validated typed objects and usage metrics.
- Given `tools/mock-llm` returning 429 `mock-rate-limit`, when either adapter makes a request, then an `LlmRateLimitError` is thrown with `retryAfterSeconds` equal to 2.
- Given `tools/mock-llm` returning `mock-refusal`, when either adapter makes a request, then an `LlmRefusalError` is thrown with the refusal message.
- Given `tools/mock-llm` returning `mock-malformed-json`, when either adapter makes a request, then an `LlmMalformedJsonError` is thrown.
- Given `tools/mock-llm` holding `mock-timeout`, when either adapter makes a request with a short timeout, then the request aborts and an `LlmTimeoutError` is thrown.
- Given `pnpm check-boundaries` and `pnpm test`, all checks pass cleanly with no boundary violations.

## Implementation Notes

- Added `LlmProvider`, `StructuredPrompt<T>`, `StructuredResponse<T>`, and `LlmUsage` in `packages/app/src/ports/llm-provider.ts` and re-exported from `@pangolin/app`.
- Created typed error hierarchy in `packages/llm/src/errors.ts`: `LlmError`, `LlmRateLimitError`, `LlmTimeoutError`, `LlmRefusalError`, `LlmMalformedJsonError`, `LlmValidationError`, `LlmHttpError`.
- Created Zod to JSON Schema converter in `packages/llm/src/schema-converter.ts` leveraging built-in `z.toJSONSchema` from Zod 4.
- Implemented `OpenAiAdapter` in `packages/llm/src/openai.ts` supporting `response_format: { type: "json_schema" }`, retry-after parsing, refusal extraction, and abort-controller timeout handling.
- Implemented `AnthropicAdapter` in `packages/llm/src/anthropic.ts` supporting forced tool use (`tool_choice: { type: "tool", name: ... }`), retry-after parsing, refusal stop reason detection, and abort-controller timeout handling.
- Updated `scripts/check-boundaries.ts` to allow `testOnly: ["tools/mock-llm"]` for `packages/llm`.
- Added contract tests in `packages/llm/src/contract.test.ts` executing against `tools/mock-llm` across all 5 fixture scenarios (`mock-ok`, `mock-rate-limit`, `mock-refusal`, `mock-malformed-json`, `mock-timeout`) plus schema validation failure for both adapters (12 test cases).
- Configured constructor properties without parameter syntax to comply with TypeScript `erasableSyntaxOnly`.
- Verified typechecking across all workspace packages and boundary checks.

## Plan Change Log

## Review Triage Log

- Total findings: 13 | High: 0 | Medium: 2 | Low: 8 | False: 3 | Maybe-false: 0
- [medium] [patch] `packages/llm/src/{anthropic,openai}.ts` -- AbortSignal listener leak: `prompt.signal.addEventListener` has no corresponding `removeEventListener` in a `finally` block.
- [medium] [patch] `packages/llm/src/{anthropic,openai}.ts` -- Timeout timer prematurely cleared before reading response body: `clearTimeout` runs before `await response.text()`, leaving body reading unmonitored by timeout.
- [low] [patch] `packages/llm/src/{anthropic,openai}.ts` -- `parseRetryAfter` regex: `parseFloat` parses leading digits of year in dates starting with numbers; should check `/^\d+(\.\d+)?$/` before Date parsing.
- [low] [patch] `packages/llm/src/{anthropic,openai}.ts` -- `LlmRefusalError` constructor call omits `refusalReason` argument, leaving the property `undefined`.
- [low] [patch] `packages/llm/src/openai.ts` -- `OpenAiAdapter` omits `prompt.schemaDescription` from `response_format.json_schema.json_schema`.
- [low] [patch] `packages/llm/src/anthropic.ts` -- `contentBlocks.find((c) => c.type === "tool_use")` should check `c.name === prompt.schemaName`.
- [low] [patch] `packages/llm/src/anthropic.ts` -- `rawString = JSON.stringify(rawData)` could return `undefined` if rawData is undefined; use `?? ""`.
- [low] [patch] `packages/llm/src/{anthropic,openai}.ts` -- Detect `finish_reason === "length"` / `stop_reason === "max_tokens"` and provide clear truncation error message.
- [low] [patch] `packages/llm/src/openai.ts` -- When `strictJsonSchema: false`, add schema and JSON instruction to system/user prompt.
- [low] [patch] `packages/llm/src/contract.test.ts` -- Add unit tests for caller `prompt.signal` cancellation and `zodToJsonSchema`.
- [false] [reject] `packages/llm/package.json` -- Adding `@pangolin/mock-llm` to package devDependencies would violate `check-boundaries.ts` rule (`testOnly` packages are linked from root devDependencies).
- [false] [reject] `packages/llm/src/{anthropic,openai}.ts` -- `trimmed.endsWith("/v1")` includes the slash, so hostnames like `http://gateway-v1` are not matched.
- [false] [reject] `packages/llm/src/errors.ts` -- Errors retaining raw responses is necessary for programmatic inspection; log redaction is enforced at logging boundaries per spine.

## Design Notes

- **OpenAI structured output:** Sends `response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } }`. Falls back to `type: "json_object"` if strict JSON schema is disabled by config.
- **Anthropic structured output:** Declares a single tool matching the schema and forces invocation with `tool_choice: { type: "tool", name: schemaName }`. Extracts the tool input from `content` where `type === "tool_use"`.
- **Zod conversion:** Uses lightweight JSON Schema extraction compatible with Zod objects, arrays, strings, numbers, booleans, and optional fields without requiring heavy external schema generation dependencies.

## Verification

**Commands:**
- `npx vitest run packages/llm/src/contract.test.ts` -- expected: all contract tests pass for OpenAI and Anthropic adapters against all fixtures.
- `node scripts/check-boundaries.ts` -- expected: `Package boundaries: ok`.
- `pnpm typecheck` -- expected: zero TypeScript compiler errors.
