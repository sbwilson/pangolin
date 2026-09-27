---
type: initiative
title: "Pangolin Money v1: our household finances on our own server"
parent: none
covers: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17, CAP-18]
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
4. One full budget cycle is tracked for both of us (M3 gate).
5. Each of us has an FY tax pack whose totals match a hand check. It covers deductions, investment income, capital gains and super contributions against caps.
6. No private account or hidden transaction name has reached the other partner, and no data has gone outside the outbound allowlist.

## Boundaries

Capability boundaries, ordered by milestone. Each milestone gate is the Done-when of the last epic in that milestone. Not in scope: everything in the spec's Non-goals, including partner settlement (v1.1). Tracer path: install → passkey login → import one CommBank OFX → see it in the privacy-aware ledger → see it in the cash-flow Sankey.

- Touch point: Nginx Proxy Manager — a proxy host entry and rate limits, no code; owner: epic-platform-foundations
- Touch point: TrueNAS restic REST server — an append-only repository reached over WireGuard; owner: epic-platform-foundations
- Touch point: Tang server — network-bound unlock for the LUKS data disk; owner: epic-platform-foundations
- Touch point: GHCR — signed images pulled with a read-only token; owner: epic-platform-foundations
- Touch point: CommBank NetBank — a person exports pre-FY2026 history; owner: epic-import-dedupe-transfers
- Touch point: Ollama on the LAN GPU machine — model pulled and endpoint configured; owner: epic-llm-categorisation-pdf
- Touch point: Yahoo Finance, issuer NAV pages, QSuper and Aware unit-price pages — read-only fetches on the allowlist; owner: epic-investments-super

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, section Capabilities
- constraint — _bmad-output/specs/spec-pangolin-money/SPEC.md, section Constraints (privacy, outbound allowlist, single writer, integer money)
- milestones — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, section Milestones
- diagrams — _bmad-output/specs/spec-pangolin-money/architecture-diagrams.md

## Notes

- Decision: 10 epics along capabilities, grouped by milestone; not one epic per milestone (user's decision, 2026-09-27).
- Decision: investment property (CAP-11) goes with the tax pack, not with insight (user's decision, 2026-09-27).
- Decision: the cross-epic contracts are to be settled in an architecture spine by bmad-architecture, not as stories in the opening epic (user's decision, 2026-09-27).
- Open question: the spine must settle four contracts before the epics that adopt them are incepted: (a) the `visibleAccounts()`/`redact()` contract, (b) the job table and runner contract, (c) the seed-generator extension format, (d) period, payday-anchor and FY helpers. Adopters: (a) epics 2–5 and 9–10, (b) epics 1, 5, 6 and 9, (c) all epics, (d) epics 6–8 and 10.
- Shared: CAP-1 splits between epic 3 (all non-PDF formats) and epic 5 (PDF). CAP-2 splits between epic 3 (rules, payee default, review inbox) and epic 5 (LLM suggestions). CAP-14 splits between epic 2 (beneficiary on each split) and epic 4 (contribution apportionment in reports).
