# Home buying planner

The couple estimate what they can borrow, what it costs each pay day, and what's left to live on (CAP-19). Every figure is an estimate, not a lender's offer or tax advice, and the page says so. All maths runs on the server in `domain/planner` through `shared.toCents`/`allocate`; the web never sums money, and slider changes are debounced server calls.

## Data scope

- Plans are shared by both partners and read only data both can see: public accounts and their rows, the intersection of both viewers' visible accounts (`sharedScope()`).
- A property, loan or deposit source counts only if both can see it. A viewer's private property or loan appears to them as "Not in shared plans" and never feeds a figure, for either partner.
- `home_plan` carries no `person_id` and is visible to both.

## Inputs

Every input can be typed or slid, and is tagged "from Pangolin" or "typed".

| Input | Source |
| --- | --- |
| Take-home income | Each person's pay from `pay_anchor` (gross and net pay), shared-visible pay rows only |
| Usual spending | Categorised shared-visible splits, averaged over recent periods |
| Deposit | The shared savings pool or the shared deposit goal, with a typed override |
| Existing properties and loans | Shared-visible `property`, its loan's balance and `loan_terms`, the latest valuation, rent, and ownership shares from `account_owner` |
| Credit-card limits | `account.credit_limit_cents` on shared-visible cards |
| Interest rate(s) | Typed, per scenario |
| Loan term | Typed; default 30 years, principal and interest |
| Home costs | Typed: rates and insurance |
| Rate variability | Typed |

## Outputs

| Output | Meaning |
| --- | --- |
| Borrowing power | The hero figure, always the lender-style estimate; with the deposit, "a place up to about $X" |
| Repayments | Monthly and fortnightly, lined up with pay day |
| Left for actual life | Take-home pay − loan repayments − home costs, **before** usual spending. Fortnightly in the hero, monthly in tiles and stress rows |
| Rate stress table | "What's left if rates misbehave": one row per scenario rate plus the stress rate (+3 pp) |
| Stress check | "Survives a 3% rate jump" when what's left after usual spending stays ≥ $0 at the stress rate, otherwise a plain warning |

## Two calculators

- **Simple:** borrowing power from income, usual spending, home costs and rate (the repayment that leaves nothing negative, amortised over the term); and a repayment calculator, amount + rate → monthly and fortnightly.
- **Lender-style serviceability ("true financing"):** income less assessed living costs and commitments, tested at the assessment rate, then capped by debt-to-income. Each assumption is an editable chip, labelled "estimates, not a lender's offer".
- The Lender-style estimate card shows Simple, Lender-style ("used for the number above") and debt-to-income side by side.
- Repayments use `domain/amortise`, shared with forecasting and loan detail.

| Assumption | Default |
| --- | --- |
| Assessment buffer | +3 pp over the entered rate |
| Living expenses | The higher of actual spending and HEM |
| Rental income | Counted at 80% |
| Credit-card limits | 3.8% of limit per month as debt |
| Debt-to-income cap | 6× gross income |

## Existing properties

Each shared-visible property with a value and a loan balance can be toggled (both are needed):

- **Use equity:** usable equity = value × 80% LVR − loan, scaled by ownership share. Rent, at 80%, counts as income; the existing loan's repayment counts as a commitment.
- **Sell it:** proceeds = value − 2.5% selling costs − loan − CGT estimate, scaled by ownership share, go to the deposit. Rent and repayments drop out.
- **CGT estimate:** gain = sale value − selling costs − (`purchase_price_cents` + `cost_base_adjustments_cents`), halved when held over 12 months, × the CGT estimate rate. A `home` kind property is treated as the main residence and has none. Labelled "estimate, not tax advice".

## Scenarios

- Up to three named scenarios (A, B, C) side by side, each holding rate, term and property choices.
- One is selected and drives the hero.

## Saved plans

- Saved with a name ("First look, Oct 2026") as a `home_plan`, shared by both.
- A plan stores only the typed inputs and choices, the scenarios, and a headline snapshot: borrow, repayment and left to live on, as both saw them at save time. This headline is the one allowed exception to recomputing on read.
- Everything else is recomputed on read from currently shared-visible data. Reopening shows the saved headline beside today's recalculation from the saved inputs.
- Inputs that came from data no longer shared drop out, and the plan shows "Some inputs are no longer shared".
- Saving a change creates a new plan; the old one stays for comparison.

## Rates and config

- HEM and the CGT estimate rate are `fy_config` keys (the per-FY config table), entered by hand. Pangolin never fetches them.
- Pangolin holds no lender data and makes no outbound calls for the planner.
