# Validation Report — pangolin

- **DESIGN.md:** `/Users/sim/dev/pangolin/_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/DESIGN.md`
- **EXPERIENCE.md:** `/Users/sim/dev/pangolin/_bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md`
- **Run at:** 2026-10-05T03:19:37Z

## Overall verdict
The visual contract is close to source-extractable: every {token} reference resolves (66 in DESIGN.md, 2 in EXPERIENCE.md), every colour has a hex value with a light/dark pair across six themes, all the contrast figures the reviewer recomputed match, and every .working/ and imports/ link resolves. The behavioural contract is lopsided. Cash flow, import, Needs review, Home buying and Loan detail are specified in depth. Budgets (named a priority feature), Goals, Forecast, Settings and Sign-in have only an IA row and an empty state. Three privacy and architecture commitments (partner pending count, in-app restore, ownership split) are either contradicted or missing. Story-dev can start on the Cash flow, ledger and planner epics now. It can't start on Planning (budgets, goals, forecast) or Settings without another pass.

Severity counts: Critical 1 · High 8 · Medium 15 · Low 11

### Resolved since review
These decisions were logged in .memlog.md after the review started. The findings stay listed because the spines haven't been updated yet; each resolves once the decision is written into DESIGN.md / EXPERIENCE.md.

- **Partner pending chip counts private-account items (Inheritance, high)** — Decision: partner-pending indicator counts only items both partners can see (shared accounts); private-account items never contribute.
- **Ownership split on loans/properties not in either spine (Inheritance, high)** — Decision confirmed: ownership split must be enterable (Simon owns/pays 100% of the investment property).
- **Saved plan visibility uncommitted (Inheritance, medium)** — Decision: saved plans are shared between both partners and use only data both can see; private accounts never feed a saved plan.
- **"Where your repayments went" contradicts the interest/principal non-goal (Inheritance, medium)** — Decision: principal/interest figures are user-entered from bank statements, not auto-estimated; the card shows only periods with entered figures.

## Category verdicts
- Flow coverage — thin
- Token completeness — adequate
- Component coverage — thin
- State coverage — thin
- Visual reference coverage — adequate
- Bloat & overspecification — adequate
- Inheritance discipline — thin
- Shape fit — strong

## Findings by severity

### Critical (1)

**[Flow coverage]** — Budgeting (CAP-4) has no flow, components or non-empty states (§ EXPERIENCE § Key Flows; § IA row "Budgets")
Budgeting was named a priority feature in the memlog. It has no flow beyond one sentence (Flow 1 step 6, "Each sets their own budgets and goals"), no component in either spine, and no non-empty state. Spent / pace / projected, the payday-anchored fortnight/month cycle, rollover, per-person vs shared caps and AI-suggested amounts have no presentation. Story-dev would have to invent the whole surface.
Fix: Add a "Set and track a budget" flow (protagonist, steps, climax at the pace/projected read-out, failure path for going over budget), plus a Budget card/row in both component tables.

### High (8)

**[Flow coverage]** — Goals with staged allocation and reconciliation (CAP-6, CAP-7) have no flow (§ EXPERIENCE § IA "Goals"; DESIGN § Colors)
The spec's required "red shortfall on the goals page and review inbox" and the "one-click buffer adjustment" are absent, and DESIGN § Colors forbids red except for amounts, so the shortfall colour is undecided.
Fix: Add a goals flow (allocation after an import → stage transition → over-commitment shortfall → buffer fix) and choose the shortfall token.

**[Flow coverage]** — Forecast (CAP-8) has no flow and no low-balance warning (§ EXPERIENCE § IA "Forecast"; § State Patterns)
Nothing covers the low-balance warning, which is the capability's success signal. The only treatment is an empty state.
Fix: Add a forecast flow ending on the low-balance warning date, and specify the projection chart, the assumption editing and its table equivalent.

**[Flow coverage]** — CAP-14's always-visible apportioned share of reports is missing (§ both spines; DESIGN § Layout & Spacing)
Not mentioned anywhere in either spine. The Cash flow grid has no slot for it.
Fix: Decide where the apportioned share sits on Cash flow and Spending, and add it to the layout and to KPI tile or header patterns.

**[Component coverage]** — Components for in-scope surfaces missing from both spines (§ DESIGN § Components; EXPERIENCE § Component Patterns)
Budget card/row, Goal card, Forecast chart and assumption editor, Account list row, Transactions filter chips and search, Spending category bars and flexible categories, Settings cards (Sign-in & security, Recovery codes, Partner, LLM providers, System status), the sign-in form, and the Demo and Offline banners.
Fix: Add a visual row and a behavioural row for each, or explicitly mark ones as shadcn as-is with their behaviour.

**[State coverage]** — Budgets, Goals and Forecast have only empty states (§ EXPERIENCE § State Patterns rows 121, 124)
Over budget, ahead/behind pace, goal complete with stage change, goal shortfall, and the forecast low-balance warning are all missing — the states the spec's success signals test.
Fix: Add the domain states, together with the components from the Component coverage finding.

**[Inheritance discipline]** — Partner pending chip counts private-account items (§ EXPERIENCE § Component Patterns "Partner pending chip"; § State Patterns "Private"; Open Q5) *(resolved since review — spine update pending)*
Counting all of the partner's review items leaks private-account activity, contradicting the spine's own Private rule and AD-5/AD-22. Scope left as Open Question 5.
Fix: Commit to counting shared/public items only (AD-22 most-restrictive scope), or drop the chip.

**[Inheritance discipline]** — Ownership split on loans/properties not in either spine (§ memlog; DESIGN "Property card"; EXPERIENCE § Home Buying Planner) *(resolved since review — spine update pending)*
The memlog decision that ownership split must be enterable isn't reflected. The Property card and the planner's equity/sell maths ignore ownership share.
Fix: Add an ownership-share input to the Property card and loan setup, and say how it feeds usable equity and rent.

**[Inheritance discipline]** — CAP-17 current net worth has no surface (§ EXPERIENCE § IA; Open Q6)
An in-scope capability has nowhere to go in the IA.
Fix: Decide the surface, for example a Net worth card on Cash flow or a section in Forecast.

### Medium (15)

**[Flow coverage]** — Sign-in, recovery and partner-assisted reset (CAP-15) have no flow (§ EXPERIENCE § IA rows Sign in / Recover; § Privacy)
States and a re-auth dialog exist, but recovery-code sign-in that forces a new passkey, and the 24-hour partner reset link, are never walked.
Fix: Add a short recovery flow with its failure paths (expired link, used code).

**[Flow coverage]** — Recurring bills (CAP-5) appear only as an alert item kind (§ EXPERIENCE § Component Patterns "Needs review item")
Detect, one-click confirm, and missed or +10% alert have no specified treatment.
Fix: Specify the confirm-a-detected-bill item and the bill-alert item copy and actions.

**[Flow coverage]** — Property (CAP-11) has no surface (§ EXPERIENCE § IA "Accounts")
Net cash position per month and FY, and gearing, have no surface beyond "properties (incl. investment)" in the Accounts row. The planner's Property card is a different thing.
Fix: Add a property detail treatment, or state that it lives in Loan detail.

**[Token completeness]** — Only Clay & Linen is in the YAML frontmatter (§ DESIGN § Theme sets)
The other five themes, and Clay's own chart ramp, exist only as markdown tables, so a token generator reading the frontmatter gets one theme of six.
Fix: Either commit the five themes as frontmatter tokens (for example harbour-morning.primary) or state explicitly that the tables are the machine source and give their parse shape.

**[Token completeness]** — Derivation rule omits destructive-foreground and several shadcn semantic tokens (§ DESIGN line 359, line 283)
Clay defines destructive-foreground; the other five themes don't. secondary/secondary-foreground and sidebar-foreground/border/accent/primary are never defined. "Unlisted shadcn tokens inherit defaults" would pull neutral greys into warm themes.
Fix: Extend the derivation rule, for example destructive-foreground = primary-foreground, secondary = background, sidebar-* = foreground/border/accent/primary.

**[Component coverage]** — Component names drift between the files (§ both § Components)
"Sankey card" vs "Sankey"; "Transaction sheet & split editor" vs "Split editor" (the sheet itself has no behavioural row); "Planner result" + "Rate stress bars" vs "Planner result / stress table"; "Rate pill" + slider vs "Rate pills / slider"; "Saved plan row" vs "Saved plan"; "Loan detail" vs "Loan detail cards".
Fix: Use one canonical name per component in both tables.

**[Component coverage]** — Some rows defer elsewhere instead of giving a rule (§ DESIGN line 459; EXPERIENCE lines 100, 109)
Category chip is a one-word visual spec with no states. Import popover and Loan detail cards in Component Patterns say "See …" with no rules of their own.
Fix: Give category chip its idle/editable/selected appearance and keep the cross-references, but name the rules they point to.

**[State coverage]** — Live planner recalculation has no pending state (§ EXPERIENCE § Interaction Primitives "Sliders")
Outputs come from debounced server recalculation, but nothing says what the hero shows while a request is in flight or if it fails.
Fix: Specify the stale/pending treatment (for example dimmed figure plus a live-region update on settle) and the error fallback.

**[State coverage]** — No no-results or empty-range states (§ EXPERIENCE § State Patterns)
Transactions has no state for a filter or search with no results, though URL-held filters are CAP-18's core. Cash flow and Spending have no state for a zero-row range when imports exist.
Fix: Add "no matches" (with clear filters) and "nothing in this range" states.

**[State coverage]** — Idempotent re-import and unsupported file outcomes unspecified (§ EXPERIENCE § Interaction Primitives "Import popover")
The popover's result for "0 new" isn't specified, and neither is an unsupported file type.
Fix: Add both outcomes with copy.

**[State coverage]** — Settings System status, /recover and /setup lack error states (§ EXPERIENCE § IA "Settings", rows Setup/Recover)
No states for a failed backup, failed restore drill or dead jobs; no error states for used or invalid code or expired partner link.
Fix: Add them, in plain no-cheek copy.

**[Inheritance discipline]** — In-app restore contradicts AD-16 (§ EXPERIENCE lines 57, 167)
Re-auth and Settings list restore as an in-app action; AD-16 makes restore CLI-only on a stopped stack. "Recovery codes" also isn't in the architecture's re-auth list.
Fix: Make restore read-only in Settings (drill status, last backup), remove it from re-auth triggers, and reconcile recovery codes.

**[Inheritance discipline]** — "Where your repayments went" contradicts the interest/principal non-goal (§ EXPERIENCE § Loan Detail; Open Q1) *(resolved since review — spine update pending)*
The card designs an interest/principal split the spec excludes; Open Q1 flags it but it isn't decided.
Fix: Decide before stories are cut; mark the card as conditional.

**[Inheritance discipline]** — Saved plan visibility uncommitted (§ EXPERIENCE § Privacy; Open Q4) *(resolved since review — spine update pending)*
Saved plan scope and the one-laptop planning view leave data visibility for plans uncommitted, which shapes the data model.
Fix: Commit to "personal plan, owner's view" or "shared plan, shared inputs only".

**[Inheritance discipline]** — 27 reconcile ideas have no keep/drop decision (§ reconcile-sharkfin.md §3; reconcile-smartspend.md §3)
Two are real gaps: where Sign out lives, and how uncategorised money appears in the Sankey/P&L.
Fix: Record keep/drop decisions, and specify sign-out and the uncategorised node.

### Low (11)

**[Flow coverage]** — Flow 1 preamble step range is off by one (§ EXPERIENCE Flow 1)
The preamble says "steps 7–10 on one laptop together", but step 11 (Save plan) is also on that laptop.
Fix: Change to "7–11".

**[Token completeness]** — Contrast not stated for warning-on-warning-bg and primary-on-accent (§ DESIGN § Colors contrast table)
Used by nav-badge, warning-line, nav-item-active and hidden-name-row. All 12 theme-modes pass when recomputed (minimum 4.72 and 4.57), but the spine doesn't commit to it.
Fix: Add two columns to the contrast table.

**[Token completeness]** — Several pixel values have no token (§ DESIGN § Components, § Elevation)
Logo "16px/650" (weight 650 isn't in the type ramp), the 50px date column, the 10px stress track and the segmented-control shadow literal.
Fix: Tokenise them or tag them as fixed.

**[Component coverage]** — Toast, Stat tile and Person dot lack a counterpart row (§ EXPERIENCE line 112; DESIGN line 444)
Toast has behavioural rules but only "Toast (Sonner)" visually; Stat tile and Person dot have no behavioural row. Acceptable as presentational, but say so.
Fix: State that they are presentational.

**[Component coverage]** — Unreferenced frontmatter component tokens (§ DESIGN frontmatter)
button-secondary, card, amount-in and amount-out are never referenced in prose.
Fix: Reference them from the matching component rows.

**[Visual reference coverage]** — IA excalidraw linked only in the header (§ EXPERIENCE line 22, § IA)
ia-2026-10-05.excalidraw isn't linked inline in § Information Architecture.
Fix: Add an inline "→ IA reference" line under the IA table.

**[Visual reference coverage]** — All links point into .working/ (§ both headers)
They'll break when artifacts are promoted to mockups/ and wireframes/.
Fix: Re-point the links at promotion.

**[Bloat & overspecification]** — Home buying glimpse described in three places (§ DESIGN Components; EXPERIENCE Component Patterns; EXPERIENCE § Home Buying Planner)
Triple description invites drift.
Fix: Keep the visual spec in DESIGN and the behaviour in Component Patterns, and drop the third.

**[Bloat & overspecification]** — Spec Catch-up List is a process hand-off (§ EXPERIENCE § Spec Catch-up List)
It's for bmad-correct-course, not a downstream consumer.
Fix: Move it to the memlog or a separate hand-off note.

**[Bloat & overspecification]** — Mock example figures disagree (§ EXPERIENCE Accessibility Floor; Outputs; Flow 1 climax)
"$7,596 a month left", "~$3,764 spare" and "$Y a fortnight" invite readers to treat them as specs.
Fix: Use one consistent worked example or mark them as illustrative.

**[Inheritance discipline]** — No glossary (§ EXPERIENCE Foundation)
Spine terms ("Needs review", "Kept", "Transactions") rename source terms ("review inbox", saved, "ledger") without a mapping.
Fix: Add a short term map in Foundation.

## Mechanical notes
- DESIGN Empty state says "{typography.card-title}-scale headline at 19px", but card-title is 15px and 19px is figure-stat. The two are contradictory. (DESIGN line 464)
- {components.sankey.linkOpacityLight} / "-Dark" uses shorthand; the actual key is linkOpacityDark. (DESIGN line 455)
- The climax gives money left per fortnight; the "Left for actual life" output is monthly. Pick the period the hero shows. (EXPERIENCE Flow 1 step 10 vs § Home Buying Planner Outputs)
- The Glimpse stat tile label is "Spare after usual spending" (DESIGN line 465), while elsewhere it's "Left for actual life". These should be one label.
- The memlog says light ramp contrast is "1.7-2.7:1"; DESIGN says 1.69–2.36:1, and the table supports DESIGN.
- The memlog estimates ~40 [ASSUMPTION] tags; there are 67 (11 DESIGN, 56 EXPERIENCE). Several are load-bearing, for example the planner being server-computed, routes, and the review bulk-accept.
- Frontmatter in both files is complete (name, status, dates, sources); status: draft. Neither file has Mermaid.

## Reviewer files
- `review-rubric.md`
