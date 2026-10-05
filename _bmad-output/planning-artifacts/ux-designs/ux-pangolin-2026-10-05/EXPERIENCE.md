---
name: Pangolin Money
status: final
created: 2026-10-05
updated: 2026-10-05
sources:
  - .memlog.md
  - ../../../specs/spec-pangolin-money/SPEC.md
  - ../../../specs/spec-pangolin-money/data-model.md
  - ../../../specs/spec-pangolin-money/security-and-recovery.md
  - ../../../specs/spec-pangolin-money/import-pipeline.md
  - ../../../specs/spec-pangolin-money/budgets-goals-forecasting.md
  - ../../architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md
  - ../../../../apps/web/src/styles.css
  - ../../../../apps/web/components.json
---

# Pangolin Money — Experience Spine

> **Spines win.** This file and `DESIGN.md` win on any conflict with a mock, wireframe or import. Product behaviour (what a feature computes, privacy rules, auth) stays owned by the spec and architecture in `sources:`; this spine owns how it is presented and operated.
>
> **Key-screen mocks:** [mockups/index.html](mockups/index.html) (19 `key-*.html` screens, every IA surface; each is also linked at the section it informs). Rules marked **(from mock)** were lifted from them where the spine was silent; they are committed rules, not assumptions. Example property everywhere: **35 Hawthorne St** (Simon 100%); first-session data runs to 30 Sep 2026.
>
> **Visual references:** [wireframes/ia-2026-10-05.excalidraw](wireframes/ia-2026-10-05.excalidraw) (IA, confirmed by Simon) · [wireframes/flow-first-session-2026-10-05.excalidraw](wireframes/flow-first-session-2026-10-05.excalidraw) (first-session flow) · [mockups/direction-calm-cheeky.html](mockups/direction-calm-cheeky.html) (locked direction: Cash flow, Home buying, empty state) · [mockups/color-themes-1.html](mockups/color-themes-1.html) (theme picks; also shows the hidden-name row and duplicate warning) · [imports/inspiration-sharkfin.webp](imports/inspiration-sharkfin.webp) · [imports/inspiration-smartspend.webp](imports/inspiration-smartspend.webp).

## Foundation

- **Form factor:** one responsive PWA (spec constraint; no native app). Desktop/laptop is primary: the couple sit down together every month or two. Phone is in scope now, mainly for glancing and light categorising, but the full Home buying planner (sliders included) must work on it. Installable; no offline data.
- **UI system:** React 19 + shadcn/ui (new-york) on Tailwind 4 with CSS variables, lucide icons, TanStack Router/Query/Table/Virtual, Apache ECharts 6 (canvas renderer, `richText` tooltips). Strict nonce CSP: no third-party assets, no inline styles or scripts, no raw HTML of descriptions, PDF text or LLM output. This spine specifies only the behavioural delta on shadcn defaults.
- **Visual identity:** `DESIGN.md` (Calm + Cheeky; six themes, default Clay & Linen).
- **Audience:** Simon and Carissa, a two-person household. Goals: easy to use, secure, fun. Each person has their own view (no household lens); figures are computed per viewer on the server and the web app never sums money.
- **Locale:** en-AU only. AUD, financial year July–June, fortnightly pay cycles.
- **Worked figures** in this file (for example $780,000 at 6.09%, $650k) are illustrative, lifted from mocks and conversation; they are not specs.

**Term map** (spine label → source term)

| Spine | Source |
|---|---|
| Needs review | review inbox (AD-17) |
| Transactions | ledger (CAP-18) |
| Kept | surplus (income − expenses) |
| Cash flow | historical cash flow / Sankey (CAP-17) |
| My share | apportioned share of shared spending (CAP-14) |
| Everything I can see | the viewer's visible splits (CAP-17) |
| Shared-visible | data both partners can see: shared accounts and their rows (AD-5, AD-22) |
| Buffer | unallocated savings buffer (CAP-6, CAP-7). The buffer **has room** when the active stage allocates a share of each fortnight to it |
| Net cash (property) | rent − loan interest (the user-entered statement figures, as on Loan detail) − running costs (agent's fees, rates, water, insurance, repairs, from categorised rows). Principal repayments are not a cost; they're shown separately as out of pocket (CAP-11) |
| Left for actual life | take-home pay − loan repayments − home costs (rates, insurance); **before** usual spending. Planner only |
| Set-aside rows | rows of an import file that couldn't be read; held for fixing, never committed (import pipeline) |

## Information Architecture

Landing after sign-in is **Cash flow**. "Planning" groups everything not directly derived from imported data.

| Surface | Route | Desktop nav | Phone | Purpose (serves) |
|---|---|---|---|---|
| Sign in | `/sign-in` | — | — | Passkey-first sign-in, password + TOTP fallback (CAP-15). Own route because `/` becomes Cash flow |
| First-run setup | `/setup` | — | — | First owner + passkey (existing route) |
| Recover | `/recover` | — | — | Recovery-code sign-in or partner reset link; forces new passkey (CAP-15) |
| **Cash flow** (landing) | `/cash-flow`; `/` redirects | Sidebar 1 | Tab 1 | KPIs, apportioned share line + toggle, Sankey (desktop) / P&L table (phone), income / expense bar lists, latest transactions, Home buying glimpse, Biggest little leaks (CAP-14, CAP-17) |
| **Net worth** | `/net-worth` [ASSUMPTION: path] | Sidebar 2 | More | Today's assets, liabilities and trend; link to Forecast (CAP-17) |
| Spending | `/spending` [ASSUMPTION: path] | Sidebar 3 | More | Income/expense bar lists, category bars, flexible categories, leaks, drill to transactions (CAP-17) |
| Transactions | `/transactions` (replaces `/ledger`) | Sidebar 4, count badge | Tab 2 | Ledger grouped by date, filters, search, summary line, bulk select, transaction sheet, hidden-name rows, Import (CAP-18) |
| Needs review | `/review` | Sidebar 5, count badge | Tab 3, badge | Single inbox (AD-17): AI suggestions, rule offers, duplicates, transfers, import hand-offs, set-aside rows, bills, over budget, large withdrawal, goal shortfall |
| Accounts | `/accounts` | Sidebar 6 | More | Account rows by type, Properties card, Add loan (CAP-11) |
| Account detail | `/accounts/:id` | from Accounts | More | Balance, freshness, transactions for one account |
| Loan detail | `/accounts/:id` (loan type) | from Accounts | More | § Loan Detail, incl. Property section |
| Property detail | `/accounts/:id` (property type) | from Accounts, Loan detail | More | § Property Detail: value, equity, ownership split, net cash this FY / last FY, gearing, link to its loan (CAP-11) |
| Budgets | `/planning/budgets` | Planning group | Planning tab | Budget cards, spent vs limit, projection (CAP-4) |
| Goals | `/planning/goals` | Planning group | Planning tab | Goal cards with kind badges, active stage, shortfall, Cover an expense (CAP-6, CAP-7) |
| Home buying | `/planning/home-buying` | Planning group | Planning tab | § Home Buying Planner (spec catch-up) |
| Forecast | `/planning/forecast` | Planning group | Planning tab | Short-term cash flow + long-term net worth (CAP-8) |
| Settings | `/settings`, sections at `#appearance` · `#sign-in-security` · `#devices` · `#partner` · `#household` · `#llm-providers` · `#system-status` | Sidebar (bottom) | More | One long page of cards with a side menu jumping to sections: Appearance · Sign-in & security (passkeys, password + authenticator, recovery codes) · Signed-in devices · Partner (Invite <partner>, until both people exist · Reset <partner>'s sign-in) · Household (pay cycles per person, the household pay anchor, and shared attribution: by contribution or 50/50) · LLM providers · System status (read-only) |
| Later (M4) | — | — | — | Investments & super, Tax pack, Activities (CAP-9, 10, 12, 13). Not designed in this run |

→ IA reference: [wireframes/ia-2026-10-05.excalidraw](wireframes/ia-2026-10-05.excalidraw) (surfaces, nav groups and routes). Per-surface mocks: [mockups/index.html](mockups/index.html).

- **Desktop shell:** left sidebar (pangolin logo + nav; Planning group separated by a hairline; person footer with Sign out). Header on every view: "G'day, Simon" greeting, page title, freshness line, **Import** button; the date range appears only where it filters (§ Component Patterns › Date-range control).
- **Phone shell:** bottom tab bar Cash flow · Transactions · Needs review · Planning · More. Planning opens a list of Budgets, Goals, Home buying, Forecast. More lists Net worth, Spending, Accounts, Settings, Sign out. Phone header (from mock): greeting, then title with a compact Import button on the same row, freshness line, date range (where it filters) stacked below.
- **Re-auth** is a modal, not a route (§ Interaction Primitives).
- **Modal depth:** one level. The re-auth dialog is the only thing allowed over another dialog or popover [ASSUMPTION].
- **Demo** is a separate instance (seeded, read-only), not an in-app mode.

## Privacy & Partner Awareness

The single home for privacy behaviour; other sections point here. The rules are strict (spec CAP-3, AD-4, AD-5, AD-17, AD-22). The hidden-name wink is the one playful privacy moment; privacy settings and privacy errors stay plain.

| Situation | Experience |
|---|---|
| Private account | Invisible to the partner everywhere: nav, pickers, totals, search, errors, pending counts (NotFound looks identical to missing). No placeholder, no count, no "1 hidden account" hint. The owner sees a small lock on the account. |
| Hidden name | Partner sees the wink row ("Hidden until <date>" and the wink line); owner sees a "Hidden from <partner> until <date>" tag. Amount, date, category, tags and notes stay visible. Excluded from the partner's search results and exports. Lifts automatically on the chosen date, at most 12 months ahead. |
| Per-viewer totals | May differ between Simon and Carissa; shared figures are identical. Copy never says "household" for a per-viewer total [ASSUMPTION]. |
| Partner pending | Count of the partner's open items on shared-visible data only ("Carissa: 12 left"); items from the partner's private accounts never contribute. Count only, never contents; hidden at zero. |
| Transfer to partner's private account | Shows "Transfer from <owner>" (AD-4). |
| Personal budgets, goals, forecast assumptions | Visible only to their person (AD-22); shared ones to both. |
| Cover an expense (goal drawdowns) | One pool only. A shared-pool cover lists shared goals only and shows in both partners' Goals history with who confirmed it; a personal-pool cover is visible only to its person. The partner's personal goals are never listed, counted or touched. Large withdrawal items follow AD-22 (§ Needs review item kinds). |
| Import for partner | Hand-off, never direct import into the partner's accounts (keeps AD-5). |
| Planning together on one laptop | The signed-in person's view is shown; Home buying follows § Home Buying Planner › Data scope, so the result is the same whoever is signed in. |
| Partner-assisted reset | Settings › Partner, behind re-auth; the affected person sees a review-item notice. Plain copy, no cheek. |

## Voice and Tone

Microcopy is a friendly, plain-speaking Aussie mate who's good with money: cheeky in good moments, straight in serious ones. Brand posture lives in `DESIGN.md`.

| Moment | Do | Don't |
|---|---|---|
| Greeting | "G'day, Simon" | "Welcome back, user" |
| KPI notes | "14 pays, plus a cheeky bit of interest" · "Rent did most of the damage" · "Off to the house deposit. Good on you." · "Half of everything. Show-offs." | "Income increased 3.2% QoQ" |
| Chart helper | "Follow a band to see what fed it." · "Same numbers as the lists below and under Profit & loss. Transfers between your own accounts are left out, so nothing gets counted twice." | Unexplained totals |
| Hidden name (partner's view) | "Hidden until 12 Mar 2027 · Little secret — Carissa's hiding this one. No peeking, Simon — we'll spill on the day." | "Redacted" / "Access denied" |
| Celebration | "Every last dollar has a home. You and Carissa cleared Needs review. Pangolin is doing a small victory roll." | "Task completed successfully ✓" |
| Empty state | "Nothing to sniff at yet" · "Money out $— Blissful ignorance, for now" · "Savings rate —% No pressure" | "No data available" |
| Nudge | "2 transactions look like duplicates. Check them in Needs review." (plain: a money warning) | "WARNING: duplicates detected" |
| Over budget | "Eating out's had a big fortnight." — the only money warning with a cheeky line; never shaming, no mascot | "You exceeded your budget" |
| Goal arrival | "At the current rate, you'll arrive by Mar 2027." | "ETA: 2027-03" |
| Goal shortfall | Gentle and exact: "Your goals are $320 ahead of what's in the bank. Cover it from your goals?" / "…Or move $50/fortnight from the buffer until it's covered?" [ASSUMPTION copy] | Red alarm copy, blame |
| Cover an expense | Plain and exact, at most one light header line: "Things break. Here's where it can come from." [ASSUMPTION copy]. No cheek on the protected warning or the can't-cover line. Protected warning: "This takes $1,200 from House deposit, which you've marked Protected. Its arrival moves from Mar 2028 to Apr 2028." [ASSUMPTION copy] | "Uh-oh", a mascot, cheek on the protected warning |
| Low balance | "Everyday could dip to $140 on 12 Nov, two days before payday." [ASSUMPTION copy] | "Insufficient funds predicted" |
| Leaks | "Small stuff that quietly adds up. No judgement. Well, a little." | Shaming ("You wasted…") |
| Planning | "Comfortably, without living on two-minute noodles" · "estimates, not a lender's offer (sadly)" · "What's left if rates misbehave" · "Room for the odd smashed avo" · CGT: "estimate, not tax advice" | Advice framed as a recommendation |
| Errors about money or security | Plain and exact: "142 imported. 3 rows set aside: row 14 has a date we can't read." · "Confirm it's you to change recovery codes." | Jokes, mascot, or blame. Never cheeky in errors, re-auth, privacy settings, privacy errors, backups, system status or balance gaps (the hidden-name wink is the one playful privacy moment) |

Rules: use names, not "the user" or "your partner". AU spelling and idiom (categorise, arvo, squiz) in moderation: at most one cheeky line per card [ASSUMPTION]. Never imply financial advice; planner and forecast outputs are "estimates".

## Component Patterns

Behavioural. Visual specs live in `DESIGN.md` § Components; names match it. Presentational only (no behaviour beyond shadcn): Button, Stat tile, Person dot, Focus ring.

### Shell & reports

Mocks: [key-cash-flow.html](mockups/key-cash-flow.html) (Sankey, bar lists, glimpse, leaks) · [key-cash-flow-phone.html](mockups/key-cash-flow-phone.html) (phone shell, P&L table) · [key-spending.html](mockups/key-spending.html) (category bars, leaks) · [key-net-worth.html](mockups/key-net-worth.html) (as-of-today view)

| Component | Behavioural rules |
|---|---|
| **App sidebar** / **Bottom tab bar** | Current surface marked `aria-current="page"`. Phone tab bar is always visible except while the keyboard is open [ASSUMPTION]. Sign out ends this session only and lands on `/sign-in`. |
| **Nav count badge** | Needs review: the viewer's open items; Transactions: the viewer's uncategorised rows [ASSUMPTION: what the Transactions badge counts]. At zero the badge becomes a check. |
| **Page header** | Greeting uses the viewer's display name. Freshness line states the newest imported date and its provenance ("imported up to 30 Sep from CommBank CSV, 9:14 pm"), prefixed by the range where the date range applies. Import button present on every signed-in view. |
| **Date-range control** | Shown **only where it filters**: Cash flow, Spending, Transactions, Account detail. Not on Net worth, Accounts, Loan detail, Property detail, Needs review, Budgets, Goals, Home buying or Settings; Forecast uses its own horizon control. Presets Quarter · FY to date · Custom; chevrons step by the selected unit; FY boundaries are 1 Jul–30 Jun. The range lives in URL search params and persists across surfaces in a session [ASSUMPTION]. Custom opens a range calendar popover. |
| **Segmented control** | Swaps the view in place without refetching the period; choice held in the URL. Sankey: Groups · Categories · Both. |
| **Apportioned share line** / **Share toggle** | Always visible under the KPI row on Cash flow and on Spending. Line: "Your share: $X of $Y shared (54%)", from contribution share (50/50 when none is set). Toggle "My share" scales reports to the viewer's apportioned share of shared spending; "Everything I can see" shows the viewer's full visible splits. Default "Everything I can see" [ASSUMPTION]; choice held in the URL. |
| **KPI tile** | Read-only. Figures come from the server; the note line is copy chosen from server facts (count of pays, top expense). Clicking Money in / Money out filters Transactions to that flow [ASSUMPTION]. |
| **Sankey card** | Bands draw in once, left to right. Hover or focus a band/node: `richText` tooltip with amount, share and transaction count. Click a node: drill to Transactions filtered by that category/group and range. Income nodes are per person; property rent and costs are their own nodes. Top nine groups get ramp colours; the rest fold into **Other**, which expands in place on click. **Uncategorised** is always its own node and drills to Needs review. Transfers between own accounts excluded. "View as table" switches to the P&L table. |
| **P&L table** | Income and Expenses sections, groups expandable, % of income column. On phone this replaces the Sankey (no Sankey toggle). Row click drills to Transactions. |
| **Income / expense bar lists** | On Cash flow (below the Sankey, same figures) and on Spending. Income: Category · Merchant; Expenses: Group · Category · Merchant. Rows sorted by amount; colours match the Sankey nodes. Row click drills to Transactions. |
| **Spending category bars** | Sorted by amount; flexible categories tagged; change against the previous period of equal length. Row click drills to Transactions. |
| **Leak tile** | Server picks the top small recurring spends for the range; click drills to those transactions. |
| **Net worth view** | As of today (ignores the date range). Assets and liabilities from accounts the viewer can see, property at its latest entered valuation. Trend card shows history; "Where will we be in 2 years? →" opens Forecast in Net worth mode. Group subtotals and account rows drill to Account detail. |

### Transactions & review

Mocks: [key-transactions.html](mockups/key-transactions.html) (filters, 3 rows selected, hidden-name rows) · [key-needs-review.html](mockups/key-needs-review.html) (8 open items across the kinds below)

| Component | Behavioural rules |
|---|---|
| **Transaction filters** | Chips, Selects and search all write URL params (CAP-18); combine with AND. Search matches merchant, notes, category or amount ("142.85" or "142"). Hidden-name rows never match the partner's search. "Clear filters" resets all but the date range. |
| **Transactions summary line** | Counts and in/out totals for the current filter, from the server; "2 need review" links to Needs review. |
| **Date-group header** | Shows the day's net for the filtered rows. |
| **Transaction row** | Click opens the transaction sheet; the checkbox (desktop) selects without opening it (from mock). Category chip is editable inline [ASSUMPTION]. Person dot = who performed it. Logo comes from the egress proxy for confirmed payees; otherwise the initial. Tags show inline. |
| **Bulk select bar** | Checkbox or Shift-click selects rows; header checkbox selects the loaded page only. Actions: Categorise, Tag, Mark shared; each applies through the same use case as single edits and offers Undo in a toast. Esc clears selection. |
| **Transaction sheet** | Category, tags, notes, beneficiary, hide name, split editor. Splits must sum to the parent; remaining amount shown live and Save disabled until zero (server validates). Each split: amount, category, beneficiary, activity, tags. |
| **Category chip** | Click opens a category combobox (type to filter); a correction may trigger a rule offer in Needs review. |
| **Hidden-name row** | Partner and owner views per § Privacy & Partner Awareness › Hidden name. The owner (from mock) sees the same tinted row with the real name, a "Hidden from Carissa until <date>" tag and the line "Carissa sees 'Hidden until <date>'. Your secret's safe." Hiding is set from the transaction sheet with a date ≤ 12 months. |
| **Needs review item** | One list, one action set per kind (table below); a summary line "7 things need you. Most take one click." heads it. Items resolve when their entity changes, not only by dismissal. AI suggestions show confidence as a meter + words + % (from mock): "Very sure" ≥ 90%, "Fairly sure" below. Suggestions at ≥ 90% confidence are batched into one bulk-accept card with every row pre-ticked; unticking a row leaves it as a single item; Accept all applies the ticked rows with one Undo toast. |
| **Partner pending chip** | "Carissa: 12 left"; what it counts per § Privacy & Partner Awareness › Partner pending. Refreshes on focus and every minute [ASSUMPTION: interval]. Hidden at zero. |

### Needs review item kinds

| Kind | Summary | Actions |
|---|---|---|
| AI suggestion | "Woolworths → Groceries?" | Accept · Change |
| Rule offer | "Always do this for Woolworths?" | Yes, always · Just this once |
| Duplicate pair | "These two look the same" | Keep both · It's a duplicate (never silently merged) |
| Transfer | "Looks like a transfer between your accounts" (both legs shown) | Not a transfer · Yes, it's a transfer (excluded from Cash flow) |
| Import hand-off | "Simon handed you a file: cba-oct.csv" | Pick account → Import · Dismiss |
| Set-aside rows | "3 rows from cba-joint-oct.csv were set aside" with row number, raw line and reason | Fix row (edit inline) → Import it · Ask Pangolin to read these · Discard row. When AI has read a line: "Looks like a rate change on Investment home loan: 6.24% → 6.49% from 1 Nov" → Confirm · Not that |
| Bill detected | "Looks like a monthly bill: Origin, about $180" [ASSUMPTION copy] | Confirm bill · Not a bill |
| Bill alert | "Origin is up 14% ($205)" / "Netflix didn't turn up this month" [ASSUMPTION copy] | Got it · Open transactions |
| Over budget | "Eating out's had a big fortnight: $460 of $400" | Open budget · Adjust limit · Got it |
| Large withdrawal | "$16,400 came out of Shared savings on 29 Sep" plus the transaction row | **Cover it** (primary; opens Cover an expense in large-purchase order) · **It's for a goal** (links it to one goal, as a linked withdrawal) · **Take it from the buffer** (only when the buffer covers it; left as is) · **Not an expense** (for example a move to an offset account). Raised when a withdrawal out of a pool's savings accounts (not to another savings account in the same pool, not already linked to a goal) reaches that pool's threshold ($2,000 by default, editable on Goals). Scope per AD-22: shared pool → both partners; personal pool → that person; private account → its owner only |
| Goal shortfall | "Your goals are $320 ahead of what's in the bank" | Cover it (opens Cover an expense, shortfall order) · Move $X/fortnight from the buffer (only when the stage gives the buffer a share) · Open goals. While the pool has an open Large withdrawal item, this item points to it instead of offering a second fix |
| Goal mismatch | "Savings and goals are $85 apart" | Put the difference in the buffer · Open goals |
| Goal complete / stage change | "Emergency fund's full. On to Stage 2: Build." | Accept new split · Set percentages |
| Partner reset notice | "Simon reset your sign-in on 3 Oct" | Got it · Revoke the link (plain, no cheek) |

### Planning

Mocks: [key-budgets.html](mockups/key-budgets.html) (budget states, editor sheet) · [key-goals.html](mockups/key-goals.html) (stage card, kind and emergency-fund badges, shortfall line, Undo toast) · [key-cover-expense.html](mockups/key-cover-expense.html) (large purchase and shortfall orders, sliders, protected warning) · [key-cover-expense-phone.html](mockups/key-cover-expense-phone.html) (the same sheet from the bottom on phone) · [key-forecast.html](mockups/key-forecast.html) (low balance ahead, changed assumption, not enough data)

| Component | Behavioural rules |
|---|---|
| **Budget card** | Shows spent vs limit for the current period (fortnight or month, anchored to the scope's payday), a pace tick, and the projection to period end ("On track for $380 by 17 Oct"). The mini chart plots current vs projected progress. Over the limit (spent > limit): the bar turns the warning colour, a nudge line appears on the card, and one Over budget item lands in Needs review per budget per period [ASSUMPTION: once per period]. Click opens Transactions filtered to that category and period. Edit (pencil) opens the budget editor. "New budget" (secondary button) beside the summary line opens it empty (from mock). |
| **Budget editor** | Sheet with: category or group, scope (Shared / Simon / Carissa — only own or shared), period (Fortnight / Month), limit, rollover switch. The limit is **pre-filled with a suggestion from recent average spending** ("You've averaged $410 a fortnight") and is editable. Save creates or updates. Personal budgets are visible only to their person (AD-22). |
| **Goal card** | Progress bar of balance vs target; "At the current rate, you'll arrive by <month year>" from the server's projection; "—" with "Not enough history yet" when there's no rate. The card shows a **Protected** badge (shield icon plus text) or nothing for Flexible, and an **Emergency fund** badge on the pool's emergency fund (its kind doesn't apply). The pencil opens the goal editor. Shortfall shows a warning line (warning colour, never money-out red) with **Cover it** (opens Cover an expense in shortfall order), and **Move $X/fortnight from the buffer** only when the active stage gives the buffer a share; buffer divert applies immediately, keeps the shortfall flagged with a projected clear date, and offers Undo in a toast. Entry points: "Add a goal" (secondary button) beside the summary line (from mock), and **Cover an expense** (secondary button) beside it. Goals page header names the active stage and the projected date of the next stage change; the stage card also holds the pool's Large withdrawal threshold ("Flag withdrawals of $2,000 or more", editable per pool) [ASSUMPTION: placement]. |
| **Goal editor** | Sheet, from Add a goal or the card's pencil: name; pool (Shared or own); target; kind, a ToggleGroup **Flexible · Protected** with captions "First to give way when something comes up" / "Only touched as a last resort, with a warning"; and an **Emergency fund** switch, disabled with "Shared savings already has one: Rainy day" when the pool has one. New goals default to Flexible. While the switch is on, the kind toggle is hidden. Save creates or updates (server validates one emergency fund per pool). |
| **Cover an expense** | Sheet opened from Goals (**Cover an expense**), a Large withdrawal item (**Cover it**) or a shortfall (**Cover it**). Header: amount, label ("Car repair"), pool and reason; typed when opened from Goals, pre-filled when opened from an item. Sections follow the reason's order: large purchase **Emergency fund → Flexible → Protected**; shortfall **Flexible → Emergency fund → Protected**. Each goal row: name and badges, balance, Slider plus amount input (0 to its balance), and its new arrival line from the server. Pangolin pre-fills the proposal (emergency fund up to its full balance; the Flexible split in proportion to each goal's balance); after each change the server returns **Left to cover** and the arrival lines (the web never sums). Protected is collapsed and disabled until every earlier section is at its maximum; then a warning line appears with **Use protected goals**, and only after that click do Protected sliders unlock. **Confirm cover** (primary) is enabled when Left to cover is $0, or when every eligible goal is at its maximum (a partial cover); Protected goals are not eligible while they're locked, so a cover can be confirmed without unlocking them. Whatever goals don't cover stays with the buffer (large purchase) or stays flagged (shortfall). Confirming applies, closes the sheet and offers Undo in a toast. Only goals in the expense's pool appear, never the partner's personal goals. The buffer is never drawn. Each confirmed cover appears in Goals history ("Carissa covered Car repair, 5 Oct") with Undo while its period is open. Mocks: [key-cover-expense.html](mockups/key-cover-expense.html) · [key-cover-expense-phone.html](mockups/key-cover-expense-phone.html). |
| **Forecast chart** | Segmented control **Cash flow · Net worth**. Cash flow: per-account projected balance for **transaction accounts only** (from mock; savings, loans and cards aren't plotted), horizon 3 / 6 / 12 months [ASSUMPTION: default 3], low-balance threshold per account [ASSUMPTION: editable, value unstated]. The first dip below threshold gets a warning line naming account, amount and date; only the dipping account's threshold is drawn; the rest are listed in the thresholds chip (from mock). Net worth: low / mid / high return lines, horizon 1 / 2 / 5 / 10 years [ASSUMPTION: horizon options; default 2]. Hover/focus a point: tooltip with date and value. "View as table" under each chart. |
| **Assumption chips** | Each chip is an editable assumption; click opens an inline editor; changed values show a "changed" dot and a reset. Planner and Forecast both use them. Forecast chips: savings rate, return (low/mid/high), mortgage amortisation with offset, super contributions. |
| **Home buying glimpse** | Shows the most recent saved plan (or live default) at today's rate; rate pills on the card change the figures in place; "Open planner →" carries the selection over [ASSUMPTION]. |
| **Planner result** / **Rate stress bars** | Hero, repayments and left for actual life recalculate on any input change; while a recalculation is in flight, figures dim, then settle and announce once; on failure the last figures stay with "Couldn't recalculate. Showing the last figures." and a retry [ASSUMPTION]. Stress bars always include the +3 percentage points (pp) row; the selected rate row is bold. |
| **Rate pills** / **Slider** | Pills pick a named rate quickly; the slider fine-tunes; both drive the same value and all outputs update live. Typed values accepted in the adjacent input. Keys per § Interaction Primitives. |
| **Scenario compare** | Up to three named scenarios (A/B/C) side by side; each holds rate, term, and property choices; one is "selected" and drives the hero number [ASSUMPTION: max 3]. |
| **Property card** | Toggle Use equity / Sell it per property; the hero updates live. Ownership share scales usable equity, rent and sale proceeds. A property needs a value and loan balance to be used [ASSUMPTION]. Which properties and loans count: § Home Buying Planner › Data scope ("Not in shared plans"). |
| **Ownership split input** | Percentages per person summing to 100 (Save disabled otherwise); default 100% to the account's owner [ASSUMPTION]. |
| **Saved plan row** | Plans are **shared** by both partners (data scope per § Home Buying Planner). Name, timestamp, the typed inputs and choices, and a headline snapshot (borrow, repayment, left to live on, as both saw them). Reopening shows that headline beside today's recalculation from the saved inputs and currently shared data. Inputs that are no longer shared drop out, with "Some inputs are no longer shared". |

### Accounts, settings, auth & feedback

Mocks: [key-accounts.html](mockups/key-accounts.html) (grouped rows, one stale account) · [key-settings.html](mockups/key-settings.html) (side menu, failed backup) · [key-sign-in.html](mockups/key-sign-in.html) (sign-in, re-auth dialog) · [key-import-popover.html](mockups/key-import-popover.html) (every popover state)

| Component | Behavioural rules |
|---|---|
| **Account row** | Click opens Account detail (Loan detail for loans, Property detail for property rows). Rows group Cash (transaction, offset) · Savings · Cards · Loans · Investments (brokerage, super) · Other (vehicle, other), then a separate Properties card (from mock). Stale (newest import > 45 days old) shows the freshness caption in the warning colour and an "Import" shortcut. Private lock shows to the owner only. |
| **Loan detail** | Rules in § Loan Detail. |
| **Settings section menu** | Side menu ("On this page") links jump to `/settings#<section>` and the highlight follows the scroll; the section in view is marked `aria-current="location"` (from mock); opening a URL with a hash scrolls to that card. Old `/settings/:section` links redirect to the anchor. |
| **Settings card** | Content always readable; protected actions open the re-auth dialog first. One action per row (Remove, Change, Sign out, Make new codes); the card's footer caption names which actions ask you to confirm it's you (from mock). |
| **Appearance card** | Selecting a theme or mode applies instantly and saves for this person. |
| **Signed-in devices card** | Lists this person's sessions, newest first; "Sign out" ends that session (re-auth not required [ASSUMPTION]). Signing out on "This device" returns to `/sign-in`. |
| **System status card** | Read-only: health, last backup, last restore drill, failed jobs (kind and time only, AD-9); the recovery-bundle warning until its safe storage is confirmed (AD-27; shipped). Failures show a warning line with plain copy. No restore button; caption: "Restores run from the server CLI." |
| **Sign-in form** | Passkey first; "Use password instead" → email + password → TOTP code. Success returns to the requested URL or Cash flow. |
| **Re-auth dialog** | Opens when the server returns `ReauthRequired`; passkey first, password + TOTP fallback; on success the original action retries automatically; cancel leaves state unchanged. |
| **Import popover** | Steps in § Interaction Primitives; mock [key-import-popover.html](mockups/key-import-popover.html). Includes per-bank export instructions and the note "Re-importing the same file changes nothing." Opened from the header Import (every view) or the secondary Import beside the Transactions search (from mock). |
| **Celebration banner** | Appears once when the trigger happens (all categorised, goal hit); dismissible ×; does not reappear for the same occurrence [ASSUMPTION]. Confetti pops once; none with reduced motion. |
| **Empty state** | One headline, one sentence, one primary action (Import a bank file). Ghost of the future content behind it. |
| **Warning line** | Inline, non-blocking, links to where to fix it (Needs review, Import, Goals). |
| **Demo banner** | Demo instance only: "Demo data — nothing here is real" [ASSUMPTION copy]; write actions disabled with a tooltip. |
| **Offline banner** | Shown while the network is down: "You're offline. Pangolin needs the server to show your numbers." [ASSUMPTION copy]; no cached data shown. |
| **Toast** | Confirmations and Undo for reversible actions (recategorise, accept suggestion, bulk accept, bulk edits, shortfall fix, confirmed drawdown, confirmed AI-read row) [ASSUMPTION]. Never used for errors that need action — those stay inline. |

## State Patterns

Grouped by surface, app-wide states first. Focus, reduced motion and phone layout are covered in § Accessibility Floor and § Responsive & Platform.

### App-wide

| State | Surface | Treatment |
|---|---|---|
| **Loading (cold)** | All data surfaces | shadcn Skeletons matching layout (KPI row, chart block, rows). Sankey draws in once on first data. |
| **Error** (load) | Any | Inline card: "Couldn't load your numbers. Try again." with retry. No mascot, no cheek. |
| Not found | Any `:id` route | Plain "We couldn't find that." — identical whether missing or the partner's private account (AD-5). |
| Session expired | Any | Redirect to `/sign-in`, then back to the original URL. |
| Validation | Forms, transaction sheet, ownership split | Inline per field; Save disabled until valid. |
| **Demo instance** | Whole app | Demo banner; seeded data, read-only; write actions disabled with a tooltip. |
| Offline | Whole app | Offline banner; no cached data shown. |
| **Hidden name** | Transactions, Cash flow latest, search, review | Per § Privacy & Partner Awareness › Hidden name. |
| **Private** | Everywhere | Per § Privacy & Partner Awareness › Private account. Per-viewer totals differ; shared figures are identical. |
| **Partner pending** | Needs review, Cash flow header [ASSUMPTION] | "Carissa: 12 left"; per § Privacy & Partner Awareness › Partner pending. |

### Reports

| State | Surface | Treatment |
|---|---|---|
| **Empty (no imports)** | Cash flow | KPIs show `$—` with cheeky notes; card "Nothing to sniff at yet" + mascot; "Import a bank file"; ghost Sankey "Your Sankey lands here". Copy says <partner> imports their own on their laptop. |
| Nothing in this range | Cash flow, Spending | Imports exist but no rows in range: "Nothing happened in this stretch." + previous/next range buttons [ASSUMPTION copy]. |
| Duplicates | Cash flow, Needs review | Warning line "2 transactions look like duplicates. Check them in Needs review." |
| Empty | Spending | Same empty card pattern as Cash flow, pointing to Import. |
| Empty | Net worth | KPIs `$—`; "Add an account or import a statement to see your net worth." |
| Missing valuation | Net worth, Property card | Property listed without value: "Add a valuation to count this property." inline. |

### Transactions & review

| State | Surface | Treatment |
|---|---|---|
| Empty | Transactions | "No transactions yet" + Import button [ASSUMPTION copy]. |
| No matches | Transactions | "Nothing matches those filters." + Clear filters [ASSUMPTION copy]. |
| Transfer to partner's private account | Transactions | Per § Privacy & Partner Awareness. |
| Empty / clear | Needs review | Celebration if cleared this session; otherwise "Nothing needs you. Nice." [ASSUMPTION copy] with partner pending chip if the partner has shared-visible items. |
| AI-read row proposed | Needs review | Proposed event shown beside the raw line; nothing changes until Confirm. AI unavailable or unsure → "Couldn't make sense of this one. Fix it by hand or discard it." [ASSUMPTION copy] |

### Import

| State | Surface | Treatment |
|---|---|---|
| Import in progress | Import popover, Transactions | Polls `import_batch.status` (AD-9): "Reading file… / Checking for duplicates… / 142 new, 3 to review". Navigation allowed while it runs. |
| Nothing new | Import popover | "Nothing new. You've already imported all of this." |
| Unsupported file | Import popover | "We can't read .xlsx files. Try CSV, OFX, QIF or PDF." Nothing committed (whole file unreadable). |
| **Partial import** | Import popover, Needs review | Result "142 imported · 3 set aside" listing row number + reason, with "Ask Pangolin to read these". Plain copy. Behaviour per § Interaction Primitives › Import popover (step 5). |
| Error (import) | Import popover / Needs review | Exact reason per set-aside row (date we can't read, no amount, text in the amount column) or a balance gap of $X against the statement; PDF failures show rows beside the page image for correction (spec). |
| Import hand-off pending | Sender's view | "Waiting for Carissa to pick an account" on the batch [ASSUMPTION]. |

### Accounts & loans

| State | Surface | Treatment |
|---|---|---|
| Empty | Accounts | "No accounts yet" + Import a bank file / Add loan by hand. |
| **Stale account** | Accounts, header freshness, Cash flow | Newest import for an account > 45 days old: warning line "Your CommBank data stops at 30 Aug. Import a fresh file?" [ASSUMPTION copy]. Reports still render. |
| Balance gap | Account detail, Needs review | Warning line with the gap amount and the batch; plain copy. |
| Missing loan terms | Loan detail | "Add the loan's rate and term to see the schedule" inline form; actuals still charted. |
| No interest entered | Loan detail | "Where your repayments went" shows "Add interest from a statement to see the split." |

### Planning

| State | Surface | Treatment |
|---|---|---|
| Empty | Budgets | "No budgets yet" + "Set your first budget" [ASSUMPTION copy]. |
| On track / ahead of pace | Budget card | Fill primary; caption "On track for $380 by 17 Oct". |
| Projected over | Budget card | Spent under limit but projection over: projected segment and caption in the warning colour ("Heading for $460 by 17 Oct"); no review item yet. |
| **Over budget** | Budget card, Needs review | Fill in the warning colour, nudge line, one Needs review item. |
| New period | Budget card | Resets to the new period; rollover shows "+ $40 rolled over" in caption. |
| Empty | Goals | "No goals yet" + "Add a goal" [ASSUMPTION]. |
| Not enough history | Goal card | Arrival line "Not enough history yet". |
| **Goal complete** | Goal card, Needs review | Card tinted with check; celebration banner; review item to accept the rescaled split. |
| Stage change | Goals header, Needs review | Header shows the new active stage; review item explains it. |
| **Shortfall** | Goal card, Goals header, Needs review | Warning line (glyph and text, warning colour) with the amount, Cover it, and the buffer divert per Goal card; Undo toast. |
| Mismatch | Goals header, Needs review | Warning line "Savings and goals are $85 apart" + "Put the difference in the buffer". |
| Not enough data | Forecast | Names what's missing (pay cycle, confirmed bills, budgets) with a link to each [ASSUMPTION]. |
| **Low balance ahead** | Forecast (Cash flow), Cash flow page | Warning line with account, amount and date; marked on the chart. Cash flow page shows the same line under the share line [ASSUMPTION]. |
| All clear | Forecast (Cash flow) | Caption "No dips below your thresholds in the next 3 months." |
| Assumption changed | Forecast, Planner | Changed chips show a dot; "Reset all" appears. |
| Empty | Home buying | Pre-filled from shared-visible data if any exists; otherwise inputs start blank with prompts to type income and spending. |
| Empty | Saved plans | "No saved plans yet. Save this one to compare next time." [ASSUMPTION copy] |
| Recalculating / failed | Planner | Dimmed figures; on failure last figures stay with retry. |
| **Large withdrawal** | Needs review, Goals header | Item per § Needs review item kinds; resolves when the withdrawal is covered, linked to a goal, or left with the buffer. |

### Cover an expense

| State | Surface | Treatment |
|---|---|---|
| Proposed | Cover an expense | Pangolin's split pre-filled; Left to cover from the server. |
| Adjusted | Cover an expense | Any slider moved: a "Back to Pangolin's split" link appears. |
| Not covered yet | Cover an expense | Left to cover above $0 in the warning colour; Confirm cover disabled while any eligible goal is below its maximum. |
| **Protected needed** | Cover an expense | Earlier sections at maximum: warning line naming each Protected goal and its new arrival date, with **Use protected goals**. Plain, no cheek. |
| Can't cover it all | Cover an expense | Every eligible goal at maximum (Protected goals are not eligible while locked), Left to cover still above $0: "Goals can cover $X of $Y. The rest stays with the buffer." (large purchase) / "…The rest stays flagged." (shortfall); Confirm cover enabled for the partial cover. Unlocking Protected is optional. |
| Emergency fund below threshold | Cover an expense, Goals header | "Stage 1 comes back until Rainy day is topped up." |
| Confirmed | Goals, Needs review | Sheet closes; toast with Undo; the item resolves; the cover is listed in Goals history. |
| Undone | Goals | Every goal balance restored; the item reappears if its condition still holds. |
| Recalculating | Cover an expense | Figures at 60% opacity until the server answers. |

### Settings & auth

| State | Surface | Treatment |
|---|---|---|
| **Failed jobs** | Settings › System status | Warning line "2 jobs failed: price refresh (3 Oct, 2:00 am)…" — kind and time only. |
| **Backup failed** / drill failed | Settings › System status | Warning line "Last backup failed on 4 Oct, 3:00 am. The last good one is from 3 Oct." [ASSUMPTION copy]; drill failure the same shape. Plain, no cheek. |
| Re-auth required | Settings sections | Section content visible; protected actions open the re-auth dialog. |
| Passkey cancelled / failed | Sign in, re-auth | "That didn't work. Try again, or use your password instead." No lockout message unless rate limited. |
| Rate limited | Sign in | "Too many attempts. Try again in a few minutes." |
| Code used / invalid | `/recover` | "That code doesn't work. Each code works once." [ASSUMPTION copy] |
| Reset link expired | `/recover` | "This link has expired. Ask Simon for a new one." (24-hour expiry) [ASSUMPTION copy] |
| Setup already done | `/setup` | Redirects to `/sign-in`. |

## Interaction Primitives

**Import popover (drag-drop + hand-off).** The header Import button (every view) and the Transactions Import button open one popover ([key-import-popover.html](mockups/key-import-popover.html): drag-over, picker, progress, clean and partial results, hand-off, fixing set-aside rows):

1. Drop zone: drag a file in or click to browse. Accepts CSV, OFX, QIF, PDF. Drag-over highlights with `{colors.accent}`. Dropping a file anywhere on the page while the popover is closed opens it with the file loaded [ASSUMPTION].
2. Account picker: the viewer's own accounts, shared accounts, and **"For Carissa"** (or "For Simon"). The partner's private accounts never appear. Picking an account shows its bank's export instructions.
3. Import: a progress state polls the batch; summary "142 new, 3 duplicates to review" with a link to Needs review; "Nothing new" when the file was already imported.
4. Choosing "For Carissa" sends the file to her Needs review as an **import hand-off** item; she picks the account (which may be private). Simon only sees "Handed to Carissa".
5. **Bad rows don't block a CSV, OFX or QIF file.** Good rows import. Rows that can't be read are **set aside** (never committed), listed with row number and reason, and gathered into one Set-aside rows item in Needs review, where each can be fixed inline, discarded or handed to AI. A PDF statement with a failed check still blocks as a whole and shows rows beside the page image.
6. **AI interpretation (optional).** "Ask Pangolin to read these" sends the set-aside lines to the provider assigned to row reading. That is a local provider by default; a cloud provider is used only if explicitly enabled, and never for a private account's rows. It proposes a transaction or event — for example a home-loan line "VARIABLE RATE CHANGE 6.49% EFF 01/11" → rate change on Investment home loan from 1 Nov — shown beside the raw line. Nothing is created until the person confirms; Confirm offers Undo.

**Date range.** Rules in Component Patterns › Date-range control. Keyboard: arrows step the range when the control is focused [ASSUMPTION].

**Sliders.** Rate, offset balance, extra repayments and Cover an expense amounts use shadcn Slider with a paired numeric input; arrow keys step (rate 0.05 pp, money $100 [ASSUMPTION steps]), Page Up/Down step ×10. Outputs update live from debounced server recalculation (the web never sums money) [ASSUMPTION: server computes planner outputs].

**Scenario compare.** Add scenario duplicates the current inputs; rename inline; select one to drive the hero. Removing a scenario asks no confirmation but offers Undo [ASSUMPTION].

**Re-auth prompt.** Triggered by `ReauthRequired` for the actions the architecture lists: exports, LLM provider and token changes, deletes, partner-assisted reset; plus regenerating recovery codes [ASSUMPTION: treated as a token change]. Dialog over the current view; the original action retries on success. Re-auth window per architecture (default 5 minutes). Restore is not an in-app action (AD-16: CLI-only on a stopped stack).

**Keyboard.** Full keyboard operation everywhere; Tab order follows reading order; `Esc` closes the topmost popover/dialog or clears a bulk selection; Enter activates. No custom shortcut layer in v1 (the keyboard-first Ledger direction was not chosen) [ASSUMPTION].

**Drill-down.** Any figure that is a sum (KPI, Sankey node, P&L row, bar-list row, category bar, leak tile, budget spent) links to Transactions filtered to exactly the rows behind it.

**Polling.** Async status comes from entity polling (AD-9); no websockets.

**Banned:** hover-only affordances, infinite scroll in place of virtualised lists with URL paging, autoplaying motion, modal stacks deeper than one (except re-auth), cheek in errors.

## Accessibility Floor

WCAG 2.2 AA is the floor (accessibility is a key feature; no specific personal needs). Visual contrast lives in `DESIGN.md`.

- Full keyboard operation of every surface, including the import drop zone (button fallback), sliders, scenario compare, bulk select and the Sankey (focusable nodes in reading order, or the table equivalent).
- Visible focus via `{components.focus-ring}` (≥ 3:1 in every theme) on keyboard focus of every interactive element.
- Screen-reader names and roles on every control; page title announced on navigation; live region for import progress, slider outputs (once on settle: "Borrow about $780,000, about $3,764 a month left"; Cover an expense: "Left to cover: $1,200"), low-balance and over-budget warnings, and celebration text.
- Reduced motion respected: no Sankey draw-in, confetti, wink, slider easing or springy transitions; state changes are instant.
- Every chart has a table equivalent: Sankey ↔ P&L table; balance over time, forecast and net worth trend ↔ "View as table"; budget mini chart ↔ its caption figures; stress bars are already a table.
- Never colour-only: money carries `+`/`−` and labels; over-budget, shortfall, large-withdrawal, protected-warning and low-balance carry a glyph and text; kind badges always carry text; person dots carry names in text or accessible names.
- 200% zoom and 320px reflow without horizontal scroll (tables may scroll inside their card).
- Target size ≥ 24×24 CSS px (2.5.8); phone tab bar and slider thumbs ≥ 44px [ASSUMPTION].
- Hidden names read as "Hidden until 12 March 2027" to assistive tech, with the wink line as description.
- Re-auth and sign-in work with passkeys and with password + TOTP via keyboard alone.

## Key Flows

| Flow | Who | Climax |
|---|---|---|
| 1 — First session | Simon and Carissa, two laptops then one | "We can afford this much" |
| 2 — Loan what-if | Simon | What each extra dollar buys |
| 3 — Return visit to a saved plan | Simon and Carissa | Last time against today |
| 4 — Import hand-off | Simon, then Carissa | Her private account stays private |
| 5 — Budgets | Carissa | Sees the overspend before it happens |
| 6 — Deposit goal | Simon and Carissa | An arrival date to plan around |
| 7 — Forecast | Simon and Carissa | The dip date, and where they'll be in 2 years |
| 8 — Sign-in, re-auth and recovery | Simon, Carissa | Back in, safely |
| 9 — Net worth glance | Carissa, on her phone | "We're getting there" |
| 10 — Car disaster | Simon and Carissa | The deposit barely moves |

### Flow 1 — First session: "We can afford this much" (Simon and Carissa, on the couch, each on a laptop)

Steps 1–6 on their own laptops side by side; steps 7–11 on one laptop together. Wireframe: [wireframes/flow-first-session-2026-10-05.excalidraw](wireframes/flow-first-session-2026-10-05.excalidraw) (the 11 steps across both laptops).

1. **Import own bank.** Simon clicks the header Import, drops his CommBank export, picks his account. Carissa does the same with hers. Progress: "142 new, 3 to review".
2. **Review and categorise.** Each opens Needs review, accepts AI suggestions and says yes to rule offers ("Always do this for Woolworths?"). Simon sees "Carissa: 12 left" — a count of shared-visible items, no peeking.
3. **Every dollar has a home.** The inbox clears: celebration banner "Every last dollar has a home." with a one-off confetti pop (motion-safe).
4. **Cash flow Sankey — first reward.** They land on Cash flow and look at the Sankey together: Simon's pay and Carissa's pay flowing into Savings, Housing, Groceries… They toggle Groups/Categories and adjust the date range.
5. **Spot leaks.** Spending shows "Biggest little leaks" and flexible categories ("Eating out ↑"); they drill into the Uber Eats transactions.
6. **Own budgets and goals.** Each sets their own budgets (Flow 5) and goals (Flow 6) in Planning.
7. **Home buying.** They move to one laptop: Planning › Home buying opens pre-filled with income and usual spending from shared-visible data. They type today's rate.
8. **Add investment property.** Simon adds 35 Hawthorne St with its loan, rent and ownership (100% Simon); he makes sure the loan is shared-visible so it counts. They flip between "Use equity" and "Sell it".
9. **Rates and scenarios.** They drag the rate slider and set up Scenario A (today's rate), B (+1 pp), C (+2 pp).
10. **Climax.** The hero reads: **"You could borrow ~$X and at r% still have $Y a fortnight left"** (illustrative: about $780,000 at 6.09%), with the lender-style estimate and the equity/sell choice applied, and a "Survives a 3% rate jump" chip. That's the number they came for.
11. **Save plan.** They save it as "First look, Oct 2026"; it's shared, so either can reopen it.

Failure:
- Duplicates on import → flagged to Needs review, never silently merged; warning line on Cash flow.
- A file for the other person → "For Carissa" hand-off (Flow 4).
- Some rows can't be read → the good rows import; the bad ones are set aside in Needs review, naming row and reason; optional AI read proposes what they mean.
- Balance gap against the statement → warning line with the amount; Sankey still shows.
- The investment loan is private → the property card shows "Not in shared plans" and the hero excludes it until Simon shares it.

### Flow 2 — Loan what-if (Simon, at his laptop, his investment property loan)

1. Simon opens Accounts and clicks the 35 Hawthorne St loan; Loan detail opens.
2. The header line shows lender, type, rates, term and "Yours: 100%"; tiles show Still owed, Paid off (date), Interest paid, Interest still to pay; the chart shows actual and projected.
3. He adds last quarter's interest from his statement; "Where your repayments went" fills in for that period.
4. In "What if I pay extra?" he enters a monthly extra amount; the planned line appears and the tiles update.
5. He drags the offset slider above today's offset balance.
6. **Climax:** the "Your offset" card shows interest saved and time saved, and the Paid off tile moves to the earlier date — he can see what each extra dollar buys.
7. He notes it; nothing is saved (what-ifs are not persisted) [ASSUMPTION].

Failure: the loan has no contract terms → "Add the loan's rate and term to see the schedule" inline form; actuals still charted. Extra above the yearly cap → capped with the caption "Your contract caps extras at $X a year."

### Flow 3 — Return visit to a saved plan (Simon and Carissa, two months later)

1. Monthly couch session, signed in as Carissa. They open Planning › Home buying.
2. Saved plans list shows "First look, Oct 2026 — borrow ~$650,000" (illustrative).
3. They open it: the saved headline (borrow, repayment, left to live on) sits beside today's recalculation from the saved inputs and fresh shared data.
4. **Climax:** "Last time we said $650k" sits beside today's figure, so they can see how far they've moved [ASSUMPTION: a short note says which inputs changed].
5. They tweak the rate scenarios and save as a new plan; the old one stays for comparison.

Failure: an account the plan used is no longer shared-visible → "Some inputs are no longer shared" and the recalculation runs without them [ASSUMPTION copy].

### Flow 4 — Import hand-off (Simon has Carissa's file)

1. Simon has a bank file that belongs to one of Carissa's accounts [ASSUMPTION: scenario]. He clicks Import, drops the file, and in the account picker chooses **"For Carissa"**.
2. The popover confirms "Handed to Carissa. It'll wait in her Needs review."
3. Carissa's Needs review shows "Simon handed you a file" with the file name and an account picker (her private accounts included).
4. **Climax:** she picks her private savings account; the import runs, and Simon's view never learns which account it went to.
5. If she picks wrongly she can undo the batch from Needs review [ASSUMPTION].

Failure: Carissa dismisses the hand-off → the file is discarded and Simon's batch shows "Carissa didn't import this" [ASSUMPTION].

### Flow 5 — Budgets (Carissa, after the first session; then a fortnight later)

1. After Flow 1, Carissa opens Planning › Budgets. Empty state: "No budgets yet".
2. She clicks "Set your first budget", picks Eating out, scope Carissa, period Fortnight.
3. The limit is pre-filled: "You've averaged $410 a fortnight." She types $350 and saves.
4. She adds Groceries (Shared) the same way; the card shows $0 of $600 with the pace tick at today.
5. A fortnight later, after her import, the Eating out card shows $280 of $350 and "Heading for $460 by 17 Oct" in the warning colour.
6. **Climax:** the card shows spent vs limit, the pace tick and the projected line side by side — she sees she'll be over before it happens, and has nine days to ease off.
7. She goes over: the bar turns the warning colour, the card says "Eating out's had a big fortnight.", and an Over budget item lands in her Needs review.

Failure: she resolves the item with "Adjust limit" (opens the editor) or "Got it". Simon's personal budgets never appear for her (AD-22). No spend history for a category → no suggestion; the field starts empty with "No history yet" [ASSUMPTION].

### Flow 6 — Deposit goal (Simon and Carissa, together)

1. On Planning › Goals, Simon adds a shared goal "House deposit", target $160,000, linked to the shared savings pool, and marks it **Protected**.
2. The goal sits in the active stage ("Stage 1 · Emergency fund first") at its rule share.
3. After the next import and period close, the card shows a progress bar "$48,200 of $160,000".
4. **Climax:** "At the current rate, you'll arrive by Mar 2028." — a date they can plan the home purchase around.
5. Months later small withdrawals leave goals $320 ahead of the bank. The warning line offers **Cover it**. This stage gives the buffer no share, so no buffer option is shown. The same item sits in Needs review.
6. Simon clicks Cover it. Pangolin proposes $320 across the Flexible goals in proportion to their balances ($267 from Japan trip, $53 from New couch). He confirms, the shortfall clears, House deposit is untouched, and a toast offers Undo.

Failure: not enough history → "Not enough history yet" instead of a date. A savings/goal mismatch (for example a newly flagged account) → "Put the difference in the buffer".

### Flow 7 — Forecast (Simon and Carissa, one laptop)

1. They open Planning › Forecast; Cash flow mode shows each account's projected balance for 3 months from pay cycles, confirmed bills and budgets.
2. A warning line reads "Everyday could dip to $140 on 12 Nov, two days before payday." and the dip is marked on the chart.
3. **Climax (short term):** they see the exact date and gap, and move a bill date or top up Everyday before it happens.
4. They switch to Net worth mode with the horizon at 2 years; low / mid / high lines show where they could be.
5. They edit the savings-rate chip to the rate they'd need for the deposit; the lines move, the chip shows "changed".
6. **Climax (long term):** "In 2 years: about $X (mid)" — where they'll be if they keep going [ASSUMPTION: headline copy].

Failure: missing pay cycle or no confirmed bills → "Not enough data" naming each gap with a link (pay cycle in Settings, bills in Needs review).

### Flow 8 — Sign-in, re-auth and recovery (brief)

| Moment | Steps | Climax / failure |
|---|---|---|
| Sign in (Simon) | Opens Pangolin → `/sign-in` → "Sign in with passkey" → Cash flow | Lands on Cash flow in one tap. Failure: passkey cancelled → retry or password + TOTP; too many attempts → rate-limited message |
| Re-auth (Simon) | Settings › LLM providers → change key → re-auth dialog → passkey | Original change completes automatically. Failure: cancel → nothing changes |
| Recovery code (Carissa, new phone) | `/recover` → enters a recovery code → forced new passkey enrolment → Cash flow | She's back in with a new passkey. Failure: used or invalid code → plain message; try another |
| Partner reset (Simon helps Carissa) | Settings › Partner → re-auth → create reset link (24 h) → gives it to Carissa [ASSUMPTION: shown as a copyable link] → she opens it on `/recover` → enrols passkey | Carissa sees a "Simon reset your sign-in" notice in Needs review. Failure: link expired → "Ask Simon for a new one" |

### Flow 9 — Net worth glance (Carissa, on her phone)

1. On the bus, Carissa opens Pangolin; Cash flow loads. She taps More › Net worth.
2. KPIs show Net worth, Assets, Liabilities as of today, from what she can see.
3. **Climax:** the trend card shows the line climbing since last month — a quick "we're getting there" without opening a laptop.
4. She taps "Where will we be in 2 years? →" and lands in Forecast, Net worth mode.

Failure: a property has no valuation → "Add a valuation to count this property"; an account is stale → its row shows the 45-day warning.

### Flow 10 — Car disaster: "The deposit barely moves" (Simon and Carissa)

Mocks: [key-cover-expense.html](mockups/key-cover-expense.html) · [key-cover-expense-phone.html](mockups/key-cover-expense-phone.html).

1. The car needs a new engine. Carissa moves $16,400 from Shared savings to Shared bills and pays the mechanic.
2. After the next import, a Large withdrawal item lands in both Needs review: "$16,400 came out of Shared savings on 29 Sep".
3. Carissa clicks **Cover it**. Emergency fund "Rainy day" $8,000 (all of it), then Flexible: Japan trip $6,000 and New couch $1,200 at their maximum. Left to cover: $1,200.
4. Protected stays locked behind the warning: "This takes $1,200 from House deposit, which you've marked Protected. Its arrival moves from Mar 2028 to Apr 2028." The footer reads "Goals can cover $15,200 of $16,400. The rest stays with the buffer." and Confirm cover is already enabled for that partial cover. She chooses to click **Use protected goals** instead.
5. Simon would rather keep the couch money. She drags New couch to $0; Left to cover shows $2,400, so she drags House deposit up to $2,400. The arrival line updates from the server.
6. **Climax:** She confirms. "Rainy day's below 80%. Stage 1 comes back until it's topped up." House deposit moves from Mar 2028 to May 2028, not years, and they can see exactly why.
7. Carissa's personal "Pilates retreat" goal and Simon's personal goals are never listed or touched. Both see "Carissa covered Car repair, 5 Oct" in Goals history. A toast offers Undo.

Failure: the withdrawal was a move to the offset account → **Not an expense**. They change their minds a day later → Undo from Goals history (period open) restores every goal and re-raises the item.

## Home Buying Planner

Lives at Planning › Home buying. Captured now; the spec catches up later. Mocks: [key-home-buying.html](mockups/key-home-buying.html) (full planner, desktop) · [key-home-buying-phone.html](mockups/key-home-buying-phone.html) (same cards stacked, sliders and scenarios on phone). All maths is an estimate and runs on the server with no lender data; the web never sums money.

**Data scope.** Plans are shared by both partners and use only shared-visible data. Properties, loans and the deposit source count only if both can see them; a viewer's private items appear to them as "Not in shared plans" and never feed a plan.

**Inputs.** Pulled from shared-visible data wherever possible: take-home income, usual spending (from categorised splits), deposit (from the shared savings pool or shared deposit goal [ASSUMPTION]), existing properties and loans with ownership shares. Typed by the couple: interest rate(s), loan term (default 30 years P&I, from mock), home costs (rates and insurance), deposit override, rate variability. Every input can be typed or slid.

**Outputs.**

| Output | Shown as |
|---|---|
| Borrowing power | Hero figure; "That's a place up to about $940,000 with your $160,000 deposit" |
| Repayments | Monthly and fortnightly, "lined up with pay day" |
| Left for actual life | Per Term map. Fortnightly in the hero sentence ("$3,506 a fortnight to live on"), monthly in the stat tile and stress rows ($7,596 / mo) |
| Rate stress table | "What's left if rates misbehave" rows per scenario rate plus the stress rate (+3 pp) |
| Stress check | Chip "Survives a 3% rate jump (9.09%)" or a plain warning if not |

**Two calculators.** (1) **Simple:** borrowing power from income, spending and rate; repayment calculator for a given amount and rate. (2) **Lender-style serviceability estimate ("true financing"):** each assumption is an editable chip, labelled "estimates, not a lender's offer". **Display (from mock):** the hero is always the lender-style figure; the Lender-style estimate card shows Simple calculator, Lender-style estimate ("Used for the number above") and Debt-to-income side by side. The repayment calculator is its own card (amount + rate → monthly and fortnightly).

**Card order (from mock):** result + stress → Lender-style estimate → Scenarios → inputs ("What we're working with", each input tagged "from Pangolin" or "typed") + Repayment calculator → Properties you already own + Saved plans. Same order stacked on phone.

| Assumption | Default |
|---|---|
| Assessment buffer | +3 pp over the entered rate |
| Living expenses | the higher of actual spending and HEM |
| Rental income | counted at 80% |
| Credit-card limits | 3.8% of limit per month as debt |
| Debt-to-income cap | 6× |

**Existing properties.** Multiple properties with loans, each with an ownership split. Toggle per property: **Use equity** — usable equity = value × 80% LVR − loan, scaled by ownership share; rent (at 80%) counts as income. **Sell it** — proceeds = value − 2.5% selling costs − loan − CGT estimate ("estimate, not tax advice"), scaled by ownership share, go to the deposit; rent and repayments drop out. The hero updates live.

**Scenarios.** Named side-by-side scenarios and a live slider (§ Interaction Primitives).

**Saved plans.** Save with a name ("First look, Oct 2026"); a plan keeps its typed inputs and choices plus a headline snapshot (borrow, repayment, left to live on), and everything else is recalculated on open (§ Component Patterns › Saved plan row). List with name, date and headline figure; reopen to compare the saved headline with today (Flow 3).

**Future (post-v1).** The climax extends to show how rate changes pressure savings and flexible categories (for example eating out).

## Loan Detail

Under Accounts, for every loan (including investment-property loans). Mock: [key-loan-detail.html](mockups/key-loan-detail.html) (Simon's investment loan partway through a what-if: extras, bigger offset, property section). Loans come from an import or **Add loan** by hand (name, lender, type, rate, term, start, balance, ownership split).

- **Header line:** lender · loan type · nominal vs effective rate · term and start · ownership share; "54% repaid · next $2,140 on 1 Nov".
- **Tiles:** Still owed (of borrowed) · Paid off (date) · Interest paid (sum of entered figures) · Interest still to pay (estimate from rate and term).
- **Balance over time:** actual (solid), projected (dashed), planned with extras (thin); "View as table".
- **Where your repayments went:** principal vs interest from **user-entered interest figures** taken from bank statements ("Add from a statement": period + interest amount). Never auto-estimated (spec non-goal). Shows only periods with entered figures.
- **Schedule:** estimated from the loan's terms and corrected by entered interest figures; the caption reads "Estimate: worked out from the rate and term." Importing a lender's repayment plan is later work (not in v1).
- **What if I pay extra?** Monthly extra and one-off extra (amount + date), capped at the contract's yearly extra limit when entered; outputs payoff date and interest saved.
- **Your offset:** benefit tile (interest saved, time saved) and a slider to adjust the offset balance and see the effect.
- **Who owns this loan:** Ownership split input; scales equity and sale figures in Home buying.
- **Property section:** for a loan secured on a property, a card "The property behind it" summarising that property (value, net cash this FY with its per-month figure, gearing, ownership) with "View property →" (from mock).
- **Layout (from mock):** tiles → Balance over time beside Where your repayments went + Who owns this loan → What if I pay extra? beside Your offset → Property section (`DESIGN.md` § Layout & Spacing).
- What-ifs are not saved [ASSUMPTION].

## Property Detail

Under Accounts at `/accounts/:id` for a property (CAP-11), reached from the Properties card on Accounts or the Property section on Loan detail. Example: 35 Hawthorne St, Geelong VIC (investment, rented, Simon 100%). Mock: [key-property-detail.html](mockups/key-property-detail.html) (Simon's view: net cash chart and FY table, gearing, ownership, value and linked loan; notes on missing valuation and Carissa's view).

| Part | Behaviour |
|---|---|
| Header line | "← Accounts" · type ("Investment property") · place · "rented at $480 a week" · owner dot + share |
| Value | Latest entered valuation with its month; "Update" in the tile and the "Value and loan" card (value + as-of date + Update value). Pangolin doesn't look up prices. Missing → Value and Equity tiles say "Add a valuation to count this property."; rent, costs and net cash still show |
| Equity | Value − linked loan balance, with the LVR in the caption |
| Net cash | Per **Term map › Net cash (property)**; loan interest is labelled "entered from statements" wherever it appears. Tiles for **this FY** (to date) and **last FY**, each with its per-month average; monthly chart (rent up, interest and running costs down, net cash line) with "View as table"; a by-FY table itemising rent, loan interest, agent's fees, rates/water/insurance and repairs. Months with no entered interest show interest as missing with "Add from a statement" on Loan detail, never an estimate [ASSUMPTION]. Shown for the whole property, with a "Your share (X%)" line beneath when the viewer owns part of it; a non-owner sees whole-property figures only |
| Principal | Shown separately under the FY table as out of pocket ("Principal isn't a cost: it pays down your own loan… Counting it too, the property takes about $X a month out of pocket"); never included in net cash |
| Gearing | "Negatively geared" / "Positively geared" from last FY's net cash, with the yearly gap and a rent-against-costs bar pair; label only, "estimate, not tax advice" |
| Ownership split | "Who owns it" card with the Ownership split input; same split feeds net cash, equity and Home buying equity / sell |
| Linked loan | Row in the "Value and loan" card: lender, type, rate, offset, balance, "View loan →" to Loan detail; "Link a loan" when none |
| Drill-down | Rent, running costs and net cash figures drill to Transactions for that property and period; interest links to Loan detail's entered figures [ASSUMPTION] |
| Privacy | A property the viewer can't see is NotFound (AD-5); a property that isn't shared-visible shows its owner "Not in shared plans" |

Layout per `DESIGN.md` § Layout & Spacing (from mock).

## Theming

- Six themes (Clay & Linen, Harbour Morning, Fern Gully, Galah Party, Gelato Bar, Black Opal), each light and dark (`DESIGN.md` § Theme sets, which also holds the implementation notes).
- **Per person**, chosen in Settings › Appearance, with a light / dark / system mode. Default: Clay & Linen, system. This overrides the current `prefers-color-scheme`-only behaviour in `apps/web/src/styles.css`.
- Applies instantly; saved to the person's profile on the server so it follows them across devices [ASSUMPTION].
- Signed-out pages (`/sign-in`, `/setup`, `/recover`) use Clay & Linen with system mode [ASSUMPTION].

## Responsive & Platform

| Breakpoint [ASSUMPTION: Tailwind defaults] | Behaviour |
|---|---|
| `≥ lg` (1024px+) | Full sidebar; Cash flow 4-up KPIs, Sankey, two-column lower row; Budgets/Goals two-column grid. |
| `md` (768–1023px) | Sidebar stays; lower rows stack to one column [ASSUMPTION]. |
| `< md` (phone) | Bottom tab bar; phone header with compact Import (from mock); single column; Cash flow shows the P&L table instead of the Sankey (v1); KPIs 2-up; budget and goal cards stack; Forecast chart full width with table below; the full Home buying planner works including sliders and scenarios (scenarios stack vertically); loan detail stacks; the goal editor and Cover an expense open as bottom sheets; Transactions hides the Account column and bulk select; Settings side menu becomes a chip row. |

- PWA installable on phones; no offline data; the page shell is never precached (CSP rule).
- Phone is for glancing and light categorising: Needs review, Net worth and the transaction sheet must be comfortable one-handed. Split editing on phone is supported but not optimised [ASSUMPTION].

## Inspiration & Anti-patterns

- **Lifted from SharkFin** ([imports/inspiration-sharkfin.webp](imports/inspiration-sharkfin.webp)): the "Where the money went" Sankey with Groups/Categories/Both and Sankey/P&L toggles; property and Uncategorised nodes; income and expense bar lists with Merchant views; Net worth as a top-level surface; phone P&L table.
- **Lifted from SmartSpend** ([imports/inspiration-smartspend.webp](imports/inspiration-smartspend.webp)): warm off-white canvas with one warm accent; loan detail (% repaid, balance over time, what-if with yearly cap, lender plan import (deferred)); transactions grouped by date with net subtotals and a summary line; signed-in devices; "imported up to" freshness with provenance; per-bank export instructions.
- **Kept from Direction C:** copy personality, celebrations, winking pangolin, Biggest little leaks.
- **Dropped for now:** per-task AI model selection (spec covers per-purpose providers); Telegram weekly review (push deferred); Apple Pay Shortcut tokens.
- **Parent directions** (merged into the lock, [mockups/direction-calm-cheeky.html](mockups/direction-calm-cheeky.html)): A Calm [.working/direction-calm.html](.working/direction-calm.html) (layout, density, single accent) · C Cheeky [.working/direction-playful.html](.working/direction-playful.html) (copy, mascot, celebrations). Kept in `.working/` as audit trail.
- **Rejected:** Direction C's rounded heavy (800) headings, pill Sankey labels, springy motion and 20px radius; the dense keyboard-first Ledger direction ([.working/direction-ledger.html](.working/direction-ledger.html)); the serif Editorial direction ([.working/direction-editorial.html](.working/direction-editorial.html)); a single household lens (spec: per-viewer); the placeholder deep-green theme; `prefers-color-scheme`-only dark mode; importing directly into the partner's accounts (replaced by hand-off); in-app restore (AD-16); an in-app demo toggle (demo is a separate instance).

## Spec Catch-up

Handed to correct course on 2026-10-05 (see the [sprint change proposal](../../sprint-change-proposal-2026-10-05.md)). Additional items found: hand-off, set-aside AI purpose, budget suggestion, over-budget item, theme storage, signed-in devices, shared saved plans, and the category and rule management surface (still undesigned).

| # | Item | Touches |
|---|---|---|
| 1 | Home buying planner: borrowing power, repayments, lender-style serviceability with accepted defaults, multiple properties (equity at 80% LVR / sell at 2.5% + CGT estimate), saved plans shared and built from shared-visible data only | new capability; AD-22 |
| 2 | Ownership split on loans and properties, used in equity and sell calculations | data model, CAP-11 |
| 3 | Loan detail with user-entered interest figures, extra repayments (yearly cap), offset slider, Add loan (lender plan import deferred beyond v1) | CAP-11; stays within the interest/principal non-goal |
| 4 | Net worth as a top-level surface (`/net-worth`, after Cash flow) | CAP-17 |
| 5 | Review item kinds: **over budget**, **import hand-off**, **transfer**, **set-aside rows** | AD-17, CAP-4, import pipeline |
| 6 | Goal shortfall shown in the warning colour, not red | CAP-7 wording |
| 7 | Partner pending indicators (shared-visible items only) | AD-17, AD-22 |
| 8 | Per-person themes: six themes, light / dark / system | new |
| 9 | Phone bottom tab bar | IA |
| 10 | WCAG 2.2 AA floor | constraints |
| 11 | Routes: `/sign-in` (Home becomes Cash flow); `/ledger` → `/transactions`; `/settings` single page with `#section` anchors (replaces `/settings/:section`); `/accounts/:id` also serves property detail | routes |
| 12 | **Partial import:** good rows commit, bad rows set aside for fixing (replaces all-or-nothing for CSV/OFX/QIF; PDF stays all-or-nothing); optional **AI interpretation** of set-aside rows proposing a transaction or event (for example a home-loan rate change) that the person confirms | import pipeline, LLM purposes, AD-17 |
| 13 | **Property detail** surface: value, equity, ownership split, net cash this FY / last FY (rent − user-entered interest − running costs; principal shown separately), gearing, linked loan; Property section on Loan detail | CAP-11 |
| 14 | Goal kinds (Flexible / Protected, one emergency fund per pool); Cover an expense for large purchases and shortfall; Large withdrawal item; buffer divert as a shortfall alternative (Undo) | CAP-6, CAP-7, AD-17, AD-24 |
| 15 | Large withdrawal review item (threshold per pool, default $2,000 [ASSUMPTION]) | AD-17, AD-24, CAP-7 |

## Open Questions

None open.
