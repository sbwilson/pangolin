---
id: 1
type: story
title: "Tracer bullet: PayAnchor, PayCalendar resolution, and Household Settings"
parent: epic-budgets-bills
covers: [CAP-4]
after: [4.4]
hitl: false
risk: high
---

# Tracer bullet: PayAnchor, PayCalendar resolution, and Household Settings

## Description

Implements the pay_anchor schema, migration, and pay-deposit detection, connects PayCalendar resolution in shared/period with Clock support, and adds pay cadence, personal anchor, and household pay anchor controls to the Settings › Household card.

## Requirements

Verify: Unit and component tests verify payday detection from deposits and calendar fallbacks, and Settings updates pay cycles and household anchor correctly.

## References

- parent — _bmad-output/initiative-pangolin-money-v1/tickets/epic-budgets-bills/epic-budgets-bills.md
