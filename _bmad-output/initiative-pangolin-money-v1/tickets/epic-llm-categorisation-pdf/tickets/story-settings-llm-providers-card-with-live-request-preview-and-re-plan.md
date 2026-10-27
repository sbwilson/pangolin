---
title: 'Settings › LLM providers card with live request preview and re-auth guard'
type: 'feature'
ticket: 4
created: '2026-10-27'
status: 'built'
baseline_revision: '70cb543a5d88288e18dc383d34f4acdef6f93d1c'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users need a household-wide settings interface to configure LLM providers (local Ollama or cloud OpenAI/Anthropic), assign providers to purposes (`categorise`, `pdf_extract`, `row_interpret`), test connectivity, and inspect real live request previews, while guarding sensitive credentials behind re-authentication.

**Approach:** Implement `/settings#llm-providers` in `apps/web` with provider CRUD, purpose assignment selects, test connection action, re-authentication guard (`ReauthDialog`), and live request preview powered by the real request builder (`buildCategorisationRequest`, AD-6), backed by server HTTP endpoints and application use cases.

## Boundaries & Constraints

**Always:**
- Provider CRUD and purpose assignment actions require recent sign-in (`requireRecentAuth`), rejecting stale sessions with 403 `ReauthRequired` and presenting `ReauthDialog` in the web client.
- Plaintext API keys are encrypted at rest with AES-256-GCM under `authSecret`; safe read views expose at most `apiKeyLast4` and omit ciphertext.
- Provider locality (`isLocal`) is strictly derived from the `baseUrl` resolving to private LAN/RFC 1918 subnets (`isLanAddress`), never directly toggled or edited by the user.
- Cloud opt-in flags (`cloudPdf`, `cloudRows`) default to false and must be explicitly toggled for cloud providers; PDF extraction and row interpretation are blocked on cloud providers unless enabled.
- Live request preview must be generated using `buildCategorisationRequest` from `packages/app/src/classify/categorise-request.ts` (AD-6), demonstrating the actual prompt and payload structure sent to the provider.
- Request preview samples only visible, non-private transactions from public accounts (`is_private = 0`), or synthetic default items if no public transactions exist, never exposing private accounts to cloud previews.
- All new HTTP routes must be registered in `apps/server/src/privacy/route-manifest.ts` as system entries.
- Settings navigation includes `#llm-providers` with active scroll-spy and URL hash navigation.

**Never:**
- Never leak plaintext API keys or encrypted ciphertexts to the browser in read models or error messages.
- Never allow modifying providers or changing purpose assignments without a valid, recent authentication session.
- Never use a separate mock request generator for the preview; it must invoke `buildCategorisationRequest`.
- Never send private account transactions in preview requests or Few-Shot examples.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List providers & assignments | `GET /api/llm/settings` | Returns list of safe provider views (`apiKeyLast4`, `isLocal`, etc.) and purpose assignments | Requires authenticated session (401 if unauthenticated) |
| Create local provider | Name: "Ollama Local", kind: "openai", baseUrl: "http://192.168.1.10:11434/v1", model: "llama3.2" | Saved with `isLocal: true`, empty/null key, returns safe view | Rejects invalid kind or missing name/url |
| Create cloud provider | Name: "OpenAI Cloud", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "sk-proj-abc...7Q2a" | Saved with `isLocal: false`, encrypted ciphertext, `apiKeyLast4: "7Q2a"` | 403 `ReauthRequired` if session > 5 min |
| Edit provider key | User updates API key on existing provider | Re-authenticates via `ReauthDialog`, updates ciphertext and last4 | Reverts changes if re-auth cancelled |
| Delete provider | User deletes provider assigned to a purpose | Cascades or removes purpose assignment and deletes provider | 403 `ReauthRequired` if stale |
| Assign purpose | Purpose: "categorise", providerId: valid ID | Updates `llm_purpose_assignment` record; UI updates dropdown | 403 `ReauthRequired` if stale |
| Test connection success | Click "Test connection" on valid provider | Dispatches ping/minimal structured prompt via adapter; returns `{ ok: true, latencyMs }` | Displays green success badge with latency |
| Test connection failure | Provider endpoint unreachable or invalid key | Provider returns network/auth error; returns `{ ok: false, error: message }` | Displays inline error message without leaking keys |
| Live request preview | Purpose: "categorise", provider configured | Calls `buildCategorisationRequest` with categories and public sample; returns prompt/schema preview | Graceful fallback if no provider assigned |

</frozen-after-approval>

## Code Map

- `packages/app/src/classify/llm-provider-use-cases.ts` -- use cases for listing, creating, updating, deleting LLM providers, assigning purposes, testing connectivity, and generating live request previews.
- `packages/app/src/classify/categorise-request.ts` -- reuse `buildCategorisationRequest` for live preview generation.
- `packages/app/src/identity/reauth.ts` -- reuse `requireRecentAuth` for re-authentication checks.
- `packages/app/src/index.ts` -- export LLM provider use cases from `@pangolin/app`.
- `apps/server/src/http/app.ts` -- register `/api/llm/settings`, `/api/llm/providers`, `/api/llm/providers/:id`, `/api/llm/providers/:id/test`, `/api/llm/purposes/:purpose`, and `/api/llm/preview` routes.
- `apps/server/src/privacy/route-manifest.ts` -- register `/api/llm/*` routes as system entries.
- `apps/server/src/server.ts` -- pass `authSecret` in `ApiDeps` to `createApp`.
- `apps/web/src/api.ts` -- add typed client methods for LLM provider CRUD, purpose assignment, test connection, and preview.
- `apps/web/src/components/SettingsNav.tsx` -- add `llm-providers` section to `SETTINGS_SECTIONS`.
- `apps/web/src/components/LlmProviderSettings.tsx` -- Settings card component with provider CRUD, purpose assignment selects, test connection buttons, request preview modal/accordion, and `ReauthDialog`.
- `apps/web/src/routes/settings.tsx` -- mount `LlmProviderSettings` at `<section id="llm-providers">`.
- `apps/server/src/http/app.test.ts` -- server integration tests verifying provider CRUD, re-auth enforcement, and test endpoint.
- `apps/web/src/components/LlmProviderSettings.test.tsx` -- component unit tests covering rendering, re-auth flow, test connection, and live request preview.
- `apps/web/src/routes/settings.test.tsx` -- route tests verifying `/settings#llm-providers` navigation and interaction.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/classify/llm-provider-use-cases.ts` -- implement use cases: `getLlmSettings`, `createLlmProvider`, `updateLlmProvider`, `deleteLlmProvider`, `assignLlmPurpose`, `testLlmProvider`, `getLlmRequestPreview`.
- [x] `packages/app/src/index.ts` -- export LLM use cases and types.
- [x] `apps/server/src/http/app.ts` & `apps/server/src/server.ts` -- implement HTTP routes for LLM provider management, test connection, and live preview with `requireRecentAuth`.
- [x] `apps/server/src/privacy/route-manifest.ts` -- register `/api/llm/*` routes in manifest.
- [x] `apps/server/src/http/app.test.ts` -- test suite for LLM HTTP endpoints (auth required, re-auth enforcement, CRUD, test connection).
- [x] `apps/web/src/api.ts` -- implement web API client functions for LLM endpoints.
- [x] `apps/web/src/components/SettingsNav.tsx` -- register `llm-providers` in `SETTINGS_SECTIONS`.
- [x] `apps/web/src/components/LlmProviderSettings.tsx` -- build Settings card with provider list, add/edit form, purpose dropdowns, test connection, live preview, and `ReauthDialog` integration.
- [x] `apps/web/src/routes/settings.tsx` -- add `llm-providers` section to Settings page.
- [x] `apps/web/src/components/LlmProviderSettings.test.tsx` -- unit tests for component interactions, re-auth guard, test connection, and preview rendering.
- [x] `apps/web/src/routes/settings.test.tsx` -- route integration tests for `/settings#llm-providers`.

**Acceptance Criteria:**
- Given a user on `/settings#llm-providers`, all configured providers and their purpose assignments (`categorise`, `pdf_extract`, `row_interpret`) are displayed with safe attributes (`apiKeyLast4`, `isLocal` badge).
- Given a user attempting to add, edit, or delete a provider, or change purpose assignments, when their session is older than 5 minutes, `ReauthRequired` (403) triggers `ReauthDialog`; upon completing re-authentication, the action completes successfully.
- Given a provider with a valid endpoint, clicking "Test connection" validates the endpoint and displays latency; given an invalid endpoint or key, a clear error is shown without leaking sensitive credentials.
- Given the live request preview, the displayed payload is generated by `buildCategorisationRequest` (AD-6) with sanitized fields (description, amount, date, categories) and never includes private account data.
- Given `pnpm check-boundaries`, `pnpm typecheck`, and `npx vitest run`, all boundary checks, type checks, and tests pass cleanly.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Total findings: 16 | High: 0 | Medium: 1 | Low: 8 | False: 7 | Maybe-false: 0
- [medium] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- if encryption helper is injected but authSecret is missing, throw Validation error instead of writing unencrypted key or sending ciphertext over the wire; patched to throw AppError("Validation", "Encryption secret not configured").
- [low] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- test connection error sanitisation only masked keys if length > 4; patched to mask as "***" when length <= 4.
- [low] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- fallback isLanAddress failed on bracketed IPv6 and missed link-local/ULA; patched to strip brackets and match fe80/fc/fd subnets.
- [low] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- provider input schemas did not validate http/https protocol; patched with isValidHttpUrl refine.
- [low] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- assignLlmPurpose and deleteLlmProvider lacked before state or cascading purpose assignment audit events; patched to record prior state and emit unassign audit events.
- [low] [patch] `packages/app/src/classify/llm-provider-use-cases.ts` -- getLlmRequestPreview did not parse input with Zod schema; added getLlmRequestPreviewInputSchema with parseInput.
- [low] [patch] `apps/web/src/components/LlmProviderSettings.tsx` -- preview badge defaulted to "Cloud" when query was loading or unassigned; patched to show badge only when provider is resolved.
- [low] [patch] `apps/web/src/components/LlmProviderSettings.tsx` -- deleting provider while editing could leave stale form open; patched to resetForm when editingProvider.id matches deleted id.
- [low] [patch] `apps/web/src/components/LlmProviderSettings.tsx` -- cloud opt-ins displayed for local endpoints despite backend overriding to false; patched to display local privacy notice and hide cloud opt-in checkboxes when local provider is detected.
- [false] [reject] `packages/app/src/classify/llm-provider-use-cases.ts` -- claimed nameHidden is missing from TransactionRow; refuted: listVisible returns VisibleTransaction which explicitly defines nameHidden: boolean (ports/unit-of-work.ts:463).
- [false] [reject] `apps/server/src/privacy/route-manifest.ts` -- claimed /api/llm/preview misclassified as system route; refuted: preview queries only public accounts and never varies with private data, confirmed by privacy.test.ts passing 81/81 tests.
- [false] [reject] `apps/web/src/components/LlmProviderSettings.tsx` -- claimed inability to clear API key on update; refuted: updateLlmProvider accepts apiKey: null/empty string and clears key ciphertext and last4.
- [false] [reject] `apps/web/src/components/LlmProviderSettings.tsx` -- claimed preview UI hardcodes categorise; refuted: categorise is the only capability builder that exists in milestone M2 (AD-6), pdf_extract and row_interpret builders belong to subsequent stories 5.6 and 5.7.
- [false] [reject] `packages/app/src/classify/categorise-engine.test.ts` -- claimed fixture typing bypasses in tests; refuted: test assertions pass all TypeScript strict checks without type errors.
- [false] [reject] `apps/web/src/components/LlmProviderSettings.tsx` -- claimed potential 404 on stale form submit; refuted: updateLlmProvider handles NotFound with clean user-facing error message.
- [false] [reject] `packages/app/src/classify/llm-provider-use-cases.ts` -- claimed ciphertext sent as plaintext when authSecret missing; refuted: testLlmProvider checks authSecret and returns error before calling provider adapter.

## Design Notes

- **Locality Classification:** The user never directly selects whether a provider is "local". It is derived via `isLanAddress(baseUrl)`: URLs resolving to `127.0.0.1`, `localhost`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, or `*.local` receive `isLocal = true`; cloud endpoints receive `isLocal = false`.
- **Cloud Opt-ins:** When a provider is not local (`isLocal = false`), the UI shows checkboxes for `cloud_pdf` and `cloud_rows`, warning that statements carry names and account numbers.
- **Request Builder Reuse (AD-6):** `getLlmRequestPreview` calls `buildCategorisationRequest`, fetching category options and a sample transaction from visible public accounts.
- **Re-auth Action Pattern:** Following `AccountSettings.tsx` and `ReauthDialog.tsx`, destructive or sensitive actions store the pending callback, open `ReauthDialog` on `ReauthRequired`, and execute the callback on `onSuccess`.

## Verification

**Commands:**
- `npx vitest run packages/app/src/classify/llm-provider-use-cases.test.ts apps/server/src/http/app.test.ts apps/web/src/components/LlmProviderSettings.test.tsx apps/web/src/routes/settings.test.tsx`
- `node scripts/check-boundaries.ts`
- `pnpm typecheck`
