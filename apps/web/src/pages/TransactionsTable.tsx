import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import type { CategorySummary, LedgerTransaction } from "../api.ts";
import { CategoryCombobox } from "../components/ui/category-combobox.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { hiddenUntilLabel, hidingActive, longDay, utcDay, WINK_LINE } from "../lib/hidden.ts";

const MONEY = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const DAY = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Formats cents the server worked out; the web never adds money up. */
export const formatCents = (cents: number) => MONEY.format(cents / 100);

/** A net with its sign spelled out: "+$5.00" or "-$5.00". */
const formatNet = (cents: number) => `${cents > 0 ? "+" : ""}${formatCents(cents)}`;

/** Past this many rows the body is virtualised; below it every row is in the DOM. */
export const VIRTUAL_ROW_THRESHOLD = 200;
const ROW_HEIGHT = 40;

/** What the table lists: a date header, then that date's transactions. */
export type TableItem =
  | { readonly kind: "day"; readonly key: string; readonly date: string }
  | { readonly kind: "txn"; readonly key: string; readonly txn: LedgerTransaction };

/** The rows (already newest first) with a header before each run of one date. */
export function groupByDate(transactions: readonly LedgerTransaction[]): TableItem[] {
  const items: TableItem[] = [];
  let current: string | undefined;
  for (const txn of transactions) {
    if (txn.postedOn !== current) {
      current = txn.postedOn;
      items.push({ kind: "day", key: `day-${current}-${items.length}`, date: current });
    }
    items.push({ kind: "txn", key: txn.id, txn });
  }
  return items;
}

/** The hidden-below-`md` classes of the Account and checkbox columns. */
const WIDE = "hidden md:table-cell";

/** Stands in for the rows scrolled out of the window; nothing in it is focusable or read out. */
function Spacer({ height }: { height: number }) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a spacer row holds nothing focusable
    <tr aria-hidden="true">
      <td colSpan={5} style={{ height, padding: 0 }} />
    </tr>
  );
}

/**
 * The category cell: one split shows its category as a chip that edits in place through the
 * category combobox; several splits show "Split (N)", which opens the sheet.
 */
function CategoryCell({
  txn,
  categories,
  onOpen,
  onCategory,
}: {
  txn: LedgerTransaction;
  categories: readonly CategorySummary[];
  onOpen: (txn: LedgerTransaction) => void;
  onCategory: (txn: LedgerTransaction, splitId: string, categoryId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [first, second] = txn.splits;
  if (first === undefined) return <span className="text-muted-foreground">-</span>;
  if (second !== undefined) {
    return (
      <button
        type="button"
        className="rounded-full border px-2 py-0.5 text-xs"
        aria-label={`${txn.nameHidden ? hiddenUntilLabel(txn.nameHiddenUntil) : txn.descriptionRaw}: ${txn.splits.length} splits, open to edit`}
        onClick={() => onOpen(txn)}
      >
        Split ({txn.splits.length})
      </button>
    );
  }
  const name = categories.find((c) => c.id === first.categoryId)?.name;
  if (categories.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="block max-w-28 truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
      >
        …
      </button>
    );
  }
  if (editing) {
    return (
      <CategoryCombobox
        label={`Category for ${txn.nameHidden ? hiddenUntilLabel(txn.nameHiddenUntil) : txn.descriptionRaw}`}
        categories={categories}
        value={first.categoryId}
        autoFocus
        className="w-40"
        onChange={(categoryId) => {
          setEditing(false);
          onCategory(txn, first.id, categoryId);
        }}
        onDismiss={() => setEditing(false)}
      />
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "block max-w-28 truncate rounded-full border px-2 py-0.5 text-xs",
        name === undefined && "text-muted-foreground",
      )}
      aria-label={`Category for ${txn.nameHidden ? hiddenUntilLabel(txn.nameHiddenUntil) : txn.descriptionRaw}: ${name ?? "Uncategorised"}. Edit`}
      onClick={() => setEditing(true)}
    >
      {name ?? "Uncategorised"}
    </button>
  );
}

function Row({
  item,
  dayNets,
  accountNames,
  categories,
  viewerId,
  partnerName,
  rowIndex,
  virtual,
  onOpen,
  onCategory,
}: {
  item: TableItem;
  dayNets: Readonly<Record<string, number>>;
  accountNames: ReadonlyMap<string, string>;
  categories: readonly CategorySummary[];
  viewerId: string;
  partnerName: string | null;
  rowIndex: number | undefined;
  virtual: boolean;
  onOpen: (txn: LedgerTransaction) => void;
  onCategory: (txn: LedgerTransaction, splitId: string, categoryId: string | null) => void;
}) {
  const rowProps = {
    ...(rowIndex === undefined ? {} : { "aria-rowindex": rowIndex }),
    ...(virtual ? { className: "h-10" } : {}),
  };
  if (item.kind === "day") {
    const net = dayNets[item.date];
    return (
      <TableRow {...rowProps} className={cn("bg-muted/60 hover:bg-muted/60", rowProps.className)}>
        <th scope="rowgroup" colSpan={5} className="px-2 text-left text-sm font-medium">
          <span className="flex items-baseline justify-between gap-2">
            <time dateTime={item.date}>{DAY.format(new Date(`${item.date}T00:00:00Z`))}</time>
            {net === undefined ? null : (
              <span className="tabular-nums text-muted-foreground">Net {formatNet(net)}</span>
            )}
          </span>
        </th>
      </TableRow>
    );
  }
  const { txn } = item;
  return (
    <TableRow {...rowProps}>
      <TableCell className={cn(WIDE)}>
        <input type="checkbox" aria-label={`Select ${txn.descriptionRaw}`} />
      </TableCell>
      <TableCell className="w-full max-w-0">
        {txn.nameHidden ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-left"
              aria-label={hiddenUntilLabel(txn.nameHiddenUntil)}
              aria-describedby={`wink-${txn.id}`}
              onClick={() => onOpen(txn)}
            >
              {hiddenUntilLabel(txn.nameHiddenUntil)}
            </button>
            <span
              id={`wink-${txn.id}`}
              className="min-w-0 truncate text-xs italic text-muted-foreground"
            >
              {WINK_LINE}
            </span>
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-left"
              title={txn.descriptionRaw}
              onClick={() => onOpen(txn)}
            >
              {txn.descriptionRaw}
            </button>
            {partnerName !== null &&
            txn.nameHiddenBy === viewerId &&
            hidingActive(txn.nameHiddenUntil, utcDay(new Date())) ? (
              <span className="shrink-0 truncate rounded-full border bg-muted px-2 text-xs">
                Hidden from {partnerName} until {longDay(txn.nameHiddenUntil as string)}
              </span>
            ) : null}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <CategoryCell txn={txn} categories={categories} onOpen={onOpen} onCategory={onCategory} />
      </TableCell>
      <TableCell className={cn(WIDE, "max-w-40")}>
        <span className="block truncate">{accountNames.get(txn.accountId) ?? ""}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatCents(txn.amountCents)}
      </TableCell>
    </TableRow>
  );
}

/**
 * The transactions of one page, grouped by date with the day's net. Past `VIRTUAL_ROW_THRESHOLD`
 * rows only the rows in view are in the DOM (`aria-rowcount` carries the full count). Below `md`
 * the checkbox and Account columns are hidden; the description truncates, so nothing scrolls
 * sideways at 320 px.
 */
export function TransactionsTable({
  transactions,
  dayNets,
  accountNames,
  categories,
  viewerId,
  partnerName,
  onOpen,
  onCategory,
}: {
  transactions: readonly LedgerTransaction[];
  dayNets: Readonly<Record<string, number>>;
  accountNames: ReadonlyMap<string, string>;
  categories: readonly CategorySummary[];
  /** The signed-in person, whose own hidden names carry a "Hidden from" tag. */
  viewerId: string;
  /** The partner's name for that tag; null when there is no partner. */
  partnerName: string | null;
  /** Opens the transaction sheet. */
  onOpen: (txn: LedgerTransaction) => void;
  /** An inline category edit of a single-split row. */
  onCategory: (txn: LedgerTransaction, splitId: string, categoryId: string | null) => void;
}) {
  const items = useMemo(() => groupByDate(transactions), [transactions]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = transactions.length > VIRTUAL_ROW_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 10,
  });

  const windowed = virtual ? virtualizer.getVirtualItems() : [];
  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  const padTop = first?.start ?? 0;
  const padBottom = last === undefined ? 0 : virtualizer.getTotalSize() - last.end;
  const visible = virtual
    ? windowed.flatMap((entry) => {
        const item = items[entry.index];
        return item === undefined ? [] : [{ item, index: entry.index }];
      })
    : items.map((item, index) => ({ item, index }));

  return (
    <div
      ref={scrollRef}
      className={virtual ? "max-h-[70vh] overflow-auto" : undefined}
      {...(virtual ? { tabIndex: 0, "aria-label": "Transactions list, scrollable" } : {})}
    >
      <Table
        aria-labelledby="transactions"
        {...(virtual ? { "aria-rowcount": items.length + 1 } : {})}
      >
        <TableHeader className={virtual ? "sticky top-0 bg-background" : undefined}>
          <TableRow {...(virtual ? { "aria-rowindex": 1 } : {})}>
            <TableHead scope="col" className={cn(WIDE)}>
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead scope="col" className="w-full">
              Description
            </TableHead>
            <TableHead scope="col">Category</TableHead>
            <TableHead scope="col" className={cn(WIDE)}>
              Account
            </TableHead>
            <TableHead scope="col" className="text-right">
              Amount
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {padTop > 0 ? <Spacer height={padTop} /> : null}
          {visible.map(({ item, index }) => (
            <Row
              key={item.key}
              item={item}
              dayNets={dayNets}
              accountNames={accountNames}
              categories={categories}
              viewerId={viewerId}
              partnerName={partnerName}
              rowIndex={virtual ? index + 2 : undefined}
              virtual={virtual}
              onOpen={onOpen}
              onCategory={onCategory}
            />
          ))}
          {padBottom > 0 ? <Spacer height={padBottom} /> : null}
        </TableBody>
      </Table>
    </div>
  );
}
