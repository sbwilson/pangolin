---
title: 'Re-auth dialog and account lifecycle settings'
type: 'feature'
ticket: 5
created: '2026-10-18'
status: done
baseline_revision: '4307ba771b4af33373739af9c7f11123d1dba3e6'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran:
  - 'blind-hunter'
  - 'edge-case-hunter'
  - 'verification-gap'
  - 'intent-alignment'
review_loop_iteration: 0
context:
  - '_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md'
  - '_bmad-output/v6-archive/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sensitive operations currently lack a standardized modal re-authentication ceremony — CSV export falls back to a disruptive inline sign-out alert, and account lifecycle actions (viewing archived closed accounts, reopening accounts, inspecting closing-balance warnings, and leaving the household) lack dedicated UI in Settings.

**Approach:** Build a reusable, CSP-clean `ReauthDialog` that retries guarded actions upon successful re-authentication (retiring the inline banner on CSV export), add an `/settings#accounts` section showing archived accounts with reopen and closing-balance warnings, and provide a guarded leave-household flow requiring re-auth and confirmation.

## Boundaries & Constraints

**Always:**
- Keep all dialogs and cards CSP-compliant: use Tailwind utility classes and CSS variables only; no external modal libraries, inline style attributes, or unsafe scripts.
- Re-auth dialog must match UX specifications (`DESIGN.md` § Components › Settings & auth and `key-sign-in.html`): lock icon, plain heading ("For your security, sign in again"), descriptive action text, primary "Sign in with passkey" button, "Use password instead" link (with email/password/TOTP fallback), and cancel button.
- Retrying guarded action: when re-authentication succeeds in `ReauthDialog`, the dialog must automatically retry and complete the original guarded action without requiring the user to click the trigger button again.
- In `TransactionList.tsx`, retire the temporary inline `ReauthRequired` alert and replace it with `ReauthDialog` for CSV exports.
- Navigation rail and chips in `SettingsNav.tsx` must include all 7 sections in order: `appearance` ("Appearance"), `security` ("Sign-in & security"), `devices` ("Signed-in devices"), `partner` ("Partner"), `household` ("Household"), `accounts` ("Accounts"), and `status` ("System status").
- Closed accounts in `/settings#accounts`: query accounts with `includeClosed: true`, filter by closed status (`closedOn !== null && closedOn <= today`), display `closedOn` date, show warning badge for `account.warning.kind === 'closing-balance'`, and provide a "Reopen account" button that calls `reopenAccount(id)` (`PATCH /api/accounts/:id` with `{ closedOn: null }`).
- Leave household flow in `/settings#accounts`: requires explicit confirmation naming that the leaver's private data is deleted, shared accounts remain with the partner, and active sessions and credentials will be revoked; must be protected behind re-authentication (`leaveHousehold` calls `POST /api/accounts/leave-household`), navigating to `/sign-in` on success.

**Never:**
- Never delete closed accounts from the database — accounts are archived via `closedOn`, never deleted.
- Never allow leaving the household without both explicit confirmation and recent authentication (within the 5-minute window enforced by the server).
- Do not alter database schemas or server API contracts — the endpoints (`/api/accounts`, `/api/accounts/:id`, `/api/accounts/leave-household`, `/api/ledger/export`) already exist in `apps/server`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CSV export with stale session | User clicks "Export CSV" with session >5 min old | `exportTransactions` returns 403 `ReauthRequired`; `ReauthDialog` opens over TransactionList | User can cancel or re-authenticate |
| CSV export re-auth passkey success | User completes passkey ceremony in `ReauthDialog` | Re-auth succeeds; `ReauthDialog` automatically retries `handleExport()`; CSV downloads; dialog closes | Error notice if passkey fails |
| CSV export re-auth password fallback | User clicks "Use password instead" in `ReauthDialog` | Displays email, password (and TOTP if enabled) fields; on verify, retries export and closes | Inline auth error message on wrong password/code |
| Settings navigation | User clicks `#accounts` in rail or chips | URL updates to `/settings#accounts`; scrolls to Accounts card; nav highlights Accounts | Hash synchronization |
| List closed accounts | Accounts returned with `closedOn <= today` | Displays closed accounts table/list with name, type, closed date, and "Reopen account" action | Empty state "No closed accounts" if none exist |
| Closing-balance warning | Closed cash account has `warning: { kind: 'closing-balance', balanceCents: 1500 }` | Displays warning callout with formatted balance: "Closed with a remaining balance of $15.00" | Warning displayed alongside account |
| Reopen account | User clicks "Reopen account" | Calls `PATCH /api/accounts/:id` with `{ closedOn: null }`; invalidates account query cache; account returns to open state | Displays error notice on refusal |
| Leave household initiated | User clicks "Leave household" | Opens confirmation modal detailing private data deletion, shared account handover, and credential revocation | User can cancel |
| Leave household confirmation | User confirms and submits | Calls `leaveHousehold({ confirm: true })`; if `ReauthRequired`, prompts `ReauthDialog`, then retries; on success, session cookies are cleared and user is redirected to `/sign-in` | Displays error notice on failure |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/ReauthDialog.tsx` -- New reusable modal component: renders lock icon, heading, action description, passkey sign-in, password/TOTP fallback, and automatic retry of `onSuccess` callback.
- `apps/web/src/api.ts` -- Update `listAccounts` to accept `options?: { includeClosed?: boolean }`; add `reopenAccount(id: string)` and `leaveHousehold(confirm?: boolean)`.
- `apps/web/src/components/AccountSettings.tsx` -- New component implementing `#accounts`: displays archived closed accounts, closing-balance warnings, "Reopen account" button, and leave household confirmation flow.
- `apps/web/src/components/SettingsNav.tsx` -- Update `SETTINGS_SECTIONS` to include `accounts` between `household` and `status`.
- `apps/web/src/routes/settings.tsx` -- Mount `<section id="accounts"><AccountSettings /></section>` in SettingsPage.
- `apps/web/src/pages/TransactionList.tsx` -- Retire inline `reauthRequired` alert box; wire up `ReauthDialog` on `ReauthRequired` during CSV export with automatic retry.
- `apps/web/src/pages/TransactionList.test.tsx` -- Update unit tests to verify `ReauthDialog` replaces the inline alert and retries export.
- `apps/web/src/routes/settings.test.tsx` -- Add unit tests for `AccountSettings` (closed accounts, warnings, reopen, leave household) and updated `SettingsNav`.
- `e2e/settings.spec.ts` -- Update e2e tests to verify 7 settings sections, `#accounts` rendering, closed accounts, and leave household dialog.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/ReauthDialog.tsx` -- Create Re-auth dialog component -- Implements accessible modal dialog with passkey button, password/TOTP fallback, and `onSuccess` automatic retry.
- [x] `apps/web/src/api.ts` -- Add account lifecycle API helpers -- Enhance `listAccounts` with `includeClosed` parameter, add `reopenAccount`, and add `leaveHousehold`.
- [x] `apps/web/src/components/AccountSettings.tsx` -- Create Account lifecycle settings component -- Renders archived closed accounts, closing balance warnings, reopen action, and leave household confirmation flow.
- [x] `apps/web/src/components/SettingsNav.tsx` -- Add accounts section to SettingsNav -- Adds `{ id: 'accounts', label: 'Accounts' }` to `SETTINGS_SECTIONS`.
- [x] `apps/web/src/routes/settings.tsx` -- Integrate AccountSettings into /settings -- Places `<section id="accounts">` in proper rail sequence.
- [x] `apps/web/src/pages/TransactionList.tsx` -- Wire ReauthDialog to CSV export -- Replaces inline ReauthRequired alert with ReauthDialog and automatic export retry.
- [x] `apps/web/src/pages/TransactionList.test.tsx` -- Update TransactionList tests -- Verifies CSV export triggers ReauthDialog on 403 ReauthRequired and retries on success.
- [x] `apps/web/src/routes/settings.test.tsx` -- Add unit tests for AccountSettings and SettingsNav -- Covers closed accounts listing, closing balance warning display, reopening, and leave household flow.
- [x] `e2e/settings.spec.ts` -- Expand settings e2e tests -- Verifies 7 section anchors and `#accounts` card on desktop and mobile viewports.

**Acceptance Criteria:**
- Given a signed-in person exporting CSV transactions when their session is older than 5 minutes, then the Re-auth dialog opens over the transaction list, and completing passkey or password re-authentication automatically downloads the CSV.
- Given the TransactionList component, then the deprecated inline "Sign in again to export transactions" alert is completely removed.
- Given a signed-in person visiting `/settings`, then the navigation rail and mobile chips display all 7 sections: Appearance, Sign-in & security, Signed-in devices, Partner, Household, Accounts, and System status.
- Given a signed-in person visiting `/settings#accounts`, then closed accounts are listed showing their closed date, any closing-balance warning with the exact amount, and a "Reopen account" button.
- Given a user clicking "Reopen account", then `PATCH /api/accounts/:id` is called with `{ closedOn: null }`, and the account is reopened.
- Given a user visiting `/settings#accounts`, clicking "Leave household" displays a confirmation modal warning of private data deletion and shared account retention, guarded by re-authentication before calling `POST /api/accounts/leave-household`.

## Implementation Notes

- Implemented reusable modal `ReauthDialog` with passkey authentication and password/TOTP fallback, matching `DESIGN.md` § Components › Settings & auth.
- Retired inline `reauthRequired` alert from `TransactionList.tsx`, replacing it with `ReauthDialog` on 403 `ReauthRequired` and automatically downloading the CSV upon re-auth.
- Added `reopenAccount` and `leaveHousehold` to `apps/web/src/api.ts` and enhanced `listAccounts` to accept `{ includeClosed?: boolean }`.
- Created `AccountSettings.tsx` mounted at `/settings#accounts`: displays archived closed accounts, closing-balance warnings, "Reopen account" trigger, and leave household flow with confirmation and re-auth guard.
- Added `accounts` to `SETTINGS_SECTIONS` in `SettingsNav.tsx` (order: `appearance`, `security`, `devices`, `partner`, `household`, `accounts`, `status`).
- Updated e2e specs in `e2e/settings.spec.ts` to verify all 7 navigation rail sections and `#accounts` card.
- Addressed all review patch items: prevented modal stacking collision in leave household flow, kept `ReauthDialog` mounted with error reporting during retried export, handled `accountsQuery.isError`, disabled all reopen buttons during in-flight actions, added account type labels and currency-aware balance formatting, guarded sole member household exit, added Escape dismissal and `aria-describedby` to confirmation modal, invalidated `["notices"]` on reopen, added HTTP wire tests in `api.test.ts`, and added dedicated `ReauthDialog.test.tsx` (117 unit tests passing).

## Plan Change Log

## Review Triage Log

- Review pass 1 (thorough): high: 0, medium: 2, low: 8, false: 1, maybe-false: 0
  - TransactionList.tsx:533 -- medium -- patch -- `handleExport` called `setReauthRequired(false)` early unmounting `ReauthDialog` during retry; patched by removing early dismiss and allowing errors to propagate to `ReauthDialog`.
  - AccountSettings.tsx:160 -- medium -- patch -- modal collision when leave household triggers re-auth while confirm modal is open; patched by hiding confirm modal before displaying `ReauthDialog`.
  - api.ts:544 -- low -- patch -- `reopenAccount` and `leaveHousehold` HTTP wire contracts unverified; patched by adding unit tests in `apps/web/src/api.test.ts`.
  - AccountSettings.tsx:124 -- low -- patch -- open accounts exclusion unverified in settings tests; patched by adding test asserting active accounts are filtered out.
  - AccountSettings.tsx:223 -- low -- patch -- `accountsQuery.isError` unhandled; patched by rendering error alert.
  - AccountSettings.tsx:275 -- low -- patch -- reopen button disabled only for matching id; patched to `disabled={reopeningId !== null}`.
  - AccountSettings.tsx:242 -- low -- patch -- missing account type label in closed accounts list; patched with `TYPE_LABEL[account.type] ?? account.type`.
  - AccountSettings.tsx:95 -- low -- patch -- hardcoded AUD currency formatting; patched using `account.currency`.
  - AccountSettings.tsx:290 -- low -- patch -- missing sole member check for leave household; patched with `me?.partner === null` guard and disabled state.
  - ReauthDialog.tsx:1 -- low -- patch -- missing dedicated unit tests; patched by adding `ReauthDialog.test.tsx`.
  - AccountSettings.tsx:114 -- low -- false -- institutions queryKey mismatch claim; rejected: `AccountsPage.tsx` also uses `["institutions"]`.

## Design Notes

Per `DESIGN.md` § Components › Settings & auth and `key-sign-in.html`:
1. Re-auth dialog:
   - Header: Lock icon, "For your security, sign in again".
   - Copy: "Confirm it's you to {action}. Once you're in, the change goes through."
   - Primary action: "Sign in with passkey".
   - Alternate: "Use password instead" link toggling email/password/TOTP.
   - Cancel: closes dialog and leaves state untouched.
2. Account settings card (`#accounts`):
   - Card title: "Accounts", icon: Landmark / Wallet / CreditCard, description: "Archived closed accounts, closing balance warnings, and household membership."
   - Subhead "Archived closed accounts": list rows with account name, institution, `Closed on {date}`, closing-balance warning callout in `{colors.warning}` when present, and "Reopen account" secondary button.
   - Subhead "Household membership": explains consequences of leaving, with destructive "Leave household" button launching confirmation dialog with re-auth guard.

## Verification

**Commands:**
- `pnpm --filter @pangolin/web typecheck` -- expected: TypeScript compiles with 0 errors.
- `pnpm vitest run apps/web/src/routes/settings.test.tsx` -- expected: Component unit tests pass.
- `pnpm vitest run apps/web/src/pages/TransactionList.test.tsx` -- expected: Transaction list export tests pass.
- `pnpm lint` -- expected: Biome check and architecture boundaries pass with 0 warnings/errors.
- `pnpm --filter @pangolin/e2e test e2e/settings.spec.ts` -- expected: Settings e2e tests pass for all 7 sections.
