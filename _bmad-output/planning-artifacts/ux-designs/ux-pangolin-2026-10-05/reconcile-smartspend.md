# Reconcile: inspiration-smartspend.webp

Compared against DESIGN.md, EXPERIENCE.md and .memlog.md (2026-10-05). Spines not edited.

## 1. Carried into spines
- Warm off-white canvas, one warm accent, flat bordered cards — DESIGN § Colors, § Elevation & Depth; EXPERIENCE § Inspiration.
- KPI tile row on Cash flow (Income, Spending, Saved, Savings rate with note lines) → Money in / Money out / Kept / Savings rate with cheeky notes — DESIGN § Components (KPI tile); EXPERIENCE § Component Patterns (KPI tile).
- "Saved = income minus spending; transfers between own accounts left out" helper — EXPERIENCE § Voice and Tone (Chart helper), § Component Patterns (Sankey).
- Sankey footer note "The same numbers are in the Income and Expenses lists… and under Profit & loss" — EXPERIENCE § Voice and Tone (Chart helper); DESIGN § Components (Sankey card footer).
- Groups/Categories and Sankey/Profit & loss toggles — EXPERIENCE § Component Patterns (Segmented control).
- Freshness sub-line under page title ("Transactions up to 27 Sept") — EXPERIENCE § Component Patterns (Page header); DESIGN § Components (Page header).
- Date range with prev/next chevrons in header — DESIGN § Components (Date-range control).
- Loan detail: Still owed / Paid off / Interest paid / Interest still to pay tiles — EXPERIENCE § Loan Detail; DESIGN § Components (Loan detail).
- Balance over time with Actual / Projected / Planned lines and "Balance by year as a table" disclosure — EXPERIENCE § Loan Detail, § Accessibility Floor.
- "Where your repayments went" principal vs interest — EXPERIENCE § Loan Detail (with Open Question 1).
- "What if I pay extra?" with monthly extra, one-off extra and one-off date — EXPERIENCE § Loan Detail, Flow 2.
- Loan schedule estimated from contract terms; missing terms prompt — EXPERIENCE § State Patterns (Missing loan terms), Open Question 1.
- Transactions grouped by date, search box, filter chips (All / Needs review / Uncategorised / Transfers), Import button on Transactions — EXPERIENCE § IA (Transactions), § Interaction Primitives (Import popover).
- Transfer between own accounts labelled — EXPERIENCE § State Patterns (Transfer to partner's private account).
- Settings as cards; Appearance with System / Light / Dark — EXPERIENCE § Theming; DESIGN § Components (Theme picker).
- Settings AI coach (Claude API key status) → Settings › LLM providers — EXPERIENCE § IA (Settings).
- "Waiting for review: 2 transactions" / nav badges → Needs review count — EXPERIENCE § Component Patterns (App sidebar).

## 2. Deliberately diverged
- Orange single accent → six themes, light/dark/system per person. Memlog: "Themes: ship all 6…", "Theme is per-person".
- "Uncategorized" nav item with badge → single Needs review inbox. Memlog: source constraint "single Needs-review inbox".
- "Loans" nav item → Loan detail under Accounts. Memlog: "Loan detail page under Accounts".
- "Budgets & rules" nav item → Budgets under Planning; rules arrive as rule offers in Needs review. Memlog: "Planning group = … Budgets, Goals, Home buying, Forecast"; journey "rule offers".
- Import as a Settings card (choose file + Import CSV) → header Import popover on every view with drag-drop and account picker. Memlog: "Import entry: persistent top-right Import button … popover with drag-and-drop".
- "Year to date" calendar-year preset → Quarter · FY to date · Custom (Jul–Jun). Memlog: source constraint "AU locale (AUD, FY Jul-Jun…)".
- What-if "Calculate" button → live recalculation via sliders/typed values. Memlog: "adjust via sliders or typed values to see outcomes".
- Offset not present in SmartSpend → offset benefit tile + slider added. Memlog: loan detail decision "Plus: offset account benefit … slider".
- EUR, de-DE bank (N26, Deutsche Bahn) → en-AU, AUD only. Memlog: source constraint "en-AU only".
- Plain neutral copy → Calm + Cheeky voice and mascot. Memlog: "merge A (Calm) + C (Cheeky)".

## 3. Dropped / unaddressed qualitative ideas
- Import provenance in header subtitle ("Imported from N26 CSV 27 Sept 2026, 22:15") — spine freshness line has newest date only, not source/file type or import time.
- Transactions summary line ("134 transactions · €8,039.95 in · €7,028.79 out · 2 need review").
- Daily net subtotal on each date-group header row.
- Bulk-select checkboxes on transaction rows (and header select-all) for bulk actions.
- "Impulse" tag shown inline next to category on rows (auto/behavioural tagging).
- Merchant avatar/logo initial on rows; Account column on desktop rows.
- Dropdown filters for type / account / category beside the chips; search scope "merchant, notes, category or amount".
- Loan header line: lender · loan type · nominal vs effective rate · term and start date.
- "Import the lender's repayment plan to replace the estimate" (actual schedule upload).
- "Your contract allows extra up to a cap per year; anything above is capped" in the what-if.
- "54% of the loan is repaid" progress statement and "Next €314.50 on 1 Oct" next-repayment line (spine has "next repayment" only as a tile sub-line, no % repaid).
- How loans are created: import loans file or "Add loan" by hand — spines only cover an inline rate/term form.
- Bank-specific export instructions in the import card ("Download a CSV from the N26 web app… re-importing the same file changes nothing").
- Apple Pay / iPhone Shortcut tokens (create named token per device for nudges).
- Signed-in devices list with "This device" tag, last-used time and per-session sign out.
- AI coach settings: per-task model selection (nudges & sorting vs weekly review) and nudges as a feature.
- Telegram weekly review (bot token / chat ID status, "Send test message").
- Sign out link at sidebar bottom.
