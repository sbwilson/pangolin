# M1 gate

The runbook and decision record for the M1 gate of the import-dedupe-transfers epic: **twelve
months imported, no unexplained balance gaps**. The pipeline checks the balances and the report
lists what it found; the human decides whether each finding is explained and marks the gate closed.

Who does what: the human exports the statements from NetBank and the other banks, imports them,
runs the report and pastes the output. The agent prepares this page and fills the record from
pasted output. The agent never closes the gate, and no real statement is committed to the repo.

## What counts as an unexplained gap

The report (`m1-report`) lists three kinds of finding for each account. The gate's machine check is
zero of each.

1. **A broken balance chain.** Every import with printed running balances (CommBank CSV, ubank
   CSV, the FY2025 multi-bank CSV, and generic CSV with a balance column) checks that adjacent
   balances agree with the amounts, in file order, newest first or oldest first. A batch where they
   do not is recorded as `gap` with the size of the break, and raises a "Balance gap" item in
   Needs review. The import still commits. OFX, QIF and Up CSV carry no running balances; they
   record `unavailable`, which is not a failure.
2. **A hole in coverage.** A span of calendar days from 1 July 2024 to the account's newest
   covered date that no statement reaches. An account's covered days are the union of the first to
   last posted dates of its imported batches (undone batches do not count).

   **Accepted start.** Bank exports only reach back so far, so an account's first statement
   starts mid-life with a non-zero balance. The leading span (from 1 July 2024 to the first
   covered date) is accepted, and not counted as a hole, when the account has a balance snapshot
   dated before its first covered date. The report then prints `starts from opening balance
   <amount> on <date>`. Without such a snapshot the leading span stays a hole. When the first batch derived an opening of its own, only a snapshot with that same balance
   counts. Interior holes and broken batches always count.
   **Ledger balance.** For an account with an accepted opening, the report prints `ledger balance
   <amount> on <date>`: the ledger's balance on the account's newest covered date (the opening
   balance plus every transaction after it). Compare it with the bank's balance on that date and
   record both under Findings per account. The ledger balance counts every live transaction,
   pending or posted and manually entered ones included, so a manual entry or a pending row can
   explain a difference from the bank. With no accepted opening snapshot the sum would start
   from 0, so nothing is printed.
3. **A join break.** For batches ordered by first date, where the next starts after the previous
   ends, the previous closing balance must equal the next opening balance, when both are recorded.
   A mismatch is a `JOIN` line and counts in the total. Overlapping batches are not join-checked.

The report only measures. A weekend between two files shows as a two-day hole, and an account
opened after July 2024 shows a leading hole unless it starts from an opening balance; the human
reads each span and records why it is explained (or goes and gets the missing statement).

### Opening balances

On import, a statement whose printed balances chain (`ok`) gets its opening balance (the balance
before its oldest balanced row) and closing balance (the newest balanced row's balance) recorded
on the batch. When the account has no live transaction before the file's first date and no
snapshot dated on or before the day before it, the opening is also recorded as a `statement`
balance snapshot dated the day before the first row, linked to the batch. Undoing the batch
deletes that snapshot. A `gap` or `unavailable` file records neither.

Accounts whose statements print no balances (credit cards, Up, OFX, QIF), and batches imported
before this change, have no opening yet. Set one by hand, on the host with the server running:

```sh
sudo pangolin m1-report                                      # prints each account's id
sudo pangolin opening-balance <account-id> <YYYY-MM-DD> <amount>
```

The date is the day before the account's first transaction; the balance is at the end of that
day, signed (a credit card owing 500 is `-500.00`). It records a `manual` snapshot, audited, and
the report then accepts the leading span. Only batches imported after this change get derived
opening and closing values and join checks; batches imported before it (and files with no
printed balances) rely on the `opening-balance` command, and their joins are not checked. The
report counts such pairs as `N joins not checked`, so "0 join breaks" is only as strong as the
joins that were compared. The command refuses when the account already has a snapshot on that
day.

## Steps

Prerequisites: the server is running (`sudo pangolin status` is ready) and the statements are
exported from each bank, for each account, from 1 July 2024 to the present. The report only checks up to each account's newest covered
date, so the human confirms that date reaches the present. Earlier history for the
CommBank accounts has to come from NetBank (the exports on hand start in FY2026).

1. Import every statement into its account (Import in the app). Overlapping files are safe:
   duplicates are skipped and re-importing a file changes nothing.
2. Open Needs review and clear each "Balance gap" item: find the missing or edited row, then undo
   the batch and import the corrected file (importing a corrected file alone leaves the broken
   batch listed). A file with rows set aside records `unavailable`, not a gap: clear its "Rows set
   aside" item instead.
3. Run the report on the host:

   ```sh
   sudo pangolin m1-report
   ```

   Expected: for each account a line `<name>: N batches, M months covered, H holes, B broken
   batches, J join breaks`, then its `starts from opening balance` and `ledger balance` lines, its `account` id, `covered`,
   `HOLE`, `BROKEN` and `JOIN` lines, and a last line `Total: 0 holes, 0 broken batches, 0 join
   breaks`. An account with no statement is listed apart and not counted.
4. For each `HOLE`, `BROKEN` and `JOIN` line left, record the span and why it is explained (for example "no
   transactions: account opened 14 Mar 2025") in the table below.
5. The human fills the decision row.

The report is read-only: it writes nothing and takes no audit entry.

## Rehearsal on generated data

CI runs the same report on twelve generated monthly statements
(`generateTwelveMonthStatements`, `apps/server/src/cli.test.ts`): every batch is `ok`, and the
report shows 0 holes, 0 join breaks and 12 months. A statement with a dropped row is `gap` with the size of the
break, and a missing month shows as a hole. This shows the check works; it says nothing about the
real statements.

## Record

| Field | Value |
| --- | --- |
| Commit / release tag | |
| Date | |
| Accounts imported | |

### Findings per account

One row per account that has statements. Findings are the `HOLE`, `BROKEN` and `JOIN` lines left after step 3.

| Account | Source files (bank, period) | Months covered | Holes (spans) | Broken batches | Join breaks | Explained? (why) |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

### Evidence

| Evidence | |
| --- | --- |
| `pangolin m1-report` output (account names may be redacted) | |
| Needs review "Balance gap" items open | |
| Outcome | |

### Decision

The gate is **closed** only when every finding is zero or explained in the table above. Only the
human marks it closed.

| Gate | Decided by | Date |
| --- | --- | --- |
| Open | | |
