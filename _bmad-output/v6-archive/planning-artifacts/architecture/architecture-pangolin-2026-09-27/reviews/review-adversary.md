---
type: architecture-review
lens: adversary (compliant-but-incompatible pairs)
target: ../ARCHITECTURE-SPINE.md
reviewed: '2026-09-27'
inputs:
  - ../../../../initiative-pangolin-money-v1/tickets.toml
  - ../../../../initiative-pangolin-money-v1/epic-*/epic-*.md
  - ../../../../specs/spec-pangolin-money/SPEC.md (+ data-model, budgets-goals-forecasting, investments-super-tax, categorisation, import-pipeline, decisions)
verdict: 'Not yet a build substrate: the spine controls how code is layered and who writes which table, but not what shared concepts mean. Sixteen pairs of epics can obey every AD and still build incompatibly, and two of those pairs leak private data.'
---

# Adversarial review: ARCHITECTURE-SPINE (Pangolin Money v1)

## Verdict

**Hold. Tighten the spine before any epic from M2 onward starts inception.** The layering (AD-1/2/3/4/10) is strong. Once the ownership map exists, two epics can't both write one table. The holes sit one level up. The spine says *who writes* a row but not *what shared concepts mean*: "is this spending?", "whose split is this?", "which pool is this account in?", "what is a payday?", "what does a snapshot on date D include?", and "who can see a person-scoped plan?". Each of these is computed by at least two epics, and every AD allows each epic its own definition. Two pairs (P1 and P7) produce privacy leaks that meet every AD, and so defeat the purpose of AD-3/AD-7.

Severity scale: **Critical** means a privacy leak or wrong money that no test catches until the M-gate. **High** means two epics' code cannot be merged without one of them being rewritten. **Medium** means rework or a silent inconsistency that can be contained.

## Summary table

| # | Sev | Units in conflict | Hole | Fix (AD) |
| --- | --- | --- | --- | --- |
| P1 | Critical | E7 goals vs E2 privacy (AD-3/AD-17); also E6 personal budgets | Person-scoped planning rows (personal pool, goal_allocation, personal budget, pool-shortfall review_item) are not visibility-scoped, so the partner can see figures derived from private savings | New AD-22: person-scoped planning visibility |
| P2 | Critical | E3 transfers vs E4 reports vs E6 budgets vs E8 forecast vs E10 property vs E9 contributions | "Excluded from spending" is defined three ways (transfer_group, the "Transfers" category group, counterpart account type), and mortgage repayments, credit-card payments, brokerage buys and super contributions each come out differently | New AD-23: one `flowKind(split)` classifier in `domain` |
| P3 | High | E3 transfer matching vs E4 contribution (AD-4 vs AD-7) | Matching scope is unspecified by viewer, and contribution needs the owner of a private counterpart that AD-7 says must not be read | Tighten AD-4/AD-7: matching under `SystemViewer`; contribution reads only the shared-side `performed_by` |
| P4 | High | E7 goal draw-down vs E10 activities (goal_link vs activity) | Two representations of goal↔activity, plus a double decrement against the reconciliation invariant | New AD-24: goal draw-down is only a linked withdrawal from a pool savings account |
| P5 | High | E6 recurring_series vs E8 forecast vs E9 Payday Super (plus E6 PayCalendar) | Salary can be a confirmed recurring_series and a pay cycle at the same time; no owner for expected gross/SG; E9 is not ordered after E6 | New AD-25: income model, and add the E9→E6 edge |
| P6 | High | E2 split editing vs E3 review_item vs E5 suggestion (plus `transaction.needs_review`) | Three "needs attention" states for one split, split IDs that don't survive an edit, and suggestions that never close | Tighten AD-10/AD-17: kind registry, state-derived resolution, stable split IDs |
| P7 | High | E2 account ownership (`share_bp`) vs E7 pools vs E4 net worth | "Shared pool" vs "person's pool" is not a function of `account_owner`; a jointly owned or private-joint savings account lands in different pools in different epics | New AD-26: `accounts.poolOf(account)` |
| P8 | High | Seed modules of E6/E7 vs E3's file emission (AD-15) | Two modules emitting separate statement files for one account create contradictory closing-balance snapshots | Tighten AD-15: the world owns per-account statement rendering |
| P9 | Medium-High | E3 reconcile vs E7 reconciliation vs E10 valuations (AD-19) | `balance_snapshot` as_of semantics and source precedence are undefined; balances snap to statements and hide the gaps that E3 and E7 must report | Tighten AD-19 |
| P10 | Medium-High | E2 `split.property_id` vs E10 property (AD-3/AD-5) | A split visible to the partner can point to a property scoped by a private loan account; a paid-off property has no scope | Tighten AD-3 property rule |
| P11 | Medium | E6 budget `anchor_date` vs E7 PayCalendar periods (AD-14) | The same "this fortnight" differs between budgets and goals; budget rollover recomputes when deposit detection changes | Tighten AD-14 |
| P12 | Medium | E6 budgets vs E8 forecast | Budgets have no account, but the forecast is per account; bill categories are double-counted | New rule in AD-25 or its own AD |
| P13 | Medium | E9 caps vs E10 thresholds/WFH (system owns `fy_config`) | Two shapes for one table; carry-forward needs 5 prior FYs of config and prior-30-June TSB | Tighten AD-10 `fy_config` |
| P14 | Medium | E2 soft delete vs E3 dedupe vs E4 reports vs E9 lot rebuild | Tombstone vs filter semantics per epic | New convention row, or AD-3 addition |
| P15 | Medium | E3 epic (CMC in its format list and DoD) vs AD-10 (E9 owns CMC) | Two owners of one parser and one DoD sample | Fix the epic text; the AD is right |
| P16 | Medium | E1 restore / admin socket vs E5/E9 outbox handlers | A restored DB resurrects pending and leased jobs; external effects (SMTP, LLM spend, logo fetches) repeat | Tighten AD-8/AD-16 |

---

## P1 — Person-scoped planning data leaks private savings (Critical)

**Unit A: E7 story "Goals page and reconciliation".** AD-3 scopes only tables with a direct or transitive `account_id`. `goal`, `goal_rule`, `goal_allocation`, `allocation_stage`, `budget` and `pay_anchor` have none. E7 obeys the letter: it reads savings balances through `balanceAsOf(viewer, …)`, but runs period close as a `local`-lane job under `SystemViewer` (allowed by AD-6/AD-8). The personal pool of Partner B includes B's private savings account, so the job writes `goal_allocation` rows equal to shares of B's *private* new savings. The goals page lists all goals, since these tables are unscoped, and shows B's allocations to A. A can back out B's private savings deltas exactly (Σ shares = new savings − buffer).

**Unit B: E7 reconciliation raising a review item.** The personal-pool shortfall is a pool-level condition with several accounts, so E7 raises it with `person_id = B` and no `account_id`. AD-17 says "Items with no account … are visible to both partners." So A sees "B's savings over-committed by $1,240". That is a private balance, delivered by an AD.

**Same shape in E6:** B's personal budget "spent" is summed under whichever viewer loads it. Loaded by A, it silently excludes B's private-account splits and shows a different number from the one B sees. Loaded under `SystemViewer` for an alert, it includes them and leaks them through the `review_item` text.

**Fix — new AD-22 "Person-scoped planning rows follow the person":** `budget` (scope = person), personal goals, their `goal_rule`/`goal_allocation`/`stage_event`, the personal pool's review items, `pay_anchor` and `forecast_assumption` rows owned by a person are visibility-scoped by `person_id`: only that person sees them, and any other viewer gets `NotFound` (AD-5 applies). A job computing person-scoped figures must pass `Viewer(person)`, never `SystemViewer`. Amend AD-17: an item with `person_id` and no `account_id` is visible to that person only; "visible to both" applies only when both are null.

## P2 — "Is this spending?" has three answers (Critical)

The spec gives two independent signals: `transaction.transfer_group_id` (E3 matching) and the category group "Transfers (not spending)" (Between our accounts, Credit card payment, To savings, To investments). Nothing in the spine says which one decides, or how the counterpart account's type affects the answer.

- **E4 (reports and Sankey)** excludes splits whose category group is the Transfers group. A category is the user's statement of intent, and it works for unmatched transfers.
- **E6 (budgets and recurring detection)** excludes `transfer_group_id IS NOT NULL`. It is deterministic and survives recategorisation.

Concrete divergences, each compliant on both sides:

1. An ambiguous transfer sits in review, unlinked, and a rule has categorised it "Between our accounts". E4 excludes it and E6 counts it: the budget is blown by a savings sweep.
2. **Mortgage repayment:** checking → `home_loan` account. E3 auto-links it as a transfer (opposite amount on another of our accounts). The spec says repayments are "a simple expense" (Housing › Mortgage repayments; Investment property › Loan repayments), and E10's property view counts them. Under E6's rule the repayment disappears from spending, under E4's it appears, and E10 counts it either way. The P&L and property view disagree.
3. **Credit-card payment:** also a linked transfer, but it *must* be excluded, or card spending is counted twice. The only thing that separates it from case 2 is the counterpart account's `type`, and no AD says that.
4. **Brokerage buy / personal super contribution:** a CMC settlement debit or a BPAY to a super fund has no counterpart *transaction*. Brokerage and super accounts hold `investment_event`/`contribution` rows, not transactions, so it can never join a `transfer_group`. E6/E8 count it as spending. E9 also records it as an event or contribution, and E4's net worth then moves twice.

**Fix — new AD-23 "One flow classifier":** `domain.flowKind(split, txn, counterpartAccountType?, categoryGroupKind)` returns `spend | income | internal | liability_repayment | investment_out | investment_in`, from one table owned by `domain`. Every sum of "spending" or "income" (E4, E6 budget and detection, E7 new savings, E8, E10 property and activity rollups) filters on it in SQL, through a repository fragment like `visibleAccounts`. Rules: a linked transfer to `credit_card` is `internal`; one to `home_loan` is `liability_repayment`, which counts as expense per the spec and is labelled as such. A transfer category without a link is `internal` and appears in review as unlinked. A debit matched to an `investment_event`/`contribution` on the other side is `investment_out`, and E3/E9 link it (extend `transfer_group` to hold an event or contribution as the other side, or add `transfer_group.counterpart_ref`). Category groups get a system `kind` (`income`, `expense`, `transfer`, `investment_property`) that survives renaming, since the spec lets users rename or merge categories.

## P3 — Transfer matching scope vs contribution attribution (High)

**E3** runs the import and transfer matching as the uploading person's `Viewer` (AD-3: "every use case takes a Viewer"). Partner A imports the shared account. The inbound $800 from B's private account has no visible candidate, so it stays unmatched. Next week B imports the private account, and the match now happens, but only if B's import re-scans A's earlier unmatched rows. Result: the link depends on import order.

**E4** computes contribution ("transfers into shared accounts + shared expenses paid personally"). AD-4 says the private-counterpart transfer "still counts towards the owner's contribution". AD-7 says contribution percentages are shared figures "computed only from non-private accounts". To attribute the $800 to B, E4 must read the counterpart account's owner, which is private data, or leave it unattributed and break AD-4. Both options comply with one AD and violate the other.

**Fix:** tighten AD-4/AD-7. (a) Transfer matching is a system-level step: candidates come from all accounts under `SystemViewer`, inside the `imports` use case, and results are exposed only through `redact()`. Unmatched rows are re-evaluated whenever any account imports. (b) At link time, `ledger` stamps the shared-side transaction's `performed_by` with the counterpart owner (the column already exists in data-model). Contribution reads only `performed_by` on the shared-side rows, so it never touches the private account. For unlinked inbound credits, `performed_by` is set by the user or left null ("unattributed"), and E4 shows unattributed amounts separately.

## P4 — Goal↔activity: two link models and a double decrement (High)

The ownership map puts `goal_link` in `planning` (E7) and `activity` in `classify` (E10). The spec says "A goal can be linked to an activity, so spending on 'Japan Trip 2026' draws its balance down", and that emergency-fund spending is "recorded by linking the transaction to that goal".

- **E7** builds `goal_link(goal_id, transaction_id | activity_id)` and computes goal balance = Σ allocations − Σ linked spending.
- **E10** owns `activity` and adds `activity.goal_id` (its own table, so AD-10 is satisfied), so the activity page can show "funded by goal". The link now lives in two places that can disagree.

**Money is wrong too.** Trip spending goes on a credit card, so the goal drops by $3,000 at posting. The savings account hasn't moved, so the reconciliation invariant (goals + buffer = savings balance) breaks and E7 raises a false "mismatch". Next week the couple sweep $3,000 from savings to pay the card. New savings for that period is −$3,000, and option A draws it from the buffer, *again*. The goal has been debited once and the buffer once, so the invariant is now $3,000 off in the other direction. No AD says what a goal-funded withdrawal is.

**Fix — new AD-24 "Goal draw-down is a pool withdrawal":** a goal balance decreases only by a `goal_link` from that goal to a split that is an outflow from one of the pool's savings accounts (normally the savings side of a transfer). `planning` owns the link; `activity` carries no goal pointer, and the activity page reads `goal_link`. Period close computes new savings *excluding* goal-linked withdrawals, so option A's buffer draw doesn't double count. Linking an activity to a goal is a UI convenience that proposes `goal_link`s for the matching savings withdrawals and never debits on the spend splits. Interest (which goes to the buffer) is identified by `flowKind` (AD-23) or a system category kind, never by category name.

## P5 — Income: pay cycles, recurring series and Payday Super (High)

- **E6** builds recurring detection per the spec: group by payee, test intervals, ≥3 occurrences. Salary matches perfectly, so it becomes a candidate. The user confirms it (nothing forbids it), and it is a `recurring_series` with positive `expected_cents`. E6 also builds pay-deposit detection for `PayCalendar` (AD-14), a *second* model of the same deposits.
- **E8** projects "known pay cycles + confirmed recurring bills". It takes income from pay anchors *and* all confirmed series, so salary is counted twice. Or it takes only negative series and drops real recurring income (rent received into the rental property's account).
- **E9** Payday Super needs, per payday, the *expected SG* = SG rate × ordinary-time earnings. No table holds gross pay. E9 can't write `pay_anchor` (owned by `planning`), so it adds `super_expectation(person_id, gross_cents, rate)` in its own module (compliant). If E6 later adds a salary amount to `pay_anchor` for the forecast, there are two salary figures.
- **Ordering:** tickets.toml orders E9 after E1/E2 only, not E6. E9 can ship Payday Super on `calendar` alignment (AD-14 allows it). When E6 lands deposit alignment, past paydays move by a day or more. The SG-gap `review_item`s keyed on the old payday dates are orphaned, and new ones are raised for the same gaps.

**Fix — new AD-25 "One income model":** `planning.pay_anchor` holds per person `expected_net_cents`, `expected_gross_cents` (or an OTE basis) and the deposit account. It is the only source of salary for E8 and of expected SG for E9, and SG rates come from `fy_config`. `recurring_series` gets `direction` (`bill | income`), and detection skips payees already bound to a pay anchor. Payday Super keys its review items on `(person_id, period_start)` from the resolved `PayCalendar` and resolves stale ones when the calendar is recomputed. Add `after = [{ epic = 6, needs = "PayCalendar with deposit alignment and pay_anchor amounts" }]` to epic 9 in tickets.toml, or state that E9 builds on calendar alignment only and that the keys are period-based.

## P6 — Review lifecycle: `needs_review`, `review_item`, `suggestion`, split IDs (High)

- **E2** builds `transaction.needs_review` (it is in data-model) and a "Needs review" filter in the ledger UI. When a user sets a category it calls `ledger.setSplitField(category, x, user)`, which is enough to comply with AD-10.
- **E3** raises `review_item(kind = 'uncategorised', entity_ref = split:…, dedupe_key = 'uncat:'+splitId)` through `system.raiseReviewItem` (AD-17).
- **E5** writes a `suggestion(source = llm)`, auto-applies it above the threshold via `setSplitField(…, llm)`, and marks the suggestion `applied`. It does not know E3's dedupe_key format, so the "uncategorised" item stays open.
- **E2's split editor** replaces one split with two by delete-and-recreate, which is a common pattern and violates no AD. The `suggestion.split_id`, the E3 review item's `entity_ref`, `split_tag` and the provenance now reference dead IDs. When the user edits a field directly, E5's pending suggestion is never closed, so the acceptance rate that tunes the auto-apply threshold (CAP-2) is computed from wrong outcomes.

The result is three inboxes that disagree, a badge count that never reaches zero, and a threshold tuned on corrupted data.

**Fix:** tighten AD-17 and AD-10. (a) A **review-kind registry** in `shared`: `kind` → owning module, `entity_ref` type, `dedupe_key` format, and a *resolving condition*. Condition-type kinds (uncategorised, unmatched transfer, pending suggestion) are resolved by the entity's owner in the same transaction as the state change (for example, `setSplitField` resolves `uncategorised:{splitId}`). Drop `transaction.needs_review`, or define it as a derived read of open items. (b) `setSplitField` closes any open `suggestion` for `(split, field)` with outcome `accepted | overridden | superseded`. (c) Split IDs are stable. Re-splitting keeps the first split's ID, and the ledger use case re-points or closes every row that references a removed split (suggestion, split_tag, goal_link, review_item) in the same transaction.

## P7 — Pool membership vs `account_owner.share_bp` (High)

- **E2** allows any number of `account_owner` rows with `share_bp` (5000/5000, 7000/3000), and `is_private` independently. Nothing says a private account has exactly one owner.
- **E7** defines pools (the spec: "shared, or one person's"). A compliant reading is "`is_savings` and owner count ≥ 2 → shared pool; one owner → that person's pool".
- **E4** net worth and "by person" views apportion jointly owned balances by `share_bp` via `allocate()` (AD-13 names `share_bp`).

Now take a 70/30 jointly owned savings account. E7 treats it as fully shared, and shared goals draw on 100% of it. E4's per-person net worth assigns 70/30. That is fine as long as both are stated, but it isn't. Worse, a private account with two owners (allowed) is in the shared pool, and AD-7 says shared figures use only non-private accounts, so E7 includes it (pool rule) and excludes it (AD-7) at the same time. Also, "payer comes from the account's owner" is undefined for a joint account, and E6's "person's own splits" (beneficiary) and E10's "by person" activity rollup (payer) pick different attributes.

**Fix — new AD-26 "Pools, payer and beneficiary are functions of the account":** `accounts.poolOf(account)` returns `shared` when there are ≥2 owners and the account is non-private, `person(p)` when there is one owner, and nothing unless `is_savings`. A private account must have exactly one owner (enforced by `accounts`). `share_bp` is used only for per-person net-worth apportionment, never for pools or budgets. Define **payer** = `transaction.performed_by`, else the sole owner, else `joint`; define **beneficiary** as the split field. Every "by person" figure names which of the two it uses (budgets use beneficiary; contribution uses payer).

## P8 — Seed modules each emit statements for the same account (High)

AD-15: each epic's `SeedModule.generate` returns `{ files, expectations }`, written as real OFX/CSV. The E6 "bills" module emits `shared-offset-2025.ofx` containing the bills. The E7 "savings" module emits `shared-offset-2025-sweeps.ofx` with savings transfers for the *same account and date range*. Each file's `LEDGERBAL`/closing balance is computed from its own rows only. E3's reconcile step writes a `balance_snapshot` from each file (AD-19 sources), so two contradictory closing balances land for one account and date. `balanceAsOf` then snaps to whichever snapshot is later, and the "no unexplained balance gap" M1 check and E7's reconciliation fail on seed data through no fault of the code. The fingerprint occurrence numbers (identical rows that day) also depend on how rows were split across files. Adding a module shifts another module's expectations, which is exactly what AD-15 set out to prevent.

**Fix:** tighten AD-15. Modules contribute *world events* (postings to accounts), not files. The world model (built by E1, with renderers from E3) renders **one statement stream per account and statement period** over all modules' postings, and computes balances and occurrence numbers globally. A module's `expectations` may reference only its own postings, plus aggregates the world computes. State module ordering as a topological sort on `dependsOn`, with ties broken by name, so rendering is stable.

## P9 — `balance_snapshot` semantics (Medium-High)

AD-19: "latest snapshot on or before the date, plus the splits posted since." "Since" is undefined. E3 writes the OFX `LEDGERBAL` with as_of = statement end date, which includes that day's transactions. E2's manual-entry UI records "balance this morning", which excludes them. With "since" meaning `> as_of`, the manual snapshot loses a day's transactions; with `>= as_of`, the statement snapshot counts them twice. Also, because every snapshot re-anchors the balance, a genuine import gap (a missing week of rows) is *absorbed* at the next statement. E3's "no unexplained balance gaps" gate and E7's "mismatch" reconciliation both call `balanceAsOf` (AD-19 requires them to) and never see the gap. With several sources (statement, OFX, PDF, manual, and valuation for property), none has precedence.

**Fix:** tighten AD-19. A snapshot is an **end-of-day closing** balance (includes all splits with `posted_on ≤ as_of`). Source precedence: `statement_pdf > ofx > csv_running > manual`, and one effective snapshot per account and day. Add `accounts.balanceGap(viewer, account, from, to)`, computed as snapshot(t1) − snapshot(t0) − Σsplits. E3 reconcile and E7 mismatch use it, and `balanceAsOf` stays the display figure. Property and vehicle valuations use `source = valuation`.

## P10 — `split.property_id` vs property visibility (Medium-High)

AD-3 scopes `property` "through `loan_account_id`". **E10** makes B's investment property private by marking the loan account private (the spec: "hidden from the partner when the loan account is private"). Rent is paid into the *shared* offset account. **E2** lets B set `property_id` on that split through `setSplitField` (AD-10). A now reads a visible split whose `property_id` is a property that returns `NotFound` (AD-5). Either the join fails, or the ID leaks the property's existence, which AD-5 exists to prevent. A property with no loan (paid off) has no scoping account and is visible to everyone, even with a private `value_account_id`.

**Fix:** tighten AD-3. A property is visible iff its owner is the viewer, or both its loan account (if any) and value account are visible. `redact()` nulls `property_id` (and the property's category label) for viewers who can't see the property. `setSplitField(property_id)` only allows splits whose owner is the property's owner.

## P11 — Budget periods vs goal periods (Medium)

The data model gives `budget` its own `anchor_date`. **E6** implements budgets with `period` + `anchor_date` through `shared/period` (compliant with AD-14's "all period maths lives in shared/period"). **E7** closes periods from the resolved `PayCalendar` with deposit alignment (AD-14). With a Friday payday that lands on Thursday, "this fortnight" on the budgets page and on the goals page start on different days. E6's rollover recomputes every past period on read (AD-11: budgets derived), so when deposit detection later changes, past rollovers shift, while E7's closed boundaries are frozen.

**Fix:** tighten AD-14. `budget` references `pay_anchor_id` (person or household), not its own `anchor_date`. Budget rollover reads the same frozen closed-period boundaries as goals, which makes "closed-period boundaries" a per-anchor table rather than per-pool.

## P12 — Forecast inputs have no account, and bills are double-counted (Medium)

E8 projects "per account" from budgeted discretionary spend, but `budget` has no account. E8 invents a mapping (historical account mix per category) inside a read-only module, and E6 separately adds a `funding_account_id`. Two answers. Budget caps also cover categories whose bills are already confirmed series (the Utilities budget and the electricity bill), so E8 counts both unless told otherwise.

**Fix:** part of AD-25, or a new AD. `forecast_assumption` (owned by `planning`) holds the account distribution per budget, defaulting to the trailing 90-day mix computed in `domain`. Projected discretionary spend = the budget minus the expected amounts of confirmed series in the same categories for that period.

## P13 — `fy_config` shape and history (Medium)

`system` owns `fy_config`. E1 builds `system` but its epic says "no finance tables beyond person, household_settings, job". **E9** needs concessional caps, the SG rate and the carry-forward TSB threshold, and adds typed columns through a `system` use case (compliant). **E10** needs the immediate-deduction threshold and the WFH fixed rate, and adds key/value rows (also compliant). The result is two shapes in one table. Carry-forward also needs five prior FYs of caps (back to FY2021) and each person's total super balance at the prior 30 June, which is `balanceAsOf` on super before history begins (1 July 2024).

**Fix:** tighten AD-10. `fy_config` is `(fy, key, value_json)` with a typed key registry in `shared` (Zod schema per key, each key declared by the owning epic). Seed data ships every key from FY2020 to FY2027. Carry-forward accepts a manually entered opening TSB per person and FY when the ledger has no history.

## P14 — Soft delete vs dedupe and derived reads (Medium)

Conventions: `deleted_at` "on user-facing records", with no list of which records. **E3** dedupe looks up existing rows with `deleted_at IS NULL` (as every other E2 read does), finds none for a row the user deleted, and inserts. The unique index on `(account_id, fingerprint)` then throws `Conflict` and the whole batch commit fails. Or, if E2 dropped the unique index in favour of a partial one, the deleted row comes back. **E4** sums `split` joined to non-deleted `transaction`, while an ad-hoc report sums `split` directly and counts deleted rows. **E9** rebuilds `lot` from `investment_event` including soft-deleted events.

**Fix:** new convention row, or an AD-3 addition. Soft-delete filtering is part of the same repository fragment as `visibleAccounts` (so every scoped read gets it). Deleted imported rows are **tombstones** for dedupe (the unique index covers them, and dedupe treats a tombstone match as a duplicate). Say whether `split` is soft-deletable (recommendation: no; splits are owned by their transaction). Projections (`lot`, `balanceAsOf`, period close) exclude deleted rows.

## P15 — CMC Invest has two owners (Medium)

AD-10 says E9 owns CMC Invest parsing and commits through `invest.recordEvents`. E3's epic lists "CMC confirmations" among its formats, and its DoD #2 ("each format imports its committed anonymised sample") makes E3 responsible for a CMC sample in M1, before `investment_event` exists (E9 is M4). E3 can meet its DoD only by parsing CMC into `import_row` with nowhere to commit, or by committing the cash side as ordinary transactions, which E9 later has to reconcile against events (see P2 case 4).

**Fix:** the AD is right, so fix the epic. Remove CMC from E3's format list and DoD, and give E9 the sample. Record in AD-10 that `import_row` has a `target` discriminator (`transaction | investment_event | contribution`), so the pipeline's shape is fixed in M1.

## P16 — Restore vs the outbox (Medium)

AD-8 enqueues jobs inside business transactions. AD-16 has `restore` go through `app` use cases. **E1**'s restore (and the monthly drill's swap test) brings back the `job` table as it was at snapshot time: pending jobs and `running` rows whose leases have since expired. **E5/E9** handlers are idempotent against the *database*, as AD-8 requires, but not against the outside world: LLM batches are re-billed on a cloud provider, SMTP notices are re-sent, and logo fetches repeat (AD-8 says "once per confirmed payee domain"). On a live server, AD-16 also leaves open whether an admin-socket `backup` can run concurrently with the nightly `local`-lane backup job (both run `VACUUM INTO`, a long synchronous call that blocks HTTP on the single process).

**Fix:** tighten AD-8/AD-16. After a restore, every `pending`/`running` job with an outbound lane is moved to `dead` with reason `restored` (an idempotent step inside the restore use case). Outbound handlers record an external-effect key (`llm_request_id`, `smtp_message_id`) on the owning entity before calling out. Admin-socket commands that touch the database file (backup, restore drill) are enqueued as `local`-lane jobs with a fixed `dedupe_key` rather than run inline, so the single-writer rule and the lane concurrency setting serialise them.

---

## Ones that held

- **Two writers of classifying fields** (rules vs LLM vs activity pre-fill vs user): closed by AD-10's `setSplitField` with precedence. P6 only adds suggestion closure.
- **Lot drift after backdated events:** closed by AD-11's rebuild in the same transaction. Keep parcel selections keyed by `buy_event_id`, not by `lot.id`, since rebuilds may change IDs.
- **Private rows in cloud LLM prompts:** closed by AD-6 at the request builder.
- **Sign flips in reports:** closed by AD-12. P2 is about classification, not sign.
