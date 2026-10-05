---
id: SPEC-pangolin-money
companions:
  - data-model.md
  - tech-stack.md
  - import-pipeline.md
  - categorisation.md
  - budgets-goals-forecasting.md
  - home-buying.md
  - investments-super-tax.md
  - security-and-recovery.md
  - deployment-and-ops.md
  - decisions.md
  - architecture-diagrams.md
  - ../../planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md
sources:
  - ../../../docs/architecture/Pangolin Money Architecture & Data Model.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. The source document is for traceability — consult it only for narrative rationale or prose color this contract intentionally omits.

# Pangolin Money

## Why

A couple wants to see where their money goes, what they can save, and how they're tracking against goals, without handing their bank credentials or transaction history to a third-party aggregator. This is a vision to realize for two specific people: a self-hosted household finance app where their own SQLite database — not an existing finance app — is the single source of truth, covering everyday banking, investments, super and an Australian tax pack, running on infrastructure they already control (a Proxmox VM behind their existing reverse proxy).

## Capabilities

- **CAP-1**
  - **intent:** Household can import transactions from CommBank (OFX/CSV/QIF), ubank (CSV), Up (CSV history), any bank/broker PDF statement (LLM-extracted and checked against statement balances), CMC Invest (CSV) and Betashares/super (units × price) through one idempotent pipeline.
  - **success:** Each format ships a committed, anonymised sample file; re-importing the same file or an overlapping date range changes nothing; any statement with a printed opening/closing or running balance reconciles to the cent. Unreadable rows in CSV/OFX/QIF are set aside with row number and reason while good rows commit; a PDF statement with any failed check still blocks as a whole. A file can be handed to the partner, who chooses the account. Once set-aside rows are fixed or discarded, the statement reconciles to the cent.
- **CAP-2**
  - **intent:** A transaction split is categorised deterministically by rule, then payee default, then LLM suggestion, with LLM auto-apply gated by a confidence threshold tuned from acceptance rate.
  - **success:** Every auto-applied split records the suggestion's model, prompt version and outcome; everything else lands in the review inbox.
- **CAP-3**
  - **intent:** An account can be marked private (visible only to its owner) and a transaction's name hidden from the other partner in a shared account for up to 12 months, while shared totals stay correct.
  - **success:** Cross-user reads of private accounts or hidden names fail in tests (including search, exports, audit log); hidden names lift automatically after 12 months; redaction runs through one `visibleAccounts()`/`redact()` path.
- **CAP-4**
  - **intent:** A household or a person sets a spending cap per category or group on a fortnight or month cycle, anchored to a payday, with spent/pace/projected computed live from splits; the editor suggests a limit from recent average spending, and going over the limit raises one review item per budget per period.
  - **success:** Spent/pace/projected figures match a hand-computed check against seeded splits; rollover behaves per its per-budget setting.
- **CAP-5**
  - **intent:** The app detects recurring bills from payee/interval/amount patterns and alerts on a missed payment or an amount increase over 10%.
  - **success:** A synthetic series of ≥3 occurrences with a stable median interval is detected and confirmed with one click; a seeded 11%+ rise raises an alert.
- **CAP-6**
  - **intent:** Positive new savings each period are split across goals by staged, priority-ordered rules, with automatic stage transitions when a stage's exit goal completes and fallback reactivation when a goal drops below its threshold. Each goal is Flexible or Protected, and each pool has at most one goal marked as its emergency fund.
  - **success:** A seeded multi-period savings history produces `goal_allocation` rows matching the active stage's shares; a completed or under-threshold goal triggers the documented rescale or reactivation with a logged stage change. A second emergency fund in the same pool is rejected. A drawdown that takes the emergency fund below its fallback threshold reactivates stage 1, the same as a linked withdrawal.
- **CAP-7**
  - **intent:** Each period and after every import, goal balances plus the unallocated buffer must reconcile to the real balance of that pool's savings accounts, with over-commitment and other mismatches flagged. A large purchase or a shortfall is covered by a user-confirmed drawdown across that pool's goals, in a fixed order by goal kind.
  - **success:** A seeded over-commitment shows a shortfall in the warning colour (never money-out red), with a glyph and text, on the goals page and in the review inbox. Its fix opens Cover an expense in shortfall order: Flexible, then emergency fund, then Protected. A seeded savings withdrawal at or above the pool's threshold raises a Large withdrawal item. Covering it debits the emergency fund first, then Flexible goals, then Protected goals only after a warning. Each confirmed drawdown writes one audited `goal_adjustment` per goal under one `goal_drawdown`, never touches another pool, and is undone in full. Any other mismatch offers a one-click buffer adjustment.
- **CAP-8**
  - **intent:** Cash flow (3–12 months ahead, per account, with a low-balance warning) and net worth (assets/liabilities with editable savings-rate, return, mortgage-amortisation and super assumptions) are projected from known pay cycles, confirmed bills and budgeted discretionary spend.
  - **success:** A seeded pay-cycle + bills + budget scenario produces a cash-flow projection whose low-balance warning fires at the expected date.
- **CAP-9**
  - **intent:** ETF holdings (Betashares, CMC) are tracked as buy/sell/distribution/DRP/cost-base-adjustment events, with FIFO or manually-selected lots, 12-month CGT-discount flagging, and both money-weighted (XIRR) and time-weighted return.
  - **success:** A seeded buy/sell/DRP/adjustment sequence produces lot-level cost bases and a capital gain on sale matching a hand-computed figure, with the 50% discount applied only to lots held over 12 months.
- **CAP-10**
  - **intent:** Super balance is derived as units × that day's unit price per option; contributions are tagged by kind and tracked against per-person, per-FY concessional caps with carry-forward; expected SG per payday is checked against contributions received.
  - **success:** A seeded statement plus unit-price history reproduces the fund's reported balance within rounding; the cap tracker flags a seeded over-cap contribution; a seeded missed SG payment is flagged after its payday.
- **CAP-11**
  - **intent:** A property record links its value account, loan account, rental income and costs. Its ownership shares come from its owners. It shows value, equity and LVR (loan ÷ latest valuation). It shows net cash per month and per FY, where net cash = rent − user-entered loan interest − running costs, with principal shown separately as out of pocket. It labels the property negatively or positively geared from last FY's net cash.
  - **success:** A seeded property's rent, entered interest and costs produce the documented net cash (this FY, last FY), LVR and gearing label. Months without entered interest show interest as missing, never estimated. The property is hidden from the partner when its value or loan account is private.
- **CAP-12**
  - **intent:** The app produces a per-person, per-FY pack of deductions by ATO label, investment income and capital gains, and super contributions vs caps, exportable as CSV and a PDF bundle with receipts.
  - **success:** A seeded FY of deductible splits, distributions and lot sales produces a deduction summary, capital gains schedule and cap comparison matching hand-computed totals, exported in both formats.
- **CAP-13**
  - **intent:** A split can carry an activity tag (e.g. "Japan Trip 2026") with optional dates and budget, rolling up total/by-category/by-person/against-budget, and pre-filling suggestions for transactions inside its date range.
  - **success:** A seeded dated activity shows correct rollups and offers itself as a suggestion for a seeded transaction inside its date range.
- **CAP-14**
  - **intent:** Every split carries a beneficiary (shared or a person); each person's contribution to shared costs (transfers into shared accounts plus shared expenses paid personally) drives an always-visible apportioned share of reports.
  - **success:** A seeded pair of contribution histories produces the documented apportioned percentages, configurable to 50/50; this is groundwork for v1.1 partner settlement.
- **CAP-15**
  - **intent:** Partners authenticate with passkeys (password + TOTP fallback) and recover access via one-time recovery codes or partner-assisted re-enrolment, with a server-console reset for a both-locked-out scenario.
  - **success:** Tests cover login, passkey/TOTP fallback, recovery-code enrolment-forcing, and partner-assisted reset within its 24-hour expiry and audit log, without leaking the other partner's private data.
- **CAP-16**
  - **intent:** `install.sh` brings up the full stack in one command on Debian (then Ubuntu, Rocky Linux) behind an existing reverse proxy (NPM; bundled Caddy and Tailscale-only are deferred to the next version), and `pangolin upgrade`/`backup`/`restore` keep it running with a tested restore path.
  - **success:** CI backs up and restores a synthetic database on every release; a monthly restore drill runs automatically on the server; `pangolin upgrade` rolls back automatically on a failed health check.
- **CAP-17**
  - **intent:** Either partner can see historical cash flow (Sankey), P&L by group or category, spending over any period, and current net worth, all summed from the splits they can see.
  - **success:** Against the seeded household, each report's totals match a hand-computed sum of splits for the chosen period; the other partner's private accounts are absent, and shared figures are identical for both partners.
- **CAP-18**
  - **intent:** A partner can browse thousands of transactions with filters held in the URL, edit splits and tags, and work the review inbox.
  - **success:** An end-to-end test filters the seeded ledger via URL parameters, splits a transaction into two splits summing to the parent, tags it, and clears a review-inbox item.
- **CAP-19**
  - **intent:** The couple estimate what they can borrow, their repayments, and what's left to live on. Borrowing is estimated two ways, simple and lender-style serviceability, with editable defaults: +3 pp buffer, max(actual, HEM) living costs, rent at 80%, 3.8% of card limits, DTI 6×. The estimate can include existing properties, used for equity (80% LVR) or sold (2.5% costs + CGT estimate). Up to three scenarios. Named saved plans are shared by both and built only from data both can see.
  - **success:** Against the seed, borrowing power, repayments and the stress row match a hand calculation. A private loan never changes a plan's figures for either partner. A reopened plan shows its saved headline (borrow, repayment, left to live on) beside today's recalculation from its saved inputs. Inputs that are no longer shared drop out with 'Some inputs are no longer shared'.
- **CAP-20**
  - **intent:** A loan records its terms, rate changes and user-entered interest per period. It shows balance over time (actual, projected, with extras), interest paid and still to pay, payoff date, and the effect of extra repayments (capped yearly) and of the offset balance. Its schedule is estimated from its terms and corrected by the user-entered interest. Loans can be added by hand.
  - **success:** A seeded loan's projected payoff, and the interest saved by a given extra, match a hand amortisation. Principal and interest are shown only for periods with entered interest.
- **CAP-21**
  - **intent:** Each person picks one of six themes in light, dark or system mode, saved to their profile. The app has a desktop sidebar, a phone tab bar and a single Settings page (appearance, sign-in & security, signed-in devices, partner, household, LLM providers, system status). A person can list and end their sessions.
  - **success:** A theme choice follows the person to another device. The axe check is clean on every route.

## Constraints

- Private data never leaves the server by default; outbound network is limited to an explicit allowlist (price/unit-price hosts, any configured LLM endpoint) — no third-party aggregators, no telemetry. Only the job runner makes outbound calls; API and domain services make none.
- SQLite is the single source of truth with a single writer (one Node process/container); jobs are polled rows in SQLite, not a separate queue server.
- Money is stored as integer minor units (branded `Cents` type) — no floats near money. Units are integer micro-units; prices are decimal strings.
- Cloud LLM use is opt-in only, assigned per purpose, and receives only description/amount/date/category list — never account names, people, or private transactions. PDF statement extraction is restricted to local providers unless explicitly enabled for cloud, because statements carry names, addresses and account numbers; set-aside row interpretation, like PDF extraction, sees raw text and is restricted to local providers unless explicitly enabled for cloud, and never for a private account.
- One-command install and upgrade on Debian first (then Ubuntu 24.04, Rocky Linux 9), must work behind an existing reverse proxy (Nginx Proxy Manager), with encrypted backups and a CI-tested restore.
- Web and mobile ship as one responsive PWA; no native app-store app.
- Every surface meets WCAG 2.2 AA: full keyboard operation, visible focus, a table equivalent for every chart, and reduced motion respected. An automated accessibility test in CI checks it.
- The database file is protected by host disk encryption, not SQLCipher — avoids a second key to manage and keeps standard SQLite tooling working.
- Australian defaults are baked in: AUD base currency, July–June financial year, fortnightly pay cycles, ATO tax categories, super; the ledger stays currency-agnostic but v1 requires each account's currency to match the base currency.
- `STRICT` SQLite tables with `PRAGMA foreign_keys = ON`; every write goes through a service layer that also writes `audit_log`.
- The import pipeline must be idempotent: re-importing the same file or an overlapping date range changes nothing.

## Non-goals

- Unofficial CommBank/ubank API clients (they require storing full-access credentials).
- Scraping member portals (super funds, brokers) — MFA, breakage, credential-storage risk.
- Paid third-party account aggregators or Consumer Data Right integrations.
- The Up Bank API (account is closing) — only a one-off CSV history import is supported.
- Full double-entry accounting — the ledger uses transactions + splits with transfer links, and lot-level accounting for investments.
- Partner settlement (who owes whom for shared costs paid from personal accounts) — deferred to v1.1, after M4.
- Betashares Direct statement parsing — v1 uses manual holdings entry only.
- Automatically splitting imported mortgage repayments into interest/principal — v1 treats repayments as a simple expense in cash flow; interest is only ever user-entered per period from statements.
- Monte Carlo forecasting bands — v1 ships editable explicit assumptions only.
- A native app-store mobile app.

## Success signal

A fresh install reaches first login in one command with the restore test passing in CI (M0 gate); 12 months of the couple's real data import with no unexplained balance gaps (M1 gate); both partners use it weekly instead of their spreadsheets (M2 gate) and track one full budget cycle each, and the home buying planner works on their real data (M3 gate); and the M4 tax pack reproduces hand-checked per-person FY totals. The milestone table is in `deployment-and-ops.md`.

## Assumptions

- Assumed the source's "all are settled" framing for its Decisions table means those choices are recorded here as decisions/constraints rather than open questions, while the rationale tables themselves are preserved verbatim in `decisions.md`.
