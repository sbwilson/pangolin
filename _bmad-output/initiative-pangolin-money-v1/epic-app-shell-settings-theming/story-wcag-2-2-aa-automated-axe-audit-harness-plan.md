---
title: 'WCAG 2.2 AA automated axe audit harness'
type: 'feature'
ticket: 6
created: '2026-10-18'
status: 'built'
baseline_revision: '2fce49e8e61d3f4342e7defd03e1fef0baf730a6'
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
  - '_bmad-output/specs/spec-pangolin-money/SPEC.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The application lacks an automated accessibility audit in CI and e2e testing to guard against WCAG 2.2 AA regressions across shipped routes (`/transactions`, `/accounts`, `/accounts/:id`, `/settings`, `/sign-in`) in both light and dark modes.

**Approach:** Integrate `@axe-core/playwright` into `@pangolin/e2e`, add a dedicated `axe.spec.ts` testing all 5 shipped routes in both light and dark modes with `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']` tags, expose `test:axe` scripts in `e2e/package.json` and root `package.json`, and remediate any contrast, focus ring, form control label, or ARIA structure violations on these surfaces.

## Boundaries & Constraints

**Always:**
- Assert zero WCAG 2.2 AA violations using `@axe-core/playwright` on all 5 shipped routes (`/transactions`, `/accounts`, `/accounts/:id`, `/settings`, `/sign-in`) in both light and dark modes.
- Maintain strict CSP compliance with zero console errors or `securitypolicyviolation` events during accessibility audits (no inline style attributes and no unsafe script evaluation).
- Visible focus rings (`focus-visible:ring-*`) must maintain >= 3:1 contrast against adjacent backgrounds across all themes and modes.
- Body and interactive text contrast must strictly meet WCAG AA standards (>= 4.5:1 for normal text, >= 3:1 for large text).
- `pnpm --filter @pangolin/e2e test:axe` must be runnable against a running server and exit 0 when no violations exist.

**Never:**
- Do not disable or globally ignore WCAG 2.2 AA rule IDs in `AxeBuilder` to pass tests; fix the underlying DOM or CSS violations in application code.
- Do not inject inline `style="..."` attributes to fix contrast or focus issues (violates strict CSP).
- Do not alter database schemas or server API contracts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `/sign-in` audit (light & dark) | Unauthenticated user navigates to `/sign-in` in light and dark modes | Axe audits login view, form inputs, buttons, and logo; 0 violations | Fails on any WCAG 2.2 AA violation |
| `/transactions` audit (light & dark) | Authenticated session navigates to `/transactions` in light and dark modes | Axe audits desktop sidebar, mobile nav, transactions table, filters, and header; 0 violations | Fails on any WCAG 2.2 AA violation |
| `/accounts` audit (light & dark) | Authenticated session navigates to `/accounts` in light and dark modes | Axe audits accounts overview, group cards, action buttons, and freshness tags; 0 violations | Fails on any WCAG 2.2 AA violation |
| `/accounts/:id` audit (light & dark) | Authenticated session navigates to `/accounts/:id` in light and dark modes | Axe audits account detail header, balance, filters, and transaction rows; 0 violations | Fails on any WCAG 2.2 AA violation |
| `/settings` audit (light & dark) | Authenticated session navigates to `/settings` in light and dark modes | Axe audits 7 settings sections (rail, chips, form cards, closed accounts table); 0 violations | Fails on any WCAG 2.2 AA violation |
| Standalone CLI run | Run `pnpm --filter @pangolin/e2e test:axe` | Playwright executes `axe.spec.ts` against running instance and passes | Reports failed rules and offending DOM nodes on violation |

</frozen-after-approval>

## Code Map

- `e2e/package.json` -- Add `@axe-core/playwright` dependency and declare script `"test:axe": "playwright test axe.spec.ts"`.
- `package.json` -- Expose root script `"test:axe": "pnpm --filter @pangolin/e2e test:axe"`.
- `e2e/playwright.config.ts` -- Configure `axe` project running `axe.spec.ts` with dependency on `accounts`, and ignore `axe.spec.ts` from default `chromium` test project.
- `e2e/axe.spec.ts` -- Implement automated WCAG 2.2 AA audit for `/transactions`, `/accounts`, `/accounts/:id`, `/settings`, `/sign-in` in light and dark modes using `AxeBuilder` and `alexSession`.
- `apps/web/src/components/MascotLogo.tsx` -- Audit SVG icons/logos to ensure `aria-hidden="true"` and `role="img"` attributes satisfy ARIA standards without missing accessible names.
- `apps/web/src/styles.css` -- Remediate any CSS variables, focus ring outlines, or token contrast issues failing WCAG 2.2 AA in light or dark mode.
- `apps/web/src/LoginView.tsx` -- Fix any form label associations, error status banner ARIA, or button accessible names in the sign-in view.
- `apps/web/src/components/SettingsNav.tsx` & `AccountSettings.tsx` -- Remediate settings navigation rail, modal dialog attributes, and closed accounts table semantics.
- `apps/web/src/pages/TransactionsTable.tsx` & `TransactionList.tsx` -- Fix any table header scope, checkbox labels, or contrast issues in transactions list.
- `apps/web/src/pages/AccountsPage.tsx` & `AccountPage.tsx` -- Fix any list item roles, card heading hierarchies, or link text in accounts.
- `.github/workflows/ci.yml` -- Verify accessibility audit is included in CI pipeline.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/package.json` -- add @axe-core/playwright and script -- Installs `@axe-core/playwright` in `e2e` devDependencies and adds `"test:axe": "playwright test axe.spec.ts --no-deps"`.
- [x] `package.json` -- add root test:axe script -- Adds `"test:axe": "pnpm --filter @pangolin/e2e test:axe"` to root scripts.
- [x] `e2e/playwright.config.ts` -- configure axe project -- Adds `axe` project depending on `accounts` and adds `axe.spec.ts` to `testIgnore` of `chromium` project.
- [x] `e2e/axe.spec.ts` -- create axe audit test suite -- Audits `/sign-in`, `/transactions`, `/accounts`, `/accounts/:id`, and `/settings` across both light and dark modes with `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']`.
- [x] `apps/web/src/components/MascotLogo.tsx` -- sanitize logo accessibility attributes -- Ensures decorative SVGs use `aria-hidden="true"` without redundant `role="img"` lacking labels.
- [x] `apps/web/src/styles.css` -- patch token contrast and focus styles -- Adjusts dark mode `--accent` across all themes to ensure contrast > 4.5:1 for active nav links and radio options.
- [x] `apps/web/src/LoginView.tsx` -- accessibility remediation on sign-in -- Ensures inputs, explicit `htmlFor`/`id` labels, and error banners satisfy WCAG 2.2 AA.
- [x] `apps/web/src/components/SettingsNav.tsx` & `AccountSettings.tsx` -- accessibility remediation on settings -- Fixes closed accounts list container semantics (`ul`/`li` with aria-label) and backdrop button `aria-hidden="true"`.
- [x] `apps/web/src/pages/TransactionsTable.tsx` -- accessibility remediation on transactions -- Ensures split button visible text matches accessible name prefix (`label-content-name-mismatch`).
- [x] `apps/web/src/pages/AccountsPage.tsx` & `AccountPage.tsx` -- accessibility remediation on accounts -- Audited; accounts list, balance headings, and cards conform to WCAG 2.2 AA with zero violations.
- [x] `.github/workflows/ci.yml` -- include axe in CI -- Verified: `pnpm e2e` in CI executes all Playwright projects including the newly configured `axe` project.

**Acceptance Criteria:**
- Given the e2e test suite, when `pnpm --filter @pangolin/e2e test:axe` is run against a running Pangolin server, then Playwright executes axe scans on `/transactions`, `/accounts`, `/accounts/:id`, `/settings`, and `/sign-in` with zero WCAG 2.2 AA violations reported.
- Given each audited route, when evaluated under `data-resolved-mode="light"` and `data-resolved-mode="dark"`, then all text and non-text contrast ratios meet or exceed WCAG 2.2 AA requirements (>= 4.5:1 text, >= 3:1 focus ring/UI components).
- Given the root layout and page views, all interactive controls (buttons, links, inputs, selects, dialog triggers) possess accessible names and valid ARIA attributes without missing labels.
- Given the accessibility test execution, zero Content Security Policy (CSP) violations are emitted during page rendering or axe evaluation.

## Implementation Notes

- Added `@axe-core/playwright` (`4.14.0`) to `e2e/package.json` devDependencies.
- Implemented `e2e/axe.spec.ts` covering `/sign-in`, `/transactions`, `/accounts`, `/accounts/:id`, and `/settings` in both `light` and `dark` modes, with tags `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']`.
- No WCAG rules disabled or suppressed in `AxeBuilder`.
- Configured CSP monitoring via `watchCsp` to ensure zero CSP violations or inline styles.
- Updated dark mode theme `--accent` tokens across all 6 themes in `apps/web/src/styles.css` to ensure contrast exceeds 4.5:1 across both sRGB and wide-gamut Display P3 displays.
- Remediated ARIA violations in `MascotLogo.tsx` (redundant `role="img"` on decorative SVG), `LoginView.tsx` (`htmlFor`/`id` bindings and `role="alert"`), `TransactionsTable.tsx` (`label-content-name-mismatch`), `AccountSettings.tsx` (`ul`/`li` list container semantics and backdrop `aria-hidden="true"`), and `AppSidebar.tsx` (removed `opacity-60` on disabled nav links causing low contrast).
- Configured `test:axe` script with `--no-deps` for direct standalone execution against a running instance while preserving dependency order (`axe` -> `accounts` -> `chromium` -> `auth`) in the full `pnpm e2e` run.

## Plan Change Log

## Review Triage Log

- Review pass 1 (thorough): high: 0, medium: 5, low: 6, false: 2, maybe-false: 0
  - LoginView.tsx:62 -- low -- patch -- Conflicting live region semantics (role="alert" with aria-live="polite"); patched by removing aria-live="polite".
  - AccountSettings.tsx:267 -- low -- patch -- Interactive modal backdrop button hidden with aria-hidden="true" and tabIndex={-1}; patched by removing aria-hidden="true" and tabIndex={-1} for accessible backdrop dismissal.
  - TransactionsTable.tsx:90 -- low -- patch -- Redundant speech repetition in split button accessible name; patched to "Split (n): n splits for ...".
  - AppSidebar.tsx:104 -- low -- patch -- Inactive placeholder navigation spans lacked accessibility indication; patched by adding aria-disabled="true".
  - e2e/axe.spec.ts:31 -- low -- patch -- Uncaught error in signInWithPassword terminates retry loop; patched by guarding sign-in flow.
  - e2e/axe.spec.ts:460 -- low -- patch -- Theme preference query race condition with setMode; patched by pre-seeding localStorage via context.addInitScript.
  - LoginView.tsx:160 -- medium -- patch -- Password and TOTP input forms unverified on /sign-in in axe tests; patched by extending axe tests to click "Use password instead" and audit form controls.
  - AccountSettings.tsx:175 -- medium -- patch -- Closed accounts list container semantics unverified; patched by adding role="list" and role="listitem" assertions in settings.test.tsx.
  - AccountSettings.tsx:264 -- medium -- patch -- Leave household confirmation modal unverified in axe tests; patched by extending axe test to open modal and audit dialog.
  - styles.css:166 -- medium -- patch -- Dark mode --accent contrast unverified across non-default themes; patched by adding dark mode axe audit across all 6 themes.
  - e2e/axe.spec.ts:75 -- medium -- patch -- Transient states and theme coverage gap; patched by auditing interactive states and 6 theme palettes.
  - e2e/axe.spec.ts:16 -- false -- - -- Probe in alexSession claimed dead; false because probe allows unauthenticated execution against demo mode server.
  - e2e/playwright.config.ts:28 -- false -- - -- Axe project claimed missing under E2E_RESTORED; false because E2E_RESTORED is intentionally restricted to restored.spec.ts.

## Design Notes

Axe configuration uses the standard Playwright integration:
```ts
import AxeBuilder from "@axe-core/playwright";

const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
  .analyze();
expect(results.violations).toEqual([]);
```

For light and dark mode testing, each route is audited after setting the mode via `page.emulateMedia({ colorScheme })` and setting DOM attributes `data-mode` and `data-resolved-mode` so all Tailwind variables and CSS selectors take effect.

## Verification

**Commands:**
- `pnpm --filter @pangolin/e2e test:axe` -- expected: all axe tests pass with zero WCAG 2.2 AA violations
- `pnpm lint` -- expected: zero Biome errors or package boundary violations
- `pnpm typecheck` -- expected: clean TypeScript build across all packages
