---
type: initiative
title: "Pangolin Money v1: our household finances on our own server"
parent: none
covers: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17, CAP-18, CAP-19, CAP-20, CAP-21]
after: []
assignee: ""
risk: high
---

# Pangolin Money v1: our household finances on our own server

## Description

A self-hosted web app for two people that shows where the money goes, what can be saved, and how goals are tracking. It covers everyday banking, investments, super and an Australian tax pack. Our SQLite database is the single source of truth. The spec owns the capabilities, constraints and non-goals; this initiative delivers all of them through milestones M0–M4.

## Outcome

Both of us run our finances from Pangolin Money instead of spreadsheets, with every figure traceable to imported bank data. The spec's success signal, expressed as the milestone gates, is the measure.

## Done when

1. A fresh install on the Debian VM reaches first login in one command, and the restore test passes in CI on every release (M0 gate).
2. Twelve months of our real data are imported with no unexplained balance gaps (M1 gate).
3. We use it weekly instead of the spreadsheets (M2 gate).
4. One full budget cycle is tracked for both of us, and the home buying planner works on our real data (M3 gate).
5. Each of us has an FY tax pack whose totals match a hand check. It covers deductions, investment income, capital gains and super contributions against caps.
6. No private account or hidden transaction name has reached the other partner, and no data has gone outside the outbound allowlist.
7. Every surface passes the WCAG 2.2 AA automated check.

## Boundaries

Capability boundaries, ordered by milestone. Each milestone gate is the Done-when of the last epic in that milestone: M0 epic-platform-foundations, M1 epic-import-dedupe-transfers, M2 epic-llm-categorisation-pdf, M3 epic-home-buying-planner. Not in scope: everything in the spec's Non-goals, including partner settlement (v1.1). Tracer path: install → passkey login → import one CommBank OFX → see it in the privacy-aware ledger → see it in the cash-flow Sankey.

- Touch point: Nginx Proxy Manager — a proxy host entry and rate limits, no code; owner: epic-platform-foundations
- Touch point: TrueNAS restic REST server — an append-only repository; owner: epic-platform-foundations
- Touch point: Tang server — network-bound unlock for the LUKS data disk; owner: epic-platform-foundations
- Touch point: GHCR — signed images pulled with a read-only token; owner: epic-platform-foundations
- Touch point: CommBank NetBank — a person exports pre-FY2026 history; owner: epic-import-dedupe-transfers
- Touch point: Ollama on the LAN GPU machine — model pulled and endpoint configured; owner: epic-llm-categorisation-pdf
- Touch point: Yahoo Finance, issuer NAV pages, QSuper and Aware unit-price pages — read-only fetches on the allowlist; owner: epic-investments-super

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, section Capabilities
- constraint — _bmad-output/specs/spec-pangolin-money/SPEC.md, section Constraints (privacy, outbound allowlist, single writer, integer money, WCAG 2.2 AA)
- milestones — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, section Milestones
- diagrams — _bmad-output/specs/spec-pangolin-money/architecture-diagrams.md
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, all ADs
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md and DESIGN.md
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, section 4.4 Epics and stories

## Notes

- Decision: 10 epics along capabilities, grouped by milestone; not one epic per milestone (user's decision, 2026-09-27). The count was 10 at 2026-09-27 and is 15 after 2026-10-05.
- Superseded (2026-10-05): ~~Decision: investment property (CAP-11) goes with the tax pack, not with insight (user's decision, 2026-09-27).~~
- Decision (2026-10-05, correct course after UX): CAP-11 moves to epic-loans-property (14), alongside CAP-20; new epics 13 (app shell, settings, theming), 14 (loans and property) and 15 (home buying planner). The M3 gate moves to epic 15. Lender repayment-plan import is deferred beyond v1. Every UI epic's Done-when includes 'axe e2e clean on its routes' (WCAG 2.2 AA), except epic 12 (epic-ledger-workspace), which ships before the axe harness; epic 13's Done-when axe check covers its routes (`/transactions`, `/accounts`, `/accounts/:id`).
- Decision (2026-10-05, after approval): the M3 gate on epic-home-buying-planner keeps both checks: one full budget cycle tracked for both of us, and the home buying planner works on our real data.
- Decision: the cross-epic contracts are to be settled in an architecture spine by bmad-architecture, not as stories in the opening epic (user's decision, 2026-09-27).
- Decision: the four cross-epic contracts are settled in the architecture spine (final, 2026-09-27): (a) AD-3, AD-4, AD-22; (b) AD-8, AD-9; (c) AD-15; (d) AD-14. Each epic cites the ADs it adopts.
- Shared: CAP-1 splits between epic 3 (non-PDF bank formats), epic 5 (PDF) and epic 9 (CMC Invest confirmations). CAP-2 splits between epic 3 (rules, payee default, review inbox) and epic 5 (LLM suggestions). CAP-14 splits between epic 2 (beneficiary on each split) and epic 4 (contribution apportionment in reports). `domain/amortise` is shared by epic 8 (mortgage amortisation in the net-worth projection) and epic 14 (the loan schedule); epic 8 builds it first and epic 14 extends it. CAP-21 splits between epic 13 (shell, Settings page, themes), epic 5 (LLM providers card) and epics 4 and 6 (Settings › Household controls). CAP-3 splits between epic 2 (privacy core) and epic 12 (the workspace's surfaces on it). CAP-18 splits between epic 2 (privacy path), epic 12 (the workspace) and epic 3 (the review inbox). CAP-15 splits between epic 1 and epic 11. CAP-16 splits between epic 1, epic 11 and each epic's release entry.
- Raise with Architect: AD-25 Binds should include epic 15 (epic-home-buying-planner reads pay_anchor gross and net pay).
