import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils.ts";
import type { LedgerTransaction } from "../api.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";

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
      <td colSpan={4} style={{ height, padding: 0 }} />
    </tr>
  );
}

function Row({
  item,
  dayNets,
  accountNames,
  rowIndex,
  virtual,
}: {
  item: TableItem;
  dayNets: Readonly<Record<string, number>>;
  accountNames: ReadonlyMap<string, string>;
  rowIndex: number | undefined;
  virtual: boolean;
}) {
  const rowProps = {
    ...(rowIndex === undefined ? {} : { "aria-rowindex": rowIndex }),
    ...(virtual ? { className: "h-10" } : {}),
  };
  if (item.kind === "day") {
    const net = dayNets[item.date];
    return (
      <TableRow {...rowProps} className={cn("bg-muted/60 hover:bg-muted/60", rowProps.className)}>
        <th scope="rowgroup" colSpan={4} className="px-2 text-left text-sm font-medium">
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
        <span className="block truncate" title={txn.descriptionRaw}>
          {txn.descriptionRaw}
        </span>
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
}: {
  transactions: readonly LedgerTransaction[];
  dayNets: Readonly<Record<string, number>>;
  accountNames: ReadonlyMap<string, string>;
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
              rowIndex={virtual ? index + 2 : undefined}
              virtual={virtual}
            />
          ))}
          {padBottom > 0 ? <Spacer height={padBottom} /> : null}
        </TableBody>
      </Table>
    </div>
  );
}
