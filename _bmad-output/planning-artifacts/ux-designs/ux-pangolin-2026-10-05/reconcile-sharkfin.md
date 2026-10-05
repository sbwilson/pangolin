# Reconcile: inspiration-sharkfin.webp

Compared against DESIGN.md, EXPERIENCE.md and .memlog.md (2026-10-05). Spines not edited.

## 1. Carried into spines
- Left sidebar nav with active item tint and count badges — DESIGN § Components (App sidebar, Nav count badge); EXPERIENCE § Component Patterns (App sidebar).
- "Where the money went" Sankey: income nodes left, expense nodes right, plain two-line labels with amount + % — DESIGN § Components (Sankey card); Do's and Don'ts (plain labels).
- Groups / Categories segmented toggle and Sankey / Profit & loss toggle, held in URL — EXPERIENCE § Component Patterns (Segmented control); DESIGN § Components (Segmented control).
- Savings shown as a destination node in the Sankey — DESIGN § Colors (chart ramp: Savings first); EXPERIENCE Flow 1 step 4.
- P&L table: Category · % of income · Amount, Income/Expenses sections, expandable groups with chevrons, colour square per category — DESIGN § Components (P&L table); EXPERIENCE § Component Patterns (P&L table).
- Phone shows P&L instead of Sankey — EXPERIENCE § State Patterns (Phone), § Responsive & Platform.
- Phone bottom tab bar with badges and a More tab — DESIGN § Components (Bottom tab bar); EXPERIENCE § Information Architecture (Phone shell).
- Income / expense horizontal bar lists with amount + % — EXPERIENCE § Inspiration (lifted), § IA (Spending: category bars).
- Spending and Accounts as sidebar items — EXPERIENCE § Information Architecture.
- Calm, airy card layout with hairline-bordered cards — DESIGN § Brand & Style, § Elevation & Depth (Direction A was "SharkFin-like", memlog).
- Sankey ↔ table equivalence — EXPERIENCE § Accessibility Floor.

## 2. Deliberately diverged
- Separate "Uncategorized" nav item (badge 4) → single Needs review inbox. Memlog: source constraint "single Needs-review inbox".
- Separate "Loans" nav item → Loan detail lives under Accounts. Memlog: "Loan detail page under Accounts (per existing loan…)".
- "Properties" sidebar section listing each property → properties live under Accounts and as property cards in Home buying. Memlog: "IA confirmed by Simon (ia-2026-10-05.excalidraw)"; multiple properties decision.
- "Net worth" in sidebar and phone tabs → no Net worth surface; Forecast in Planning. Memlog: "Planning group = … Forecast"; IA confirmed. (Still EXPERIENCE Open Question 6.)
- Phone tabs Transactions · Cash flow · Spending · Net worth · More → Cash flow · Transactions · Needs review · Planning · More. Memlog: "Mobile bottom tab bar: Cash flow · Transactions · Needs review · Planning · More."
- Transactions first in nav → Cash flow is landing and first. Memlog: "Landing page after sign-in: Cash flow."
- Orange accent / navy branding → six switchable themes, default Clay & Linen. Memlog: "Themes: ship all 6 …".
- Neutral, copy-free UI → cheeky microcopy, mascot, greeting. Memlog: "Direction: merge A (Calm) + C (Cheeky)"; mascot decision.
- One household view (single Paychecks node) → per-viewer figures, per-person income nodes with person dot. Memlog: source constraint "per-viewer view (no household lens)", "person colours".

## 3. Dropped / unaddressed qualitative ideas
- Third "Both" option on the Groups/Categories toggle (groups and categories in one Sankey) — spines only have Groups/Categories.
- Category / Merchant toggle on the Income bar list — no merchant view anywhere.
- Group / Category / Merchant toggle on the Expenses bar list — no merchant breakdown.
- Properties as Sankey nodes: rent from a property as an income node and a property's costs as an expense node (with house icon) — per-property flows not addressed.
- "Uncategorized" as a visible Sankey/P&L node — spines don't say how uncategorised money is shown in the chart.
- Income and Expenses bar-list cards on Cash flow beneath the Sankey — spine Cash flow grid has latest transactions + Home buying glimpse + leaks instead; the bar lists' placement (Spending only?) not stated.
- Count badge on the Transactions nav item — badge only on Needs review.
- "Sign out" at sidebar bottom — sidebar footer shows person + "Signed in with passkey"; sign-out location not specified.
- Net worth as a top-level nav item (only raised as Open Question 6, not decided).
