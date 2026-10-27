---
title: 'App shell: responsive desktop sidebar, mobile tab bar, and /sign-in route'
type: 'feature'
ticket: 1
created: '2026-10-17'
status: done
baseline_revision: 'd1e1e7263afbab9153d150c44190cc2485bb35ec'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app currently uses an interim horizontal RootLayout navigation bar with a placeholder Home view, lacks a dedicated `/sign-in` route, and does not provide the responsive desktop sidebar or phone bottom tab bar specified in the UX design.

**Approach:** Replace the interim navigation with a responsive layout: a desktop sidebar (`md:flex`) and phone bottom tab bar (`< md`) reaching all shipped routes (`/transactions`, `/accounts`), redirect `/` to `/transactions` for now, establish a dedicated `/sign-in` route with passkey/password/TOTP tabs per `key-sign-in.html`, and ensure sign-out lands on `/sign-in`.

## Boundaries & Constraints

**Always:**
- Keep all styling CSP-clean: use Tailwind utility classes and CSS variables only; no inline style attributes or third-party asset URLs.
- Retain the `selectGate` state machine invariants: `pending`, `error`, `recover-signed-in`, `recover`, `enrol`, `setup`, `recovery-codes`.
- Mobile tab targets must have minimum touch dimensions >= 44x44px per WCAG 2.5.8 / UX specification.
- Sidebar and tab bar links must specify `aria-current="page"` when active.
- The person footer and header greetings must reflect the signed-in person's display name and colour dot.
- Existing e2e tests in `e2e/auth.spec.ts`, `e2e/routing.spec.ts`, and `e2e/helpers/account.ts` must continue to pass.

**Never:**
- Do not build the full Settings cards or theming engine in this story (reserved for stories 13.2–13.5).
- Do not precache shell pages in service worker (violates CSP / dynamic auth requirements).
- Do not introduce client-side math calculations for currency or balances.
- Do not alter database schemas or server API contracts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Root path access | Signed-in person visits `/` | Automatically redirects to `/transactions` | Handled via router redirect |
| Sign-in page access | Signed-in person visits `/sign-in` | Automatically redirects to `/transactions` | Handled via gate / router redirect |
| Unauthenticated access | Signed-out person visits `/transactions` or `/accounts` | Redirects to `/sign-in` with clean URL | Handled via gate / router redirect |
| Sign-in passkey | User clicks "Sign in with a passkey" | Prompts WebAuthn; on success navigates to `/transactions` | Displays error message in `.warnline` status banner |
| Sign-in password fallback | User selects password, enters credentials | Moves to TOTP step; verifies code and signs in | Displays error message in `.warnline` status banner |
| Sign-out | User clicks "Sign out" in sidebar or phone "More" sheet | Ends session, resets queries, and lands on `/sign-in` | Displays sign-out error in alert if request fails |
| Phone Planning tab | User on `< md` taps "Planning" tab | Opens sheet with Budgets, Goals, Home buying, Forecast | Dismissible via backdrop or Escape key |
| Phone More tab | User on `< md` taps "More" tab | Opens sheet with Net worth, Spending, Accounts link, Settings, Sign out | Dismissible via backdrop or Escape key |
| Responsive resize | Viewport resizes across 768px (`md`) breakpoint | Seamlessly switches between desktop sidebar and mobile bottom tab bar | Content maintains scroll state without horizontal overflow |

</frozen-after-approval>

## Code Map

- `apps/web/src/RootLayout.tsx` -- Main shell layout: replace interim navigation with responsive desktop sidebar (`aside`), phone header, phone bottom tab bar (`nav.tabs`), and wire gate redirects for `/sign-in`.
- `apps/web/src/RootLayout.test.ts` -- Unit tests for `selectGate` verifying `/sign-in`, unauthenticated redirection, and root path handling.
- `apps/web/src/routes/sign-in.tsx` -- New TanStack route for `/sign-in` presenting the dedicated authentication interface.
- `apps/web/src/routes/home.tsx` -- Root route `/` redirecting to `/transactions`.
- `apps/web/src/router.tsx` -- Router configuration registering `signInRoute`.
- `apps/web/src/components/AppSidebar.tsx` -- Desktop sidebar component: mascot logo, nav links (`aria-current="page"`), planning section, settings link, user dot/displayName, and sign-out button.
- `apps/web/src/components/MobileNav.tsx` -- Mobile navigation: bottom tab bar with 5 tabs (Cash flow, Transactions, Needs review, Planning, More) and popover/sheet menus for Planning and More.
- `apps/web/src/components/MascotLogo.tsx` -- Inline SVG mascot and wordmark component per design tokens.
- `apps/web/src/LoginView.tsx` -- Sign-in view styled per `key-sign-in.html`: centered 380px card, passkey primary, password/TOTP flow, and recovery code link.
- `e2e/routing.spec.ts` -- E2E test updates: verify desktop sidebar and mobile tab bar reach shipped routes (`/transactions`, `/accounts`), and `/sign-in` handles authentication.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/MascotLogo.tsx` -- Create inline SVG MascotLogo component -- Renders mascot icon and "Pangolin" wordmark using theme tokens without external images.
- [x] `apps/web/src/components/AppSidebar.tsx` -- Create desktop AppSidebar component -- Displays mascot header, navigation links (Transactions, Accounts), Planning group, Settings link, person indicator (`Signed in as {name}`), and Sign out button.
- [x] `apps/web/src/components/MobileNav.tsx` -- Create mobile bottom tab bar and sheet menus -- Provides 5 touch tabs (>= 44px) and slide-up sheets for Planning and More lists reaching Accounts and Sign out.
- [x] `apps/web/src/routes/sign-in.tsx` -- Create dedicated sign-in route -- Renders LoginView in a centered auth layout and redirects signed-in visitors to `/transactions`.
- [x] `apps/web/src/routes/home.tsx` -- Update root route to redirect to `/transactions` -- Implements immediate redirect from `/` to `/transactions`.
- [x] `apps/web/src/router.tsx` -- Register `signInRoute` in routeTree -- Adds `/sign-in` to the router configuration.
- [x] `apps/web/src/RootLayout.tsx` -- Integrate responsive sidebar and mobile tab bar into RootLayout -- Renders AppSidebar on `md:flex`, MobileNav on `< md`, and updates `selectGate` for `/sign-in` routing.
- [x] `apps/web/src/RootLayout.test.ts` -- Update unit tests for `selectGate` -- Verifies redirection of unauthenticated users to `/sign-in` and authenticated visitors to `/transactions`.
- [x] `apps/web/src/LoginView.tsx` -- Align sign-in form styling with `key-sign-in.html` -- Formats centered auth-card (380px), warning banners, and password/TOTP steps.
- [x] `e2e/routing.spec.ts` -- Add e2e assertions for desktop sidebar, mobile tab bar, and `/sign-in` -- Confirms all shipped routes are reachable via sidebar and mobile nav on desktop and phone viewports.

**Acceptance Criteria:**
- Given a signed-in person on a desktop viewport (>= 768px), when viewing any app page, then the desktop sidebar is visible with Transactions, Accounts, and user profile footer, and the mobile bottom tab bar is hidden.
- Given a signed-in person on a mobile viewport (< 768px), when viewing any app page, then the mobile bottom tab bar is visible with 5 tabs, and the desktop sidebar is hidden.
- Given a mobile user, when tapping the "More" tab, then a menu sheet opens listing Accounts, Settings, and Sign out, and tapping "Accounts" navigates to `/accounts`.
- Given a signed-in person, when navigating to `/`, then the browser redirects to `/transactions`.
- Given an unauthenticated visitor, when navigating to `/transactions` or `/accounts`, then the browser redirects to `/sign-in`.
- Given a signed-in person, when navigating to `/sign-in`, then the browser redirects to `/transactions`.
- Given a signed-in person, when clicking "Sign out", then the session is terminated and the page redirects to `/sign-in`.
- Given an unauthenticated visitor on `/sign-in`, when providing valid passkey or password + TOTP credentials, then sign-in succeeds and redirects to `/transactions`.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- Review pass 1 (thorough): high: 1, medium: 1, low: 6, false: 5, maybe-false: 0
  - MobileNav.tsx:26 -- high -- patch -- Cash flow `<Link to="/">` without `exact: true` matches prefix and stays active on all routes; patched with `activeOptions={{ exact: true }}`.
  - LoginView.tsx:71 -- medium -- patch -- Outer `<section aria-labelledby="sign-in-heading">` referenced non-existent heading ID when `step === "recovery"`; patched to use `aria-label="Sign in"` on recovery step.
  - RootLayout.tsx:85 -- low -- patch -- `signedIn` navigated before query invalidation completed; patched to `await refresh()` before `navigate()`.
  - MascotLogo.tsx:935 -- low -- patch -- Eyes and claws used `var(--foreground)` which turns white in dark mode; patched to `var(--mascot-ink, #1F2328)`.
  - MobileNav.tsx:1057 -- low -- patch -- Sheet trigger buttons lacked ARIA dialog attributes; patched with `aria-haspopup="dialog"` and `aria-expanded`.
  - RootLayout.tsx:590 -- low -- patch -- Main container applied mobile tab bar bottom padding unconditionally; patched to apply `pb-16` only when `shell` is active.
  - AppSidebar.tsx:30 -- low -- patch -- Desktop sidebar omitted Cash flow, Needs review, and active Settings link; patched to include matching items and link Settings to `/settings`.
  - e2e/routing.spec.ts:340 -- low -- patch -- Mobile Planning sheet opening/dismissal and mobile Sign out lacked test assertions; patched with dedicated test cases.
  - LoginView.tsx:38 -- false -- rejected -- Claim that `withPassword` dropped `twoFactorRedirect` check; refutation: lines 41-43 explicitly check `data.twoFactorRedirect` and transition to `totp`.
  - LoginView.tsx:217 -- false -- rejected -- Claim that password step must include recovery code link; refutation: `key-sign-in.html` Figure 2 explicitly omits recovery link on password step.
  - RootLayout.tsx:606 -- false -- rejected -- Claim that `<h1>Pangolin Money</h1>` should be removed; refutation: required by existing `e2e/routing.spec.ts` baseline assertions.
  - RootLayout.tsx:88 -- false -- rejected -- Claim that `signOut` should not navigate on error; refutation: client session teardown and redirect to `/sign-in` is intended behavior.
  - routes/home.tsx:2 -- false -- rejected -- Claim that `HomePage.tsx` is dead code; refutation: retained intentionally until story 13.7 refactor sweep per epic inception decision 70.

## Design Notes

The navigation layout adheres to `DESIGN.md` § Shell:
1. Desktop sidebar (`w-58 shrink-0 border-r bg-sidebar p-3 flex flex-col justify-between`):
   - Brand row: Mascot SVG (30x22 viewBox) + wordmark "Pangolin".
   - Primary nav items with Lucide-style inline SVGs: Transactions (`/transactions`), Accounts (`/accounts`).
   - Planning section separated by a hairline divider.
   - Settings link (`/settings` or placeholder).
   - Footer: Person dot (`me.colour`), display name, "Signed in as {name}" text for test continuity, and quiet "Sign out" button.
2. Mobile navigation:
   - Bottom tab bar (`fixed bottom-0 inset-x-0 bg-card border-t grid grid-cols-5 py-1 z-40 md:hidden`).
   - Tabs: Cash flow (`/`), Transactions (`/transactions`), Needs review, Planning (opens sheet), More (opens sheet).
   - Min touch target height >= 44px. Active tab styled in `text-primary`.
3. `/sign-in` layout:
   - Centered column on `bg-background` min-h-screen, 380px wide card, mascot logo above card, passkey primary button, alternate password toggle, and recovery code link.

## Verification

**Commands:**
- `pnpm --filter @pangolin/web typecheck` -- expected: Clean TypeScript compile with 0 errors.
- `pnpm --filter @pangolin/web test` -- expected: All unit tests in `RootLayout.test.ts` and component tests pass.
- `pnpm lint` -- expected: Biome linter and architecture boundaries check pass with 0 warnings/errors.
- `pnpm --filter @pangolin/e2e test e2e/routing.spec.ts` -- expected: Playwright e2e routing suite passes green on desktop and mobile viewports.
