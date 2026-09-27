# Import pipeline

Every upload, whether CSV, OFX, QIF or PDF, goes through the same idempotent pipeline. Importing the same file twice changes nothing, and overlapping date ranges are safe.

1. **Parse.** Rows are parsed and validated with Zod, then staged in `import_row`. Bad rows are reported with line numbers; nothing is committed.
   - OFX and QIF use standard parsers and need no mapping.
   - CSV uses the account's `import_profile` (column map, date format, sign convention).
   - PDF goes through LLM extraction first (below).
2. **Normalise.** Strip card and reference noise from descriptions (e.g. `VISA DEBIT PURCHASE CARD 1234`), keep the raw text, and convert amounts to cents.
3. **Deduplicate.** Use `external_id` when the source has one (OFX FITIDs).
   - Otherwise use a fingerprint: account + date + amount + normalised description + occurrence number among identical rows that day.
   - The occurrence number keeps two genuine identical coffees distinct.
4. **Match payee.** Use `payee_alias` patterns first, then fuzzy match against known payees. Unknown payees are queued for the LLM.
5. **Apply rules.** Run in priority order, deterministically. The result is recorded on the split, with the rule ID for traceability.
6. **Match transfers.** Look for an opposite amount on another of our accounts within ±3 days, with a transfer-like description.
   - A unique match is linked automatically.
   - An ambiguous one goes to review.
7. **Reconcile.** Where the source has a running or closing balance (CommBank CSV and OFX do, as do PDF statements), compare it with the computed balance. Any gap is flagged against the batch.
8. **Review inbox.** Anything uncategorised, low-confidence, or newly matched as a transfer lands in "Needs review". Accepting a correction offers to create a rule.

## PDF statements (LLM-assisted)

The LLM reads the statement; plain code decides whether to trust it.

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

Statements contain names, addresses and account numbers, so PDF extraction is allowed only on providers marked local unless explicitly enabled for a cloud provider.

## Formats to ship in v1

- CommBank OFX (preferred), CSV and QIF;
- ubank CSV;
- Up CSV (a one-off history import before the account closes);
- CMC Invest trade confirmations;
- PDF statements;
- a generic CSV mapper UI for anything else.

Each format is tested against a committed, anonymised sample file. PDF extraction is tested against synthetic statements with known totals.

## History

Import from 1 July 2024 (start of FY2025).

- One FY2025 export (1 Jul 2024 – 30 Jun 2025) uses a different, timestamped multi-bank format, so it gets its own profile.
- The CommBank exports on hand start in FY2026 (March 2025 for the home loan). Earlier history should be exported from NetBank before M1's gate.
