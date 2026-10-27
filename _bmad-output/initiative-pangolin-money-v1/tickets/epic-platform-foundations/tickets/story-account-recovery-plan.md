---
title: 'Account recovery'
type: 'feature'
ticket: '6'
created: '2026-09-27'
status: done
baseline_revision: 'cc5f9745035c8efe9b2f7e6395899493a92d5d21'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/security-and-recovery.md'
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-passkey-login-plan.md'
warnings: [oversized]
deferred:
  - summary: >-
      No test shows demo mode skipping the "Save your recovery codes" step on the way to home.
    evidence: |-
      App.tsx gates the step on !me.demo. Nothing renders the web app in demo mode: there are no
      component tests and no demo e2e project. Dropping the check would make demo home unreachable
      and no test would fail.
    location: >-
      apps/web/src/App.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** A person who loses their passkey device, or forgets their password, has no way back in. The spec's two recovery methods are missing:
- 10 hashed one-time recovery codes that force a new passkey;
- a partner-issued, audited 24-hour re-enrolment link that notifies the affected person in the app.

The server-side `reset-user` use case that the CLI (story 1.9) will call is missing too.

**Approach:**
- Recovery codes are generated when enrolment completes and can be regenerated. They are stored hashed. Redeeming one takes the email, password and code. It removes the person's passkeys, revokes their other sessions, and signs them in to an enrolment-incomplete session that needs a new passkey.
- The partner re-enrolment link is issued by the other person, which needs re-auth. It is stored hashed and expires after 24 hours. It raises a person-scoped review item for the affected person.
- Redeeming the link sets a new password, clears passkeys, TOTP, sessions and recovery codes, and signs the person in needing both passkey and TOTP.
- `identity.resetUser` does the same clearing for a `SystemViewer` and returns a fresh re-enrolment link.
- Every step is audited.
- A viewer-scoped notices list, with dismissal of your own notices, surfaces the review item.

## Boundaries & Constraints

**Always:**
- **Recovery codes:**
  - 10 codes of 10 characters each, from a 32-letter unambiguous alphabet, grouped `XXXXX-XXXXX` for display. They are stored as SHA-256 hashes in `recovery_code` (`id`, `person_id`, `code_hash`, `created_at`, `used_at`).
  - They are generated when enrolment completes (the first time both passkey and TOTP exist), and shown once in the web app.
  - `POST /api/identity/recovery-codes` regenerates them. It needs re-auth, replaces all unused codes, and returns the new codes once.
- **Redeeming a recovery code:**
  - `POST /api/identity/recover` takes `{ email, password, code }` and is public.
  - Every failure goes into `login_attempt` and counts toward the 1.5 lockout. A locked email is refused with 429 before anything is checked.
  - The endpoint answers every failure (unknown email, wrong password or code, used code) with the same 401 `Unauthenticated`, so it never reveals which part was wrong.
  - On success, in one transaction: the code is marked used, all the person's passkeys are deleted, and all their sessions are revoked.
  - A new session is then issued with the strict cookie attributes. `me` reports `needs: ["passkey"]`, so only enrolment is reachable (the 1.5 gate).
- **Re-enrolment link:**
  - `POST /api/identity/re-enrolment-links` takes `{ personId }`, needs re-auth, and must target the *other* person, never yourself.
  - It creates `re_enrolment_link` (`id`, `person_id`, `issued_by` (`person:<id>` or `cli:reset-user`), `token_hash`, `created_at`, `expires_at` +24 h, `used_at`) and revokes earlier unused links for that person.
  - It raises the review item `identity.partner-reset`, scoped to that person, with dedupe `identity.partner-reset:<linkId>`.
  - It returns `<PANGOLIN_PUBLIC_URL>/recover?token=…` once, and nothing sensitive is logged.
- **Redeeming the link:**
  - `POST /api/identity/re-enrol` takes `{ token, newPassword }` and is public.
  - A valid, unused, unexpired token sets the password. It deletes the person's passkeys, their TOTP (two-factor off) and their recovery codes, and revokes all their sessions.
  - It marks the link used, then issues a session needing passkey and TOTP.
  - An invalid, used or expired token gets 400 `Validation` with the same message in every case.
- **`identity.resetUser(ctx, { personId })`:** accepts only a `SystemViewer` (`cli:reset-user`), otherwise it throws `Unauthenticated`. It does the same clearing as redeeming the link, then issues a re-enrolment link with `issued_by` `cli:reset-user`, raises the notice and returns the link. There is no HTTP route; story 1.9 exposes it over the admin socket.
- **Audit:** every event is audited with its entity: code generation, code use, link issue, link revocation, link redemption and `resetUser`. Audit rows never contain codes, tokens or passwords.
- **Notices:**
  - `GET /api/identity/notices` lists the viewer's open review items (1.4 scoping; person-scoped items only for that person).
  - `POST /api/identity/notices/:id/dismiss` resolves one if it is the viewer's own notice, otherwise 404.
- **Web:**
  - The enrolment completion screen shows the codes once, with a "saved them" confirmation.
  - The login page offers "Use a recovery code".
  - `/recover?token=` sets a new password, then goes through enrolment.
  - Home offers "Regenerate recovery codes", "Reset partner's access" (shows the link once) and the notices list.
- **Schema:** migration `0004`, all tables `STRICT`, and the schema version becomes 5.

**Never:**
- No email or SMTP.
- No admin socket or CLI (story 1.9).
- No recovery-code login without the password.
- No self-issued re-enrolment link.
- No codes, tokens or passwords in logs, audit rows or error bodies.
- No change to the 1.5 lockout thresholds.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Codes issued | enrolment completes | 10 codes shown once; 10 hashes stored | — |
| Recover | right email, password and code | old passkeys gone, other sessions revoked; new session with `needs: [passkey]`; code used; audited | — |
| Code reuse | the same code again | — | 401, counts toward lockout |
| Wrong code ×5 | 5 bad codes | the email is locked | 429 `RateLimited` |
| Regenerate | re-auth ok | old unused codes invalid; 10 new codes | stale auth → 403 `ReauthRequired` |
| Partner link | A resets B | link returned once; B's notice raised; audited | A targeting A → 400 `Validation` |
| Redeem link | B, valid token, new password | password set; passkeys, TOTP, codes and sessions cleared; session needs passkey + TOTP; link used; audited | — |
| Link reuse | the same token again | — | 400 `Validation` |
| Link expiry | 24 h + 1 s later (injected clock) | — | 400 `Validation` |
| Newer link | A issues twice | the first link is invalid | 400 on the first |
| Notice scope | after A resets B | B's notices include it; A's do not; A cannot dismiss it | A dismiss → 404 |
| reset-user | system viewer, person B | same clearing plus a link issued by `cli:reset-user` | a person viewer → `Unauthenticated` |

</intent-contract>

## Code Map

- `packages/app/src/identity/`:
  - `setup-links.ts` is the hashed-token pattern to copy (random bytes, SHA-256, expiry, revoke-older, audit).
  - `lockout.ts` has `recordLoginAttempt`/`checkLockout`; `reauth.ts` has `requireRecentAuth`; `me.ts` has `enrolmentNeeds`; `credentials.ts` has `recordCredentialChange`.
- `packages/app/src/system/review-items.ts`: `defineReviewKind`, `raiseReviewItem`, `resolveReviewItem`, `listReviewItems` (person scope). Register `identity.partner-reset` with person scope.
- `packages/db`:
  - `schema/` (auth tables use the `auth_` prefix; `auth_passkey`, `auth_two_factor`, `auth_session`, `auth_user.two_factor_enabled`).
  - Migrations `0000`–`0003`; next is `0004`.
  - The unit-of-work repos: add `recoveryCodes`, `reEnrolmentLinks`, and the credential-clearing operations on the auth tables. These are synchronous, in one transaction.
- `apps/server/src/auth/{auth,hooks}.ts`:
  - better-auth has a disabled-route mechanism (404), the re-auth gate on credential routes, and lockout hooks.
  - Issuing a session outside better-auth's sign-in: use its `internalAdapter.createSession` plus its cookie helpers, so the cookie attributes stay identical. Setting a password: use better-auth's password hasher (`ctx.password.hash`) or `internalAdapter.updatePassword`.
- `apps/server/src/http/{app,session}.ts`:
  - The session → viewer middleware and the enrolment-incomplete gate. The new public endpoints join its allow-list, like the setup endpoints.
  - The Origin check applies to them.
- `apps/web/src/{App,LoginView,SetupView,EnrolView}.tsx`, `api.ts`: existing views to extend. No inline styles (CSP).
- `e2e/`:
  - `auth.spec.ts` runs serially and leaves two enrolled people. It has virtual-authenticator, TOTP and CSP helpers in `e2e/helpers/`.
  - Add `recovery.spec.ts`, depending on the auth project, or extend the auth spec.
  - Watch the sign-in rate limit: CI and the README recipe use `PANGOLIN_AUTH_RATE_LIMIT=100`.
- **Schema version:** 4 → 5 in the tests, e2e and `README.md`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/{recovery-code,re-enrolment-link}.ts`, `migrations/0004_*.sql`, the repos + db tests -- tables, repos, and credential clearing (`deletePasskeys`, `disableTwoFactor`, `revokeSessions`, `setPasswordHash`) -- persistence
- [x] `packages/app/src/identity/{recovery-codes,re-enrolment,reset-user}.ts` + tests -- generate/regenerate/redeem codes; issue/redeem links; `resetUser`; the `identity.partner-reset` review kind; audit -- rules
- [x] `apps/server/src/auth/recovery.ts` + tests -- session issuing and password hashing via better-auth internals; the lockout for `/recover` -- the auth glue
- [x] `apps/server/src/http/app.ts` (+ tests) -- the recovery-code, recover, re-enrolment-link, re-enrol and notices routes; allow-list the public ones -- HTTP
- [x] `apps/web/src/**` -- codes shown at enrolment completion; the recovery-code login; `/recover`; home actions and the notices list -- UI
- [x] `e2e/recovery.spec.ts` (+ helpers) -- Playwright covers the recovery-code flow (forced passkey, no reuse) and the partner-link flow (redeem, re-enrol, no reuse, the notice visible only to the affected person) -- end to end
- [x] Tests, `e2e/health.spec.ts`, `README.md` -- schema version 5; README "Account recovery" section -- docs

**Acceptance Criteria:**
- Given an enrolled person with codes, when they recover with email, password and a code, then they must enrol a new passkey before reaching anything else, and the same code is refused afterwards.
- Given partner A resets B, when B redeems the link, then B sets a new password and must enrol a passkey and TOTP. The link is refused on a second use, and an equivalent link is refused 24 hours after issue.
- Given both events, when the audit log is queried, then each has its audit rows, and none contains a code or token.
- Given A reset B, when each lists notices, then only B sees the partner-reset notice.

## Implementation Notes

- **Codes at enrolment completion:** codes cannot be shown from inside better-auth's TOTP or passkey hooks, so `POST /api/identity/recovery-codes/initial` issues them. It works only once enrolment is complete and while the person has no `recovery_code` rows at all (409 otherwise). The web app shows the step whenever `me.recoveryCodes.issued` is false: after first enrolment, and again after a partner reset (which deletes every code). A recovery-code redemption keeps the rest of the set, so no new set appears.
- **Session issuing:** a `SERVER_ONLY` better-auth endpoint (`/pangolin/start-session`, plugin `pangolin-recovery`) calls `internalAdapter.createSession` and `setSessionCookie`, so the cookie attributes are better-auth's own. better-auth never routes it over HTTP (404, tested).
- **Password:** `/recover` verifies the password with better-auth's hasher (a missing login still costs one hash). `/re-enrol` hashes the new password before the write (AD-2); `identity.redeemReEnrolmentLink` stores it through `credentials.setPasswordHash` in the same transaction as the clearing.
- **Lockout:** `/recover` checks the lock first (429), and records one failure for any wrong part and one success on redemption. A redeemed re-enrolment link also records a success for that email, so a lockout against the old password cannot block the re-enrolment's TOTP step. Thresholds are unchanged.
- **Notices:** an older link's notice is resolved as `superseded` when a newer link revokes it; a redeemed link's notice stays until the person dismisses it. `GET /api/identity/notices` returns `id`, `kind` and `createdAt` only.
- **`TokenPort.randomBytes`:** added so `app` draws codes without runtime APIs; the 32-character alphabet (`A–Z` without `I`/`O`, `2–9`) takes one byte per character with no bias.
- **Audit:** `recovery_code` `generate` (counts) and `use`; `user` `recover` and `reset` (counts); `re_enrolment_link` `create`, `revoke` and `use` (no hash); the notice's `review_item` `raise` and `resolve`. All are scoped to the affected person.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 30 findings — high 4, medium 12, low 10, false 4, maybe-false 0
- findings:
  - `[medium]` `[patch]` VG: the home "Regenerate recovery codes" flow is untested — added an e2e test: 10 new codes, the count shown, an old code refused.
  - `[medium]` `[patch]` VG: a successful `/recover` recording `ok = 1` is untested — test: 4 failures, a recovery, then 1 failure leaves sign-in allowed, with one extra success row.
  - `[low]` `[patch]` VG: the notices projection isn't pinned — exact `toEqual` on `{ id, kind, createdAt, issuedBy }`.
  - `[low]` `[defer]` VG: demo mode skipping the recovery-codes step is untested in the UI — filed as defer by the lens; there is no demo UI harness; recorded in `deferred`.
  - `[low]` `[reject]` Intent: expiry and audit are proven only in-process — an injected clock and real `audit_log` rows at the HTTP layer are the right surface; e2e has no clock control.
  - `[low]` `[reject]` Intent: reuse refusals go through the API in e2e — an end-to-end check against the real server; the UI reuses the same endpoint.
  - `[medium]` `[patch]` Intent: `resetUser` is tested only in memory — now also tested over HTTP on real SQLite, including the old password being refused and the link redeemed.
  - `[medium]` `[patch]` Intent: the partner-reset notice says "was reset" at issue, and the affected person can't revoke the link — the wording is now pending and names the issuer; the affected person can revoke (audited).
  - `[false]` `[reject]` Intent: a recovery code skips the TOTP challenge — by design: codes stand in for the second factor, and the password is still required (Design Notes).
  - `[false]` `[reject]` Intent: the re-enrolment link also resets the password — by design (Design Notes): partner recovery is for someone who has lost everything.
  - `[false]` `[reject]` Intent: issuance and revocation audited beyond the two named events — a superset of the intent; not a defect.
  - `[high]` `[patch]` Blind: after `resetUser` the old password still opens an enrolment session in which anyone holding it can plant their own factors — `resetUser` now sets an unusable random password hash in the same transaction; an HTTP test shows the old password refused.
  - `[high]` `[patch]` Blind: `/recover` and `/re-enrol` bypass the per-client rate limit, so they can be sprayed at a password hash per request — the same per-client limiter now covers both routes (trusted-proxy aware); the 11th call gets 429.
  - `[medium]` `[patch]` Blind: recovery codes are unkeyed SHA-256 at 50 bits, so a stolen DB cracks them — HMAC-SHA256 under a key derived from the auth secret, never stored; tested.
  - `[medium]` `[patch]` Blind: using a recovery code alerts no one — raises an `identity.recovery-code-used` notice for that person; tested.
  - `[medium]` `[patch]` Blind: the partner-reset notice says "was reset" at issue, and the affected person can't revoke the link — same patch as the Intent notice row.
  - `[false]` `[reject]` Blind: demo mode's read-only rule is enforced on only two new routes — every other write goes through the read-only unit of work and fails `Conflict`.
  - `[medium]` `[patch]` Blind: a session failure after the recovery or re-enrol commit leaves a spent code or link and a 500 — the failure is caught and logged, and the answer is 200 `{ signedIn: false }` telling the person to sign in; tested.
  - `[medium]` `[patch]` Blind: `/recover` is ignored when a session exists, and the token stays in the URL — `/recover` is handled before `me`, with a sign-out-and-continue offer; the token is stripped with `replaceState`.
  - `[low]` `[patch]` Blind: the first codes are easy to lose, a 409 leaves the user stuck, and there is no low-codes warning — a 409 refetches `me`; home warns below 3 codes; codes can be regenerated with re-auth.
  - `[low]` `[reject]` Blind: revoking a link overwrites `expires_at` — the audit row keeps the original expiry; a `revoked_at` column adds schema for no current reader.
  - `[low]` `[patch]` Blind: test gaps (a no-Origin request; a redeemed `cli:reset-user` link over HTTP) — both added; the missing-password-account error stays untested (unreachable with email sign-up).
  - `[low]` `[reject]` Blind: small inconsistencies (the code-generation audit entityId, empty plan logs, README) — the entityId is the owning person by design; the plan logs are filled here; README updated.
  - `[medium]` `[patch]` Edge: a session failure after the recovery or re-enrol commit leaves a spent code or link and a 500 — same patch as the Blind post-commit row.
  - `[medium]` `[patch]` Edge: the re-enrol post-commit failure — same patch as the Blind post-commit row.
  - `[high]` `[patch]` Edge: after `resetUser` the old password still opens an enrolment session in which anyone holding it can plant their own factors — same patch as the Blind reset-user row.
  - `[low]` `[patch]` Edge: household `job.dead` items appear in notices with a dismiss that 404s — notices now list only the viewer's own person-scoped items.
  - `[medium]` `[patch]` Edge: `/recover` is ignored when a session exists, and the token stays in the URL — same patch as the Blind URL row.
  - `[low]` `[patch]` Edge: a 409 on the initial codes leaves the user stuck — same patch as the Blind first-codes row.
  - `[high]` `[patch]` Edge: `/recover` and `/re-enrol` bypass the per-client rate limit, so they can be sprayed at a password hash per request — same patch as the Blind rate-limit row.

## Design Notes

**A recovery code keeps the password requirement.** Recovery codes stand in for the second factor, the passkey or TOTP. The spec says using one "forces enrolment of a new passkey". Asking for the password as well means a leaked code sheet alone doesn't open the account.

**The partner link clears more than a recovery code does.** Partner-assisted recovery is for someone who has lost everything, including possibly their password. So it resets the password and every second factor. The spec's accepted residual risk stands: the issuing partner could redeem the link themselves. The audit trail and the notice make that visible.

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all green
- `pnpm --filter @pangolin/db db:generate` -- expected: no changes after `0004`
- `pnpm build`, then run the server on a fresh `PANGOLIN_DATA_DIR` with `PANGOLIN_AUTH_RATE_LIMIT=100`, then `PANGOLIN_DATA_DIR=… PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm e2e` -- expected: all specs pass, zero CSP violations

## Auto Run Result

Status: built

**Summary:** Ticket 1.6, account recovery:
- **Recovery codes:** 10 codes, stored as HMAC under a key derived from the auth secret. They are shown once at enrolment, and regenerating needs re-auth.
- **Using a code:** needs email, password and code. It removes the person's passkeys, revokes their sessions and forces a new passkey. It also raises an `identity.recovery-code-used` notice.
- **Partner link:** issued with re-auth, never for yourself. It lasts 24 hours, and a newer link revokes older ones. Its pending notice is visible only to the affected person, who can revoke the link.
- **Redeeming the link:** sets a new password, clears passkeys, TOTP, sessions and codes, and forces full enrolment.
- **`identity.resetUser`:** for `cli:reset-user` only. It clears credentials, makes the password unusable, and issues a link marked as issued by the console.
- **Hardening:** a per-client rate limit on the public recovery routes. A failure after commit answers `{ signedIn: false }` instead of 500.
- **Notices:** a list of the viewer's own person-scoped notices, with dismissal. Everything is audited, and no audit row holds a secret.

**Files changed:**
- `packages/db`: `schema/{recovery-code,re-enrolment-link}.ts`, `migrations/0004_recovery.sql`, and the repos (including credential clearing).
- `packages/app/src/identity/{recovery-codes,re-enrolment,reset-user,notices,me}.ts`.
- `apps/server/src`: `auth/recovery.ts` (the session plugin and keyed code hashing), `http/rate-limit.ts` and `http/app.ts` routes.
- `apps/web/src/RecoveryViews.tsx`, `App.tsx` and `api.ts`.
- `e2e/recovery.spec.ts` and `auth.spec.ts`.
- `README.md` "Account recovery"; schema version 5.

**Review:** 30 findings.
- 22 rows patched, covering 12 root causes.
- 1 deferred: the demo-mode UI test.
- 7 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict:
  - 2 high: the old password surviving `resetUser`, and no rate limit on the recovery routes.
  - 6 medium: keyed code hashing, the code-used notice, pending notice wording with revoke, the post-commit failure path, `/recover` with a session and the token in the URL, and the missing tests.
  - 4 low.

**Follow-up review:** recommended (`true`, since high entries were patched). The named unverified risks:
- The session-issuing plugin depends on better-auth internals (`internalAdapter.createSession`, `setSessionCookie`, `SERVER_ONLY` routing) and could break on an upgrade.
- `resetUser` still has no operator surface until story 1.9, so the console path is untested outside the server tests.

**Verification:**
- `pnpm install --frozen-lockfile`, lint, typecheck and `pnpm test` all pass: 55 files, 609 passed, 1 skipped as root.
- `check:strict` passes, and `db:generate` reports no changes.
- `pnpm build` passes.
- Playwright against the Node build (rate limit 100) gives 13 passed with no CSP violations.
- The Docker image was rebuilt after a Docker Hub 429 retry, then run with `compose up`: Playwright gives 13 passed.
- 0 token, secret or recover-link matches in the server or container logs.
- The CI demo-boot step passes.

**Residual risks:**
- The two follow-up risks above.
- Recovery codes stand in for the whole second factor (by design).
- The issuing partner could redeem the link themselves. This is the accepted residual risk in the spec, made visible by the audit trail and the notice.
