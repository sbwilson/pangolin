---
title: 'Theme engine and preferences persistence'
type: 'feature'
ticket: '2'
created: '2026-10-17'
status: done
baseline_revision: 'b0529443a43fd0f9565e5a7a5e6e30cc33073236'
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
  - '_bmad-output/specs/spec-pangolin-money/data-model.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app currently lacks persistent user theme preferences, confining users to default styling without support for personal aesthetic choices (6 designed themes) or light/dark/system mode switching across sessions.

**Approach:** Add the `person_preference` table and migration to store theme and mode per person, expose audited `GET` and `PUT /api/identity/preferences` endpoints, define all 6 WCAG AA theme token palettes in `apps/web/src/styles.css`, and implement a CSP-compliant client theme provider and switcher that drives `<html data-theme="..." data-mode="...">`.

## Boundaries & Constraints

**Always:**
- Adhere strictly to the WCAG 2.x AA contrast rules (>= 4.5:1 text on background and card; >= 3:1 focus ring against background) for all 6 themes in both light and dark modes.
- Maintain zero CSP inline-style violations (no `style="..."` attributes and no inline `<style>` tags without nonce).
- Require authentication for `/api/identity/preferences` and audit every preference update in `audit_log` with before and after state.
- Register all new endpoints in `apps/server/src/privacy/route-manifest.ts` ensuring privacy suite compliance.
- Support `mode: 'system'` by dynamically respecting `window.matchMedia('(prefers-color-scheme: dark)')`.
- SQLite table must use `STRICT` mode and follow existing migration journaling standards.

**Never:**
- Do not use inline CSS attributes or dynamic inline stylesheet injection that violates `Content-Security-Policy`.
- Do not allow unauthenticated access to preferences.
- Do not leak private preferences across different household members.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Get preferences (uninitialized) | Authenticated person with no `person_preference` row | Returns `{ theme: "clay-linen", mode: "system" }` | No error expected |
| Get preferences (existing) | Authenticated person with row `{ theme: "fern-gully", mode: "dark" }` | Returns `{ theme: "fern-gully", mode: "dark" }` | No error expected |
| Get preferences (unauthenticated) | Anonymous request | 401 Unauthorized | Returns `{"error": "Unauthenticated"}` |
| Update preferences (valid) | Authenticated person PUT `{ theme: "galah-party", mode: "light" }` | 200 OK with updated `{ theme: "galah-party", mode: "light" }`; row upserted; audit log recorded | No error expected |
| Update preferences (partial) | Authenticated person PUT `{ theme: "black-opal" }` | 200 OK with `{ theme: "black-opal", mode: <previous_or_default> }` | No error expected |
| Update preferences (invalid theme) | PUT `{ theme: "neon-pink" }` | 400 Bad Request with validation error | Returns error payload |
| Update preferences (invalid mode) | PUT `{ mode: "sunset" }` | 400 Bad Request with validation error | Returns error payload |
| Client system mode toggle | OS switches between light and dark when `mode === 'system'` | Client detects `matchMedia` change and updates `data-resolved-mode` / class without network call | No error expected |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/person-preference.ts` -- Drizzle schema definition for `person_preference`
- `packages/db/src/schema/index.ts` -- Exports `personPreference` schema
- `packages/db/migrations/0014_person_preference.sql` -- Migration adding `person_preference` table with STRICT and check constraints
- `packages/db/migrations/meta/_journal.json` -- Drizzle migration journal entry 14
- `packages/db/src/repositories/person-preference.ts` -- SQLite repository queries for person preference get and upsert
- `packages/app/src/ports/unit-of-work.ts` -- Type definitions: `ThemeName`, `ThemeMode`, `PersonPreferenceRow`, and `PersonPreferenceRepo`
- `packages/app/src/identity/preferences.ts` -- Use cases: `getPreferences` and `updatePreferences` with Zod validation and audit logging
- `packages/app/src/identity/preferences.test.ts` -- Unit tests for preference use cases and audit logging
- `apps/server/src/http/app.ts` -- Mounts `GET` and `PUT /api/identity/preferences`
- `apps/server/src/privacy/route-manifest.ts` -- Privacy manifest registration for `/api/identity/preferences`
- `apps/server/src/http/preferences.test.ts` -- Integration tests for preference endpoints
- `apps/web/src/styles.css` -- CSS variables for the 6 themes (light & dark) and Tailwind mappings
- `apps/web/src/theme.tsx` -- React `ThemeProvider`, `useTheme` hook, and DOM attribute manager
- `apps/web/src/components/ThemeSwitcher.tsx` -- Theme and mode switcher UI component
- `apps/web/src/components/ThemeSwitcher.test.tsx` -- Unit tests for the theme switcher component
- `apps/web/src/routes/settings.tsx` -- Embeds `ThemeSwitcher` on `/settings`

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/person-preference.ts` -- create table schema -- Defines `person_preference` table with `person_id` primary key referencing `person.id`, `theme` text default `'clay-linen'`, `mode` text default `'system'`, and timestamps.
- [x] `packages/db/src/schema/index.ts` -- export schema -- Exposes `personPreference` table definition.
- [x] `packages/db/migrations/0014_person_preference.sql` -- create migration -- Adds `person_preference` table with STRICT and check constraints.
- [x] `packages/db/migrations/meta/_journal.json` -- update journal -- Adds idx 14 entry for `0014_person_preference`.
- [x] `packages/app/src/ports/unit-of-work.ts` -- declare repository port -- Defines `PersonPreferenceRow`, `ThemeName`, `ThemeMode`, and `PersonPreferenceRepo`.
- [x] `packages/db/src/repositories/person-preference.ts` -- repository implementation -- Implements `get` and `upsert` queries for `person_preference`.
- [x] `packages/db/src/unit-of-work.ts` -- wire repository -- Exposes `personPreferences` on `tx` and `read` repos.
- [x] `packages/app/src/identity/preferences.ts` -- preference use cases -- Implements `getPreferences` and `updatePreferences` with Zod validation and audit logging.
- [x] `packages/app/src/identity/preferences.test.ts` -- unit tests -- Tests preference reading, updating, defaulting, and audit logging.
- [x] `apps/server/src/http/app.ts` -- register API routes -- Mounts `GET /api/identity/preferences` and `PUT /api/identity/preferences`.
- [x] `apps/server/src/privacy/route-manifest.ts` -- route privacy manifest -- Declares route privacy entries for GET and PUT `/api/identity/preferences`.
- [x] `apps/server/src/http/preferences.test.ts` -- API route tests -- Tests 200 responses, 401 unauthenticated, input validation, and audit recording.
- [x] `apps/web/src/styles.css` -- CSS theme tokens -- Declares 6 theme palettes (`clay-linen`, `harbour-morning`, `fern-gully`, `galah-party`, `gelato-bar`, `black-opal`) in light and dark modes with Tailwind bindings.
- [x] `apps/web/src/theme.tsx` -- ThemeProvider & hook -- Manages theme & mode state, syncs with API, and sets `data-theme` & `data-mode` attributes on `<html>`.
- [x] `apps/web/src/components/ThemeSwitcher.tsx` -- theme switcher UI -- Component to toggle between 6 themes and 3 modes (Light/Dark/System).
- [x] `apps/web/src/components/ThemeSwitcher.test.tsx` -- theme switcher tests -- Unit tests verifying attribute changes on `<html>` and API update dispatch.
- [x] `apps/web/src/routes/settings.tsx` -- embed in settings -- Mounts `ThemeSwitcher` in the Settings page.

**Acceptance Criteria:**
- Given an authenticated user, when `GET /api/identity/preferences` is called without prior preference saved, then `{ theme: "clay-linen", mode: "system" }` is returned.
- Given an authenticated user, when `PUT /api/identity/preferences` is called with `{ theme: "harbour-morning", mode: "dark" }`, then the database is updated, an audit log row is recorded, and the updated preferences are returned.
- Given any theme selection, the HTML root element reflects `data-theme="<theme>"` and `data-mode="<mode>"` without emitting any inline styles or violating CSP.
- Given `mode: 'system'`, the active styling resolves to dark mode when the client media query matches `prefers-color-scheme: dark`, and light mode otherwise.

## Implementation Notes

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence / Action |
|---|---|---|---|
| VG-1: ThemeProvider preference hydration unverified on mount | medium | patch | Query hydration to DOM attributes was unverified; added test asserting non-default hydration in ThemeSwitcher.test.tsx. |
| VG-2: Dynamic OS theme toggle via matchMedia unverified in system mode | medium | patch | matchMedia change listener was unverified; added test simulating OS media query changes in ThemeSwitcher.test.tsx. |
| ECH-1: Stale closure in ThemeProvider update handlers | medium | patch | setTheme/setMode closed over state; patched to dispatch isolated partial updates { theme } and { mode }. |
| ECH-2: Missing mutation error rollback in ThemeProvider | low | patch | Added onError handler in useMutation invalidating preferences query to roll back UI drift on network failure. |
| ECH-3: Unauthenticated 401 request noise in fetchPreferences | low | patch | fetchPreferences threw on 401; patched to return default { theme: "clay-linen", mode: "system" } gracefully. |
| ECH-4: Runtime constants THEME_NAMES/THEME_MODES export | false | - | Verified that runtime const arrays are exported as values from packages/app/src/index.ts. |
| BH-1: Missing mascot scale tokens in styles.css | medium | patch | DESIGN.md explicitly defined mascot scale tokens; added --mascot-scale-1 and --mascot-scale-2 to all 12 theme/mode blocks. |
| BH-2: Missing id="appearance" anchor on /settings | low | patch | Added id="appearance" to appearance section card in routes/settings.tsx for in-page navigation. |
| BH-3: Invalid aria-pressed on role="radio" in ThemeSwitcher | low | patch | WAI-ARIA forbids aria-pressed on role="radio"; removed aria-pressed and kept aria-checked. |
| BH-4: Missing roving tabindex in ThemeSwitcher radiogroups | low | patch | Implemented roving tabIndex={isSelected ? 0 : -1} for accessible radiogroup keyboard navigation. |
| BH-5: Orphaned label elements in ThemeSwitcher | low | patch | Replaced orphaned labels with div and aria-labelledby on radiogroups. |
| BH-6: Flash of default theme (FOUC) on client load | low | patch | Implemented localStorage caching in ThemeProvider for instant synchronous theme rendering. |
| BH-7: CSS specificity collisions on :root[data-mode="dark"] | low | patch | Refined Clay dark selectors with :root:not([data-theme]) to avoid accidental bleed onto other themes. |
| BH-8: Initial audit action for preferences | false | - | Verified that idempotent settings updates in Pangolin record action: "update" matching household-settings. |
| BH-9: Cleanup on household leave in leave-household.ts | low | defer | Household leave and account lifecycle settings are formally scoped to Story 13.5 (SH-4). |
| BH-10: Empty update payload in updatePreferences | false | - | Partial updates allow empty object no-op safely without violating Zod schema or data integrity. |

## Design Notes

Six themes from `DESIGN.md` and `color-themes-1.html`:
1. `clay-linen`: Light (`--bg: #F6EFE6`, `--card: #FFFAF3`, `--fg: #2A1F17`, `--muted-fg: #6A594B`, `--border: #E3D6C5`, `--primary: #A3441D`), Dark (`--bg: #1C1713`, `--card: #26201A`, `--fg: #F3E9DD`, `--muted-fg: #B5A391`, `--border: #3E342A`, `--primary: #E58457`).
2. `harbour-morning`: Light (`--bg: #F3F6F9`, `--card: #FFFFFF`, `--fg: #0E1A26`, `--muted-fg: #526070`, `--border: #D8E0E8`, `--primary: #0A5CBD`), Dark (`--bg: #0B121B`, `--card: #121C28`, `--fg: #E5EDF5`, `--muted-fg: #95A5B6`, `--border: #233244`, `--primary: #5EA6FF`).
3. `fern-gully`: Light (`--bg: #F2F5EE`, `--card: #FCFDF9`, `--fg: #18261B`, `--muted-fg: #526454`, `--border: #D7E0D2`, `--primary: #2B7446`), Dark (`--bg: #111A14`, `--card: #18241C`, `--fg: #E4EEE3`, `--muted-fg: #9DB09E`, `--border: #2A3A2E`, `--primary: #6CC48A`).
4. `galah-party`: Light (`--bg: #FAF7F8`, `--card: #FFFFFF`, `--fg: #1A1020`, `--muted-fg: #5E5367`, `--border: #E8DEE6`, `--primary: #C11574`), Dark (`--bg: #120B16`, `--card: #1D1322`, `--fg: #F8EEF6`, `--muted-fg: #B8A7BF`, `--border: #3A2A40`, `--primary: #FF4FA3`).
5. `gelato-bar`: Light (`--bg: #F8F5FC`, `--card: #FFFFFF`, `--fg: #231C33`, `--muted-fg: #625975`, `--border: #E6E0F0`, `--primary: #6A4FCF`), Dark (`--bg: #19152A`, `--card: #221D36`, `--fg: #EEEAF8`, `--muted-fg: #ABA3C2`, `--border: #362F4E`, `--primary: #B6A2FF`).
6. `black-opal`: Light (`--bg: #F4F1EC`, `--card: #FFFDF9`, `--fg: #1A1722`, `--muted-fg: #5D5765`, `--border: #E2DCD3`, `--primary: #0D6669`), Dark (`--bg: #0D0E14`, `--card: #161722`, `--fg: #ECE8F2`, `--muted-fg: #A49FB3`, `--border: #2A2B3A`, `--primary: #35C2C0`).

Derived token rules per `DESIGN.md`:
- `popover` = `card`
- `popover-foreground`, `secondary-foreground`, `sidebar-foreground` = `foreground`
- `muted`, `secondary`, `sidebar` = `background`
- `input`, `sidebar-border` = `border`
- `accent-foreground`, `sidebar-primary`, `sidebar-accent-foreground` = `primary`
- `sidebar-accent` = `accent`
- `destructive` = `money-out`
- `destructive-foreground`, `sidebar-primary-foreground` = `primary-foreground`

## Verification

**Commands:**
- `pnpm --filter @pangolin/db check:strict` -- expected: all tables STRICT
- `pnpm --filter @pangolin/db check:upgrade` -- expected: migrations upgrade cleanly from version 14 to 15
- `pnpm -r typecheck` -- expected: exit code 0
- `pnpm --filter @pangolin/app test` -- expected: preference use case tests pass
- `pnpm --filter @pangolin/server test` -- expected: API & privacy manifest tests pass
- `pnpm --filter @pangolin/web test` -- expected: web unit tests pass
