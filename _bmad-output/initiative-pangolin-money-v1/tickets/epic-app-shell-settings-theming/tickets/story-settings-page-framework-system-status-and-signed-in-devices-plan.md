---
title: 'Settings page framework: System status and Signed-in devices'
type: 'feature'
ticket: 3
created: '2026-10-18'
status: done
baseline_revision: 'b33136af620fb50dfe345fd8ac212255004e15f6'
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

**Problem:** The `/settings` route currently only hosts a basic appearance card without the responsive section rail navigation specified in UX designs, and lacks dedicated cards for System status (health, backup, restore drill, dead jobs, bundle warning) and Signed-in devices (listing active sessions and revoking access).

**Approach:** Build the `/settings` framework with a desktop sticky section rail (`snav`) and mobile scrollable chips reaching `#appearance`, `#devices`, and `#status`; move the System status cards from `HomePage` into a cohesive `SystemStatus` component; and create a `SignedInDevices` component querying `authClient.listSessions()` with "This device" identification and per-session revocation.

## Boundaries & Constraints

**Always:**
- Keep all styling CSP-clean: use Tailwind utility classes and CSS variables only; no inline style attributes or unapproved scripts.
- Navigation rail must follow `DESIGN.md` § Settings layout (`grid-cols-[188px_minmax(0,640px)]` on desktop, chips on mobile) with `#appearance`, `#devices`, and `#status` section anchors and active state indication.
- Retain exact status copy and alerts for e2e continuity: "Healthy", "Schema version {v}", "No jobs need attention", "No backup yet", "Last backup ...", and recovery bundle warning.
- Identify "This device" accurately using current session credentials from `authClient.getSession()`.
- Revoking a remote session must call `authClient.revokeSession({ token })` and refresh the device list.
- Signing out "This device" must invoke `signOut()` from session context, clearing cookies and landing on `/sign-in`.
- Unit/component tests and e2e tests must verify live rendering of `/settings#status` and `/settings#devices`, including session revocation.

**Never:**
- Do not build the full Security/Partner cards (reserved for story 13.4) or Re-auth dialog/Account lifecycle cards (reserved for story 13.5).
- Do not provide an in-app restore button (restores run strictly from the server CLI per AD-16 / `EXPERIENCE.md`).
- Do not alter database schemas or server API contracts.
- Do not break existing e2e assertions expecting health or backup status text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Settings desktop navigation | Viewport >= 768px (`md`), signed-in user opens `/settings` | Sticky section rail visible on left with Appearance, Signed-in devices, System status; content column max 640px | Handled via CSS responsive grid |
| Settings mobile navigation | Viewport < 768px (`md`), signed-in user opens `/settings` | Horizontal scrollable chip bar visible above content; desktop rail hidden | Handled via CSS responsive layout |
| Section anchor jump | User clicks or navigates to `/settings#devices` or `#status` | Page scrolls to selected section card with appropriate scroll-margin; corresponding rail item/chip shows active state | Hash update and scroll-margin-top |
| List active devices | Authenticated person with 2 active sessions | Displays both sessions with device/browser breakdown, IP/location, active timestamp, and "This device" badge on current session | If list fails, displays error message in banner |
| Revoke remote session | User clicks "Sign out" on another session | Calls `authClient.revokeSession({ token })`, removes revoked session from list upon refresh | Displays error notice if revocation fails |
| Revoke current session | User clicks "Sign out" on "This device" | Invokes session `signOut()`, terminates session cookies, and redirects to `/sign-in` | Handled via session signOut handler |
| System status health | API returns `{ status: "ok", schemaVersion: 14 }` | Shows check icon, "Health", "Healthy", and schema version number | Shows "Unhealthy" or error on failure |
| System status backup | API returns backup with last snapshot, stale, check, drill | Displays snapshot id, backup timestamp, verification statuses, and alerts if stale or failed | Displays "No backup yet" / "Backups not configured" as appropriate |
| Dead jobs display | API returns dead jobs list | Shows count and failed jobs by kind and time only; shows "No jobs need attention" when empty | Displays unavailable error if API fails |
| Recovery bundle warning | Recovery bundle unconfirmed | Shows warning role="alert" with bundle ID and server CLI confirmation command | Hidden when bundle is confirmed |

</frozen-after-approval>

## Code Map

- `apps/web/src/routes/settings.tsx` -- Settings route component: structure with desktop sticky rail (`snav`), mobile chips, and card sections for `#appearance`, `#devices`, and `#status`.
- `apps/web/src/components/SettingsNav.tsx` -- Navigation rail and chip components handling hash sync, scroll observation, and accessible active markers (`aria-current="location"`).
- `apps/web/src/components/SystemStatus.tsx` -- Unified System status component extracted from `HomePage.tsx`: includes `HealthStatus`, backup status & verifications, dead jobs, recovery bundle warning, and CLI restore note.
- `apps/web/src/components/SignedInDevices.tsx` -- Signed-in devices card component: fetches sessions via `authClient.listSessions()`, parses user agent for device/browser labels, highlights "This device", and triggers per-session revocation or current session sign out.
- `apps/web/src/pages/HomePage.tsx` -- Clean up moved status components while keeping remaining temporary cards until story 13.7 refactor sweep.
- `apps/web/src/routes/settings.test.tsx` -- Component unit tests verifying settings navigation, `#status` rendering, and `#devices` session listing and revocation interactions.
- `e2e/settings.spec.ts` -- End-to-end test suite: verifies `/settings#status` and `/settings#devices` live server data, anchor navigation, and session revocation.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/SystemStatus.tsx` -- Extract and assemble System status component -- Consolidates HealthStatus, LastBackup, DeadJobs, RecoveryBundle, and CLI restore note into a structured card per `key-settings.html`.
- [x] `apps/web/src/components/SignedInDevices.tsx` -- Create Signed-in devices component -- Queries sessions and current session, renders device/browser metadata, "This device" indicator, and sign-out buttons with revocation logic.
- [x] `apps/web/src/components/SettingsNav.tsx` -- Create SettingsNav component -- Implements desktop sticky rail and mobile chips with anchor links and active indicator.
- [x] `apps/web/src/routes/settings.tsx` -- Update SettingsPage framework -- Integrates SettingsNav, ThemeSwitcher (`#appearance`), SignedInDevices (`#devices`), and SystemStatus (`#status`).
- [x] `apps/web/src/pages/HomePage.tsx` -- Clean up HomePage -- Removes extracted status card components moved to Settings.
- [x] `apps/web/src/routes/settings.test.tsx` -- Add component tests for settings framework, status, and devices -- Tests desktop/mobile navigation, live status rendering, and session revocation action.
- [x] `e2e/settings.spec.ts` -- Create e2e test suite for `/settings` -- Verifies live rendering of `/settings#status` and `/settings#devices`, hash scrolling, and remote session revocation in browser.

**Acceptance Criteria:**
- Given a signed-in person on desktop (>= 768px) visiting `/settings`, then a sticky left navigation rail displays links to Appearance, Signed-in devices, and System status alongside the content cards.
- Given a signed-in person on mobile (< 768px) visiting `/settings`, then a scrollable chip bar displays links to the sections above the cards, and the desktop rail is hidden.
- Given a signed-in person visiting `/settings#status`, then the System status section is rendered with live health, schema version, backup verification, and dead jobs.
- Given a signed-in person visiting `/settings#devices`, then their active sessions are listed with device/browser details, and the current session is marked with "This device".
- Given a signed-in person with multiple sessions, when clicking "Sign out" on a remote session, then `authClient.revokeSession` is called and the session is removed from the list.
- Given a signed-in person, when clicking "Sign out" on "This device" in the devices card, then the current session is ended and the browser redirects to `/sign-in`.

## Implementation Notes

- Implemented responsive SettingsPage layout with desktop sticky rail (`snav`) and mobile horizontal chips (`md:hidden`).
- Built SignedInDevices querying `authClient.listSessions()` and correlating with `authClient.getSession()`, with device/browser user-agent breakdown, "This device" badge, remote session revocation, and current-device sign out.
- Built SystemStatus consolidating health, backup checks, restore drill verifications, dead jobs list, recovery bundle warnings, and CLI restore disclaimer.
- Cleaned up extracted components from HomePage.
- Patched review findings: guarded loading states for current session, global busy state during revocation/sign-out, removed redundant right-column timestamps in status rows, added unit tests for non-null checks/drills and hash navigation, and redirected e2e jobs/recovery-bundle specs to `/settings#status`.

## Plan Change Log

## Review Triage Log

- Review pass 1 (thorough): high: 0, medium: 1, low: 8, false: 5, maybe-false: 0
  - SignedInDevices.tsx:448 -- low -- patch -- currentSessionQuery pending state left "This device" untagged; patched by combining pending states.
  - SignedInDevices.tsx:461 -- low -- patch -- concurrent session revocation race condition; patched by disabling all sign-out buttons while any revocation is in flight.
  - SignedInDevices.tsx:385 -- low -- patch -- signOut() lacked try/catch and loading state; patched with isSigningOut state and inline error banner.
  - SignedInDevices.tsx:460 -- low -- patch -- missing empty state message when session list empty; patched to show "No active sessions".
  - SystemStatus.tsx:664 -- low -- patch -- duplicate timestamp displayed in right column; patched by removing redundant column.
  - settings.test.tsx:1462 -- low -- patch -- missing tests for non-null check and drill results; patched with comprehensive tests.
  - settings.test.tsx:1303 -- low -- patch -- missing test for initial hash-based active section; patched with window.location.hash test.
  - settings.test.tsx:1480 -- low -- patch -- missing error state tests for backup and dead jobs queries; patched with failure tests.
  - e2e/jobs.spec.ts:13 -- medium -- patch -- jobs and recovery-bundle specs checked root path instead of settings; patched to navigate to `/settings#status` per epic Done-When 2.
  - SettingsNav.tsx:180 -- low -- false -- IntersectionObserver scroll jitter; verified observer options correctly threshold active sections.
  - SystemStatus.tsx:722 -- low -- false -- raw timestamps should be formatted; rejected: existing e2e test contract explicitly asserts raw ISO format.
  - routes/settings.tsx:21 -- low -- false -- section anchor should be #system-status; rejected: ticket specification explicitly specifies #status.
  - ThemeSwitcher.tsx:86 -- low -- false -- missing roving tabindex and aria attributes; rejected: roving tabindex is fully implemented and tested.
  - e2e/settings.spec.ts:1666 -- low -- false -- flaky second session synchronization; rejected: helper already awaits signed-in assertion.
  - HomePage.tsx:280 -- low -- false -- missing alert indicators on home page; rejected: moving status cards away from HomePage is explicit ticket requirement.

## Design Notes

Per `DESIGN.md` § Layout & Spacing and `key-settings.html`:
1. Layout:
   - Desktop: `setwrap` grid with `grid-template-columns: 188px minmax(0, 640px)` with `gap-7`. Sticky rail `snav` on left with `top-4`.
   - Rail items: `px-3 py-1.5 text-[13.5px] border-l-2 text-muted-foreground hover:text-foreground`, active item gets `border-l-primary text-primary font-semibold bg-accent`.
   - Mobile: Horizontal scrollable chips bar (`flex gap-2 overflow-x-auto pb-2 scrollbar-none md:hidden`).
2. Card sections:
   - Each card has `scroll-mt-4 rounded-xl border border-border bg-card p-6 shadow-sm` and an `id` matching its section hash (`#appearance`, `#devices`, `#status`).
   - Card headers follow `key-settings.html`: Lock icon on security/status cards, `h3` title, and `.sc-desc` description.
3. System status card:
   - Status rows (`st`) with OK check glyph or warning line for bad status.
   - CLI restore note at footer: "Restores run from the server CLI, with Pangolin stopped. There's no restore button here on purpose."

## Verification

**Commands:**
- `pnpm --filter @pangolin/web typecheck` -- expected: TypeScript compiles with 0 errors.
- `pnpm vitest run apps/web/src/routes/settings.test.tsx` -- expected: Unit and component tests for settings framework pass.
- `pnpm lint` -- expected: Biome check and architecture boundaries pass with 0 warnings/errors.
- `pnpm --filter @pangolin/e2e test e2e/settings.spec.ts` -- expected: E2E tests for `/settings#status` and `/settings#devices` pass.
