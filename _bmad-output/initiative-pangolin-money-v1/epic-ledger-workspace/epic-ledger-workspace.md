---
type: epic
title: "Ledger workspace"
parent: initiative-pangolin-money-v1
covers: [CAP-18, CAP-3, CAP-14, CAP-16]
after: []
assignee: ""
risk: high
---

# Ledger workspace

## Description

The web workspace on top of epic-ledger-accounts-privacy's server core: a transaction list at `/transactions` with filters and a date range in the URL that stays fast at 50,000 rows, a transaction sheet for splits, tags, notes, beneficiaries and hidden names, bulk select, account screens, search, CSV export and the audit-log API, all on the same privacy path. Milestone M1, with that epic.

## Outcome

Both of us browse, filter and edit one shared ledger in the browser without ever seeing the other's private accounts or hidden names; the end-to-end ledger journey and the cross-user privacy suite are the signal.

## Done when

1. Tests that try cross-user reads of private accounts and hidden names fail through search, CSV export and the audit-log API, extending epic-ledger-accounts-privacy's server-side privacy suite.
2. In an end-to-end test at `/transactions`, the seeded ledger is filtered through URL parameters. In the transaction sheet, a transaction is split into two splits that sum to the parent, it is tagged, and the split carries a beneficiary.
3. The transaction list's first page answers within 300 ms server-side on the 50,000-row profile, and the list is virtualised.
4. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

The web app (router, table, list, editors, account screens), search (FTS5), CSV export, the audit-log read API and the 50,000-row performance work. Not the ledger tables, modules or privacy core (epic-ledger-accounts-privacy). Not the review inbox UI (epic-import-dedupe-transfers). Not the final app shell, Settings, sign-in route or themes (epic-app-shell-settings-theming); entry 1's interim sidebar stays until epic 13. Not the Import popover or the Import button beside the Transactions search (epic-import-dedupe-transfers), nor the target of the summary line's "N need review" link. Not loan or property detail (epic-loans-property). The web never sums money.

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-3, CAP-14, CAP-18
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, Privacy enforcement
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-4, AD-5, AD-7, AD-9, AD-10, and Consistency Conventions (Frontend state, API, Tests, Web security, Accessibility, Routes)
- core — _bmad-output/initiative-pangolin-money-v1/epic-ledger-accounts-privacy/epic-ledger-accounts-privacy.md, its Notes' decisions
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Information Architecture, Component Patterns (Transactions & review), State Patterns (Transactions & review)
- design — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md, Components › Transactions & review, Components › Accounts & loans
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-transactions.html, key-accounts.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, sections E-3, E-4, E-5

## Notes

- Decision (2026-10-04): split out of epic 2 at its inception; see epic-ledger-accounts-privacy's Notes for the shared decisions.
- Decision (2026-10-04): adopt TanStack Router (URL search params), TanStack Table and Virtual, and Tailwind/shadcn as the opening story; search and CSV export (re-authentication) get an API and a basic UI; the audit log is API-only, with redact() on its before/after JSON; a separate 50,000-row perf profile with a first-page bar of 300 ms server-side.
- Waits on epic-ledger-accounts-privacy because: the list, editors, search, export and audit read its modules, API and privacy path; the end-to-end test needs its seeded ledger.
- Decision (2026-10-05, correct course after UX): entries 2–5 amended in place (`/transactions` with `/ledger` redirecting, date range, day nets, summary line, transaction sheet, grouped accounts, amount search); new entry 12 bulk select (after 3, before the refactor sweep). The shell, Settings, sign-in route and themes go to epic-app-shell-settings-theming, keeping this epic at M1 size.
- Decision (2026-10-05): the tracer path is entry 1 (built), the tracer bullet through router, shell, table and virtual list; entry 2 extends it to `/transactions`.
- Decision (2026-10-05, validation): entries 3 → 4 → 5 → 6 run one after another, because all four touch the `/transactions` page and 5 and 6 also touch entry 2's filter parser; search (5) lands its text filter before export (6) takes the parser's parameters, and entries 7, 8, 12 and the sweep keep their own after.
- Decision (2026-10-05, validation): CAP-16 added to this epic's covers; its part is the release and deploy of this epic (entry 11), as entries already cited it.
- Decision (2026-10-05, user): Accounts groups are Cash = transaction + offset, Savings = savings, Cards = credit_card, Loans = home_loan, Investments = brokerage + super, Other = vehicle + other, and Properties is a separate card; the "% repaid" caption and "Add loan by hand" go to epic-loans-property, import provenance and the stale row's Import shortcut to epic-import-dedupe-transfers.
- Decision (2026-10-05, user, exemption): this epic ships before the axe harness exists (it arrives in epic-app-shell-settings-theming, 13), so its Done-when has no axe check; epic 13's Done-when axe check covers this epic's routes, and `/transactions`, `/accounts` and `/accounts/:id` must pass it there.
- Decision (2026-10-05, validation): entry 2 owns the CSP nonce wiring and a CSP e2e check for popover, sheet and toast; entries 3 and 12 reach it through after. Entry 2 renders the date-range control in its own page header until epic-app-shell-settings-theming's shell header takes it over.
- Decision (2026-10-05, user): the transaction list shows page numbers, "Showing X of N · Page p of P", from a server-side total count alongside keyset paging; page jumps use OFFSET on the same sort [ASSUMPTION], and entry 8's 300 ms first-page budget includes the count query (entries 2 and 8).
- Decision (2026-10-05, user): a hidden-name row is excluded from the partner's search entirely, by name, amount, notes or any field; the owner still finds it (entries 5 and 7; spec data-model and decisions updated).
- Decision (2026-10-05, user): epic-app-shell-settings-theming owns the Re-auth dialog; entry 6's export uses the existing inline ReauthRequired pattern until it ships.
- Decision (2026-10-05, validation): the audit-log read filters account rows through visibleAccounts, shows person-scoped rows only to that person, and shows rows with neither to both (AD-3, AD-22); entry 4 no longer waits on 2.8 directly.
- Decision (2026-10-05, validation): wiring the Needs review chip and the summary line's "N need review" link, the Import button beside the Transactions search, account freshness moving from posted_on to import_batch, import provenance and the stale row's Import shortcut go to epic-import-dedupe-transfers.
- Assumption (2026-10-05): account freshness comes from the newest `posted_on` per account until `import_batch` exists (epic-import-dedupe-transfers); the nav badge counts the viewer's uncategorised rows.
- Deferred (2026-10-05, validation): CAP-18's "clears a review-inbox item" is not part of this epic's journey (entry 10, Done-when 2); it goes to epic-import-dedupe-transfers, which builds the review inbox.
- Known uncertainty (2026-10-05, validation): entry 12's Undo re-applies the prior value through setSplitField, which rewrites provenance to source: user rather than restoring the prior source; either add an undo use case restoring value and source, or accept the change. Bulk writes are per row, so a partial failure is possible and is reported by row.
- Handoff (2026-10-05, epic 2 retro): entry 9 (refactor sweep) also takes epic-ledger-accounts-privacy's retro deferrals A2–A8, I8 and P10 (import cycle, shared Zod inputs, one private-owner lookup, splitting app.ts and memory-uow.ts, rules into domain, use-case test convention, memory-UoW privacy duplication, explicit needs_review registration, system-viewer scope guard).
- Handoff (2026-10-05, epic 2 retro): entry 4 (account screens) surfaces 2.15's new refusals: removing another owner, setPrivacy(private) with a partner beneficiary split, and setPrivacy(public)'s Conflict naming the scoped references and the owners; entry 6 (audit API) respects decision 80, so private-era audit rows stay owner-only through the person_id 2.15 stamps.
