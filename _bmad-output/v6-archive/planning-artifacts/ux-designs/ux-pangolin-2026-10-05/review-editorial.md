# Editorial Review — Pangolin UX spines (structure + prose)

Lenses: structure, prose (prose ran after structure). Content: docs — DESIGN.md, EXPERIENCE.md. Run 2026-10-05.

## structure-design

Structure findings for DESIGN.md (Reference/Database model, 7,963 words):
1. CONDENSE: Components cells >~100 words (Needs review item, Property detail, Loan detail, Goal card, Budget card, Forecast chart) -> H4 entries with bullets Anatomy/Tokens/States/Source.
2. CONDENSE: add Source column to component tables (mock/spine-only/mixed + link); remove inline (from mock)/Spine-only markers.
3. CUT: Components intro sentence repeating preamble's (from mock) note.
4. CUT: duplicate calm-cheeky note in Brand & Style ¶2.
5. MERGE: Shapes body is single usage list; YAML rounded comments -> "# see § Shapes" (they drifted).
6. CONDENSE: Layout page header/phone bullets to placement only; anatomy in Components.
7. MOVE: New budget/Add a goal entry point out of Budget/Goal card rows (already in Layout Budgets/Goals row).
8. MOVE: Accounts layout row token detail into Components (Account row / Accounts card).
9. CONDENSE: income colour mapping in bar lists + Sankey card -> "Fills per § Colors".
10. MOVE: Theme sets "Machine source" paragraph to top of section.
11. QUESTION: chart-ramp headers -> chart-1..chart-9 with illustrative-names caption.
12. MOVE: Breakpoints bullet up before table.
13. CONDENSE: Do's/Don'ts one-primary row; exceptions to Components → Button.
14. CONDENSE: Layout date-range mention; preserve Do's/Don'ts row.
15. QUESTION: mascot exclusions mismatch (Don't lists settings; Brand & Style doesn't).
16. CONDENSE: Brand & Style ¶3 placeholder history.
17-18. PRESERVE: Theme sets core tables; contrast table.

## prose-design

Prose findings for DESIGN.md (23 + 4 minor):
1. Define once in Components intro: 'muted' text = {colors.muted-foreground}; 'in caption' = {typography.caption}. (Highest value — {colors.muted} is a fill.)
2. Define Direction A (calm) / C (cheeky) on first mention, pointing to EXPERIENCE § Inspiration.
3. "medium weight (600)" -> "semibold weight (600)".
4. "{colors.primary} 600 text" -> "600-weight {colors.primary} text" (also Property detail).
5. Net worth grouping: assets: Cash, Savings, Property, Investments, Super; liabilities: Loans, Cards.
6. "light keys are bare" -> "light-mode keys have no suffix; dark-mode keys end in -dark".
7. Accent bullet -> "Text on accent uses only {colors.primary} or {colors.foreground}."
8. "Rows below use fr ratios at ≥ lg" -> "Multi-column rows in the table below use fr ratios at lg and up; ...".
9. page padding -> "{spacing.page-padding-top} top, {spacing.page-padding-x} sides".
10. QUESTION nav badge check: "check on an {colors.accent} disc"?
11. Machine source "derivation rule above" -> named reference ('Derived per theme' paragraph).
12. "a secondary {components.button-secondary}" -> drop "secondary".
13. stress bars: "border tone" -> {colors.border}; "pp" -> "percentage points".
14. Celebration: "on card" -> "on {colors.card}"; "one pop" -> "plays once".
15. Do's: "Keep the mascot to the logo, greeting, empty states, celebrations and hidden-name rows".
16. Settings card caption -> "lists which actions need re-authentication (Re-auth dialog)".
17. DTI caption -> "compares it with the lender's cap".
18. Property table column "a month" -> "Net cash per month".
19. Define shorthand: mid what-if, push-out, buffer move, wink line.
20. "Closest pairs to watch" -> state basis (closest dark-mode pairs); check Galah light Groceries/Lifestyle 8.4.
21. "partner-pending chips" -> "Partner pending chips".
22. Contrast header "on-primary" -> "primary-foreground".
23. Spell out IA, P&L on first use; "Prev/next" -> "Previous/next".
Minor: e.g. -> for example; vs -> against; "≥ 1 row" -> "at least one row"; "The parent and rejected directions" -> "The earlier and rejected directions".
Keep en-AU spelling and Aussie idiom; never touch quoted UI strings, YAML keys, {token} refs.

## structure-experience

Structure findings for EXPERIENCE.md (Reference/Database; 10,871 words):
1. CONDENSE: goal-shortfall fix rule stated 7x; full rule only in Goal card, elsewhere labels + "per Goal card"; keep Term map "has room".
2. MERGE: Privacy & Partner Awareness is single home; State rows Hidden name/Private/Partner pending/Transfer-to-private -> pointers.
3. MOVE (QUESTION): Privacy & Partner Awareness right after IA.
4. CONDENSE: Component Patterns bold group labels -> ### headings (incl. Needs review item kinds).
5. MOVE: State Patterns grouped/sorted by surface, global rows first.
6. CUT: State rows Focus, Reduced motion, Phone (not states; covered elsewhere).
7. CONDENSE: partial import behaviour in Interaction Primitives step 5 + Needs review kinds; state row = treatment only.
8. CONDENSE: Property Detail Net cash row -> cite Term map.
9. CONDENSE: Planner Outputs Left for actual life -> cite Term map.
10. CONDENSE: planner data scope/shared plans -> full rule in Home Buying Planner › Data scope only.
11. CUT: Property Detail "No date-range control" clause.
12. QUESTION/MOVE: Theming bullets 5-6 (implementation) to architecture/DESIGN.
13. CONDENSE: Inspiration "Lifted from" inventories to distinctive items.
14. CONDENSE: add Key Flows index; unify "Failure:" label.
15. CONDENSE: Open Questions -> "None open."
PRESERVE: Spec Catch-up; top banner; Term map + illustrative note; short pointer rows.

## prose-experience

Prose findings for EXPERIENCE.md (23 + 2 minor):
1. QUESTION Voice/Errors Don't bans cheek in "privacy" but hidden-name wink copy is playful -> narrow to "privacy settings and errors (hidden-name wink is the one playful privacy moment)". [user decision]
2. QUESTION "the one money warning allowed a cheeky line" vs duplicates line "Worth a squiz in Needs review." [user decision]
3. L105 comma splice -> "in moderation: at most one cheeky line per card [ASSUMPTION]".
4. L172 add comma "in flight, figures dim".
5. "one one-click fix" -> "a single one-click fix" (L168, L221).
6. L221 move "(warning colour, never money-out red)" next to warning line.
7. L322 scenarios "+1%/+2%" -> "+1 pp/+2 pp"; quoted chip unchanged.
8. Define pp at first use (L172) "+3 percentage points (pp)".
9. L120 "(50/50 if set)" -> "(50/50 when none is set)".
10. L141 move "(from mock)" tag inside; "Suggestions at ≥ 90% confidence are batched".
11. L283 "for the actions the architecture lists"; "Re-auth window per architecture".
12. L248 articles: "or a balance gap of $X against the statement".
13. L274 serial list for set-aside sentence.
14. L383 comma "While the buffer has room, ...".
15. L497 "Lifts automatically on the chosen date, at most 12 months ahead."
16. L315 "shared items" -> "shared-visible items".
17. L204 "Carissa ... her" -> "<partner> imports their own on their laptop".
18. Offset card name: one of "Offset" / "Your offset" (match mock).
19. "Undo" capitalised everywhere (L137, L198, L281, L384).
20. e.g. -> for example (L33, L275, L386, L453, L551).
21. "in warning"/"bar to warning" -> "in the warning colour"/"bar turns the warning colour" consistently.
22. L188 "Signing out on 'This device' returns to /sign-in".
23. L169 comma splice -> semicolon.
Minor: L186 "foot caption" -> "footer caption"; L275 expand "per-purpose, cloud opt-in per spec".

