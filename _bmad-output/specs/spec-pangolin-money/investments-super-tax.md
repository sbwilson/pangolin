# Investments, super, property and tax

Investments and super are both modelled as units × price. Holdings on any date are derived from events, so valuation history can be recomputed whenever a price or event is corrected.

## ETFs (Betashares Direct, CMC Invest)

- **Events:** buy, sell, cash distribution, reinvested distribution (DRP), and yearly cost-base adjustment.
  - CMC events are imported from its trade-confirmation CSV.
  - Betashares events are entered by hand for now, with statement import later.
- **Lots:** every buy or DRP creates a lot; sells consume lots.
  - FIFO is the default, with manual parcel selection per sale (the ATO accepts identified parcels if records support it).
  - Lots held over 12 months are flagged as eligible for the 50% CGT discount.
- **Cost-base adjustments:** the annual tax statement's AMIT adjustments are entered per holding per year and applied to lots, so capital gains are correct on sale.
- **Prices:** daily closes through a pluggable price-source interface, with the source recorded on each price.
  - Primary source: Yahoo Finance's chart endpoint (`.AX` tickers). It's free with full history and is what Ghostfolio uses, but it's unofficial and can break. Only ticker codes leave the server.
  - It carries the last price forward, shows its age, and allows manual override.
  - Fallbacks: the issuer's published daily NAV (Betashares, Vanguard and others publish one per fund), then manual entry. A paid feed can be added behind the same interface later.
- **Performance:** both money-weighted return (XIRR) and time-weighted return, because they answer different questions: how we did vs how the fund did.

## Super (QSuper, Aware Super)

- **Balance** = Σ units per option × that day's unit price.
  - Units come from statements. Contributions between statements convert to units at that day's price.
  - The result is labelled an estimate until the next statement reconciles it.
- **Unit prices:** one small fetcher per fund in the job runner, run once daily. QSuper publishes date-ranged prices with an .xls download; Aware publishes daily prices on its site. Full history is stored locally.
- **Contributions** are tagged by kind (employer SG, salary sacrifice, personal concessional, non-concessional).
  - That drives a per-person, per-financial-year concessional cap tracker, including carry-forward of unused cap.
  - Cap amounts and eligibility thresholds live in a config table per financial year, not in code.
- **Payday Super check:** since 1 July 2026 employers must pay super with each pay cycle. The app compares expected SG per payday against contributions received and flags gaps.

## Investment property (owned by one of us)

- A `property` record links the loan account, the rental income and the property's costs (through `split.property_id`).
- Repayments are treated simply as an expense for now, with no interest/principal split.
- **Property view:** rent in, repayments and costs out, and net cash position per month and per financial year.
- **Gearing:** loan balance ÷ latest valuation. Valuations are entered by hand as balance snapshots.
- **Caveat:** repayments include principal, so the net cash position understates the property's real return. An interest-only view can be added later from the interest lines in the home loan export.
- The property belongs to its owner's individual view and tax pack. It appears in shared views unless the owner makes the loan account private.

Member-portal logins are deliberately not automated: they need MFA, break often, and would mean storing credentials.

## Tax and activities

The app produces a per-person, per-financial-year (1 July – 30 June) pack for us or our accountant. It does not give tax advice or lodge anything.

**Deductions**

- A split carries `tax_category_id` (mapped to the ATO labels, e.g. work-related travel, self-education, other work-related, gifts and donations) and `deductible_bp`, the work-use percentage.
  - The deductible amount is the split amount × that percentage.
  - Splitting a purchase between personal and work use is just two splits.
- Assets over the immediate-deduction threshold are flagged for depreciation, with purchase date and cost recorded. The threshold is a config value per financial year.
- A working-from-home hours log is kept per person per week, for the fixed-rate method. The rate is config per financial year.
- Receipts attach to transactions and are encrypted at rest. They are kept at least 5 years after lodgement; the app warns before deleting anything younger.

**Investment income and capital gains**

- Distributions per financial year, with components (franking credits, foreign income, capital gain components) entered from each fund's annual tax statement.
- Realised capital gains per sale from the lot engine, with discount eligibility and the cost-base adjustments applied.

**Reports**

- Deduction summary by ATO label with the underlying transactions and receipts.
- Investment income summary, and capital gains schedule.
- Super contributions vs caps.
- Everything exports as CSV, plus a PDF bundle with receipts attached.

**Activities** ("Japan Trip 2026", "Conference") are a first-class tag on splits, with optional dates and budget.

- The activity view shows total, by category, by person, and against budget.
- A dated activity (e.g. a trip) can pre-fill suggestions for transactions in its date range, including foreign-currency ones.
- A conference activity can default its splits to the right tax category.
