# Data model

One bank line becomes one transaction row with one or more splits. Categories, tax treatment, activity and person all live on the split, so every report is a sum over splits. Transfers between own accounts are two transactions linked by a transfer group. Investments and super use their own unit-based tables rather than cash rows.

**Why not full double-entry?** Bank feeds are single-sided, and Actual and Monarch both use this shape. Double-entry's guarantee (every movement balances) is recovered where it matters by transfer links and reconciliation against statement balances. Investments get lot-level accounting, which is the one place double-entry rigour actually pays off.

## Conventions

- `STRICT` tables and `PRAGMA foreign_keys = ON`, so SQLite enforces column types.
- IDs are ULIDs, sortable by creation time and generated on the server only.
- Money is integer minor units of the household's base currency (AUD by default; decimal places come from ISO 4217, so JPY would have none). Every account stores its currency code; v1 requires it to match the base currency. Units are integer micro-units (units × 10⁶). Prices are decimal strings.
- Dates are `YYYY-MM-DD` text; timestamps are UTC ISO-8601.
- Every table has `created_at` and `updated_at`. User-facing records soft-delete with `deleted_at`.
- Every write goes through the service layer, which also writes `audit_log`.

## Tables

| Area | Table | Holds | Key columns |
| --- | --- | --- | --- |
| People | `person` | Each of us, linked to a login | `user_id`, `display_name`, `colour`, `pay_anchor_date`, `pay_cadence` |
| People | `person_preference` | Each person's appearance | `person_id`, `theme`, `mode` (light, dark, system) |
| People | better-auth tables | Users, sessions, passkeys, TOTP secrets | managed by the library |
| Accounts | `institution` | Bank, broker, super fund | `name`, `kind`, `website_url` |
| Accounts | `account` | Any balance we track | `type` (transaction, savings, offset, credit_card, home_loan, brokerage, super, property, vehicle, other), `currency`, `is_private`, `opened_on`, `closed_on`, `is_savings`, `credit_limit_cents` |
| Accounts | `account_owner` | Who owns it and in what share | `account_id`, `person_id`, `share_bp` (basis points: 5000 = 50%) |
| Accounts | `balance_snapshot` | Statement, API or manual balances | `account_id`, `as_of`, `balance_cents`, `source` |
| Accounts | `loan_terms` | A loan's contract terms, entered by hand or from an import | `account_id`, `lender`, `loan_type`, `borrowed_cents`, `start_on`, `term_months`, `repayment_cents`, `repayment_cadence` (weekly, fortnightly, monthly), `comparison_rate`, `yearly_extra_cap_cents`, `offset_account_id`. No nominal-rate column: the starting rate is the loan's first `loan_rate_change` row (`effective_from` = `start_on`) |
| Accounts | `loan_rate_change` | A loan's nominal rate over time; the first row is the initial rate | `account_id`, `effective_from`, `rate` |
| Accounts | `loan_interest_entry` | Interest charged for a period, from a statement | `account_id`, `period_start`, `period_end`, `interest_cents`, `source` (user, statement) |
| Ledger | `transaction` | One bank line | `account_id`, `posted_on`, `amount_cents`, `description_raw`, `payee_id`, `status`, `external_id`, `fingerprint`, `import_id`, `performed_by`, `transfer_group_id`, `needs_review`, `is_hidden`, `name_hidden_by`, `name_hidden_until`, `notes` |
| Ledger | `split` | Where the money went (≥ 1 per transaction; amounts sum to the parent) | `transaction_id`, `amount_cents`, `category_id`, `activity_id`, `beneficiary` (shared or a person), `property_id`, `tax_category_id`, `deductible_bp`, `memo` |
| Ledger | `transfer_group` | Links both sides of an internal transfer | `id`, `matched_by` (rule, manual, auto) |
| Classify | `category_group` | Report groups (Income, Housing, Food, a rental property) | `name`, `kind`, `sort` |
| Classify | `category` | Leaf categories | `group_id`, `name`, `is_fixed_cost` |
| Classify | `tag`, `split_tag` | Free-form labels | many-to-many |
| Classify | `activity` | "Japan Trip 2026", "Conference" | `name`, `starts_on`, `ends_on`, `budget_cents` |
| Classify | `payee` | Clean merchant identity | `name`, `website_url`, `logo_attachment_id`, `default_category_id` |
| Classify | `payee_alias` | Raw-description patterns that map to a payee | `pattern`, `match_kind`, `payee_id` |
| Classify | `rule` | Deterministic categorisation | `priority`, `conditions` (JSON), `actions` (JSON), `origin` (user, llm_suggested) |
| Classify | `suggestion` | LLM proposals awaiting review | `split_id`, `field`, `value`, `confidence`, `model`, `status` |
| Import | `import_profile` | Per-bank CSV mapping | `institution_id`, `columns` (JSON), `date_format`, `sign_convention` |
| Import | `import_batch` | One uploaded file (CSV, OFX, QIF or PDF) | `account_id`, `source`, `file_sha256`, `row_count`, `new_count`, `dup_count`, `status` |
| Import | `import_row` | Parsed rows awaiting review and commit, with the PDF page each came from | `batch_id`, `row_number`, `raw_line`, `status` (staged, committed, set_aside, discarded), `reason`, `pdf_page` |
| Import | `import_handoff` | A file imported for the partner, waiting for them to pick an account | `attachment_id`, `sender_person_id`, `recipient_person_id`, `status`, `batch_id` |
| Planning | `budget` | A cap per category or group | `category_id` or `group_id`, `scope` (shared or person), `period` (fortnight, month), `anchor_date`, `amount_cents`, `rollover` |
| Planning | `recurring_series` | Detected or confirmed bills | `payee_id`, `account_id`, `cadence`, `expected_cents`, `tolerance_bp`, `next_due_on`, `status` |
| Planning | `goal` | Savings target | `name`, `person_id` (null for the shared pool), `target_cents`, `target_date`, `priority`, `kind` (flexible, protected), `is_emergency_fund` (at most one per pool), `completed_at` |
| Planning | `goal_rule` | % of each period's savings | `goal_id`, `stage_id`, `share_bp`, `effective_from`, `effective_until` (nullable), `source` (rule, shortfall_override). A shortfall override is a time-boxed rule that diverts $X/fortnight to the buffer |
| Planning | `goal_drawdown` | One confirmed cover | `person_id` (null for shared), `reason` (large_purchase, shortfall), `label`, `amount_cents`, `transaction_id` (nullable: the covered withdrawal), `created_by`, `created_at`, `undone_at` |
| Planning | `goal_adjustment` | One goal's debit within a drawdown | `drawdown_id`, `goal_id`, `amount_cents` (debit) |
| Planning | `planning_setting` | Per-pool planning settings [ASSUMPTION: home of the threshold] | `person_id` (null for shared), `large_withdrawal_threshold_cents` |
| Planning | `goal_allocation` | Virtual money assigned per period | `goal_id`, `period_start`, `allocated_cents` |
| Planning | `allocation_stage` | `name`, `sort`, `exit_goal_id`, `fallback_threshold_bp`, `completed_share_policy` (rescale or buffer). The active stage is derived from goal balances, not stored. | |
| Planning | `home_plan` | A named saved home buying plan, shared by both | `name`, `created_by`, `inputs` (JSON of typed values and choices), `scenarios` (JSON), `headline` (JSON of borrow, repayment and left to live on at save time); no other figures stored |
| Invest | `security` | ETF, share or cash | `code` (e.g. `VAS.AX`), `name`, `kind` |
| Invest | `investment_event` | Buy, sell, distribution, reinvestment, cost-base adjustment | `account_id`, `security_id`, `trade_date`, `kind`, `units_micro`, `price`, `fees_cents`, `amount_cents` |
| Invest | `lot` | Parcels for capital-gains calculations | `buy_event_id`, `units_remaining_micro`, `cost_base_cents` |
| Invest | `price` | Daily closes | `security_id`, `date`, `close`, `source` |
| Super | `super_option` | A fund's investment option | `institution_id`, `name`, `product` (accumulation, income) |
| Super | `super_holding` | Units per option over time | `account_id`, `option_id`, `units_micro`, `as_of` |
| Super | `unit_price` | Daily published price | `option_id`, `date`, `price` |
| Super | `contribution` | Money into super | `account_id`, `date`, `kind` (SG, salary sacrifice, personal concessional, non-concessional), `amount_cents` |
| Tax | `tax_category` | ATO deduction labels (D1–D10 and so on) | `code`, `label`, `default_deductible_bp` |
| Tax | `attachment`, `transaction_attachment` | Receipts and statements, encrypted on disk | `sha256`, `mime`, `bytes`, `path` |
| Property | `property` | `name`, `place`, `kind` (investment, home), `loan_account_id`, `value_account_id`, `weekly_rent_cents`, `purchase_price_cents`, `purchased_on`, `cost_base_adjustments_cents`. Ownership comes from the value account's `account_owner`. Rental income and property costs link to it through `split.property_id`. | |
| System | `job` | Scheduled and queued work | `kind`, `run_at`, `status`, `attempts`, `payload` |
| System | `audit_log` | Who changed what | `user_id`, `entity`, `entity_id`, `action`, `before`, `after` |
| Config | `household_settings` | `base_currency` (default AUD), `fy_start` (07-01), `timezone` (Australia/Sydney), `shared_attribution` (by contribution or 50/50) | |
| LLM | `llm_provider` | `kind` (openai or anthropic), `base_url`, `model`, encrypted `api_key`, `is_local`, allowed purposes (categorise, PDF extraction, row interpretation) | |

No `loan_plan_row` table: importing a lender's repayment plan is later work, so a loan's schedule is estimated from `loan_terms` and corrected by `loan_interest_entry`.

## Privacy enforcement

Queries never touch `account` or `transaction` directly. They go through `visibleAccounts(viewer)` and `redact(viewer, rows)`. There are two kinds of privacy:

- **Private accounts** are seen only by their owner; to the other partner they don't exist. Each person has one view: household totals and net worth cover everything that person can see, including their own private accounts, so the two partners' household figures can differ. Shared figures (shared-beneficiary spending, the shared savings pool, contribution) never include private money and are identical for both.
- **Hidden transactions** sit in shared or public accounts (e.g. a birthday present).
  - Only the name is hidden from the other partner: payee, description and merchant logo. They see "Hidden until 12 Mar 2027" instead.
  - Amount, date, category, tags and notes stay visible, so totals and reports stay correct.
  - Hiding lasts at most 12 months (`name_hidden_until`), then lifts automatically.
  - Hidden names are excluded from the partner's search results and exports.
