# Pangolin Money — Architecture & Data Model

Sep 27, 2026 · @Simon

## Goals and constraints

Pangolin Money is a self-hosted web app for two people that shows where our money goes, what we can save, and how we're tracking against goals. Our own SQLite database is the single source of truth; no existing finance app sits underneath.

**Non-negotiables**

- Private data never leaves the server by default. No third-party aggregators, no telemetry. A cloud LLM is used only if we explicitly configure one. Outbound traffic is limited to an allowlist: public price and unit-price pages, plus any LLM endpoint we configure.
- Built for a couple: shared and individual views, with per-person privacy for accounts and transactions (see Security model).
- Australian by default: AUD, July–June financial year, fortnightly pay cycles, ATO tax categories, super.
- One-command install and upgrade on Linux: Debian 13 first, then Ubuntu and Rocky Linux. Works behind an existing reverse proxy (Nginx Proxy Manager) that handles Let's Encrypt. Encrypted backups with a restore that CI actually tests.
- Web and mobile through one responsive app, installable as a PWA (progressive web app, i.e. added to the home screen). No app-store app.

**Data sources in v1**

| Source | Method |
| --- | --- |
| CommBank | OFX preferred (stable transaction IDs); CSV and QIF also supported |
| ubank | CSV / statement export |
| Up (history only) | CSV export taken before the account closes |
| Any bank or broker statement | PDF, extracted by the LLM and checked against the statement's opening and closing balances |
| Betashares Direct | Manual holdings + public prices (statement parsing in a later version) |
| CMC Invest | Trade confirmations CSV |
| QSuper, Aware Super | Units held × published daily unit price; contributions entered or imported from statements |

**Out of scope for v1:** unofficial CommBank/ubank API clients (they hold full-access credentials), scraping member portals, paid aggregators, and the Up API (the account is closing).

## Architecture

One Node process serves the API and the built frontend, runs scheduled jobs, and is the only thing that writes to SQLite. That matches SQLite's single-writer model and keeps operations to one app container behind the reverse proxy we already run (Nginx Proxy Manager). A bundled Caddy profile for installs without a proxy is deferred to the next version.

&#91;embedded content: system architecture · one app container, one database\]

- **Frontend:** a React single-page app, served as static files by the same process. It is installable on phones as a PWA.
- **Domain services:** plain TypeScript modules with no HTTP or database types in their signatures (ledger, import, rules, budgets, forecasting, tax). They are unit-tested in isolation, the same split you'd use in a Rust crate.
- **Job runner:** jobs are rows in a SQLite table, polled in-process. It handles price and unit-price fetches, the LLM categorisation and PDF-extraction queues, recurring-bill detection and nightly backups. It needs no Redis or queue server.
- **Ollama** on a LAN machine with a GPU is the default LLM. The provider is configurable: any OpenAI-compatible or Anthropic-compatible endpoint, with an optional API key (see Categorisation).

## Tech stack

TypeScript end to end, strict mode, one repo. Every choice below is mainstream and well documented, so AI coding tools and search results cover it well.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | Closest to Swift/Rust discipline available on the web |
| Runtime | Node 22 LTS | Most stable; Bun optional later |
| Package manager | pnpm workspaces | Cargo-workspace equivalent |
| HTTP server | Hono | Small and typed, with typed RPC clients for the frontend |
| Database | SQLite via better-sqlite3, WAL mode | Synchronous, fast, single file |
| Queries + migrations | Drizzle ORM + drizzle-kit | SQL-shaped, typed, generates migration SQL you commit |
| Validation | Zod | Parse at every boundary (CSV rows, API bodies, LLM output) |
| Auth | better-auth | Passkeys, TOTP (authenticator codes), sessions, rate limiting |
| Frontend | React 19 + Vite | Largest ecosystem |
| UI kit | shadcn/ui + Tailwind CSS | Copy-in components you own; the look in the SharkFin screenshots |
| Data fetching | TanStack Query | Caching, refetch, optimistic edits |
| Routing | TanStack Router | Type-safe routes and search params (filters live in the URL) |
| Tables | TanStack Table + virtualisation | Transaction list with thousands of rows |
| Charts | Apache ECharts | Sankey, stacked area, treemap and calendar heatmaps built in |
| Money | Integer cents in a branded `Cents` type; `decimal.js` only for unit prices and FX | No floats anywhere near money |
| Dates | Temporal polyfill (`@js-temporal/polyfill`) | Plain dates without timezone bugs; FY and fortnight maths |
| Tests | Vitest (unit), Playwright (end to end) | Fast; Playwright drives a real browser in CI |
| Lint/format | Biome | One tool, like rustfmt + clippy |
| LLM | Two provider adapters: OpenAI-compatible (Ollama, LM Studio, vLLM, OpenAI, OpenRouter) and Anthropic Messages API; optional API key; schema-constrained output | Local by default; cloud only by explicit opt-in |
| Reverse proxy | Nginx Proxy Manager (existing); bundled Caddy as an optional Compose profile is deferred to the next version | NPM already handles Let's Encrypt; Caddy would cover installs without a proxy |
| Backups | restic (encrypted, deduplicated) + `VACUUM INTO` snapshots | Consistent snapshot, encrypted copy to TrueNAS in append-only mode |
| CI/CD | GitHub Actions to GHCR images; Renovate for updates | Tag-driven releases |

## Data model

One bank line becomes one transaction row with one or more splits. Categories, tax treatment, activity and person all live on the split, so every report is a sum over splits. Transfers between our own accounts are two transactions linked by a transfer group. Investments and super use their own unit-based tables rather than cash rows.

**Why not full double-entry?** Bank feeds are single-sided, and Actual and Monarch both use this shape. Double-entry's guarantee (every movement balances) is recovered where it matters by transfer links and reconciliation against statement balances. Investments get lot-level accounting, which is the one place double-entry rigour actually pays off.

**Conventions**

- `STRICT` tables and `PRAGMA foreign_keys = ON`, so SQLite enforces column types.
- IDs are ULIDs: sortable by creation time and safe to generate client-side.
- Money is integer minor units of the household's base currency (AUD by default; decimal places come from ISO 4217, so JPY would have none). Every account stores its currency code; v1 requires it to match the base currency. Units are integer micro-units (units × 10⁶). Prices are decimal strings.
- Dates are `YYYY-MM-DD` text; timestamps are UTC ISO-8601.
- Every table has `created_at` and `updated_at`. User-facing records soft-delete with `deleted_at`.
- Every write goes through the service layer, which also writes `audit_log`.

| Area | Table | Holds | Key columns |
| --- | --- | --- | --- |
| People | `person` | Each of us, linked to a login | `user_id`, `display_name`, `colour`, `pay_anchor_date`, `pay_cadence` |
| People | better-auth tables | Users, sessions, passkeys, TOTP secrets | managed by the library |
| Accounts | `institution` | Bank, broker, super fund | `name`, `kind`, `website_url` |
| Accounts | `account` | Any balance we track | `type` (transaction, savings, offset, credit\_card, home\_loan, brokerage, super, property, vehicle, other), `currency`, `is_private`, `opened_on`, `closed_on`, `is_savings` |
| Accounts | `account_owner` | Who owns it and in what share | `account_id`, `person_id`, `share_bp` (basis points: 5000 = 50%) |
| Accounts | `balance_snapshot` | Statement, API or manual balances | `account_id`, `as_of`, `balance_cents`, `source` |
| Ledger | `transaction` | One bank line | `account_id`, `posted_on`, `amount_cents`, `description_raw`, `payee_id`, `status`, `external_id`, `fingerprint`, `import_id`, `performed_by`, `transfer_group_id`, `needs_review`, `is_``hidden`, `name_hidden_by`, `name_hidden_until`, `notes` |
| Ledger | `split` | Where the money went (≥ 1 per transaction; amounts sum to the parent) | `transaction_id`, `amount_cents`, `category_id`, `activity_id`, `beneficiary` (shared or a person), `property_id`, `tax_category_id`, `deductible_bp`, `memo` |
| Ledger | `transfer_group` | Links both sides of an internal transfer | `id`, `matched_by` (rule, manual, auto) |
| Classify | `category_group` | Report groups (Income, Housing, Food, a rental property) | `name`, `kind`, `sort` |
| Classify | `category` | Leaf categories | `group_id`, `name`, `is_fixed_cost` |
| Classify | `tag`, `split_tag` | Free-form labels | many-to-many |
| Classify | `activity` | "Japan Trip 2026", "Conference" | `name`, `starts_on`, `ends_on`, `budget_cents` |
| Classify | `payee` | Clean merchant identity | `name`, `website_url`, `logo_attachment_id`, `default_category_id` |
| Classify | `payee_alias` | Raw-description patterns that map to a payee | `pattern`, `match_kind`, `payee_id` |
| Classify | `rule` | Deterministic categorisation | `priority`, `conditions` (JSON), `actions` (JSON), `origin` (user, llm\_suggested) |
| Classify | `suggestion` | LLM proposals awaiting review | `split_id`, `field`, `value`, `confidence`, `model`, `status` |
| Import | `import_profile` | Per-bank CSV mapping | `institution_id`, `columns` (JSON), `date_format`, `sign_convention` |
| Import | `import_batch` | One uploaded file (CSV, OFX, QIF or PDF) | `account_id`, `source`, `file_sha256`, `row_count`, `new_count`, `dup_count`, `status` |
| Planning | `budget` | A cap per category or group | `category_id` or `group_id`, `scope` (shared or person), `period` (fortnight, month), `anchor_date`, `amount_cents`, `rollover` |
| Planning | `recurring_series` | Detected or confirmed bills | `payee_id`, `account_id`, `cadence`, `expected_cents`, `tolerance_bp`, `next_due_on`, `status` |
| Planning | `goal` | Savings target | `name`, `target_cents`, `target_date`, `priority`, `completed_at` |
| Planning | `goal_rule` | % of each period's savings | `goal_id`, `stage_id`, `share_bp`, `effective_from` |
| Planning | `goal_allocation` | Virtual money assigned per period | `goal_id`, `period_start`, `allocated_cents` |
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
| System | `job` | Scheduled and queued work | `kind`, `run_at`, `status`, `attempts`, `payload` |
| System | `audit_log` | Who changed what | `user_id`, `entity`, `entity_id`, `action`, `before`, `after` |

**Privacy is enforced in one place.** Queries never touch `account` or `transaction` directly. They go through `visibleAccounts(viewer)` and `redact(viewer, rows)`. There are two kinds of privacy:

- **Private accounts** are seen only by their owner. They're excluded from the other partner's views and from the shared household totals and net worth. The owner's own views include them.
- **Hidden transactions** sit in shared or public accounts (e.g. a birthday present).
  - Only the name is hidden from the other partner: payee, description and merchant logo. They see "Hidden until 12 Mar 2027" instead.
  - Amount, date, category, tags and notes stay visible, so totals and reports stay correct.
  - Hiding lasts at most 12 months (`name_hidden_until`), then lifts automatically.
  - Hidden names are excluded from the partner's search results and exports.

**Further tables:**

- `llm_provider`: `kind` (openai or anthropic), `base_url`, `model`, encrypted `api_key`, `is_local`, allowed purposes (categorise, PDF extraction).
- `import_row`: parsed rows awaiting review and commit, with the PDF page each came from.

* `allocation_stage`: `name`, `sort`, `exit_goal_id`, `fallback_threshold_bp`, `completed_share_policy` (rescale or buffer). The active stage is derived from goal balances, not stored.

- `property`: `name`, `owner_person_id`, `loan_account_id`, `value_account_id`. Rental income and property costs link to it through `split.property_id`.
- `household_settings`: `base_currency` (default AUD), `fy_start` (07-01), `timezone` (Australia/Sydney), `shared_attribution` (by contribution or 50/50).

## Import pipeline

Every upload, whether CSV, OFX, QIF or PDF, goes through the same idempotent pipeline. Importing the same file twice changes nothing, and overlapping date ranges are safe.

1. **Parse.** Rows are parsed and validated with Zod, then staged in `import_row`. Bad rows are reported with line numbers; nothing is committed.
   - OFX and QIF use standard parsers and need no mapping.
   - CSV uses the account's `import_profile` (column map, date format, sign convention).
   - PDF goes through LLM extraction first (below).
2. **Normalise.** Strip card and reference noise from descriptions (e.g. `VISA DEBIT PURCHASE CARD 1234`), keep the raw text, and convert amounts to cents.
3. **Deduplicate.** Use `external_id` when the source has one (OFX FITIDs).
   - Otherwise use a fingerprint: account + date + amount + normalised description + occurrence number among identical rows that day.
   - The occurrence number keeps two genuine identical coffees distinct.
4. **Match payee.** Use `payee_alias` patterns first, then fuzzy match against known payees. Unknown payees are queued for the LLM (next section).
5. **Apply rules.** Run in priority order, deterministically. The result is recorded on the split, with the rule ID for traceability.
6. **Match transfers.** Look for an opposite amount on another of our accounts within ±3 days, with a transfer-like description.
   - A unique match is linked automatically.
   - An ambiguous one goes to review.
7. **Reconcile.** Where the source has a running or closing balance (CommBank CSV and OFX do, as do PDF statements), compare it with the computed balance. Any gap is flagged against the batch.
8. **Review inbox.** Anything uncategorised, low-confidence, or newly matched as a transfer lands in "Needs review". Accepting a correction offers to create a rule.

**PDF statements (LLM-assisted).** The LLM reads the statement; plain code decides whether to trust it.

1. **Extract text.** Use the PDF's text layer (pdf.js).
   - Scanned statements with no text layer are rendered to page images, which needs a vision-capable model.
   - If the configured model lacks vision, the file is rejected with that reason.
2. **LLM extraction, page by page, into a fixed schema:**
   - statement header: account's last 4 digits, period, opening and closing balance;
   - rows: date, description, amount, running balance if printed, and page number.
3. **Deterministic checks, not LLM judgement:**
   - opening balance + Σ amounts = closing balance, to the cent;
   - each printed running balance matches;
   - dates fall inside the period;
   - the account matches the one selected.
4. **Result:** any failure blocks the batch and shows rows beside the page image for correction. Even a passing batch waits in `import_row` for one-click review before it commits, then runs through the pipeline above.

Statements contain names, addresses and account numbers, so PDF extraction is allowed only on providers marked local unless we explicitly enable it for a cloud provider.

**Formats to ship in v1:**

- CommBank OFX (preferred), CSV and QIF;
- ubank CSV;
- Up CSV (a one-off history import before the account closes);
- CMC Invest trade confirmations;
- PDF statements;
- a generic CSV mapper UI for anything else.

Each format is tested against a committed, anonymised sample file. PDF extraction is tested against synthetic statements with known totals.

**History:** import from 1 July 2024 (start of FY2025).

- One FY2025 export (1 Jul 2024 – 30 Jun 2025) uses a different, timestamped multi-bank format, so it gets its own profile.
- The CommBank exports on hand start in FY2026 (March 2025 for the home loan). Earlier history should be exported from NetBank before M1's gate.

## Categorisation, merchants and the local LLM

Rules decide; the LLM only suggests. A transaction is categorised by the first of:

1. a matching rule;
2. the payee's default category;
3. an LLM suggestion.

An LLM suggestion is applied automatically only above a confidence threshold we tune from our own acceptance rate. Everything else waits in the review inbox.

**LLM call design**

- Transactions are sent in batches of about 20. Each prompt includes our category list and up to 10 similar past transactions we've already categorised, found with SQLite full-text search (FTS5). No vector database is needed.
- Output is constrained by a JSON schema (`payee_name`, `website_domain`, `category_id`, `confidence`, optional `tax_category_id`, `activity_id`). It is validated with Zod, and a category ID that doesn't exist is rejected.
- Tax categories and activities are only ever suggested, never auto-applied.
- Each suggestion records model, prompt version and outcome, which gives a real accuracy figure per model.
- Bank descriptions are untrusted text, so prompt injection is possible. The model has no tools that act on anything and can only return a schema-shaped suggestion, which caps the damage at a wrong guess.
- Default: a 7–14B instruct model on Ollama on the GPU machine. Any provider below can be swapped in and compared on the same review data.

**Providers**

- **One `LlmProvider` interface, two adapters:**
  - **OpenAI-compatible** (`/v1/chat/completions`): Ollama, LM Studio, vLLM, llama.cpp server, OpenAI, OpenRouter. Structured output uses the JSON-schema response format; servers without it fall back to JSON mode + Zod validation.
  - **Anthropic-compatible** (`/v1/messages`, `x-api-key` and `anthropic-version` headers). Structured output comes from a single forced tool call.
- **Configuration and keys:**
  - Each provider has a base URL, model, and optional API key.
  - Keys are encrypted at rest, never logged, and never sent to the browser.
- **Per-purpose assignment:** each purpose (categorisation, PDF extraction) is assigned to a provider. For example, categorisation can use a cloud model while PDFs stay local.
- **Cloud providers get the minimum data:**
  - Only description, amount, date and the category list are sent.
  - Account names, people and private transactions never are.
  - Settings shows exactly what a request contains.
- **Tests:**
  - Contract tests run both adapters against a local mock server replaying recorded OpenAI- and Anthropic-format responses, including malformed JSON, timeouts, 429 rate limits and refusals.
  - An evaluation harness scores any configured provider on a labelled synthetic transaction set: accuracy, confidence calibration, latency.
  - Live tests against real endpoints run only when a key is present in CI secrets; they're off by default.

**Merchants, logos and links**

- The LLM proposes a clean name and a likely website domain. We confirm it once per payee, and the domain becomes the payee's link.
- The job runner fetches that site's icon once, stores it as an attachment, and serves it locally.
  - The browser never loads logos from third parties, because a logo request from our browser would reveal what we buy.
  - Only the bare domain leaves the server, once.
- Logo fetching can be switched off entirely.

**Default categories**

A sensible Australian starting set. Every category can be renamed, merged or hidden, and rules and the LLM work from whatever the tree is. Tax labels are suggestions only; applying one still needs confirmation.

| Group | Categories | Suggested ATO label |
| --- | --- | --- |
| Income | Salary, Rental income, Interest, Distributions and dividends, Refunds, Other income | Reported as income, not deductions |
| Housing | Rent, Mortgage repayments, Rates and strata, Home maintenance, Home and contents insurance | — |
| Utilities | Electricity, Gas, Water, Internet, Mobile | — |
| Food | Groceries, Dining out, Takeaway and delivery, Coffee, Alcohol | — |
| Transport | Fuel, Public transport, Tolls, Parking, Rideshare, Registration and CTP, Car insurance, Servicing | D1 for work car use (needs a logbook or trip record) |
| Health | GP and specialists, Pharmacy, Dental, Optical, Private health insurance, Fitness | — |
| Personal | Clothing, Hair and beauty, Gifts, Donations | D9 for donations to registered charities |
| Lifestyle | Entertainment, Subscriptions, Hobbies, Books and media | — |
| Travel | Flights, Accommodation, Activities, Travel insurance | D2 when it's work travel |
| Work and study | Professional registration and memberships, Indemnity insurance, Courses and conferences, Books and equipment | D5; courses D4 |
| Financial | Bank fees, Interest charges, Tax agent fees, Life and income protection insurance | D10 tax agent; D15 income protection outside super |
| Investment property | Loan repayments, Agent fees, Council rates, Repairs, Insurance, Other property costs | Rental schedule on the owner's return |
| Transfers (not spending) | Between our accounts, Credit card payment, To savings, To investments | Excluded from spending and income |

## Budgets, bills, goals and forecasting

Everything here is derived from splits on read. There are no stored running totals to drift out of sync, and SQLite handles the aggregation for our volume (tens of thousands of rows) in milliseconds.

**Budgets**

- A budget has a period (`fortnight` or `month`) and an `anchor_date`. Each person has their own payday anchor. Personal budgets follow it; shared budgets use a household anchor (default: whichever of our paydays comes first).
- Scope is either shared or one person. Shared budgets count splits marked shared, whoever paid. Personal budgets count that person's own splits.
- **Spent** is the sum of that category's (or group's) splits in the current period.
- **Pace** compares spent against a straight line across the period.
- **Projected** is spent plus the trailing daily rate × days remaining.
- Rollover is optional per budget; unspent or overspent amounts carry into the next period.

**Recurring bills**

- Detection groups by payee, then tests intervals: weekly, fortnightly, monthly, quarterly, annual. A candidate needs at least 3 occurrences, a stable median interval, and amounts within a tolerance.
- Candidates appear for one-click confirmation. Confirmed series predict the next due date and amount.
- They raise alerts for a missed payment, or an amount up more than 10%. Price rises are where the easy savings are.

**Goals and savings allocation**

- **Savings** = the combined balance of accounts flagged as savings (each of us has our own, plus shared ones). Investments (brokerage, super) are tracked separately and never count as savings. A period's new savings = the change in that balance, excluding interest. Surplus (income − expenses) is still reported in cash flow, but doesn't drive goals.
- At each period close, positive new savings are split by `goal_rule` shares (e.g. 20% house deposit, 30% holidays) into `goal_allocation` rows. Whatever isn't allocated stays as a buffer. A deficit period draws down only that buffer; goal balances never decrease because of overspending.
- Goals are virtual: there's no account per goal. Shared goals draw on shared savings accounts; personal goals draw on that person's. A goal can be linked to an activity, so spending on "Japan Trip 2026" draws its balance down.
- Projected completion date = remaining target ÷ average allocation over the last 6 periods.

**Shared spending and who paid**

- Every split has a beneficiary: shared, or one of us.
  - Spending from a shared account defaults to shared.
  - A purchase from a personal account can be marked shared, e.g. groceries on one person's card.
- The payer comes from the account's owner.
- **Contribution:** each person's contribution to shared costs = their transfers into shared accounts + shared expenses they paid personally.
- **Reports:** reports show where all our money goes. Each person's share of shared spending is apportioned by contribution share over the period (50/50 is a setting), so the percentage attributable to each of us is always visible.
- This is the groundwork for v1.1's partner settlement.

**Goal priorities and stages**

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

**Reconciling goals with the savings account**

Goal money sits in the savings-flagged accounts. Pangolin checks each period, and after every import, that the books and the bank agree:

- **Invariant:** for each pool (shared, or one person's), goal balances + unallocated buffer = total balance of that pool's savings accounts.
- **Over-committed:** when withdrawals exhaust the buffer, goals exceed the real balance. That's the case option A can hide, so it's always shown in red on the goals page and in the review inbox, with the shortfall.
- **Mismatch:** any other gap (e.g. an account newly flagged, or history not yet imported) raises a warning and offers to put the difference into the buffer.
- **Interest:** interest earned goes to the buffer by default.

**Forecasting**

- **Cash flow:** known pay cycles + confirmed recurring bills + budgeted discretionary spend, projected 3–12 months ahead per account, with a low-balance warning.
- **Net worth:** today's assets and liabilities projected forward. Savings rate, return assumptions (low, mid, high), mortgage amortisation with offset, and super contributions are all shown as explicit editable assumptions.
- A Monte Carlo band can come later; the assumptions matter more than the method.

## Investments and super

Both are modelled as units × price. Holdings on any date are derived from events, so valuation history can be recomputed whenever a price or event is corrected.

**ETFs (Betashares Direct, CMC Invest)**

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

**Super (QSuper, Aware Super)**

- **Balance** = Σ units per option × that day's unit price.
  - Units come from statements. Contributions between statements convert to units at that day's price.
  - The result is labelled an estimate until the next statement reconciles it.
- **Unit prices:** one small fetcher per fund in the job runner, run once daily. QSuper publishes date-ranged prices with an .xls download; Aware publishes daily prices on its site. Full history is stored locally.
- **Contributions** are tagged by kind (employer SG, salary sacrifice, personal concessional, non-concessional).
  - That drives a per-person, per-financial-year concessional cap tracker, including carry-forward of unused cap.
  - Cap amounts and eligibility thresholds live in a config table per financial year, not in code.
- **Payday Super check:** since 1 July 2026 employers must pay super with each pay cycle. The app compares expected SG per payday against contributions received and flags gaps.

**Investment property** (owned by one of us)

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

## Security model

Pangolin will be public on our own domain behind Nginx Proxy Manager, so the login page is the front line.

- NPM terminates TLS with Let's Encrypt and forwards to the app on the LAN.
- The app trusts `X-Forwarded-*` headers only from the proxy's IP, and listens only on the internal network.
- A Tailscale-only install is a stricter option, deferred to the next version.

| Threat | Mitigations |
| --- | --- |
| Someone on the internet guesses or phishes a login | Passkeys first, password + TOTP as fallback. Registration closes after both of us exist. Login rate limiting and lockout in the app, plus rate limits and an optional Australia-only access rule in NPM. Re-authentication for exports, token changes and deletes |
| Session theft or cross-site attacks | `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Origin check on writes. Strict Content-Security-Policy (no inline scripts). React escaping, no raw HTML rendering. Idle timeout |
| Server disk or backup copy is stolen | Full-disk encryption on the host. restic backups encrypted with a key that is never stored on the backup target. LLM API keys and receipts encrypted at the application level with a key file outside the database |
| Malicious npm package (supply chain) | Pinned lockfile; install scripts allowed only for an explicit list; Renovate waits 7 days before adopting new releases. Few dependencies. Non-root, read-only container. **Outbound network allowlist** at the firewall, so even compromised code cannot send data anywhere unexpected |
| One partner sees the other's private details | Redaction enforced server-side in one function, including search, exports and the audit log. Covered by tests that attempt cross-user reads and check that privacy lifts after 12 months |
| Secrets leak through logs or errors | Structured logging with redaction of tokens, amounts and descriptions by default. No third-party error tracking |
| LLM misuse or prompt injection | Local model by default. Cloud providers are opt-in, receive minimal fields and never private transactions. No tools that act, schema-constrained output, and suggestions never auto-apply tax data |
| Exported CSV executes formulas in Excel | Cells starting with `=`, `+`, `-` or `@` are prefixed on export |
| Silent data loss | Nightly encrypted backups to an append-only restic server on TrueNAS, so a compromised app host cannot delete them. A monthly restore test, and an audit log of every change |

**Account recovery (both methods)**

- **Recovery codes:** 10 one-time codes generated at enrolment and stored hashed. Using one forces enrolment of a new passkey.
- **Partner-assisted:** the other partner, re-authenticated with their passkey, issues a one-time re-enrolment link.
  - It expires in 24 hours and is logged.
  - The affected person is notified in the app. Email notification is deferred to the next version.
  - It never reveals the other person's private accounts or hidden transaction names.
- **Both of us locked out:** `pangolin reset-user` on the server console, which requires shell access to the VM.

The database file itself is protected by disk encryption, not SQLCipher. SQLCipher would add a second key to manage and break standard SQLite tooling, for little gain on a single encrypted host. We can revisit if the app ever moves to shared hosting.

## Deployment, backups and CI/CD

The server runs one app container under Docker Compose, managed by the `pangolin` command. A bundled Caddy is deferred to the next version. Supported hosts start at Debian 13, then Ubuntu 24.04 LTS and Rocky Linux 9, on amd64 or arm64.

**Host: Debian VM on Proxmox**

`install.sh` checks these requirements and warns if they're not met. The full step-by-step goes in `docs/install.md`.

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Guest type | VM | VM, not LXC (better isolation, simpler disk encryption) |
| OS | Debian 13 | Debian 13 |
| vCPU | 1 | 2, CPU type `host` (exposes AES-NI for encryption) |
| RAM | 1 GB | 2–4 GB |
| System disk | 16 GB | 32 GB |
| Data disk (database, receipts, statements) | 10 GB | 50 GB, separate virtual disk |
| GPU | none | none; the LLM runs elsewhere |

**Configuration**

- **Encryption:** encrypt the data disk with LUKS inside the VM. It unlocks at boot through Clevis + Tang: a small Tang server on another machine (e.g. an LXC or the TrueNAS box). The disk then unlocks only on the home network, so a stolen disk or VM backup stays locked. ZFS native encryption on the Proxmox pool is the alternative, but it needs a passphrase after every host reboot.
- **Firewall** (Proxmox VM firewall or nftables):
  - Inbound: only the NPM host to the app port, and SSH from the admin network.
  - Outbound: an allowlist only (price and unit-price hosts, the LLM endpoint, TrueNAS, Debian and Docker mirrors, GHCR).
- **Private repo:** the server pulls images from GHCR with a fine-grained, read-only token (packages: read), stored with the install's secrets.
- **Proxmox VM backups** (vzdump or PBS) are a useful extra. If you use PBS, turn on its client-side encryption. restic stays the source of truth for data.

**Install and upgrade**

- `install.sh` detects the distro (apt or dnf) and installs Docker Engine from Docker's repository if it's missing. On Rocky it also sets SELinux volume labels and firewalld rules. It then asks three things: proxy mode, the public hostname, and the backup server. The existing NPM is the one proxy mode in this version; bundled Caddy and Tailscale-only are deferred to the next version. It then:
  - generates secrets (auth secret, encryption key file, restic password);
  - writes the Compose file and `.env`;
  - starts the stack and prints a one-time setup link for creating the first account. With NPM, it also prints the proxy-host settings to enter.
- `pangolin upgrade` performs these steps:
  1. pull the new signed image tag;
  2. snapshot the database;
  3. start the new version, which runs migrations inside a transaction;
  4. health-check it;
  5. on failure, roll back automatically to the previous image and snapshot.
- `pangolin backup`, `pangolin restore <snapshot>` and `pangolin status` cover the rest.

**Backups and restore**

- Nightly: a consistent snapshot (`VACUUM INTO`) plus the attachments folder go to restic. The destination is restic's REST server running as a TrueNAS app, set to append-only. Contents are encrypted before they leave. Pruning runs on the TrueNAS side, so the app host can add backups but never delete them.
- Retention: 7 daily, 4 weekly, 12 monthly. `restic check` runs weekly.
- Restore goes into a fresh directory, then verifies before swapping in:
  - `PRAGMA integrity_check`;
  - row counts;
  - per-account balance sums against the backup's manifest.
- **Tested twice:**
  - CI backs up and restores a synthetic database on every release.
  - The server runs a monthly restore drill into a temporary directory and shows the result on the status page.

**CI/CD (GitHub Actions)**

- **Every push:** Biome lint, type-check, Vitest unit tests, migration test, then Playwright end-to-end tests against the mock data.
  - The migration test applies all migrations to an empty database.
  - The release workflow also migrates the database the previous release's image creates (`migrate-previous`).
- **Tagged release:**
  1. build amd64 and arm64 images;
  2. generate a software bill of materials and run a vulnerability scan;
  3. sign with cosign;
  4. push to GHCR.
  - The upgrade command verifies the signature before pulling.
- Renovate opens dependency PRs weekly. `main` is protected and requires green CI.

**Synthetic data and offline CI**

- A seeded generator produces a realistic two-person household as the files we actually import:
  - CommBank everyday, offset, home loan and credit card in OFX, CSV and QIF;
  - ubank and Up CSVs;
  - rendered PDF statements with known totals;
  - CMC confirmations and Betashares holdings;
  - QSuper and Aware unit-price histories.
- Mock price and unit-price servers, plus the mock LLM server from the Providers section, keep CI fully offline.
- The same seed drives local development, CI end-to-end tests and a demo mode, so no real data is ever needed outside the server.
- With no live bank API in v1, no mock banking endpoint is needed. The connector interface stays, so one can be added if a usable API appears.

## Repo layout

A pnpm workspace. `domain` depends on nothing but `shared`, so the core logic stays testable and portable, the same way you'd isolate a Rust core crate.

```text
pangolin/
├─ apps/
│  ├─ server/          Hono API, auth, job runner, static hosting
│  └─ web/             React + Vite PWA
├─ packages/
│  ├─ shared/          Zod schemas, branded types (Cents, AccountId), money + date utils
│  ├─ domain/          ledger, import, rules, transfers, budgets, recurring, goals, lots, tax
│  ├─ db/              Drizzle schema, migrations, repositories, visibleAccounts(), redact()
│  ├─ importers/       OFX, QIF, CSV profiles, PDF extraction + anonymised samples
│  ├─ connectors/      price sources, super unit-price fetchers
│  └─ llm/             provider adapters (OpenAI, Anthropic), prompts, schemas, eval harness
├─ tools/
│  ├─ mock-llm/        replays recorded OpenAI- and Anthropic-format responses
│  ├─ mock-prices/     offline price and unit-price server
│  └─ seed/            synthetic household generator (files + PDFs)
├─ deploy/            compose.yaml, install.sh, pangolin CLI (caddy profile deferred)
├─ e2e/               Playwright tests
└─ .github/workflows/ ci.yml, release.yml, restore-test.yml
```

## Milestones

Five milestones, each ending in a check we can actually verify. Security, backups and CI come first, because retrofitting them is where self-hosted projects go wrong.

&#91;embedded content: milestones · 5 phases, 4 gates\]

M1 is highlighted because it carries the most risk: if import, deduplication and transfer matching aren't trustworthy, every report built on them is wrong. It's worth spending disproportionate time there.

Partner settlement (who owes whom for shared costs paid from personal accounts) follows in v1.1, after M4.

## Decisions

All are settled.

| Decision | Choice |
| --- | --- |
| Repo | Private GitHub repo; images pulled with a read-only token |
| Exposure | Public domain through our Nginx Proxy Manager (Let's Encrypt); Tailscale-only is deferred to the next version |
| Host | Debian 13 VM on Proxmox, LUKS data disk unlocked by Clevis + Tang; Ubuntu and Rocky Linux also supported |
| Backups | restic REST server on TrueNAS, append-only |
| Account recovery | Recovery codes and partner-assisted reset |
| Savings | Balance of accounts flagged as savings (personal and shared); investments tracked separately |
| Goal priorities | Staged allocation; a completed goal is flagged, its share rescaled, and we're prompted to review |
| Overspending periods | Option A: draw down the buffer only, with an over-committed warning |
| Mortgage | Repayments as a simple expense; the property view links rent to repayments and shows gearing |
| Shared spending | Beneficiary per split; shared costs apportioned by each person's contribution (50/50 as a setting) |
| Privacy | Private accounts (owner only); hidden transaction names in shared accounts for up to 12 months |
| Categories | Sensible Australian default set, fully editable |
| History | From 1 July 2024 |
| Currency | Currency-agnostic ledger, single base currency (AUD) in v1 |
| Pay cycles | Separate anchor per person; shared budgets use a household anchor |
| Partner settlement | v1.1 |
| CommBank format | OFX primary; CSV and QIF supported |
| ASX prices | Yahoo Finance primary, issuer NAV fallback, manual override |
| Betashares Direct | Manual entry in v1; statement parsing in a later version |
| LLM providers | Ollama by default; any OpenAI- or Anthropic-compatible endpoint with an optional key |
| Up | API dropped; one-off CSV history import before the account closes |
| Name | Pangolin Money |
| Host hardening (2026-10-03) | Outside the application. Host hardening and the network tunnel to the NAS are the operator's concern, not requirements of this app |
| Recovery notice (2026-10-03) | In-app notice only in this version; email notification is deferred to the next version |
| Outbound allowlist (2026-10-03) | The firewall `install.sh` generates is the only enforcement in this version; an in-app check and re-authentication to change the list are deferred to the next version |

**Periods where we spend more than we earn: option A chosen**

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| A. Buffer only | The deficit draws down the unallocated buffer; goals are untouched | Goals never go backwards; simplest | Once the buffer is empty, goal balances can add up to more money than we actually have |
| B. Pro-rata from goals | The deficit reduces every goal by its share | Goals always reconcile to reality | One lumpy fortnight (annual insurance, a car repair) knocks the house deposit backwards; noisy |
| C. Carry forward | The deficit is recorded and repaid from the next surpluses before anything is allocated. A check warns if goal balances exceed actual savings | Goals stay stable, the shortfall stays visible, and there's a built-in reality check | Allocations pause until the deficit is repaid; slightly more logic |

- [x] Chose A: a deficit draws down the unallocated buffer only

## Sources

- [RSM: guide to Consumer Data Right access models](https://www.rsm.global/australia/insights/definitive-guide-cdr-access)
- [QSuper unit prices](https://qsuper.qld.gov.au/investments/performance/unit-prices)
- [Aware Super unit prices](https://aware.com.au/member/what-we-offer/investments/unit-prices)
- [Navexa: exporting CMC Invest trades as CSV](https://help.navexa.com/en/articles/13382159-import-cmc-invest-trades-into-navexa-csv-trade-confirmations)
- [Fair Work Ombudsman: Payday Super from 1 July 2026](https://www.fairwork.gov.au/newsroom/news/payday-super-new-rules-starting-1-july-2026)
- [restic REST server](https://github.com/restic/rest-server) and its [TrueNAS app](https://apps.truenas.com/catalog/restic-rest-server_community/) (append-only option)
- [Ghostfolio](https://github.com/ghostfolio/ghostfolio) (uses Yahoo Finance for prices)
- [Wealthfolio](https://github.com/wealthfolio/wealthfolio) (reference for a Rust/React/SQLite self-hosted design)
