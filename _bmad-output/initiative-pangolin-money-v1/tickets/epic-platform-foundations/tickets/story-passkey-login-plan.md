---
title: 'Passkey login'
type: 'feature'
ticket: '5'
created: '2026-09-27'
status: done
baseline_revision: '49318b14a61564c008984ad1336b7824d959dfbd'
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
warnings: [oversized]
deferred:
  - summary: >-
      No test shows a passkey sign-in resetting the password-failure count.
    evidence: |-
      The lockout after-hook records /passkey/verify-authentication as ok, but only a WebAuthn-driven
      test can reach it. Close it with an e2e step: 4 wrong passwords, a passkey sign-in, then 1
      wrong password still answers 401, not 429.
    location: >-
      apps/server/src/auth/hooks.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The app has no login. Anyone who can reach it can see everything, and nothing stands between the internet and the household's data. CAP-15 and the security spec call for passkeys first, a password plus TOTP fallback, registration closed after two people, lockout, re-authentication for sensitive actions, strict cookies, an Origin check and a nonce-based CSP.

**Approach:**
- Add better-auth 1.7 (email and password, the `twoFactor` TOTP plugin, and `@better-auth/passkey`) on our SQLite database. Its tables come in through our own migration runner, and its writes are audited through `identity` hooks.
- Gate sign-up behind one-time setup links (at most two people).
- Add login lockout, a per-action re-authentication window on `Viewer.authAt`, strict cookie attributes, an Origin check on writes, and a per-request CSP nonce injected into `index.html`.
- `/api/*` then requires a session, except health and the auth and setup endpoints.

## Boundaries & Constraints

**Always:**
- **better-auth:**
  - The instance lives in the `apps/server` composition root, on the `packages/db` connection.
  - Its tables (user, session, account, verification, passkey, two-factor) come from migration `0003`, generated from better-auth's schema, hand-edited to `STRICT`, and applied by our runner. better-auth never migrates by itself.
  - Its user create is gated and audited through `databaseHooks`.
- **Setup links:**
  - A token of 32 random bytes, stored hashed in `setup_link` (`id`, `token_hash`, `issued_by` person or `cli`, `created_at`, `expires_at` 24 h, `used_at`).
  - On boot, when no user exists and no unexpired unused link exists, the server issues one and writes `<PANGOLIN_PUBLIC_URL>/setup?token=…` to `<dataDir>/setup-link.txt` (mode 0600). It logs only the file path, never the token.
  - A logged-in person can issue a partner link with `POST /api/identity/setup-links` (re-auth required) while fewer than two people exist.
- **Sign-up** succeeds only with a valid unused link while fewer than two users exist. It creates the better-auth user, consumes the link and creates the linked `person` (display name and colour from the form), all audited.
- **Registration flow and login:**
  - The `/setup` page takes email, password, display name and colour. It then enrols a passkey, then TOTP (showing the `otpauth://` URI and secret), in one session.
  - Login offers a passkey first; the fallback is email and password, then a TOTP code.
- **Lockout:** 5 failed password or TOTP attempts for one email within 15 minutes lock that email for 15 minutes. The thresholds are config. Attempts are counted server-side in `login_attempt`, and every login attempt goes through better-auth's rate limit.
- **Sessions and viewers:**
  - Every `/api/*` route except `/api/system/health`, `/api/auth/*` and the setup endpoints resolves the session to `personViewer(personId, authAt)`, or answers 401 `Unauthenticated`.
  - `authAt` is the time of the last full authentication, meaning the session's creation.
  - `requireRecentAuth(ctx, windowMs = 5 min)` throws `ReauthRequired` (403).
  - Sessions have an idle timeout (config, default 30 minutes).
- **Cookies:** `HttpOnly`, `Secure` and `SameSite=Strict`, with a `__Host-` prefix when the public URL is https. On `http://localhost` the browser accepts `Secure`.
- **Origin check:** every non-GET/HEAD request to `/api/*` must carry `Origin` equal to `PANGOLIN_PUBLIC_URL`'s origin. Otherwise the answer is 403 in the error shape, and nothing runs.
- **CSP on every HTML response:**
  - The policy is `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<n>'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`.
  - The nonce is per request, and the server replaces a `__CSP_NONCE__` placeholder in `index.html` with it.
  - No inline scripts. No `style=` attributes are used, since the nonce doesn't cover them.
- **Config (one Zod schema):**
  - `PANGOLIN_PUBLIC_URL`, default `http://localhost:3000`.
  - The auth secret, from `PANGOLIN_AUTH_SECRET_FILE`, default `<dataDir>/auth-secret`, created with 0600 on first boot. It never goes into the database.
  - The lockout and idle-timeout settings.
- **Demo mode:** no auth. Requests get a viewer for the first seeded person, and writes still fail with `Conflict`.
- **Tests:** Playwright uses Chromium's WebAuthn virtual authenticator over CDP and computes TOTP codes itself (RFC 6238, `node:crypto`). A CSP-violation collector fails any test that records a violation.

**Never:**
- No recovery codes and no partner re-enrolment link (story 1.6).
- No admin socket (story 1.9).
- No email sending.
- No third-party auth.
- No `unsafe-inline` or `unsafe-eval`.
- No token or secret in any log line.
- No review-inbox route (still deferred from story 1.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First boot | empty DB | `setup-link.txt` written (0600); the log names the file only | — |
| Setup | valid link, form, passkey, TOTP | user + person created, link used, logged in; audit rows for both | — |
| Reused link | the same token again | — | 400 `Validation`, no user |
| Expired link | older than 24 h (injected clock) | — | 400 `Validation` |
| Passkey login | enrolled passkey | session cookie set with the strict attributes | — |
| Password + TOTP | right password, then right code | session | wrong code counts toward lockout |
| Lockout | 5 failures within 15 min | the 6th attempt is refused even with correct credentials, until 15 min pass | 429 `RateLimited` |
| Partner link | person A, recent auth | a link for B; after B registers, any further sign-up is refused | third registration → 409 `Conflict` ("Registration is closed"), no user created |
| Stale auth | issuing a link 6 min after login | — | 403 `ReauthRequired` |
| No session | `GET /api/system/jobs` | — | 401 `Unauthenticated` |
| Bad Origin | `POST /api/identity/setup-links` with `Origin: https://evil.example` | — | 403, nothing written |
| CSP | any page load | header present; the nonce in `index.html` matches the header; zero violations | — |

</intent-contract>

## Code Map

- **Server** (`apps/server/src`):
  - `server.ts`: `startServer` wires the db, unit of work, runner and demo mode. Build the auth instance here and pass it to `createApp`.
  - `http/app.ts`: `createApi` and `createApp`, the static PWA, the SPA fallback that serves `index.html` (the nonce goes here), and `onError` through `http/errors.ts`.
  - `config.ts`: the Zod env schema.
  - `admin/` and `jobs/` may import `@pangolin/app/system-viewer`; `http/` may not (Biome ban).
- **App** (`packages/app/src`):
  - `viewer.ts`: `personViewer(personId, authAt)` and `actorOf`.
  - `errors.ts`: `AppError` codes, including `ReauthRequired` and `RateLimited`.
  - `write.ts`, `context.ts`, `identity/create-person.ts` (extend it with `userId`), and `ports/unit-of-work.ts`.
- **Database** (`packages/db`):
  - `schema/`, `migrations/` (next is `0003`) and `unit-of-work.ts`.
  - `person.user_id` already exists, unique and nullable.
  - Regenerate with `db:generate`, hand-add `STRICT`, and keep the drift check clean.
  - better-auth may need its own schema objects: use its drizzle adapter, or a thin adapter over our connection, whichever keeps the tables in our migrations.
- **Web** (`apps/web`):
  - `src/{main.tsx,App.tsx,api.ts}` and `index.html`. Add the login and setup views, plus a small router state; TanStack Router can wait.
  - The client uses `better-auth/client` with the passkey and two-factor client plugins.
  - `vite.config.ts` has PWA config that must keep `index.html` out of the precache.
- **e2e:**
  - `e2e/`: Playwright config and specs. Local runs use `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` against `node apps/server/dist/main.js` with a fresh `PANGOLIN_DATA_DIR`.
  - The CI container job runs e2e against compose, so set `PANGOLIN_PUBLIC_URL` there.
- **Existing tests:** the health and jobs e2e tests must still pass. `/api/system/jobs` now needs a session, so the jobs e2e logs in first.
- **Schema version:** 3 → 4 in the tests, e2e and `README.md`.
- **Versions** (npm, 2026-09-27): better-auth 1.7.6 and @better-auth/passkey 1.7.6.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/{auth,setup-link,login-attempt}.ts`, `migrations/0003_*.sql` -- better-auth tables (`STRICT`), `setup_link`, `login_attempt` (`email`, `at`, `ok`) -- persistence
- [x] `packages/app/src/identity/{setup-links,sign-up,lockout,reauth}.ts` + tests -- issue, validate and consume setup links (hashing, 24 h, ≤ 2 people); `completeSignUp` linking user → person; lockout record and check; `requireRecentAuth` -- identity rules
- [x] `apps/server/src/auth/{auth,hooks,secret}.ts` + tests -- the better-auth instance (email/password, `twoFactor` TOTP, passkey with rpID and origin from `PANGOLIN_PUBLIC_URL`, rate limit, cookie attributes, idle timeout); `databaseHooks` gating sign-up and auditing; the auth secret file -- the composition root
- [x] `apps/server/src/http/{session,origin,csp}.ts` + tests; `http/app.ts` -- session → viewer middleware (401), Origin check (403), nonce CSP header and `index.html` injection; mount `/api/auth/*`, the setup-link endpoints and the login-attempt hooks -- HTTP
- [x] `apps/server/src/server.ts`, `config.ts` + tests -- first-boot setup link file, auth wiring, demo viewer -- boot
- [x] `apps/web/src/**`, `apps/web/index.html` -- setup, login (passkey, then password and TOTP) and signed-in home (health + jobs + "Invite partner"); the `__CSP_NONCE__` meta placeholder -- UI
- [x] `e2e/{auth.spec.ts,helpers/{webauthn,totp,csp}.ts}`, update `health.spec.ts` and the jobs spec -- the five Verify behaviours, plus a CSP-violation guard on every test -- end to end
- [x] `.github/workflows/ci.yml`, `compose.yaml`, `README.md` -- `PANGOLIN_PUBLIC_URL` for the e2e container; README sections for first login (`setup-link.txt`) and the auth config; schema version 4

**Acceptance Criteria:**
- Given a fresh server, when Playwright opens the link from `setup-link.txt`, registers, enrols a virtual passkey and TOTP, logs out and signs in with the passkey, then the signed-in home shows.
- Given that account, when Playwright signs in with password and a computed TOTP code, then it is signed in.
- Given two registered people, when a third sign-up is attempted with any token, then it is refused and no user is created.
- Given 5 wrong passwords, when the correct password is then tried, then it is refused with `RateLimited`.
- Given any page in these tests, when a CSP violation fires, then the test fails. None fire.

## Implementation Notes

- **Table names:** better-auth's six tables are `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor` and `auth_passkey`, because epic 2 owns the ledger's `account`. The drizzle definitions stay in `packages/db` and reach better-auth only through `createAuthAdapter(db)` (its drizzle adapter, transactions off). Timestamps are ISO text through a custom column type.
- **Sign-up path:** `POST /api/identity/sign-up` is the only sign-up route (`/api/auth/sign-up/*` answers 404). It runs `checkSignUp` first (our error shape), then better-auth's sign-up under a permit, one sign-up at a time. The `user.create` hooks re-check the gate and run `completeSignUp`; if that fails, the user is deleted again.
- **Error shapes:** routes under `/api/auth/*` keep better-auth's `{ code, message }` body. Our hooks put the `AppError` code in `code`, so the lockout answers 429 `{ code: "RateLimited" }`. The Origin check answers 403 `{ error: { code: "Forbidden" } }`. `Forbidden` is a transport-level code like `Internal`, not an `AppError` code, because the spine fixes the six use-case codes.
- **Rate limit:** better-auth's memory limiter is keyed on the socket address, which `http/app.ts` passes in `x-pangolin-client-ip`. Sign-in and two-factor are each capped at 10 per minute.
- **Enrolment gate (review fix):** a login without both a passkey and a confirmed TOTP reaches only `/api/identity/me` (`enrolment: "incomplete"`, `needs`) and the better-auth sign-in and enrolment routes. Everything else answers 401 with those details, and the web app resumes the missing steps.
- **Credential routes (review fix):** passkey add, delete and update, two-factor enable, disable and URI, and change password or email need a sign-in within 5 minutes (403 `ReauthRequired`). Recovery-code and OTP routes answer 404. Passkey add and delete, and TOTP enable and disable, are audited as the person.
- **Client address (review fix):** set `PANGOLIN_TRUSTED_PROXIES` to the proxy's IPs; the client is then the right-most untrusted `X-Forwarded-For` address. `PANGOLIN_AUTH_RATE_LIMIT` sets the sign-in and two-factor limit (default 10 a minute; CI's e2e server uses 100).
- **Setup-link file (review fix):** the file is deleted once anyone has a login. If the file is missing, its live link is revoked and a new one issued; the file is always created fresh with mode 0600. Each partner invite revokes earlier unused partner links.
- **Lockout:** only failures after the last success count. A correct password that is still waiting for its TOTP code counts as neither a success nor a failure, and a passkey sign-in counts as a success. better-auth's own two-factor lockout (10 failures) also stays on.

## Plan Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 41 findings — high 5, medium 18, low 16, false 2, maybe-false 0
- findings:
  - `[high]` `[patch]` Blind: setup that stops after the account step leaves a password-only login, a spent link and no way to finish — incomplete logins reach only `me` and enrolment routes (401 with `needs` elsewhere); the web app resumes enrolment after reload; server and e2e tests.
  - `[medium]` `[patch]` Blind: `setup-link.txt` is never removed, a lost file blocks new links for 24 h, and an existing loose-permission file is overwritten before chmod — removed once a login exists; reissued if missing; recreated with `wx` and 0600; tests.
  - `[high]` `[patch]` Blind: the backup-code endpoints bypass the per-email lockout (and recovery codes belong to 1.6) — backup-code (and unused OTP) endpoints answer 404; tested.
  - `[medium]` `[patch]` Blind: wrong TOTP codes counting toward lockout, and the pending-TOTP rule, are untested — tests: 5 wrong codes lock the email; a pending-TOTP password records nothing.
  - `[medium]` `[patch]` Blind: the idle timeout and sliding cookie refresh are untested — tests: an idle session answers 401 after `sessionIdleMs`; the refreshed cookie reaches 200 and 401 responses.
  - `[medium]` `[patch]` Blind: behind the reverse proxy every client shares one rate-limit bucket — `PANGOLIN_TRUSTED_PROXIES`: the right-most untrusted `X-Forwarded-For` address, only from listed proxies; tests; README.
  - `[medium]` `[patch]` Blind: the client-IP header anti-spoofing is untested — test: 11 sign-ins rotating a spoofed header still get 429.
  - `[medium]` `[patch]` Blind: the e2e run sits exactly at the 10/min sign-in limit — `PANGOLIN_AUTH_RATE_LIMIT` (default 10); CI e2e and the README recipe use 100; the suite also passed locally at the default.
  - `[low]` `[patch]` Blind: the no-permit refusal is 403 with a `Validation` code — now 400 `Validation` via `toApiError`.
  - `[medium]` `[patch]` Blind: a failed or skipped sign-up cleanup orphans a user and hides the original error — a missing adapter throws a clear error; a failed delete is logged and the original error rethrown; tested.
  - `[low]` `[reject]` Blind: an operator-provided auth secret file's permissions are not checked — the operator owns that file; `install.sh` (1.8) creates it with 0600.
  - `[low]` `[reject]` Blind: the TOTP generator is duplicated in the server tests and e2e — both are test helpers in packages that may not share code under the boundary map.
  - `[low]` `[patch]` Blind: each partner invite leaves another live token — issuing a partner link revokes earlier unused partner links (audited); tested.
  - `[low]` `[patch]` Blind: the README e2e recipe races the server — the recipe now waits for health.
  - `[false]` `[reject]` Blind: plan bookkeeping — the review was in progress; this entry fills it.
  - `[low]` `[reject]` Blind: the no-token-in-logs test checks only better-auth's log — verified by hand for the server and container logs (0 matches); left low.
  - `[medium]` `[patch]` Edge: a failed or skipped sign-up cleanup orphans a user and hides the original error — same patch as the Blind orphan row.
  - `[high]` `[patch]` Edge: the backup-code endpoints bypass the per-email lockout (and recovery codes belong to 1.6) — same patch as the Blind backup-code row.
  - `[high]` `[patch]` Edge: setup that stops after the account step leaves a password-only login, a spent link and no way to finish — same patch as the Blind enrolment row.
  - `[low]` `[reject]` Edge: retrying after a TOTP failure registers a duplicate passkey — the enrolment view now skips the passkey step when one exists.
  - `[medium]` `[patch]` Edge: `setup-link.txt` is never removed, a lost file blocks new links for 24 h, and an existing loose-permission file is overwritten before chmod — same patch as the Blind setup-link row.
  - `[medium]` `[patch]` Edge: an existing loose setup-link file is written before chmod — same patch as the Blind setup-link row (unlink then `wx` 0600).
  - `[low]` `[reject]` Edge: a racing auth-secret creation raises EEXIST — one server process creates it at boot.
  - `[low]` `[patch]` Edge: a `PANGOLIN_PUBLIC_URL` that is an IP or non-localhost http cannot work — rejected at config parse, including 127.0.0.1 since passkeys can't bind to an IP; tested.
  - `[medium]` `[patch]` Edge: behind the reverse proxy every client shares one rate-limit bucket — same patch as the Blind proxy row.
  - `[high]` `[patch]` Edge: credential-changing better-auth routes work with a session of any age — passkey, two-factor, password, email and delete routes need a sign-in within 5 min, else 403 `ReauthRequired`; tested.
  - `[low]` `[reject]` Edge: a sign-up that is ok but returns no personId gives a generic 500 — unreachable: `completeSignUp` returns the person inside the same flow.
  - `[medium]` `[patch]` Edge: the e2e run sits exactly at the 10/min sign-in limit — same patch as the Blind e2e row.
  - `[low]` `[reject]` Edge: a missing `public/index.html` fails boot — every build produces it; failing fast beats a silent 404.
  - `[medium]` `[patch]` Edge (claim): better-auth credential writes (passkey, TOTP) are not audited, contrary to AD-1 — `recordCredentialChange` audits passkey add and delete and TOTP enable and disable as the person; tested.
  - `[medium]` `[patch]` VG: wrong TOTP codes counting toward lockout, and the pending-TOTP rule, are untested — same patch as the Blind TOTP row.
  - `[low]` `[defer]` VG: a passkey sign-in resetting the failure count is untested — filed as defer by the lens; needs WebAuthn in a server test or an extra e2e step; recorded in `deferred`.
  - `[medium]` `[patch]` VG: the client-IP header anti-spoofing is untested — same patch as the Blind spoofing row.
  - `[medium]` `[patch]` VG: the idle timeout and sliding cookie refresh are untested — same patch as the Blind idle row.
  - `[medium]` `[patch]` VG other: the e2e run sits exactly at the 10/min sign-in limit — same patch as the Blind e2e row.
  - `[low]` `[reject]` Intent: the third registration and lockout are tested via the request API, not the UI — they are end-to-end against the real server (reading R2); UI messages are covered by the flows that render them.
  - `[low]` `[reject]` Intent: the rate-limit throttle and re-auth window are tested only in-process — in-process tests exercise the same code, and the proxy and spoof tests now cover keying.
  - `[medium]` `[patch]` Intent: wrong TOTP codes counting toward lockout, and the pending-TOTP rule, are untested — same patch as the Blind TOTP row.
  - `[low]` `[patch]` Intent: the partner context's CSP guard reads the console only — every context now uses the same violation collector.
  - `[false]` `[reject]` Intent: `__Host-` over https tested only in-process — e2e runs on http://localhost, where the prefix correctly doesn't apply.
  - `[low]` `[reject]` Intent: "nothing written" on a bad Origin is checked only in-process — row counts on the same app and database are the right place to check it.

## Design Notes

**Why the setup link goes to a file:** logs must never contain tokens, and there's no admin socket until story 1.9. `install.sh` (story 1.8) prints the file's contents. Story 1.9's CLI can reissue a link through the socket.

**Third registration:** the sign-up hook throws `AppError("Conflict", "Registration is closed")`, mapped to 409.

**Lockout before better-auth:** a `before` hook on the sign-in and two-factor verify endpoints checks `login_attempt` for the email or pending two-factor user. An `after` hook records success or failure, so correct credentials during a lockout never reach better-auth.

## Verification

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm check:strict` -- expected: all green
- `pnpm --filter @pangolin/db db:generate` -- expected: no changes after `0003`
- `pnpm build`, then start `node apps/server/dist/main.js` with a fresh `PANGOLIN_DATA_DIR`, then `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm e2e` -- expected: all specs pass with zero CSP violations

## Auto Run Result

Status: built

**Summary:** Ticket 1.5, passkey login:
- **Auth stack:** better-auth 1.7 with email and password, TOTP and passkeys on our SQLite. Its tables are `auth_`-prefixed in migration `0003`, so the schema version is now 4.
- **Setup links:** one-time links, with the first written to `setup-link.txt` (0600) on first boot and removed once a login exists. Partners are invited with a re-auth-gated link that revokes earlier ones. Registration closes at two people with 409.
- **Enrolment:** a login without both a passkey and TOTP reaches only `me` and the enrolment routes until both exist.
- **Lockout:** 5 failures in 15 minutes lock an email, covering both wrong passwords and wrong TOTP codes. Backup-code and OTP routes are disabled.
- **Rate limit:** keyed per client, using `X-Forwarded-For` only from trusted proxies.
- **Re-authentication:** a 5-minute window guards credential changes and partner invites. Credential changes are audited.
- **Sessions and cookies:** HttpOnly, Secure, SameSite=Strict cookies (`__Host-` over https) with a 30-minute idle timeout.
- **Web security:** an Origin check on writes and a per-request CSP nonce.
- **Demo mode:** requests act as the first seeded person.

**Files changed:**
- `packages/db`: auth, setup-link and login-attempt schemas, migration `0003`, and the better-auth drizzle adapter.
- `packages/app/src/identity/*`: setup links, sign-up, lockout, re-auth, `me`, enrolment and credential audit.
- `apps/server/src`:
  - `auth/*`: the better-auth instance, hooks and secret file.
  - `http/{session,origin,csp,app}.ts`.
  - `admin/setup-link.ts`, `server.ts` and `config.ts`.
- `apps/web/src`: `SetupView`, `EnrolView`, `LoginView` and the app shell.
- `e2e/auth.spec.ts`, `e2e/jobs.spec.ts` and the helpers (WebAuthn, TOTP, CSP).
- `compose.yaml`, `ci.yml` and `README.md`.

**Review:** 41 findings.
- 28 rows patched, covering 18 root causes.
- 1 deferred: a passkey-reset lockout test.
- 12 rejected, each with its reason in the Review Triage Log above.
- Patched entries by verdict:
  - 3 high: incomplete enrolment, backup-code bypass, and stale-session credential changes.
  - Several medium: proxy keying, setup-link file handling, credential audit, lockout, idle and spoofing tests, e2e rate headroom.
  - Several low.

**Follow-up review:** recommended (`true`, since high entries were patched). The named unverified risks:
- **Incomplete-enrolment takeover:** an account that never finished enrolment can have its enrolment completed by anyone holding its password.
- **TOTP replay:** better-auth accepts the same TOTP code again within its window.
- **Real proxy untested:** trusted-proxy keying has never run behind a real Nginx Proxy Manager.

**Verification:**
- `pnpm install --frozen-lockfile`, lint, typecheck and `pnpm test` all pass: 52 files, 568 passed, 1 skipped as root.
- `check:strict` passes, and `db:generate` reports no changes.
- `pnpm build` passes.
- Playwright against the Node build at the production rate limit gives 10 passed with no CSP violations.
- `docker compose` build and up (rate limit 100), then Playwright with the setup link read through `docker compose exec`: 10 passed.
- The container and server logs have 0 token or secret matches.
- The CI demo-boot step passes, and shellcheck reports nothing across CI's `run` blocks.

**Residual risks:**
- The three follow-up risks above.
- better-auth's own two-factor lockout (10) still runs alongside ours.
- Two error bodies don't use our shape: better-auth routes return `{ code, message }`, and the Origin check returns a `Forbidden` code that isn't among the spine's six.
