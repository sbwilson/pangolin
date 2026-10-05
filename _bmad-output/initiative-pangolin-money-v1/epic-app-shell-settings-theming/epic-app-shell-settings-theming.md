---
type: epic
title: "App shell, settings and theming"
parent: initiative-pangolin-money-v1
covers: [CAP-21]
after: []
assignee: ""
risk: medium
---

# App shell, settings and theming

## Description

The frame every surface sits in: a desktop sidebar and a phone tab bar, a `/sign-in` route of its own, and one Settings page (`/settings#…`) that takes over the shipped HomePage cards. Each person picks one of six themes in light, dark or system mode, saved to their profile. It also lays the WCAG 2.2 AA floor for the whole app: an axe check on every route in CI. Milestone M1. The spec's CAP-21 and its accessibility constraint own the detail.

## Outcome

Both of us move around Pangolin through one shell and one Settings page, in a theme we each chose, on any device; CAP-21's success (a theme that follows its person, axe clean on every route) is the signal.

## Done when

1. On desktop the sidebar, and on a phone the tab bar with its Planning and More lists, reach every shipped route. `/sign-in` signs in, `/` redirects to `/transactions` for now, and an unknown path lands on `/`.
2. `/settings` holds System status (health, last backup, last restore drill, failed jobs by kind and time only, and the recovery-bundle warning until its storage is confirmed), Sign-in & security, Signed-in devices (list and end sessions), Partner (Invite <partner> until both people exist, Reset <partner>'s sign-in), an empty Household section and Appearance. The shipped HomePage cards live there, and the `health`, `recovery` and `auth` e2e specs pass at their new paths.
3. A person picks one of six themes in light, dark or system mode; the choice is saved in `person_preference`, follows them to another device, and causes no CSP violation.
4. An axe e2e check runs on every route in CI and fails the build on a WCAG 2.2 AA violation; it is clean on every shipped route, including epic-ledger-workspace's `/transactions`, `/accounts` and `/accounts/:id`.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

The `apps/web` shell (sidebar, tab bar, header with the Import button slot; the header hosts the date-range control on routes where it filters, carries forward the Transactions badge (12.2) and the Needs review badge, and adds the freshness line), `/sign-in`, the Settings page and its cards (Household empty; epic-budgets-bills and epic-spending-insight add its controls), the Re-auth dialog (a modal that retries the guarded action on success; DESIGN Re-auth dialog), replacing the inline ReauthRequired pattern epic-ledger-workspace's CSV export uses until then, `person_preference` in `identity`, the six themes compiled as tokens under a `data-theme` and mode attribute, and the axe harness. It moves shipped behaviour (HomePage cards, the `prefers-color-scheme`-only palette in `styles.css`) without changing it. Not the transaction list, account screens or `/transactions` route (epic-ledger-workspace). Not the Import popover or Needs review (epic-import-dedupe-transfers). Not the LLM providers card (epic-llm-categorisation-pdf). Not Cash flow, which takes over the `/` redirect (epic-spending-insight).

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-21
- constraint — _bmad-output/specs/spec-pangolin-money/SPEC.md, section Constraints (WCAG 2.2 AA)
- milestones — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, section Milestones (M1)
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, People (`person_preference`)
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-5, AD-9, AD-22, AD-27, and Consistency Conventions (Web security, Frontend state, Accessibility, Theming, Routes)
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Information Architecture, Component Patterns (Accounts, settings, auth & feedback), State Patterns (Settings & auth), Accessibility Floor, Theming, Responsive & Platform
- design — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md, sections Colors (Theme sets), Components (Shell, Settings & auth)
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-settings.html, key-sign-in.html, color-themes-1.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, sections 2.4 Technical impact and E-10

## Notes

- Decision (2026-10-05, correct course after UX): new epic for CAP-21 and the WCAG 2.2 AA floor, in M1 after epic-ledger-workspace; epic 12 keeps its M1 size and leaves the shell, Settings, sign-in route and themes here.
- Decision (2026-10-05): `/` redirects to `/transactions` until epic-spending-insight ships `/cash-flow`, then to `/cash-flow` (spine Consistency Conventions, Routes).
- Decision (2026-10-05): the System status card keeps the recovery-bundle warning (AD-27), and Partner keeps Invite and Reset sign-in; identity notices move to review items in epic-import-dedupe-transfers, keeping "Revoke the link".
- Decision (2026-10-05, user): this epic builds an empty Settings › Household section; epic-budgets-bills adds pay cycles and the household pay anchor (AD-14, AD-25), and epic-spending-insight adds the 50/50 attribution control.
- Decision (2026-10-05, user): epic-ledger-workspace ships before the axe harness; this epic's Done-when axe check covers its routes (`/transactions`, `/accounts`, `/accounts/:id`).
- Decision (2026-10-05, user): this epic owns the Re-auth dialog (modal, retry on success); epic-ledger-workspace entry 6 uses the existing inline ReauthRequired pattern until it ships.
- Waits on epic-ledger-workspace because: entry 1 delivered the router, shell and shadcn this epic builds on, and entry 2 the `/transactions` route.
- Waits on epic-platform-foundations because: identity (person, sessions, passkey sign-in, recovery, partner reset) and the system status routes are what Settings shows.
