---
title: 'Web stack: router, table and virtual list, Tailwind and shadcn'
type: 'feature'
ticket: '1'
created: '2026-10-04'
status: 'built'
baseline_revision: '82e05724a25219194835b75618b89cd3d2ab2343'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The web app is one 513-line `App.tsx` with a hand-rolled path switch and plain CSS. Every later workspace story would have to edit that file, and there is no table, virtual list, design system or typed search params.

**Approach:** Adopt TanStack Router with typed search params, build the app shell and navigation that later pages plug into by adding only their own route, add TanStack Table and Virtual and Tailwind 4 with shadcn components, and move the existing pages (setup, sign-in, status, recovery, ledger list) onto it with no change in behaviour.

## Boundaries & Constraints

**Always:** Behaviour and accessible names stay: h1 "Pangolin Money", the Home panels, the "Transactions" button on Home, `role=table` named "Transactions", all `/setup?token=`, `/recover?token=` and `/ledger` flows. The recovery and setup `token` is typed in `validateSearch`, read once, then stripped with `navigate({ replace: true })` so it never stays in history; navigation that used `replaceState` keeps replacing. State gates (`me` pending or error, enrolment incomplete, initial recovery codes, in-memory `newPassword`, sign-out error) stay as guards in the root layout and never enter the URL. Filters and paging live in URL search params; the web app never sums money. CSP stays nonce-based: no `<style>` or `style=` attributes in static HTML, Tailwind compiled to a hashed file, any runtime style-injecting library gets the nonce from `document.querySelector('meta[property="csp-nonce"]').nonce`, and only shadcn components the shell and pages use are installed. `apps/web` imports only `@pangolin/shared` and type-only `apps/server`. Dependencies are exact pins at least 7 days old; `pnpm-lock.yaml` updates and `allowBuilds` is set if a package needs it.

**Decisions:** Routes are code-based (no codegen or plugin; each later story adds one route object). The typed search params that prove the round trip are the existing `token` on `/setup` and `/recover`; `/ledger` gains none. The ledger table uses TanStack Table with the same markup, and Virtual only above a row threshold, so `role=table` and the e2e selectors stay. The shell is a sidebar with the items Home and Ledger; the Home "Transactions" button stays so no accessible name is duplicated; a UX document will refine it later, so keep the shell easy to restyle. The `me` state machine becomes the root layout and renders the outlet only when signed in with enrolment complete.

**Never:** No new features, filters, sorting or pages beyond the shell, nav and moved pages. No server change except what the CSP e2e needs. No new test framework (no jsdom). No style-injecting shadcn component (select, popover, toast) unless its nonce is wired and covered by an e2e check. No change to the existing CSP guard self-test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deep link | Signed in, GET `/ledger` | Ledger page inside the shell | Server catch-all serves the SPA |
| Setup link | Signed out, `/setup?token=x` | Setup view; token read, then removed from the URL | Invalid token shows the existing error |
| Recover link | Signed in, `/recover?token=x` | "Sign out first" panel; token stripped from history | No change from today |
| Search round trip | A route with typed search params | Navigate then reload keeps the typed values | Bad values fall back to defaults |
| CSP | Any page | No `securitypolicyviolation`; guard self-test still fails as designed | e2e fails on a violation |
| Gates | `me` pending, error, incomplete enrolment | Same screens as today, not URL-driven | No change |
| Large list | Ledger with many rows | Virtualised past the row threshold, table role and name intact | No error expected |

</frozen-after-approval>

## Code Map

- `apps/web/src/App.tsx` (513 lines) -- hand-rolled `usePath` router, `Home`, `LedgerView`, gates; split into the router, a root layout and pages.
- `apps/web/src/main.tsx` -- `QueryClientProvider`, `<App/>`, service worker registration; becomes `RouterProvider`.
- `apps/web/src/{SetupView,LoginView,EnrolView,RecoveryViews}.tsx`, `api.ts`, `auth-client.ts` -- pages and client to keep.
- `apps/web/vite.config.ts` -- has `html.cspNonce: "__CSP_NONCE__"`; add `@tailwindcss/vite` and the `@/` alias.
- `apps/web/src/styles.css` (47 lines) -- replace with Tailwind 4 and theme tokens, keep light and dark.
- `apps/web/package.json`, `tsconfig.json`, `components.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `biome.json` -- dependencies (`@tanstack/react-router`, `react-table` 9, `react-virtual` 3, `tailwindcss` 4, `@tailwindcss/vite`, shadcn support packages), alias, lint excludes for copied files.
- `apps/server/src/http/{csp.ts,app.ts}` -- nonce and `serveIndex`, catch-all `app.get("*")` already serves deep links; read, do not change.
- `e2e/helpers/csp.ts`, `e2e/health.spec.ts`, `auth.spec.ts`, `ledger.spec.ts` -- CSP guard and name-based selectors that must keep passing.
- `apps/web/src/api.test.ts` -- only web test; root vitest runs in node.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web` dependencies, Tailwind, shadcn base, alias, CSP-safe styles
- [ ] router, root layout with shell, nav and state gates, routes `/`, `/setup`, `/recover`, `/ledger`
- [ ] ledger page on TanStack Table with Virtual above a row threshold
- [ ] typed search params with a round-trip test (memory-history router test plus a Playwright check)
- [ ] move every existing page with no behaviour change; update e2e only if a name genuinely changes

**Acceptance Criteria:**
- Given the existing web and e2e suites, when they run, then they pass and the CSP e2e test stays green.
- Given a route's typed search params, when navigated and reloaded, then they round-trip.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (thorough): 0 high, 3 medium and 3 low patches; 8 deferred; 5 rejected.

| Verdict | Route | Finding and evidence |
|---|---|---|
| medium | patch | Home "Transactions" and ledger "Back" push history entries; the plan says navigation that used `replaceState` keeps replacing (intent-alignment, edge-case). |
| medium | patch | Token read on any path, stripped only when valid, and numeric-looking tokens lose their string form through the router's JSON search parsing (edge-case hunter). |
| medium | patch | Virtualised ledger: scroll container not keyboard reachable, no `aria-rowcount`/`aria-rowindex`, spacer rows exposed (blind hunter). |
| medium | patch | Virtualised e2e never scrolls and does not pin the 200-row threshold (verification-gap, pre-verified). |
| low | patch | Description cell truncates with no `title`; the old table showed the full text. |
| low | patch | Fragile `history.length === 2` assertion; signed-in `/recover?token=` untested. |
| low | defer | Theme tokens incomplete for later shadcn components (`--destructive`, `--card`, ...), `lucide-react` named but absent, `button:not([class])` base style. |
| low | defer | `RootLayout` gate precedence has no unit test (a pure `selectGate` would fix it); trailing-slash paths compare exactly. |
| low | defer | Session context rebuilt each render; virtual list first paint and sticky header offset. |
| low | defer | Unknown paths now redirect to `/` where the old router showed Home at the same URL. |
| false | reject | Round trip not shown in a real browser: decision 2a named `token`, which the app strips by design; the node router test plus the strip e2e is the agreed proof. |
| false | reject | Signed-out deep link loses its destination after sign-in: the old router also went to `/`. |
| false | reject | Stale plan file, missing `pnpm-workspace.yaml` edit (no `allowBuilds` needed). |

## Design Notes

Search-param round trip is unit-tested with `createRouter` and `createMemoryHistory` in the node environment (no DOM), and once in Playwright against the real page.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: green (known unrelated failures: `deploy/install.test.ts` x2, `backup.test.ts` restic timeout)
- `pnpm --filter @pangolin/web build` -- expected: succeeds, no inline style in the built HTML
- `pnpm e2e` -- expected: auth, ledger and CSP specs pass

