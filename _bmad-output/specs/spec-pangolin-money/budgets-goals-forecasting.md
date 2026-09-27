# Budgets, bills, goals and forecasting

Everything here is derived from splits on read. There are no stored running totals to drift out of sync, and SQLite handles the aggregation for our volume (tens of thousands of rows) in milliseconds.

## Budgets

- A budget has a period (`fortnight` or `month`) and an `anchor_date`. Each person has their own payday anchor. Personal budgets follow it; shared budgets use a household anchor, an explicit setting (suggested at setup: whichever of our paydays comes first).
- Scope is either shared or one person. Shared budgets count splits marked shared, whoever paid. Personal budgets count that person's own splits.
- **Spent** is the sum of that category's (or group's) splits in the current period.
- **Pace** compares spent against a straight line across the period.
- **Projected** is spent plus the trailing daily rate × days remaining.
- Rollover is optional per budget; unspent or overspent amounts carry into the next period.

## Recurring bills

- Detection groups by payee, then tests intervals: weekly, fortnightly, monthly, quarterly, annual. A candidate needs at least 3 occurrences, a stable median interval, and amounts within a tolerance.
- Candidates appear for one-click confirmation. Confirmed series predict the next due date and amount.
- They raise alerts for a missed payment, or an amount up more than 10%. Price rises are where the easy savings are.

## Goals and savings allocation

- **Savings** = the combined balance of accounts flagged as savings (each person has their own, plus shared ones). Investments (brokerage, super) are tracked separately and never count as savings. A period's new savings = the change in that balance, excluding interest. Surplus (income − expenses) is still reported in cash flow, but doesn't drive goals.
- At each period close, positive new savings are split by `goal_rule` shares (e.g. 20% house deposit, 30% holidays) into `goal_allocation` rows. Whatever isn't allocated stays as a buffer. A deficit period draws down only that buffer; goal balances never decrease because of overspending.
- Goals are virtual: there's no account per goal. Shared goals draw on shared savings accounts; personal goals draw on that person's. A goal can be linked to an activity (e.g. "Japan Trip 2026"); the goal goes down only when money is withdrawn from its pool's savings account and linked to it, never directly from card spending.
- Projected completion date = remaining target ÷ average allocation over the last 6 periods.

## Shared spending and who paid

- Every split has a beneficiary: shared, or one of us.
  - Spending from a shared account defaults to shared.
  - A purchase from a personal account can be marked shared, e.g. groceries on one person's card.
- The payer comes from the account's owner.
- **Contribution:** each person's contribution to shared costs = their transfers into shared accounts + shared expenses they paid personally.
- **Reports:** reports show where all our money goes. Each person's share of shared spending is apportioned by contribution share over the period (50/50 is a setting), so the percentage attributable to each of us is always visible.
- This is the groundwork for v1.1's partner settlement.

## Goal priorities and stages

- Goals are grouped into ordered allocation stages. One stage is active at a time, and its `goal_rule` shares decide the split. For example:
  - Stage 1, "Emergency fund first": 80% emergency fund, 10% house deposit, 10% holidays.
  - Stage 2, "Build": 60% house deposit, 40% holidays.
- A stage ends when its exit goal is fully funded.
  - In that period the emergency fund takes only what it still needs.
  - The rest is split using the next stage's shares, so no savings sit idle.
- When a goal reaches its target it is flagged complete and gets nothing more. Its share is spread across the stage's remaining goals by default. We're also prompted to review the allocations, and can accept the rescaled split or set new percentages.
- **Falling back:** spending from the emergency fund is recorded by linking the transaction to that goal.
  - If its balance drops below 80% of target, stage 1 reactivates until it's topped up.
  - The threshold stops small withdrawals from flipping stages back and forth, and it's configurable.
- The emergency fund target can be a fixed amount or "N months of essential spending". The latter is recalculated each period from fixed-cost categories over the last 12 months.
- Every stage change is logged. The goals page shows the active stage and a projected date for the next change.

## Reconciling goals with the savings account

Goal money sits in the savings-flagged accounts. Pangolin checks each period, and after every import, that the books and the bank agree:

- **Invariant:** for each pool (shared, or one person's), goal balances + unallocated buffer = total balance of that pool's savings accounts.
- **Over-committed:** when withdrawals exhaust the buffer, goals exceed the real balance. That's the case the buffer-only overspending option can hide, so it's always shown in red on the goals page and in the review inbox, with the shortfall.
- **Mismatch:** any other gap (e.g. an account newly flagged, or history not yet imported) raises a warning and offers to put the difference into the buffer.
- **Interest:** interest earned goes to the buffer by default.
- **Closed periods:** a period's allocations never change once closed; a backdated import or edit that changes its savings becomes an audited adjustment to the current period's buffer.

## Forecasting

- **Cash flow:** known pay cycles + confirmed recurring bills + budgeted discretionary spend, projected 3–12 months ahead per account, with a low-balance warning.
- **Net worth:** today's assets and liabilities projected forward. Savings rate, return assumptions (low, mid, high), mortgage amortisation with offset, and super contributions are all shown as explicit editable assumptions.
- A Monte Carlo band can come later; the assumptions matter more than the method.
