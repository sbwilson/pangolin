---
type: epic
title: "Loans and property"
parent: initiative-pangolin-money-v1
covers: [CAP-20, CAP-11]
after: []
assignee: ""
risk: medium
---

# Loans and property

## Description

Every loan gets its terms, rate changes and user-entered interest per period, a balance over time (actual, projected, with extras), interest paid and still to pay, a payoff date, and the effect of capped extra repayments and of the offset balance; its schedule is estimated from its terms and corrected by the entered interest. A property links its value account, loan account, rental income and costs, and shows value, equity, LVR, net cash per month and per FY (rent − entered interest − running costs, with principal shown apart) and a gearing label. Loans can be added by hand. Milestone M3. The spec's CAP-20 and CAP-11 own the detail.

## Outcome

Each of us sees what our loans cost and what our properties really earn, from figures we entered off our own statements; CAP-20's and CAP-11's hand-checked seeds are the signal.

## Done when

1. A seeded loan's projected payoff, and the interest saved by a given extra repayment (capped at the yearly limit) and by a larger offset, match a hand amortisation. Principal and interest are shown only for periods with entered interest.
2. A loan is added by hand (name, lender, type, rate, term, start, balance, ownership split), its rate changes and per-period interest are entered from a statement, and Loan detail redraws its estimated schedule from them.
3. A seeded property's rent, entered interest and costs produce the documented net cash (this FY to date, last FY), LVR and gearing label. Months without entered interest show interest as missing, never estimated, and principal is never counted in net cash. A part-owner sees whole-property figures with a "Your share (X%)" line; a non-owner sees whole-property figures only.
4. A property is hidden from the partner when its value or loan account is private, and the loan and property routes join the server-side privacy suite.
5. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

`loan_terms`, `loan_rate_change` and `loan_interest_entry` in `accounts`; the `property` table and the foreign key on `split.property_id`; loan schedule maths in `domain/amortise`, extending what epic-forecasting builds there; Add loan ("Add loan by hand"), Loan detail, Property detail, the "% repaid" caption on the Accounts › Loans row, and the Properties card on Accounts (epic-ledger-workspace leaves a placeholder). Not automatic interest/principal splitting of imported repayments (a spec non-goal; repayments stay a simple expense in cash flow, AD-23). Not the home buying planner's equity and sell maths (epic-home-buying-planner). Not the rental schedule in the tax pack (epic-tax-activities-property reads this epic's net cash). Not importing a lender's repayment plan (later work, see Notes).

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-11, CAP-20, and Non-goals (automatic interest/principal splitting)
- property — _bmad-output/specs/spec-pangolin-money/investments-super-tax.md, section Investment property
- data model — _bmad-output/specs/spec-pangolin-money/data-model.md, Tables (Accounts `loan_terms`, `loan_rate_change`, `loan_interest_entry`; Property `property`)
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-3, AD-5, AD-11, AD-13, AD-19, AD-22, AD-23, and Capability → Architecture Map (CAP-11, CAP-20)
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Loan Detail, Property Detail, State Patterns (Accounts & loans), Flow 2
- design — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md, section Components (Accounts & loans)
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-loan-detail.html, key-property-detail.html, key-accounts.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, sections 4.1 Decisions (D1, D3, D6) and E-10

## Notes

- Decision (2026-10-05, D3): CAP-11 property view moves here from epic-tax-activities-property, alongside CAP-20; reverses the 2026-09-27 placement.
- Decision (2026-10-05, D1): only automatic interest/principal splitting is a non-goal; interest is user-entered per period, and property net cash takes it from `loan_interest_entry`, not from repayment splits (AD-23).
- Decision (2026-10-05, D6): no lender repayment-plan import in v1 and no `loan_plan_row` table; the schedule is estimated from terms and corrected by entered interest.
- Decision (2026-10-05, G2): a non-owner sees whole-property figures; a part-owner also sees a "Your share (X%)" line.
- Later work (beyond v1): import a lender's repayment plan to replace the estimated schedule (no file format defined; D6, 2026-10-05).
- Handoff (2026-10-04, epic 2 inception; moved from epic-tax-activities-property 2026-10-05): `split.property_id` is created nullable with no foreign key by epic-ledger-accounts-privacy; this epic adds the `property` table and the foreign key.
- Assumption: epic-llm-categorisation-pdf's `row_interpret` ships transaction proposals only; the loan rate-change proposal target is wired here, once `loan_rate_change` exists.
- Waits on epic-spending-insight because: the net-worth page and report queries carry loans and properties.
- Waits on epic-ledger-accounts-privacy because: loans and properties hang off accounts and their owners and shares.
- Waits on epic-forecasting because: it builds `domain/amortise`, which this epic extends for the loan schedule.
- Waits on epic-llm-categorisation-pdf because: it builds `row_interpret` purpose, to which this epic adds the loan rate-change target.
