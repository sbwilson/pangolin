---
title: 'Settings: Sign-in & security, Partner, and Household cards'
type: 'feature'
ticket: 4
created: '2026-10-18'
status: done
baseline_revision: '43117262b7c3bdc0fb8a6e582865412b099e0e72'
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
  - '_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Settings currently lacks dedicated cards for Sign-in & security (passkey management, password/authenticator status, recovery codes regeneration), Partner management (invite partner setup link, partner recovery reset link), and the placeholder Household section, leaving these capabilities stranded on the deprecated HomePage or missing from the settings rail.

**Approach:** Build dedicated, CSP-compliant settings components for `SignInSecurity` (`#security`), `PartnerSettings` (`#partner`), and `HouseholdSettings` (`#household`), update `SettingsNav` with all 6 section anchors, integrate them into `/settings`, and update e2e specs (`e2e/recovery.spec.ts`, `e2e/auth.spec.ts`, and `e2e/settings.spec.ts`) to verify full functionality at their canonical `/settings` paths.

## Boundaries & Constraints

**Always:**
- Keep all styling CSP-clean: use Tailwind utility classes and CSS variables only; no inline style attributes or unsafe scripts.
- Navigation rail and chips must include all 6 sections in order: `appearance` ("Appearance"), `security` ("Sign-in & security"), `devices` ("Signed-in devices"), `partner` ("Partner"), `household` ("Household"), and `status` ("System status").
- Preserve exact copy and accessible attributes needed for e2e continuity:
  - Sign-in & security: "Add a passkey", "{n} unused recovery codes left.", "Regenerate recovery codes", "Recovery codes" list, "I have saved these codes", and "Continue".
  - Partner: "Invite partner", "Partner setup link", "Reset partner's access", "Help {partner.displayName} back in", and "Partner recovery link".
- Passkey deletion and addition must use `authClient` (`authClient.passkey.addPasskey()`, `authClient.$fetch("/passkey/delete-passkey", { method: "POST", body: { id } })`, and query `/passkey/list-user-passkeys`).
- Deleting a passkey or regenerating recovery codes must show clear warnings that re-authentication may be required.
- The Household section is an empty placeholder card explaining that pay cycles, pay anchor, and split attribution will be configured here.

**Never:**
- Do not build the full modal Re-auth dialog or account lifecycle settings (archived accounts, closing balance warnings, leave household) — reserved for story 13.5.
- Do not delete `HomePage.tsx` completely yet — clean up extracted cards and forward until story 13.7 refactor sweep.
- Do not alter database schemas or server API contracts.
- Do not introduce breaking changes to `/api/auth/*` or `/api/identity/*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Section navigation | User clicks `#security`, `#partner`, or `#household` in rail or chips | Browser scrolls to target card; hash updates; active marker highlights target | Smooth scroll & hash synchronization |
| Passkey listing | Authenticated person with 1+ passkeys | Lists enrolled passkeys with name/authenticator metadata and "Remove" button | Shows fallback if list is empty or pending |
| Add passkey | User clicks "Add a passkey" | Prompts WebAuthn ceremony via `authClient.passkey.addPasskey()`; refreshes passkey list | Displays inline error if ceremony is canceled or fails |
| Remove passkey | User clicks "Remove" on a passkey | Calls passkey deletion endpoint; removes passkey from list | Displays error notice if deletion fails or re-auth needed |
| Regenerate recovery codes | User clicks "Regenerate recovery codes" | Calls `regenerateRecoveryCodes()`; displays 10 new codes in `RecoveryCodeList` with confirmation checkbox | If `ReauthRequired`, prompts re-authentication |
| Invite partner (single user) | `me.canInvite === true`, clicks "Invite partner" | Calls `invitePartner()`; displays 24h one-time partner setup link | Inline error alert on failure |
| Reset partner (both users exist) | `me.partner !== null`, clicks "Reset partner's access" | Calls `resetPartner(personId)`; displays 24h one-time partner recovery link | Inline error alert on failure |
| Partner card (both exist, no invite) | `me.partner !== null` | Displays partner info row (name, status); invite button hidden | N/A |
| Household placeholder | Any authenticated user visits `/settings#household` | Renders placeholder card explaining upcoming pay cycles and attribution controls | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/SettingsNav.tsx` -- Update `SETTINGS_SECTIONS` to include `appearance`, `security`, `devices`, `partner`, `household`, and `status`.
- `apps/web/src/components/SignInSecurity.tsx` -- New component implementing `#security`: passkey listing, add passkey, remove passkey, password & authenticator status row, and recovery codes regeneration view.
- `apps/web/src/components/PartnerSettings.tsx` -- New component implementing `#partner`: partner information row, invite partner one-time link generation, and partner reset one-time link generation.
- `apps/web/src/components/HouseholdSettings.tsx` -- New component implementing `#household`: empty placeholder section per UX specifications.
- `apps/web/src/routes/settings.tsx` -- Integrate `SignInSecurity`, `PartnerSettings`, and `HouseholdSettings` cards into the Settings page layout.
- `apps/web/src/pages/HomePage.tsx` -- Clean up components moved to Settings, keeping minimal redirect or notice handling until story 13.7.
- `apps/web/src/routes/settings.test.tsx` -- Unit and component tests for `#security`, `#partner`, and `#household` sections, passkey interactions, and link generations.
- `e2e/settings.spec.ts` -- E2E test verifying all 6 settings sections and navigation rail items.
- `e2e/recovery.spec.ts` -- Update test navigation to `/settings#security` and `/settings#partner` for recovery codes and partner reset verification.
- `e2e/auth.spec.ts` -- Update test navigation to `/settings#partner` for partner invite verification.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/SettingsNav.tsx` -- Expand settings navigation sections -- Add `security`, `partner`, and `household` section anchors and labels to `SETTINGS_SECTIONS`.
- [x] `apps/web/src/components/SignInSecurity.tsx` -- Create Sign-in & security component -- Implements passkeys management, password/authenticator status, and recovery codes regeneration matching `key-settings.html`.
- [x] `apps/web/src/components/PartnerSettings.tsx` -- Create Partner component -- Implements partner summary row, partner invite generation, and partner reset link generation.
- [x] `apps/web/src/components/HouseholdSettings.tsx` -- Create Household placeholder component -- Implements empty placeholder card for upcoming household features.
- [x] `apps/web/src/routes/settings.tsx` -- Integrate new cards into SettingsPage -- Places sections in proper visual order matching `DESIGN.md`.
- [x] `apps/web/src/pages/HomePage.tsx` -- Clean up HomePage -- Delegates partner and recovery views to Settings components.
- [x] `apps/web/src/routes/settings.test.tsx` -- Add unit tests for new settings cards -- Covers passkey listing/creation, recovery codes regeneration, and partner invite/reset flows.
- [x] `e2e/settings.spec.ts` -- Expand settings e2e tests -- Verifies all 6 section anchors and cards on desktop and mobile viewports.
- [x] `e2e/recovery.spec.ts` & `e2e/auth.spec.ts` -- Update e2e tests for new routes -- Points partner invite, partner reset, and recovery codes tests to `/settings#security` and `/settings#partner`.

**Acceptance Criteria:**
- Given a signed-in person on desktop visiting `/settings`, then the navigation rail displays Appearance, Sign-in & security, Signed-in devices, Partner, Household, and System status.
- Given a signed-in person visiting `/settings#security`, then their enrolled passkeys are listed with an "Add a passkey" option and removal actions, along with their recovery codes status and regeneration flow.
- Given a household with only one user, visiting `/settings#partner` shows the "Invite partner" action and generates a 24-hour setup link.
- Given a household with two users, visiting `/settings#partner` displays the partner's status and provides the "Reset partner's access" link generation action.
- Given a signed-in person visiting `/settings#household`, then an empty placeholder section is displayed explaining future pay cycles and attribution settings.
- Given the Playwright test suite, then `e2e/settings.spec.ts`, `e2e/recovery.spec.ts`, and `e2e/auth.spec.ts` pass green against the `/settings` routes.

## Implementation Notes

- Expanded `SettingsNav` to all 6 sections: `appearance`, `security`, `devices`, `partner`, `household`, and `status`.
- Built `SignInSecurity` with passkey management (`/passkey/list-user-passkeys`, `addPasskey`, `delete-passkey`), password status, and recovery codes regeneration.
- Built `PartnerSettings` supporting single-user invite link generation and dual-user partner recovery reset link generation.
- Built `HouseholdSettings` empty placeholder card with upcoming configuration copy.
- Mounted `Notices` in `RootLayout` so notices are accessible across all authenticated shell views; cleaned up `HomePage`.
- Updated e2e specs (`e2e/settings.spec.ts`, `e2e/recovery.spec.ts`, and `e2e/auth.spec.ts`) to verify `/settings#security` and `/settings#partner`.
- Addressed all review findings: removed duplicate `<Notices />` from `HomePage`, added error banner for `passkeysQuery.isError`, added ReauthRequired support on passkey operations, disabled buttons during in-flight passkey actions, added specific accessible labels, and expanded unit tests in `settings.test.tsx` (40 passing tests).

## Plan Change Log

## Review Triage Log

- Review pass 1 (thorough): high: 0, medium: 1, low: 6, false: 7, maybe-false: 0
  - HomePage.tsx:18 -- medium -- patch -- duplicate `<Notices />` rendering on `/`; patched by removing `<Notices />` from `HomePage.tsx`.
  - SignInSecurity.tsx:540 -- low -- patch -- `passkeysQuery.isError` was unhandled leaving section blank; patched with error alert banner.
  - SignInSecurity.tsx:580 -- low -- patch -- concurrent passkey additions/deletions were not disabled and buttons lacked specific accessible names; patched by disabling all buttons while any action is in flight and adding specific `aria-label`.
  - SignInSecurity.tsx:440 -- low -- patch -- passkey operations lacked `ReauthRequired` handling and session refresh; patched with ReauthRequired alert offering "Sign in again" and calling `refresh()`.
  - settings.test.tsx:580 -- low -- patch -- passkey addition/deletion tests only asserted mock invocation without cache invalidation; patched by adding tests asserting query cache invalidation, refresh, and button disable states.
  - Notices.tsx:55 -- low -- patch -- untested recovery link revocation action on notices; patched by adding unit tests for `revokeMyRecoveryLinks` and `dismissNotice`.
  - settings.test.tsx:540 -- low -- patch -- missing test for passkeysQuery.isError; patched by adding test for error banner rendering.
  - HomePage.tsx:28 -- low -- false -- mounting modular `<SignInSecurity />` and `<PartnerSettings />` in `HomePage.tsx` during transition is not a defect; rejected: retains transitional compatibility until 13.7.
  - SignInSecurity.tsx:455 -- low -- false -- missing confirmation dialog before passkey deletion; rejected: re-auth modal confirmation is explicitly deferred to story 13.5.
  - PartnerSettings.tsx:180 -- low -- false -- missing confirmation dialog before partner reset; rejected: re-auth modal confirmation is explicitly deferred to story 13.5.
  - PartnerSettings.tsx:270 -- low -- false -- missing clipboard copy button on partner link; rejected: existing design and test contracts use plain read-only input.
  - Notices.tsx:48 -- low -- false -- raw ISO timestamp rendered in notices; rejected: preserves exact pre-existing shipped copy and test assertions.
  - SignInSecurity.tsx:497 -- low -- false -- unaddressed state when recovery codes never issued; rejected: RootLayout gate prevents unissued users from accessing settings.
  - RecoveryViews.tsx:89 -- low -- false -- `RegenerateRecoveryCodes` is dead code; rejected: component retirement reserved for story 13.7 refactor sweep.

## Design Notes

Per `DESIGN.md` § Components › Settings & auth and `key-settings.html`:
1. Sign-in & security (`#security`):
   - Card title: "Sign-in & security", icon: Lock, description: "Passkeys first. Your password and authenticator code are the fallback."
   - Subheadings: "Passkeys", "Password and authenticator", "Recovery codes".
   - Passkey row layout: Key icon, passkey name, metadata, and "Remove" action button.
   - Password status row: Checkmark icon, "Set up", "Password changed ... · authenticator app linked".
   - Recovery codes row: Info icon, "{n} of 10 codes left", and "Make new codes" / "Regenerate recovery codes" button.
2. Partner card (`#partner`):
   - Card title: "Partner", icon: Lock, description: "You and <partner> each have your own sign-in. Invites are closed now you're both in." (or invite instructions if single user).
   - Single user: "Invite your partner", "Send this one-time link to your partner. It works once, for 24 hours.", "Invite partner" button and input field.
   - Dual user: Partner person dot + name, "Joined ... · signs in with a passkey", and "Help <partner> get back in" with "Reset partner's access" button.
3. Household card (`#household`):
   - Card title: "Household", description: "Shared finances and household configuration."
   - Empty state copy: "Pay cycles, the household pay anchor, and split attribution will be configured here."

## Verification

**Commands:**
- `pnpm --filter @pangolin/web typecheck` -- expected: TypeScript compiles with 0 errors.
- `pnpm vitest run apps/web/src/routes/settings.test.tsx` -- expected: All component unit tests pass.
- `pnpm lint` -- expected: Biome check and architecture boundaries pass with 0 warnings/errors.
- `pnpm --filter @pangolin/e2e test e2e/settings.spec.ts` -- expected: Settings e2e tests pass.
- `pnpm --filter @pangolin/e2e test e2e/recovery.spec.ts` -- expected: Recovery e2e tests pass at new settings paths.
- `pnpm --filter @pangolin/e2e test e2e/auth.spec.ts` -- expected: Auth e2e tests pass at new settings paths.
