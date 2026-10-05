---
title: "Sprint Change Proposal: UX catch-up, goal kinds and Cover an expense"
date: 2026-10-05
status: approved
trigger: "UX spines ux-pangolin-2026-10-05 (EXPERIENCE.md, DESIGN.md, status final)"
scope_classification: major
approach: "Direct Adjustment (hybrid, light scope trim: lender repayment-plan import deferred)"
decisions: [D1, D2, D3, D4, D5, D6, D7, D8]
proposals: 50
---

# Sprint Change Proposal: UX catch-up, goal kinds and Cover an expense

Paths used below: SPEC dir = `_bmad-output/specs/spec-pangolin-money/` · SPINE = `_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md` · INIT dir = `_bmad-output/initiative-pangolin-money-v1/` · UX dir = `_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/`.

## 1. Issue Summary

**Trigger.** The UX spines finalised on 2026-10-05 (`EXPERIENCE.md`, status final, and `DESIGN.md`) describe a product larger than the spec, architecture and epics. Three sources feed the gap:

1. **The UX exceeds the spec.** It adds a home buying planner, loan detail, a richer property view, per-person themes, an app shell with one Settings page, partial import with AI row reading, import hand-off to the partner, partner-pending counts, a WCAG 2.2 AA floor and new routes.
2. **New stakeholder requirements from Simon and Carissa** surfaced during UX (themes, hand-off, saved shared plans, net worth as a top-level surface, bulk select, amount search).
3. **Raised during this review (D7):** goals become Flexible or Protected, each pool gets one emergency fund, and a new "Cover an expense" sheet covers a large purchase or a gradual shortfall by a confirmed, audited, undoable drawdown across goals. A new "Large withdrawal" review item detects big savings withdrawals.

**Evidence.**
- `EXPERIENCE.md` § Spec Catch-up lists 14 items for correct course; this analysis found 13 more (X-1 to X-13), plus six UX gaps (no household settings, recovery-bundle warning, invite partner and "Revoke the link" dropped, ambiguous non-owner property figures, no category/rule management surface).
- Mockups in `mockups/` (`key-home-buying`, `key-loan-detail`, `key-property-detail`, `key-settings`, `key-net-worth`, `key-needs-review`, `key-import-popover`, `key-goals`, `key-transactions` and others) show surfaces with no capability, table, AD or epic behind them.
- Shipped code drifts from the UX and AD-17: `/ledger`, a status-style HomePage at `/`, a single green palette, and identity notices served outside `review_item`.

**Shipped baseline.** Epics 1, 11 and 2 (v0.2.0). Epic 12 story 1 (web stack, shell, router) is done.

## 2. Impact Analysis

### 2.1 Epic impact

| Epic | Impact | Change |
|---|---|---|
| 12 Ledger workspace (M1, in progress) | Continues | Entries 2–5 get amended ACs (`/transactions`, date range, day nets, summary line, transaction sheet, grouped accounts, amount search); new entry 12 bulk select. Shell, Settings, sign-in and themes stay out (go to 13). |
| 13 App shell, settings and theming | **New (M1)** | CAP-21 + WCAG floor: sidebar, tab bar, `/sign-in`, `/settings#…`, six themes × modes, `person_preference`, axe harness, `/` interim redirect. |
| 3 Import, dedupe, transfers | Scope grows | Partial import (CSV/OFX/QIF), hand-off, attachment storage (from 5), batch undo, Needs review UI with all kinds, partner-pending count, identity notices → review items. |
| 4 Spending insight | Scope grows | `/cash-flow` landing (the `/` redirect switches here), Net worth page and trend, Biggest little leaks, share toggle. |
| 5 LLM categorisation and PDF | Scope changes | `row_interpret` purpose, ≥ 90% bulk-accept card, Settings › LLM providers card; loses attachment storage. |
| 6 Budgets and bills | Scope grows | Limit suggestion, over-budget review item. |
| 7 Goals and savings | Scope grows (~+1 story) | Goal kinds, emergency fund, Cover an expense, Large withdrawal item, drawdowns, buffer divert, warning-colour shortfall. |
| 8 Forecasting | Scope changes | Per-account low-balance threshold; `domain/amortise` shared with 14. No longer the M3 gate. |
| 14 Loans and property | **New (M3)** | CAP-20 + CAP-11 (moved from 10; reverses the 2026-09-27 placement, D3). |
| 15 Home buying planner | **New (M3)** | CAP-19. **Carries the M3 gate:** the home buying planner works on real data (G3). |
| 9 Investments and super | None | — |
| 10 Tax pack and activities | Slimmed | Loses CAP-11; reads property net cash from 14. `after` += 14. |

**New build order:** 1, 2, 12, 13, 11, 3, 4, 5, 6, 7, 8, 14, 15, 9, 10.

### 2.2 Story impact

- **Epic 12:** entry 1 done and compatible; entries 2, 3, 4, 5 amended; new entry 12 (bulk select, `after = [3]`; entry 9 `after` += 12); entries 6–11 unchanged.
- **Epics 3–8, 10:** Done-when and Boundaries edits (E-6 to E-9, E-1); stories are sliced later by bmad-preview-ticketing, so no existing story files are rewritten.
- **Epics 13–15:** about 25–30 new stories in all (≈ +30% of remaining v1).
- **Epic 7** grows by about one story (Cover an expense and detection); re-check sizing when sliced.

### 2.3 Artifact conflicts

| Artifact | Conflicts | Resolved by |
|---|---|---|
| Spec (SPEC.md + companions) | No CAP for home buying, loans, shell/themes; non-goal forbids interest/principal split; CAP-7 "red" shortfall; all-or-nothing import; two LLM purposes only; option A "goal balances never decrease"; property owned by one person; no WCAG constraint | SP-1 to SP-16, SP-10a, SP-15a |
| Architecture (SPINE) | AD-3 property scope; AD-7 recompute-on-read vs saved plans; AD-6 purposes; AD-11 stored list; AD-17 binds and notices drift; AD-21 attachment storage in epic 5; AD-22 person-scoped list; AD-23 repayments as expense; AD-24 goal drawdown only by linked withdrawal; AD-9 "status page"; no accessibility/theming/routes conventions | A-1 to A-9 (new AD-28) |
| UX (EXPERIENCE, DESIGN, mocks) | Settings lacks household; system status drops recovery-bundle warning; partner actions dropped; non-owner property figures ambiguous; lender-plan import; push-out shortfall fix superseded by D7; no Cover an expense pattern or Large withdrawal kind | U-1 to U-13 |
| Epics (tickets.toml, epic files) | No epics 13–15; CAP-11 in epic 10; epic 12 ACs; M3 gate on epic 8 | E-1 to E-10 |

### 2.4 Technical impact (shipped code)

| Shipped | Change | Where |
|---|---|---|
| `/ledger` route | Renamed `/transactions`; `/ledger` redirects | Epic 12 entry 2 |
| `/` HomePage | `/` redirects to `/transactions` (interim) until epic 4 ships `/cash-flow`; unknown paths → `/` → landing | Epic 13; epic 4 switches the target |
| HomePage cards (health, last backup, recovery-bundle warning, dead jobs, invite partner, regenerate codes, partner reset, notices, sign out) | Move into Settings cards (System status, Sign-in & security, Partner, Signed-in devices) | Epic 13 |
| e2e specs `health`, `recovery`, `ledger`, `routing`, `auth` | Paths and selectors updated | Epics 12 (ledger, routing) and 13 (rest) |
| Identity notices at `/api/identity/notices` | Migrate to review-item kinds, keeping "Revoke the link" | Epic 3 |
| Attachment storage | Built in epic 3 (hand-off files), not epic 5 | Epic 3 |
| `styles.css` single palette, `prefers-color-scheme` only | Replaced by six themes × light/dark/system via `data-theme` | Epic 13 |

None of this needs a rollback; all items are redirects, moves or planned replacements.

## 3. Recommended Approach

**Direct Adjustment, hybrid with a light scope trim:** lender repayment-plan import is deferred beyond v1 (D6).

- **Rationale.** Nothing shipped contradicts the UX in a way that needs reverting (rollback: no gain, high churn). A pure scope review would cut the UX's first-session climax (home buying) and the M3 planning value the couple asked for. Adjusting the artifacts keeps v0.2.0 intact and lets epic 12 continue now.
- **Effort.** Medium-high: about 18 spec edits, 9 architecture edits (one new AD), 13 UX edits plus 4 mock changes, 3 new epics (~25–30 stories, ≈ +30% of remaining v1), AC amendments to epics 3–8, 10 and 12.
- **Risk.** Low-medium. Shipped-code rework is small and localised (routes, HomePage → Settings, palette). Main risks: M3 grows (two new L epics), and goal drawdowns add money-moving logic, mitigated by server-only sums, one-pool scope, audit and full undo.
- **Timeline.** Epic 12 continues immediately. Epic 13 can start in parallel once the spec and architecture edits land (no blocking decision remains). Epics 3, 7, 14 and 15 are sliced only after the artifact edits are applied. M3 now ends with epic 15.

## 4. Detailed Change Proposals

All groups G1–G9 are approved. Where `cc-proposals.md` and `cc-proposals-g6.md` conflicted, the G6 version is used; D8 resolves every "[CONFIRM: keep buffer divert?]" as **kept**, so those markers are removed.

### 4.1 Decisions

| ID | Decision | Affects |
|---|---|---|
| D1 | Non-goal excludes only *automatic* interest/principal splitting; interest is user-entered per period. | SP-4, SP-1, SP-11, A-7 |
| D2 | Shortfall fixes: buffer divert as a time-boxed `goal_rule` override; audited `goal_adjustment`; option A and AD-24 gain an exception. Its "push out lowest-priority goal" is **replaced by D7**; buffer divert survives per D8. | SP-12, SP-10, A-4 |
| D3 | CAP-11 property view moves from epic 10 to new epic 14 "Loans and property" (M3); reverses 2026-09-27. | E-1, E-2, E-10 |
| D4 | `home_plan` stores typed inputs and choices plus a headline snapshot only (borrow, repayment, left to live on); everything else recomputed from shared-visible data; "Some inputs are no longer shared". Allowed exception to AD-7. | SP-2, SP-13, A-2, A-4, U-7 |
| D5 | Partial import for CSV/OFX/QIF only; PDF stays all-or-nothing. New `row_interpret` purpose: local by default, cloud only if enabled, never for private-account rows, proposes only. | SP-5, SP-8, SP-9, A-3, E-6, E-8, U-8 |
| D6 | Lender repayment-plan import deferred beyond v1 (no `loan_plan_row`, no import button); schedule estimated from terms, corrected by entered interest. | SP-2, SP-10, A-1, A-9, E-10, U-5, U-6 |
| D7 | Goals are Flexible or Protected; one emergency fund per pool. Cover an expense: large purchase (emergency fund → Flexible split → Protected behind a warning) and gradual shortfall (Flexible → emergency fund → Protected). Confirmed, audited, undoable, one pool. Large withdrawal item. | SP-7, SP-12, SP-16, SP-10a, SP-15a, A-4, A-6, A-9, E-9, U-9 to U-13 |
| D8 | Buffer divert is kept alongside Cover it for gradual shortfall. | SP-10, SP-12, A-4, U-9, U-10 |

Also settled at group approval: M3 gate moves to epic 15 (G3); U-4 non-owner sees whole-property figures plus a "Your share" line for part-owners (G2); G6 assumptions accepted (threshold ≥ $2,000 per pool, editable; new goals default Flexible; proportional Flexible split; emergency fund pre-filled up to its full balance; Cover never draws the buffer; undo via toast or history while the period is open).

### 4.2 Spec (18)

#### SP-1 · CAP-11 property net cash and LVR
- **Artifact:** SPEC.md · § Capabilities, CAP-11
- **OLD:** "A property record links its loan account, rental income and costs to show net cash position per month and per FY, and gearing (loan balance ÷ latest valuation), with repayments treated as a simple expense." · success: "A seeded property's rent/repayments/costs produce the documented net cash position and gearing figure, visible in the owner's individual view and hidden from the partner when the loan account is private."
- **NEW:** "A property record links its value account, loan account, rental income and costs. Its ownership shares come from its owners. It shows value, equity and LVR (loan ÷ latest valuation). It shows net cash per month and per FY, where net cash = rent − user-entered loan interest − running costs, with principal shown separately as out of pocket. It labels the property negatively or positively geared from last FY's net cash." · success: "A seeded property's rent, entered interest and costs produce the documented net cash (this FY, last FY), LVR and gearing label. Months without entered interest show interest as missing, never estimated. The property is hidden from the partner when its value or loan account is private."
- **Why:** Items 2 and 13; consistent with D1.

#### SP-2 · Add CAP-19 Home buying and CAP-20 Loans
- **Artifact:** SPEC.md · § Capabilities, after CAP-18
- **OLD:** —
- **NEW:**
  - **CAP-19 intent:** "The couple estimate what they can borrow, their repayments, and what's left to live on. Borrowing is estimated two ways, simple and lender-style serviceability, with editable defaults: +3 pp buffer, max(actual, HEM) living costs, rent at 80%, 3.8% of card limits, DTI 6×. The estimate can include existing properties, used for equity (80% LVR) or sold (2.5% costs + CGT estimate). Up to three scenarios. Named saved plans are shared by both and built only from data both can see."
  - **CAP-19 success:** "Against the seed, borrowing power, repayments and the stress row match a hand calculation. A private loan never changes a plan's figures for either partner. A reopened plan shows its saved headline (borrow, repayment, left to live on) beside today's recalculation from its saved inputs. Inputs that are no longer shared drop out with 'Some inputs are no longer shared'."
  - **CAP-20 intent:** "A loan records its terms, rate changes and user-entered interest per period. It shows balance over time (actual, projected, with extras), interest paid and still to pay, payoff date, and the effect of extra repayments (capped yearly) and of the offset balance. Its schedule is estimated from its terms and corrected by the user-entered interest. Loans can be added by hand."
  - **CAP-20 success:** "A seeded loan's projected payoff, and the interest saved by a given extra, match a hand amortisation. Principal and interest are shown only for periods with entered interest."
- **Why:** Items 1 and 3; D4 (headline-only snapshot), D6 (no lender-plan import).

#### SP-3 · Add CAP-21 shell and themes, and the WCAG constraint
- **Artifact:** SPEC.md · § Capabilities and § Constraints
- **OLD:** —
- **NEW:**
  - **CAP-21 intent:** "Each person picks one of six themes in light, dark or system mode, saved to their profile. The app has a desktop sidebar, a phone tab bar and a single Settings page (appearance, sign-in & security, signed-in devices, partner, household, LLM providers, system status). A person can list and end their sessions."
  - **CAP-21 success:** "A theme choice follows the person to another device. The axe check is clean on every route."
  - **Constraint:** "Every surface meets WCAG 2.2 AA: full keyboard operation, visible focus, a table equivalent for every chart, and reduced motion respected. An automated accessibility test in CI checks it."
- **Why:** Items 8, 9, 10 and X-9.

#### SP-4 · Non-goal excludes only automatic splitting
- **Artifact:** SPEC.md · § Non-goals
- **OLD:** "Splitting mortgage repayments into interest/principal — v1 treats repayments as a simple expense."
- **NEW:** "Automatically splitting imported mortgage repayments into interest/principal — v1 treats repayments as a simple expense in cash flow; interest is only ever user-entered per period from statements."
- **Why:** D1.

#### SP-5 · CAP-1 partial import and hand-off
- **Artifact:** SPEC.md · CAP-1 success
- **OLD:** "…re-importing the same file or an overlapping date range changes nothing; any statement with a printed opening/closing or running balance reconciles to the cent."
- **NEW:** Append: "Unreadable rows in CSV/OFX/QIF are set aside with row number and reason while good rows commit; a PDF statement with any failed check still blocks as a whole. A file can be handed to the partner, who chooses the account. Once set-aside rows are fixed or discarded, the statement reconciles to the cent."
- **Why:** Items 12 and X-1; D5.

#### SP-6 · CAP-4 limit suggestion and over-budget item
- **Artifact:** SPEC.md · CAP-4 intent
- **OLD:** "…with spent/pace/projected computed live from splits."
- **NEW:** Append: "…; the editor suggests a limit from recent average spending, and going over the limit raises one review item per budget per period."
- **Why:** X-3 and X-4.

#### SP-7 · CAP-7 shortfall, large withdrawals and the drawdown
- **Artifact:** SPEC.md · CAP-7 intent and success
- **OLD (intent):** "Each period and after every import, goal balances plus the unallocated buffer must reconcile to the real balance of that pool's savings accounts, with over-commitment and other mismatches flagged."
- **NEW (intent):** Append: "A large purchase or a shortfall is covered by a user-confirmed drawdown across that pool's goals, in a fixed order by goal kind."
- **OLD (success):** "A seeded over-commitment (buffer exhausted) shows a red shortfall on the goals page and review inbox; any other mismatch offers a one-click buffer adjustment."
- **NEW (success):**
  - "A seeded over-commitment shows a shortfall in the warning colour (never money-out red), with a glyph and text, on the goals page and in the review inbox. Its fix opens Cover an expense in shortfall order: Flexible, then emergency fund, then Protected."
  - "A seeded savings withdrawal at or above the pool's threshold raises a Large withdrawal item. Covering it debits the emergency fund first, then Flexible goals, then Protected goals only after a warning."
  - "Each confirmed drawdown writes one audited `goal_adjustment` per goal under one `goal_drawdown`, never touches another pool, and is undone in full. Any other mismatch offers a one-click buffer adjustment."
- **Why:** Items 6 and 14; D7 replaces D2's push-out.

#### SP-8 · Import pipeline: set-aside rows and hand-off
- **Artifact:** import-pipeline.md · step 1, plus a new section
- **OLD:** "Bad rows are reported with line numbers; nothing is committed."
- **NEW:** "For CSV, OFX and QIF, rows that fail validation are **set aside** in `import_row` (status `set_aside`, row number, raw line, reason) and never committed; the rest continue. Set-aside rows are gathered into one review item. There, each row can be fixed inline (then committed through the same batch), discarded, or read by the LLM (`row_interpret`, see categorisation.md). PDF statements are unchanged: any failed check blocks the whole batch."
- **ADD § "Hand-off to the partner":** "A file imported 'For <partner>' is stored as an encrypted attachment and raises a hand-off review item for the partner, who picks any of their accounts. The sender sees only the hand-off's status, never the account. Dismissing the item discards the file. The person who imported a batch can undo it."
- **Why:** Items 12 and X-1; D5.

#### SP-9 · Third LLM purpose `row_interpret`
- **Artifact:** categorisation.md · § Providers; SPEC.md · § Constraints (cloud LLM line)
- **OLD:** "**Per-purpose assignment:** each purpose (categorisation, PDF extraction) is assigned to a provider." · Constraint: "Cloud LLM use is opt-in only, assigned per purpose, and receives only description/amount/date/category list — never account names, people, or private transactions."
- **NEW:**
  - Per-purpose assignment: "…each purpose (categorisation, PDF extraction, set-aside row interpretation) is assigned to a provider."
  - Add: "Row interpretation (`row_interpret`) sees the raw line, so it is local by default. It runs on a cloud provider only if explicitly enabled for that provider, and never for a private account's row. It returns a schema-shaped proposal, either a transaction or a loan rate change. Nothing applies without the person's confirmation."
  - Add: "Until the confidence threshold is tuned, nothing auto-applies. Review batches suggestions at ≥ 90% confidence into one bulk-accept card."
  - Constraint: append "…; set-aside row interpretation, like PDF extraction, sees raw text and is restricted to local providers unless explicitly enabled for cloud, and never for a private account."
- **Why:** Item 12; D5. Reconciles the UX's 90% batching with the tuned auto-apply threshold.

#### SP-10 · Data model table changes (non-goal parts)
- **Artifact:** data-model.md · § Tables
- **OLD:** Property row: "`name`, `owner_person_id`, `loan_account_id`, `value_account_id`. Rental income and property costs link to it through `split.property_id`." · LLM row: "allowed purposes (categorise, PDF extraction)" · `import_row`: "Parsed rows awaiting review and commit, with the PDF page each came from" (no key columns) · `goal_rule`: "`goal_id`, `stage_id`, `share_bp`, `effective_from`" · `account` has no credit limit.
- **NEW:**
  - Property: "`name`, `place`, `kind` (investment, home), `loan_account_id`, `value_account_id`, `weekly_rent_cents`, `purchase_price_cents`, `purchased_on`, `cost_base_adjustments_cents`. Ownership comes from the value account's `account_owner`. Rental income and property costs link to it through `split.property_id`."
  - LLM: "…(categorise, PDF extraction, row interpretation)".
  - `import_row` key columns: "`batch_id`, `row_number`, `raw_line`, `status` (staged, committed, set_aside, discarded), `reason`, `pdf_page`".
  - `goal_rule`: add `effective_until` (nullable) and `source` (rule, shortfall_override). A shortfall override is a time-boxed rule that diverts $X/fortnight to the buffer (kept per D8).
  - `account`: add `credit_limit_cents`.
  - Add rows: Accounts `loan_terms`, `loan_rate_change`, `loan_interest_entry` (`period_start`, `period_end`, `interest_cents`, `source` user or statement); Import `import_handoff`; Planning `home_plan` (`name`, `created_by`, `inputs` JSON of typed values and choices, `scenarios` JSON, `headline` JSON of borrow, repayment and left-to-live-on at save time, shared; no other figures stored); People `person_preference` (`theme`, `mode`).
  - No `loan_plan_row` table: lender-plan import is later work.
  - Goal tables (`goal`, `goal_drawdown`, `goal_adjustment`, `planning_setting`): see SP-10a, which supersedes SP-10's `goal_adjustment` row.
- **Why:** Items 1, 2, 3, 8, 12, 13, X-1; D4, D5, D6, D8.

#### SP-10a · Data model: goal kinds and drawdowns
- **Artifact:** data-model.md · § Tables, Planning
- **OLD:** "| Planning | `goal` | Savings target | `name`, `target_cents`, `target_date`, `priority`, `completed_at` |"
- **NEW:**
  - `goal`: "`name`, `person_id` (null for the shared pool, AD-22), `target_cents`, `target_date`, `priority`, `kind` (flexible, protected), `is_emergency_fund` (at most one per pool), `completed_at`".
  - Add `goal_drawdown`: "One confirmed cover: `person_id` (null for shared), `reason` (large_purchase, shortfall), `label`, `amount_cents`, `transaction_id` (nullable: the covered withdrawal), `created_by`, `created_at`, `undone_at`".
  - Add `goal_adjustment`: "`drawdown_id`, `goal_id`, `amount_cents` (debit)".
  - Add `planning_setting`: "`person_id` (null for shared), `large_withdrawal_threshold_cents`" [ASSUMPTION: home of the threshold].
  - `goal_rule`: keep SP-10's `effective_until` and `source` (buffer divert survives, D8).
- **Why:** D7. A drawdown header makes undo atomic and holds the withdrawal link once.

#### SP-11 · Investment property section
- **Artifact:** investments-super-tax.md · § Investment property
- **OLD:** "## Investment property (owned by one of us)" … "Repayments are treated simply as an expense for now, with no interest/principal split." … "**Property view:** rent in, repayments and costs out, and net cash position per month and per financial year." … "**Gearing:** loan balance ÷ latest valuation. Valuations are entered by hand as balance snapshots." … "**Caveat:** repayments include principal, so the net cash position understates…"
- **NEW:** "## Investment property" · "Ownership shares come from the property's owners and scale equity, rent, costs and sale figures." · "**Property view:** net cash = rent − user-entered loan interest − running costs, per month and per FY (this FY to date, last FY). Principal is shown separately as out of pocket." · "**LVR:** loan balance ÷ latest valuation. Valuations are entered by hand as balance snapshots. **Gearing label:** negatively or positively geared from last FY's net cash (estimate, not tax advice)." · Drop the superseded "Caveat" bullet.
- **Why:** Item 13, within D1.

#### SP-12 · Budgets, goals and forecasting: kinds, Cover an expense, shortfall, thresholds
- **Artifact:** budgets-goals-forecasting.md · § Goals and savings allocation, § Goal priorities and stages, § Reconciling, new § Covering an expense, § Budgets, § Forecasting
- **OLD (Goals):** "A deficit period draws down only that buffer; goal balances never decrease because of overspending."
- **NEW (Goals):** Append "…, except through an explicit, user-confirmed drawdown (see Covering an expense)." Add bullet: "Each goal is **Flexible** (the first to give way) or **Protected** (touched only as a last resort, behind a warning). New goals default to Flexible [ASSUMPTION]. One goal per pool can be marked as that pool's **emergency fund**, and its kind doesn't apply."
- **OLD (Goal priorities and stages):** "**Falling back:** spending from the emergency fund is recorded by linking the transaction to that goal."
- **NEW:** "…by linking the transaction to that goal, or by a drawdown that debits it (see Covering an expense)."
- **OLD (Reconciling):** "That's the case the buffer-only overspending option can hide, so it's always shown in red on the goals page and in the review inbox, with the shortfall."
- **NEW (Reconciling):** "…so it's always shown in the warning colour on the goals page and in the review inbox, with the shortfall and a **Cover it** fix that opens Cover an expense in shortfall order. While the pool has an open Large withdrawal item, the shortfall item points to it rather than raising a second fix [ASSUMPTION]." Plus: "**Buffer divert.** Offered as an alternative only when the active stage gives the buffer a share. A time-boxed `goal_rule` override diverts $X/fortnight of goal allocation into the buffer until the shortfall is covered. The shortfall stays flagged with a projected clear date. It is undoable."
- **ADD § Covering an expense:**
  - **Two triggers.** A large purchase: flagged from Goals (amount, label, pool), or detected when a withdrawal out of a pool's savings accounts (not to another savings account in the same pool, and not already linked to a goal) reaches the pool's threshold, raising a Large withdrawal review item; threshold $2,000 per pool by default, editable [ASSUMPTION]. A gradual shortfall: goals exceed the pool's savings.
  - **Order.** Large purchase: emergency fund first (pre-filled up to its balance, adjustable [ASSUMPTION]), then Flexible, then Protected. Shortfall: Flexible, then emergency fund, then Protected. Pangolin proposes the Flexible split in proportion to each goal's balance [ASSUMPTION]; each amount is adjustable by slider from $0 to that goal's balance. Protected goals unlock only once every Flexible goal (and, for a shortfall, the emergency fund) is at its maximum, behind a plain warning naming each goal and its new arrival date.
  - **Confirm.** Enabled when the server reports $0 left to cover, or every eligible goal is at its maximum; then for a purchase the rest stays with the buffer, for a shortfall the rest stays flagged.
  - **Recording.** One `goal_drawdown` and one `goal_adjustment` per goal debited. When it covers a withdrawal, period close excludes that withdrawal from new savings, as for a linked withdrawal.
  - **Undo.** From the toast, and from the drawdown in goal history while its period is open [ASSUMPTION]. Restores every goal; if the condition still holds, the review item returns.
  - **Scope.** One pool only. A personal-pool drawdown is visible only to its person.
- **ADD (Budgets):** "The editor suggests a limit: the mean spent over the last 6 closed periods of that cadence, and no suggestion without history. When spent exceeds the limit, one over-budget review item is raised per budget per period."
- **ADD (Forecasting):** "Each transaction account has an editable low-balance threshold."
- **Why:** D7 and D8, plus X-3, X-4 and X-13.

#### SP-13 · New companion `home-buying.md`
- **Artifact:** SPEC.md frontmatter `companions:`; new file home-buying.md
- **OLD:** "  - budgets-goals-forecasting.md" (last companion entry)
- **NEW:** Add "  - home-buying.md" after it. The file covers: data scope (public accounts only); inputs and their sources; the two calculators; the defaults table (from EXPERIENCE § Home Buying Planner); equity and sell formulas; scenarios (max 3); saved plans (typed inputs and choices plus a headline snapshot; everything else recomputed on read from shared-visible data; "Some inputs are no longer shared"); HEM and CGT rates as `fy_config` keys entered by hand (no fetch); every figure is an estimate, not a lender's offer or tax advice.
- **Why:** Item 1; D4.

#### SP-14 · Ops: status page and milestone scope
- **Artifact:** deployment-and-ops.md · § Backups and § Milestones
- **OLD:** "…and shows the result on the status page." · M1: "…transaction list with filters, splits, tags, rules and the review inbox" · M3: "…goals with percentage allocation rules, cash-flow and net-worth forecasts"
- **NEW:** "…and shows the result in Settings › System status." · M1 append "; app shell, Settings page and per-person themes" · M3 append "; loans and property (net cash, LVR); home buying planner with shared saved plans". M3 gate: the home buying planner works on real data (epic 15 Done-when).
- **Why:** Items 1, 3, 8, 11, 13; D3; G3 gate move.

#### SP-15 · Decision log rows (non-goal parts)
- **Artifact:** decisions.md · summary table
- **OLD:** —
- **NEW rows:**
  - "Import errors (2026-10-05): CSV/OFX/QIF commit good rows and set aside unreadable rows; PDF stays all-or-nothing"
  - "AI row reading (2026-10-05): `row_interpret` is local by default, cloud only if explicitly enabled, never for a private account's rows; proposes only"
  - "Import for partner (2026-10-05): hand-off, never direct"
  - "Loan interest (2026-10-05): user-entered per period; only automatic splitting is a non-goal"
  - "Lender repayment-plan import (2026-10-05): deferred to later work; the schedule is estimated from terms"
  - "Property (2026-10-05): moves to the loans-and-property epic (reverses 2026-09-27); net cash excludes principal"
  - "Home buying plans (2026-10-05): shared, public data only; store typed inputs plus a headline snapshot, recompute the rest"
  - "Themes (2026-10-05): six, per person, light/dark/system"
  - "Accessibility (2026-10-05): WCAG 2.2 AA floor"
  - Option A text and the goal rows: see SP-15a (supersedes SP-15's option A text and "Goal shortfall" row).
- **Why:** Traceability for D1, D3–D6.

#### SP-15a · Decision log: drawdown exception and goal kinds
- **Artifact:** decisions.md · summary table, plus § Periods where spend exceeds income
- **OLD:** "- Chosen: **A** — a deficit draws down the unallocated buffer only (see `budgets-goals-forecasting.md` for the reconciliation invariant this feeds)." · Summary row: "| Overspending periods | Option A: draw down the buffer only, with an over-committed warning |"
- **NEW:** Append to option A: "Goal balances never decrease because of overspending, except by an explicit, user-confirmed drawdown (Cover an expense, 2026-10-05)." Summary row: "…with an over-committed warning; a shortfall or large purchase is covered by a user-confirmed drawdown (2026-10-05)". New rows:
  - "Goal kinds (2026-10-05): Flexible or Protected; one emergency fund per pool"
  - "Cover an expense (2026-10-05): large purchase draws the emergency fund, then Flexible, then Protected (warned); shortfall draws Flexible, then the emergency fund, then Protected (warned); split proposed by Pangolin, adjusted by us; one pool; audited; undoable. Replaces push-out (D2)."
  - "Large withdrawal (2026-10-05): a savings withdrawal at or above the pool threshold raises a review item"
  - "Shortfall buffer divert (2026-10-05): kept as an alternative when the stage gives the buffer a share (D8)"
- **Why:** Traceability for D7 and D8.

#### SP-16 · CAP-6 goal kinds and the emergency fund
- **Artifact:** SPEC.md · CAP-6 intent and success
- **OLD (intent):** "Positive new savings each period are split across goals by staged, priority-ordered rules, with automatic stage transitions when a stage's exit goal completes and fallback reactivation when a goal drops below its threshold."
- **NEW (intent):** Append: "Each goal is Flexible or Protected, and each pool has at most one goal marked as its emergency fund."
- **OLD (success):** "…a completed or under-threshold goal triggers the documented rescale or reactivation with a logged stage change."
- **NEW (success):** Append: "A second emergency fund in the same pool is rejected. A drawdown that takes the emergency fund below its fallback threshold reactivates stage 1, the same as a linked withdrawal."
- **Why:** D7.

### 4.3 Architecture (9)

#### A-1 · AD-3 property scope and new scoped tables
- **Artifact:** SPINE · AD-3
- **OLD:** "`property` takes the scope of its loan account. With no loan account, it takes the scope of its owner."
- **NEW:** "`property` takes the most restrictive scope of its value account and its loan account (AD-22). `loan_terms`, `loan_rate_change`, `loan_interest_entry` and `import_handoff` are added to the scoped tables; `import_handoff` is person-scoped to its sender and recipient."
- **Why:** Items 3, 13, X-1. Without this, an unloaned property can never be in shared plans. D6 removes `loan_plan_row`.

#### A-2 · New AD-28 "Shared plans read only what both partners can see"
- **Artifact:** SPINE · new AD-28
- **OLD:** —
- **NEW:**
  - "Binds: CAP-19; epic-home-buying-planner."
  - "Planner reads use `sharedScope()`: public accounts only, which is the intersection of both viewers' visible accounts. A viewer's private property or loan appears to them as 'Not in shared plans' and never feeds a figure."
  - "`home_plan` carries no `person_id` and is visible to both."
  - "A saved plan stores only typed inputs and choices, plus a headline snapshot: borrow, repayment, and left to live on, as both saw them at save time. This headline is the one allowed exception to AD-7's 'recomputed on read' (listed in AD-11). Every other figure is recomputed on read from currently shared-visible data. Inputs that came from data no longer shared drop out, and the plan shows 'Some inputs are no longer shared'."
  - "All planner maths is server-side in `domain/planner`, through `shared.toCents`/`allocate`. Slider recalculation is debounced server calls."
- **Why:** Item 1; D4.

#### A-3 · AD-6 `row_interpret` rule
- **Artifact:** SPINE · AD-6
- **OLD:** "`pdf_extract` runs only on a local provider unless that provider has an explicit `cloud_pdf` opt-in."
- **NEW:** Append: "`row_interpret` (set-aside import rows) runs only on a local provider unless that provider has an explicit `cloud_rows` opt-in. It never sends a private account's row to a non-local provider. Its output is a proposal, and nothing is written until a person confirms it."
- **Why:** Item 12; D5.

#### A-4 · AD-11 stored list, AD-24 drawdown exception
- **Artifact:** SPINE · AD-11 and AD-24
- **OLD (AD-11):** "`import_batch` counts, FTS5 indexes and closed-period boundaries."
- **NEW (AD-11):** "…closed-period boundaries; the `home_plan` headline snapshot (borrow, repayment and left to live on at save time — an allowed exception to AD-7's recompute-on-read; see AD-28); `goal_drawdown` and `goal_adjustment` rows; time-boxed `goal_rule` shortfall overrides."
- **OLD (AD-24 title):** "### AD-24 — Goals are drawn down only by linked withdrawals"
- **NEW:** "### AD-24 — Goals are drawn down only by linked withdrawals or a confirmed drawdown"
- **OLD (AD-24 rule):** "A goal's balance goes down only through a linked withdrawal *from its pool's savings account*."
- **NEW (AD-24 rule):** "…*from its pool's savings account*, or through a user-confirmed drawdown (`goal_drawdown` with one `goal_adjustment` per goal; reason `large_purchase` or `shortfall`; audited; undone as a whole; CAP-7)." Add:
  - "A drawdown debits goals in a single pool: the pool of the covered withdrawal (AD-26), or the pool chosen. It never debits another person's personal-pool goal (AD-22)."
  - "The order by reason and kind, and the proposed split, are computed in `domain`. `app/planning` validates that every amount is between 0 and the goal's balance and that the total does not exceed the amount to cover. The web never sums."
  - "Period close excludes a withdrawal covered by a drawdown, the same as a linked withdrawal."
  - "`planning` registers the `large_withdrawal` review-item kind (AD-17), scoped per AD-22. It resolves when the withdrawal is covered, linked to a goal, or left with the buffer."
- **Why:** D4, D7, D8.

#### A-5 · AD-17 binds, actor and partner-pending count
- **Artifact:** SPINE · AD-17
- **OLD:** "**Binds:** CAP-2, CAP-5, CAP-7, CAP-10, CAP-18; epics 2, 3 and 5–9"
- **NEW:** "**Binds:** CAP-1, CAP-2, CAP-4, CAP-5, CAP-7, CAP-10, CAP-15, CAP-18; epics 2, 3, 5–9 and 13". Add:
  - "`review_item` carries `actor_person_id` (attribution, not scope)."
  - "A **partner-pending count** for viewer V counts the partner's open items whose scope is visible to both partners (a public `account_id` and no `person_id`, or neither). It is never computed from items V can't see."
  - "Identity notices (`/api/identity/notices`) migrate to review-item kinds when the inbox UI ships."
- **Why:** Items 5 and 7; shipped-code drift.

#### A-6 · AD-22 person-scoped list
- **Artifact:** SPINE · AD-22
- **OLD:** "Rows scoped to a person (`pay_anchor`, personal `budget`, personal-pool `goal`, `goal_rule`, `goal_allocation`, `stage_event`, the WFH log, depreciable assets, `forecast_assumption`, per-person tax figures) carry `person_id`…"
- **NEW:** Add `person_preference`, `import_handoff` (sender and recipient), personal-pool `goal_drawdown` and `goal_adjustment`, `planning_setting` (personal pool), and the personal `over_budget` and `large_withdrawal` items to the list. Add: "`home_plan` is shared by rule (AD-28)."
- **Why:** Items 1, 8, X-1, X-4; extended by G6 (D7).

#### A-7 · AD-23 property net-cash exception
- **Artifact:** SPINE · AD-23
- **OLD:** "| Repayment into a home-loan account | `expense` (per the spec) |"
- **NEW:** Keep the row and add a rule: "The property net-cash figure (CAP-11) is the one exception: it takes loan interest from `loan_interest_entry`, not from repayment splits. Principal is reported separately and never as a cost."
- **Why:** Item 13, within D1.

#### A-8 · AD-21 attachment storage moves to epic 3; AD-5 hand-off
- **Artifact:** SPINE · AD-21 and AD-5
- **OLD (AD-21):** "Epic 5 builds attachment storage first."
- **NEW (AD-21):** "Epic 3 builds attachment storage first (import hand-off files); epic 5 adds statements and logos."
- **ADD (AD-5):** "An import hand-off never reveals to its sender the account or batch the recipient chose."
- **Why:** X-1.

#### A-9 · Module ownership, conventions and AD-9
- **Artifact:** SPINE · § Module ownership, § Consistency Conventions, AD-9
- **OLD:** "| `accounts` | `institution`, `account`, `account_owner`, `balance_snapshot` |"
- **NEW:** "…, `loan_terms`, `loan_rate_change`, `loan_interest_entry` |". Also: `imports` gains `import_handoff`; `planning` gains `home_plan`, `goal_drawdown`, `goal_adjustment` and `planning_setting` (and keeps `goal_rule`, with its `effective_until`/`source` override columns, since buffer divert stays per D8); `identity` gains `person_preference`.
- **OLD (AD-9):** "Every dead job appears on the status page with its kind and time only…"
- **NEW (AD-9):** "…appears in Settings › System status with its kind and time only…"
- **ADD convention rows:**
  - "Accessibility: WCAG 2.2 AA. An axe e2e check on every route fails CI. Every canvas chart has a table equivalent."
  - "Theming: a `data-theme` and mode attribute on `<html>`, with all tokens compiled (no inline styles). The choice is read from `person_preference` and cached locally only as a slug."
  - "Routes: `/` redirects to the landing page (`/transactions` until Cash flow ships, then `/cash-flow`)."
- **Why:** Items 3, 8, 10, 11; D6 drops `loan_plan_row`; planning list synced with G6 (G8 approval).

### 4.4 Epics and stories (10)

#### E-1 · tickets.toml epics 13–15, epic 10 slimmed, M3 gate
- **Artifact:** INIT tickets.toml; epic-tax-activities-property/epic-tax-activities-property.md
- **OLD (toml):** epic 10 `title = "Tax pack, activities and property"`, `covers = ["CAP-12", "CAP-13", "CAP-11"]`, `after = [{ epic = 9, needs = "realised capital gains, distributions and contributions" }]`; no epics 13–15.
- **NEW (toml):**
  - Epic 10: `title = "Tax pack and activities"`, `covers = ["CAP-12", "CAP-13"]`, `after += { epic = 14, needs = "property net cash for the rental schedule" }`. Slug stays.
  - Add `id = 13 slug = "epic-app-shell-settings-theming"`, covers CAP-21, `after` 12 ("entry 1: router, shell, shadcn"). Table position after 12.
  - Add `id = 14 slug = "epic-loans-property"`, covers CAP-20 and CAP-11, `after` 4 ("net worth and report queries") and 2 ("accounts and owners"); coordinates `domain/amortise` with epic 8.
  - Add `id = 15 slug = "epic-home-buying-planner"`, covers CAP-19, `after` 14, 6 ("pay_anchor gross and net pay") and 7 ("shared deposit goal").
  - Order: 1, 2, 12, 13, 11, 3, 4, 5, 6, 7, 8, 14, 15, 9, 10.
  - **M3 gate** moves to epic 15 (last M3 epic): "the home buying planner works on real data". Epic 8 is no longer the gate.
- **OLD (epic 10 .md):** "covers: [CAP-12, CAP-13, CAP-11]" · Description: "An investment-property view shows net cash position and gearing." · Done-when 4: "A seeded property shows the documented net cash position and gearing. It is hidden from the partner when its loan account is private." · Boundaries: "Tax reports, attachments and receipts, activities, and the property view. … The mortgage interest/principal split is a spec non-goal." · Handoff note: "…this epic adds the property table and the foreign key."
- **NEW (epic 10 .md):** Title "Tax pack and activities"; covers [CAP-12, CAP-13]. Drop the property sentence and Done-when 4; add "The rental schedule reads property net cash from epic-loans-property." Boundaries: replace "and the property view" with "; not the property view (epic-loans-property)"; drop the non-goal sentence. Move the `split.property_id` handoff note to epic 14.
- **Why:** Section 2; D3; G3 gate decision.

#### E-2 · Initiative covers, notes and Done-when
- **Artifact:** INIT initiative-pangolin-money-v1.md
- **OLD:** "covers: [CAP-1, CAP-2, … CAP-18]" · Notes: "- Decision: investment property (CAP-11) goes with the tax pack, not with insight (user's decision, 2026-09-27)."
- **NEW:**
  - covers adds CAP-19, CAP-20, CAP-21.
  - Mark the 2026-09-27 note superseded by: "Decision (2026-10-05, correct course after UX): CAP-11 moves to epic-loans-property (14), alongside CAP-20; new epics 13 (app shell, settings, theming), 14 (loans and property) and 15 (home buying planner). The M3 gate moves to epic 15. Lender repayment-plan import is deferred beyond v1. Every UI epic's Done-when includes 'axe e2e clean on its routes' (WCAG 2.2 AA)."
  - Done-when adds: "7. Every surface passes the WCAG 2.2 AA automated check."
- **Why:** Items 1, 10, 13; D3, D6, G3.

#### E-3 · Ledger workspace entry 2: `/transactions`
- **Artifact:** INIT epic-ledger-workspace/tickets.toml · entry 2
- **OLD:** "…the list page holds the filters in URL search params and renders a virtualised table."
- **NEW:** "…the list page at `/transactions` (`/ledger` redirects) holds the filters and the date range (Quarter · FY to date · Custom) in URL search params. It groups rows by date with a server-computed day net, shows a server-computed summary line (count, in, out), and renders a virtualised table. The nav badge counts the viewer's uncategorised rows."
- **Verify adds:** "`/ledger` redirects; no client sums." Update paths in `routing.spec.ts` and `ledger.spec.ts`.
- **Why:** Items 11, X-5, X-10.

#### E-4 · Ledger workspace entries 3 and 5, new entry 12
- **Artifact:** INIT epic-ledger-workspace/tickets.toml · entries 3, 5, new 12
- **OLD (entry 3 title):** "Edit splits, tags, beneficiary and hiding"
- **NEW (entry 3):** "Transaction sheet: splits, tags, notes, beneficiary and hiding". Description adds the owner's "Hidden from <partner> until <date>" tag and the partner's wink row ("Hidden until <date>").
- **OLD (entry 5):** "FTS5 over visibleTxn keyed on a stable integer, … and a basic search UI."
- **NEW (entry 5):** Append "; amount search ('142.85' exact, '142' whole dollars) beside FTS5".
- **NEW (entry 12):** "Bulk select: Categorise, Tag, Mark shared". Applied per row through `ledger.setSplitField`, with Undo. Mark shared refuses private-account rows (AD-7) and reports which. `after = [3]`; entry 9 `after` += 12.
- **Why:** X-10, X-11.

#### E-5 · Ledger workspace entry 4 and Boundaries
- **Artifact:** INIT epic-ledger-workspace/tickets.toml entry 4; epic-ledger-workspace.md § Boundaries
- **OLD:** "Create and edit accounts, owners and shares, and privacy (with the refusal when splits are shared), calling the accounts API."
- **NEW:** Append: "The Accounts page groups rows as Cash · Savings · Cards · Loans, with a separate Properties card placeholder. It shows the owner-only lock and the stale caption (newest import > 45 days). `/accounts/:id` shows the balance, freshness and that account's transactions."
- **Boundaries add:** "Not the app shell, Settings, sign-in route or themes (epic-app-shell-settings-theming). Not loan or property detail (epic-loans-property)."
- **Why:** Item 11; keeps epic 12 at M1 size; consistent with D3.

#### E-6 · Import epic: partial import, hand-off, inbox
- **Artifact:** INIT epic-import-dedupe-transfers/epic-import-dedupe-transfers.md
- **OLD (Done-when 2):** "Each format imports its committed anonymised sample. Re-importing the same file, or an overlapping range, adds zero rows."
- **NEW (Done-when 2):** Append: "A CSV, OFX or QIF file with unreadable rows commits its good rows and sets the rest aside with row number and reason. Fixing a set-aside row commits it through the same batch."
- **ADD Done-when:** "A file handed to the partner raises a hand-off item only she can see. She imports it into her private account, and the sender's responses are byte-identical to before (AD-5)."
- **ADD Done-when:** "Needs review shows every registered kind with its actions. The partner-pending count changes only with shared-visible items. Identity notices are review items and keep 'Revoke the link'."
- **Boundaries add:** "attachment storage (moved from epic 5), the Import popover, batch undo."
- **Why:** Items 5, 7, 12, X-1; D5.

#### E-7 · Spending insight: landing, net worth, leaks
- **Artifact:** INIT epic-spending-insight/epic-spending-insight.md · Description
- **OLD:** "Historical cash flow as a Sankey, P&L by group or category, spending over any period, and current net worth, all summed from visible splits."
- **NEW:** Prepend "Cash flow becomes the landing page (`/cash-flow`; `/` redirects there)." Append: "a net-worth page with trend; Biggest little leaks; and a 'My share / Everything I can see' toggle under an always-visible apportioned share line."
- **Why:** Items 4, 11, X-12.

#### E-8 · LLM epic: `row_interpret` guard
- **Artifact:** INIT epic-llm-categorisation-pdf/epic-llm-categorisation-pdf.md
- **OLD (Done-when 4):** "A cloud provider receives only description, amount, date and the category list, and never a private transaction. PDF extraction is refused on a cloud provider unless it is explicitly enabled."
- **NEW:** Append: "Set-aside row interpretation runs on a local provider by default. It is refused on a cloud provider unless explicitly enabled, never sends a private account's row to one, and creates nothing until the person confirms."
- **Boundaries:** drop attachment storage (now epic 3); add the Settings › LLM providers card and the ≥ 90% bulk-accept card; the rate-change target needs epic 14, so until then only transaction proposals ship.
- **Why:** Item 12, A-8; D5.

#### E-9 · Budgets, goals and forecasting epics
- **Artifact:** INIT epic-budgets-bills.md, epic-goals-savings.md, epic-forecasting.md · Description, Done-when, Boundaries
- **Epic 6:** OLD (Done-when 1) "For a seeded budget, spent, pace and projected match a hand calculation. Rollover carries correctly into the next period." → NEW append "The editor suggests a limit from the last 6 periods. Overspending raises one over-budget review item per budget per period."
- **Epic 7:**
  - OLD (Description) "A deficit draws down only the buffer (option A)." → NEW "A deficit draws down only the buffer (option A). A large purchase or a shortfall is covered by an explicit drawdown across goals by kind (Flexible, Protected, emergency fund)."
  - OLD (Done-when 2) "A deficit period reduces only the buffer, and no goal balance goes down." → NEW "…and no goal balance goes down except through a confirmed drawdown."
  - OLD (Done-when 3) "A seeded over-commitment shows a red shortfall on the goals page and in the review inbox. Any other mismatch offers a one-click adjustment to the buffer." → NEW "A seeded over-commitment shows a shortfall in the warning colour on the goals page and in the review inbox. Cover it proposes Flexible, then emergency fund, then Protected (warned); when the active stage gives the buffer a share, buffer divert is offered as the alternative (D8). Any other mismatch offers a one-click adjustment to the buffer."
  - ADD (Done-when): "A seeded shared-savings withdrawal over the threshold raises a Large withdrawal item for both partners. Covering it draws the emergency fund, then the proposed Flexible split, then Protected only after the warning. It writes one audited `goal_adjustment` per goal under one `goal_drawdown`, leaves both partners' personal goals untouched, and Undo restores every balance."
  - OLD (Boundaries) "goal, goal_rule, goal_allocation and allocation_stage, the goals page," → NEW "goal (kind, emergency fund), goal_rule, goal_allocation, allocation_stage, goal_drawdown and goal_adjustment, the goals page, the Cover an expense sheet, the large-withdrawal threshold and review item,"
- **Epic 8:** OLD (Done-when 3) "Net-worth assumptions (low, mid and high returns, savings rate, mortgage with offset, and super) are editable, and the projection redraws from them." → NEW append "Each transaction account has an editable low-balance threshold. Mortgage amortisation uses `domain/amortise`, shared with epic-loans-property."
- **Why:** Items 6, 14, X-3, X-4, X-13; D7, D8. Epic 7 grows by about one story; check sizing.

#### E-10 · New epic files 13, 14 and 15
- **Artifact:** INIT new epic `.md` files, created through bmad-preview-ticketing
- **OLD:** —
- **NEW:**
  - **Epic 13 "App shell, settings and theming" (M1).** Done-when: sidebar and phone tab bar; `/sign-in`; `/settings#…` with System status (incl. recovery-bundle warning), Sign-in & security, Signed-in devices, Partner (invite + reset), Household (pay cycles, 50/50) and Appearance, with the shipped HomePage cards moved here and their e2e specs updated; `/` interim redirect to `/transactions`; six themes × light/dark/system saved per person with no CSP violation; the axe harness in CI.
  - **Epic 14 "Loans and property" (M3).** CAP-20 Done-when (schedule estimated from terms, corrected by user-entered interest); CAP-11 Done-when (moved from epic 10 Done-when 4, reworded per SP-1); Add loan by hand, interest entries, Property detail. Notes: "Later work (beyond v1): import a lender's repayment plan to replace the estimated schedule (no file format defined; D6, 2026-10-05)."
  - **Epic 15 "Home buying planner" (M3, carries the M3 gate).** CAP-19 Done-when, including the AD-28 privacy test and a test that a reopened plan shows only its saved headline, with every other figure recomputed and "Some inputs are no longer shared" when an input was made private. Gate: the home buying planner works on real data.
- **Why:** Section 2; D3, D4, D6, G3.

### 4.5 UX (13)

#### U-1 · Settings gains a Household section
- **Artifact:** EXPERIENCE.md · § IA, Settings row
- **OLD:** "`/settings`, sections at `#appearance` · `#sign-in-security` · `#devices` · `#partner` · `#llm-providers` · `#system-status`"
- **NEW:** Add `#household`: pay cycles per person, the household pay anchor, and shared attribution (by contribution or 50/50).
- **Why:** Flow 7 links "pay cycle in Settings"; the spec's household anchor and 50/50 setting have no UI.

#### U-2 · System status card keeps the recovery-bundle warning
- **Artifact:** EXPERIENCE.md · § Component Patterns › System status card
- **OLD:** "Read-only: health, last backup, last restore drill, failed jobs (kind and time only, AD-9)."
- **NEW:** Append "; the recovery-bundle warning until its safe storage is confirmed (AD-27; shipped)."
- **Why:** Otherwise shipped epic-1 behaviour is dropped.

#### U-3 · Keep the shipped partner security actions
- **Artifact:** EXPERIENCE.md · § Needs review item kinds; § IA Settings › Partner
- **OLD:** "| Partner reset notice | \"Simon reset your sign-in on 3 Oct\" | Got it (plain, no cheek) |"
- **NEW:** "… | Got it · Revoke the link (plain, no cheek) |". Settings › Partner: "Invite <partner> (until both people exist) · Reset <partner>'s sign-in".
- **Why:** Keeps the shipped security actions.

#### U-4 · Property figures for a non-owner
- **Artifact:** EXPERIENCE.md · § Property Detail › Net cash
- **OLD:** "Scaled by ownership share in the viewer's figures"
- **NEW:** "Shown for the whole property, with a 'Your share (X%)' line beneath when the viewer owns part of it; a non-owner sees whole-property figures only."
- **Why:** The old wording would show Carissa $0 for Simon's 100% property. Approved in G2.

#### U-5 · Close § Spec Catch-up
- **Artifact:** EXPERIENCE.md · § Spec Catch-up
- **OLD:** "For `bmad-correct-course` / spec update after UX:" · row 3: "Loan detail with user-entered interest figures, extra repayments (yearly cap), offset slider, Add loan, lender plan import" · row 12: "…bad rows set aside for fixing (replaces all-or-nothing)…"
- **NEW:** Intro: "Handed to correct course on 2026-10-05 (see the sprint change proposal). Additional items found: hand-off, set-aside AI purpose, budget suggestion, over-budget item, theme storage, signed-in devices, shared saved plans, and the category and rule management surface (still undesigned)." Row 3: drop "lender plan import", add "(lender plan import deferred beyond v1)". Row 12: "(replaces all-or-nothing for CSV/OFX/QIF; PDF stays all-or-nothing)". Rows 14 and 15: see U-9 and U-12.
- **Why:** Closes the hand-off loop; D5, D6.

#### U-6 · Drop lender-plan import from Loan detail
- **Artifact:** EXPERIENCE.md · § Loan Detail and § Lifted from SmartSpend; mockups/key-loan-detail.html
- **OLD:** "- **Lender's plan:** \"Import the lender's repayment plan\" replaces the estimated schedule when provided." · SmartSpend: "…what-if with yearly cap, lender plan import);" · Mock: "Estimate: the schedule is worked out from the rate and term. <span class=\"link\">Import the lender&#8217;s repayment plan</span> to replace it."
- **NEW:** Loan Detail bullet: "- **Schedule:** estimated from the loan's terms and corrected by entered interest figures; the caption reads 'Estimate: worked out from the rate and term.' Importing a lender's repayment plan is later work (not in v1)." · SmartSpend: "…lender plan import (deferred))". · Mock: remove the import link span; keep the estimate caption.
- **Why:** D6.

#### U-7 · Saved plan row stores a headline snapshot
- **Artifact:** EXPERIENCE.md · § Component Patterns › Saved plan row
- **OLD:** "Name, timestamp, snapshot of inputs and outputs. Reopening shows the snapshot beside today's recalculation."
- **NEW:** "Name, timestamp, the typed inputs and choices, and a headline snapshot (borrow, repayment, left to live on, as both saw them). Reopening shows that headline beside today's recalculation from the saved inputs and currently shared data. Inputs that are no longer shared drop out, with 'Some inputs are no longer shared'."
- **Why:** D4.

#### U-8 · Import popover: PDF exception and local-by-default AI read
- **Artifact:** EXPERIENCE.md · § Interaction Primitives › Import popover, steps 5 and 6
- **OLD (step 5):** "**Bad rows don't block the file.** Good rows import."
- **NEW (step 5):** "**Bad rows don't block a CSV, OFX or QIF file.** Good rows import. … A PDF statement with a failed check still blocks as a whole and shows rows beside the page image."
- **OLD (step 6):** "…sends the set-aside lines to the configured LLM provider (providers are set per purpose, and cloud providers are opt-in, per the spec)."
- **NEW (step 6):** "…sends the set-aside lines to the provider assigned to row reading. That is a local provider by default; a cloud provider is used only if explicitly enabled, and never for a private account's rows."
- **Why:** D5.

#### U-9 · Shortfall copy, Needs review row, Toast and Spec Catch-up
- **Artifact:** EXPERIENCE.md · § Voice (Goal shortfall), § Needs review item kinds (Goal shortfall), Toast row, § Spec Catch-up row 14, Planning mocks line
- **OLD (Voice):** "Gentle and exact: \"Your goals are $320 ahead of what's in the bank. Move $50/fortnight from the buffer?\" / \"…Push House deposit out to May 2028?\" [ASSUMPTION copy]"
- **NEW (Voice):** "Gentle and exact: \"Your goals are $320 ahead of what's in the bank. Cover it from your goals?\" / \"…Or move $50/fortnight from the buffer until it's covered?\" [ASSUMPTION copy]"
- **OLD (Needs review):** "The fix that applies, per Goal card: Move $X/fortnight from the buffer **or** Push <goal> out to <month> · Open goals"
- **NEW:** "Cover it (opens Cover an expense, shortfall order) · Move $X/fortnight from the buffer (only when the stage gives the buffer a share) · Open goals"
- **OLD (Toast):** "…bulk edits, shortfall fix, confirmed AI-read row) [ASSUMPTION]."
- **NEW:** "…bulk edits, shortfall fix, confirmed drawdown, confirmed AI-read row) [ASSUMPTION]."
- **OLD (Spec Catch-up row 14):** "Goal shortfall fix: buffer move when the active stage gives the buffer a share, else push out the active stage's lowest-priority goal (Undo)"
- **NEW:** "Goal kinds (Flexible / Protected, one emergency fund per pool); Cover an expense for large purchases and shortfall; Large withdrawal item; buffer divert as a shortfall alternative (Undo)". Touches: "CAP-6, CAP-7, AD-17, AD-24".
- **OLD (Planning mocks):** "[key-goals.html](mockups/key-goals.html) (stage card, both shortfall fixes, Undo toast)"
- **NEW:** "…(stage card, kind and emergency-fund badges, shortfall line, Undo toast) · [key-cover-expense.html](mockups/key-cover-expense.html) (large purchase and shortfall orders, sliders, protected warning)"
- **Why:** D7, D8.

#### U-10 · Goal card kind and emergency fund badge, goal editor
- **Artifact:** EXPERIENCE.md · Goal card row; DESIGN.md · § Goal card, § Layout (Budgets / Goals)
- **OLD (EXPERIENCE Goal card):** "Shortfall shows a warning line (warning colour, never money-out red) with a single one-click fix: **Move $X/fortnight from the buffer** when the buffer has room (the active stage allocates it a share of each fortnight), otherwise **Push <goal> out to <month>**, which delays the active stage's lowest-priority goal. Either applies immediately and offers Undo in a toast."
- **NEW:**
  - "The card shows a **Protected** badge (shield icon plus text) or nothing for Flexible, and an **Emergency fund** badge on the pool's emergency fund."
  - "**Goal editor** (Sheet, from Add a goal or the card's pencil): name; pool (Shared or own); target; kind, a ToggleGroup **Flexible · Protected** with captions 'First to give way when something comes up' / 'Only touched as a last resort, with a warning'; and an **Emergency fund** switch, disabled with 'Shared savings already has one: Rainy day' when the pool has one."
  - "Goals header gains **Cover an expense** (secondary button) beside Add a goal."
  - "Shortfall shows a warning line (warning colour, never money-out red) with **Cover it**, and **Move $X/fortnight from the buffer** only when the active stage gives the buffer a share."
- **OLD (DESIGN Goal card, shortfall state):** "with the one-click fix as a `{components.button-secondary}` inside it: \"Move $50/fortnight from the buffer\" when the active stage gives the buffer a share, otherwise \"Push House deposit out to May 2028\" (the active stage's lowest-priority goal)."
- **NEW:** "…with **Cover it** as a `{components.button-secondary}` inside it, plus a plain-text **Move $50/fortnight from the buffer** when the active stage gives the buffer a share." Anatomy adds: "kind badge (`Badge`, outline, shield icon, 'Protected'); emergency-fund badge (`Badge`, `{colors.accent}` fill, 'Emergency fund'). Badges sit after the scope badge and always carry text."
- **OLD (DESIGN Layout, Goals mock):** "(stage card; shortfall fixed by pushing a goal's arrival date out, and by moving savings from the buffer when the buffer has a share)"
- **NEW:** "(stage card; kind badges; shortfall line with Cover it)"
- **Why:** D7, D8.

#### U-11 · Cover an expense: component pattern, states and Voice
- **Artifact:** EXPERIENCE.md · § Component Patterns › Planning (new row), § States, § Voice; DESIGN.md · § Components › Planning (new entry)
- **OLD:** — (new component)
- **NEW (EXPERIENCE):** A Sheet opened from Goals (Cover an expense), a Large withdrawal item (Cover it) or a shortfall (Cover it). Header: amount, label ('Car repair'), pool, reason; typed from Goals, pre-filled from an item. Sections in the reason's order (large purchase: Emergency fund → Flexible → Protected; shortfall: Flexible → Emergency fund → Protected). Each goal row: name, balance, Slider plus amount input (0 to its balance), and its new arrival line from the server. Pangolin pre-fills the proposal; after each change the server returns **Left to cover** and arrival lines. Protected is collapsed and disabled until earlier sections are at maximum; then a warning line appears with **Use protected goals**, and only after that click do Protected sliders unlock. **Confirm cover** (primary) is enabled when Left to cover is $0 or nothing more is eligible; it applies, closes the sheet and offers Undo in a toast. Only goals in the expense's pool appear, never the partner's personal goals.
- **NEW (States):** Proposed (pre-filled split) · Adjusted ('Back to Pangolin's split' link) · Not covered yet (Left to cover in warning colour, Confirm disabled) · Protected needed (warning line plus Use protected goals) · Can't cover it all ('Goals can cover $X of $Y. The rest stays with the buffer.' for purchase, '…stays flagged' for shortfall) · Emergency fund below threshold ('Stage 1 comes back until Rainy day is topped up.') · Confirmed (toast with Undo) · Undone (balances restored; item reappears if still true) · Recalculating (figures at 60% opacity).
- **NEW (Voice):** Cover an expense: plain and exact, at most one light header line ("Things break. Here's where it can come from.") [ASSUMPTION copy]; no cheek on the protected warning or the cannot-cover line. Protected warning: "This takes $1,200 from House deposit, which you've marked Protected. Its arrival moves from Mar 2028 to Apr 2028." [ASSUMPTION copy]. Never "Uh-oh", never a mascot.
- **NEW (DESIGN):** "shadcn Sheet (right on desktop, bottom on phone). Header amount in `{typography.figure-stat}`. Section labels in `{typography.label-caps}`. Rows: name and badges, balance tabular, `Slider` (as § Slider) with an adjacent tabular input, and the arrival line `{typography.body-sm}` muted (moved dates in `{colors.foreground}`). A sticky footer holds Left to cover (tabular; `{colors.warning}` when above $0) and `{components.button-primary}` Confirm cover. The Protected section uses a `{components.warning-line}` with a warning glyph, never `destructive` or money-out red. The mascot is absent."
- **Why:** D7. The protected warning is a money warning, so it is never cheeky.

#### U-12 · Large withdrawal review item kind
- **Artifact:** EXPERIENCE.md · § Needs review item kinds (new row), Navigation table Needs review row, § Spec Catch-up (new row 15); DESIGN.md · Needs review "By kind"
- **OLD (Navigation):** "…bills, over budget, goal shortfall |"
- **NEW (Navigation):** "…bills, over budget, large withdrawal, goal shortfall |"
- **NEW (item row):** Large withdrawal · "$16,400 came out of Shared savings on 12 Nov" plus the transaction row · Actions: **Cover it** (primary; Cover an expense, large-purchase order) · **It's for a goal** (link to one goal via existing `goal_link`) · **Take it from the buffer** (only when the buffer covers it; left as is) · **Not an expense** (e.g. a move to an offset account). Scope per AD-22: shared pool → both partners; personal pool → that person; private account → owner only.
- **NEW (DESIGN by kind):** "Large withdrawal: a `{colors.warning}` icon, with the withdrawal row inside."
- **NEW (Spec Catch-up row 15):** "Large withdrawal review item (threshold per pool, default $2,000 [ASSUMPTION])" | "AD-17, AD-24, CAP-7"
- **Why:** D7 (detection). Threshold ≥ $2,000 per pool, editable in Goals (approved assumption).

#### U-13 · Flow 6 rewrite and new Flow 10 "Car disaster"
- **Artifact:** EXPERIENCE.md · Flows table, Flow 6 steps 1, 5–6, new Flow 10 (replaces the earlier U-9 flow edits)
- **OLD (step 5):** "Months later a withdrawal leaves goals $320 ahead of the bank. While the buffer has room, the warning line offers **Move $50/fortnight from the buffer**; this stage gives the buffer no share, so it offers **Push House deposit out to May 2028** instead (per Goal card). The same item sits in Needs review."
- **OLD (step 6):** "Simon clicks the fix; the shortfall clears, the arrival line updates, and a toast offers Undo."
- **NEW (step 1):** Append "…and marks it **Protected**."
- **NEW (step 5):** "Months later small withdrawals leave goals $320 ahead of the bank. The warning line offers **Cover it**. This stage gives the buffer no share, so no buffer option is shown. The same item sits in Needs review."
- **NEW (step 6):** "Simon clicks Cover it. Pangolin proposes $320 across the Flexible goals in proportion to their balances ($267 from Japan trip, $53 from New couch). He confirms, the shortfall clears, House deposit is untouched, and a toast offers Undo."
- **NEW (Flows table row):** "10 — Car disaster | Simon and Carissa | The deposit barely moves"
- **NEW (Flow 10):**
  1. The car needs a new engine. Carissa moves $16,400 from Shared savings to Shared bills and pays the mechanic.
  2. After the next import, a Large withdrawal item lands in both Needs review: "$16,400 came out of Shared savings on 12 Nov".
  3. Carissa clicks **Cover it**. Emergency fund "Rainy day" $8,000 (all of it), then Flexible: Japan trip $6,000 and New couch $1,200 at their maximum. Left to cover: $1,200.
  4. Protected unlocks behind the warning: "This takes $1,200 from House deposit, which you've marked Protected. Its arrival moves from Mar 2028 to Apr 2028." She clicks **Use protected goals**.
  5. Simon would rather keep the couch money. She drags New couch to $0; Left to cover shows $1,200, so she drags House deposit up to $2,400. The arrival line updates from the server.
  6. **Climax:** She confirms. "Rainy day's below 80%. Stage 1 comes back until it's topped up." House deposit moves from Mar 2028 to May 2028, not years, and they can see exactly why.
  7. Carissa's personal "Pilates retreat" goal and Simon's personal goals are never listed or touched. Both see "Carissa covered Car repair, 12 Nov" in Goals history. A toast offers Undo.
  - **Failure:** the withdrawal was a move to the offset account → **Not an expense**. They change their minds a day later → Undo from Goals history (period open) restores every goal and re-raises the item.
- **Why:** D7. Exercises detection, order, sliders, the protected warning, privacy across pools and undo.

## 5. Implementation Handoff

**Scope classification: Major.** New capabilities (CAP-19, CAP-20, CAP-21), a new AD-28, three new epics and a changed M3 gate need PM- and Architect-level artifact edits before the backlog is regenerated through bmad-preview-ticketing.

### 5.1 Ordered actions

| # | Action | Proposals | Owner |
|---|---|---|---|
| a | Apply spec edits: SPEC.md (CAP-1, 4, 6, 7, 11, new 19–21, non-goal, constraints, companions), import-pipeline.md, categorisation.md, data-model.md, investments-super-tax.md, budgets-goals-forecasting.md, deployment-and-ops.md, decisions.md; write new home-buying.md | SP-1 to SP-16, SP-10a, SP-15a | PM (bmad-spec Update) |
| b | Apply architecture edits: AD-3, AD-5, AD-6, AD-9, AD-11, AD-17, AD-21, AD-22, AD-23, AD-24, new AD-28; module ownership; conventions (accessibility, theming, routes) | A-1 to A-9 | Architect (bmad-architecture Update) |
| c | Apply UX edits to EXPERIENCE.md and DESIGN.md; mocks: **new** `key-cover-expense.html` (desktop + phone, both orders, protected warning, Left to cover); **redraw** `key-goals.html` (drop push-out; kind and emergency-fund badges, Cover an expense button, Cover it on the shortfall line); **extend** `key-needs-review.html` (Large withdrawal item); **remove** the lender-plan link in `key-loan-detail.html` | U-1 to U-13 | UX designer (bmad-ux Update) |
| d | Regenerate backlog via bmad-preview-ticketing: tickets.toml (epics 13–15, epic 10 slimmed and `after` 14, new order, M3 gate on 15); epic files 13, 14, 15; amend epic 3–8 and 10 files; epic 12 entries 2–5 amended and new entry 12; initiative covers, notes and Done-when 7 | E-1 to E-10 | PM / SM (bmad-preview-ticketing) |
| e | Follow-ups: bmad-ux Update for the undesigned **categories and rules management surface**; record **later work** (beyond v1): lender repayment-plan import (no file format defined; D6) | U-5, E-10 | UX designer; PM |

Order matters: (a) and (b) before (d); (c) can run beside (a)–(b). Epic 12 continues throughout; slice epics 3, 7, 14 and 15 only after (a)–(d).

### 5.2 Handoff recipients

| Recipient | Responsibility |
|---|---|
| PM (John) | Spec edits and home-buying.md; initiative notes; backlog regeneration with SM; owns the later-work list |
| Architect (Winston) | SPINE edits and AD-28; confirms `domain/amortise` coordination between epics 8 and 14; `planning_setting` placement [ASSUMPTION] |
| UX designer (Sally) | EXPERIENCE/DESIGN edits, the four mock changes, then the categories and rules management Update |
| Dev (Amelia) | Continues epic 12 with amended entries 2–5 and new entry 12; epic 13 shipped-code rework (redirects, HomePage → Settings, palette, e2e specs) |
| Simon and Carissa | Final acceptance of this proposal (status moves from approved-pending-final to approved) |

### 5.3 Success criteria

- Every proposal in § 4 is applied, and no artifact still contradicts a decision D1–D8 (no "red" shortfall, no push-out, no lender-plan import, no `loan_plan_row`, no CAP-11 in epic 10).
- tickets.toml lists epics in order 1, 2, 12, 13, 11, 3, 4, 5, 6, 7, 8, 14, 15, 9, 10, and epic 15's Done-when carries the M3 gate.
- EXPERIENCE.md § Spec Catch-up is closed and points to this proposal; the four mock changes exist.
- Epic 12 keeps M1 size (shell, Settings, themes live in epic 13), and the shipped e2e suite passes after the route and Settings moves.
- Every UI epic's Done-when includes "axe e2e clean on its routes".

## Approval

Approved by Simon Wilson on 2026-10-05. Scope: Major. Routed to PM/Architect-level artifact edits (spec, architecture, UX), then backlog changes via bmad-preview-ticketing.
