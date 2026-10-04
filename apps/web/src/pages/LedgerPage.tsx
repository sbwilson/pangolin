import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { fetchTransactions, type LedgerTransaction } from "../api.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";

const MONEY = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

/** Past this many rows the body is virtualised; below it every row is in the DOM. */
export const VIRTUAL_ROW_THRESHOLD = 200;
const ROW_HEIGHT = 40;

const features = tableFeatures({});
const column = createColumnHelper<typeof features, LedgerTransaction>();
const columns = column.columns([
  column.accessor("postedOn", {
    header: "Date",
    cell: (info) => <time dateTime={info.getValue()}>{info.getValue()}</time>,
  }),
  column.accessor("descriptionRaw", {
    header: "Description",
    cell: (info) => (
      <span className="block max-w-md truncate" title={info.getValue()}>
        {info.getValue()}
      </span>
    ),
  }),
  column.accessor("amountCents", {
    header: "Amount",
    cell: (info) => MONEY.format(info.getValue() / 100),
  }),
]);

/** Stands in for the rows scrolled out of the window; nothing in it is focusable or read out. */
function Spacer({ height }: { height: number }) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a spacer row holds nothing focusable
    <tr aria-hidden="true">
      <td colSpan={columns.length} style={{ height, padding: 0 }} />
    </tr>
  );
}

function TransactionsTable({ data }: { data: LedgerTransaction[] }) {
  const table = useTable({ features, columns, data, getRowId: (row) => row.id });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUAL_ROW_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 10,
  });

  const items = virtual ? virtualizer.getVirtualItems() : [];
  const first = items[0];
  const last = items[items.length - 1];
  const padTop = first?.start ?? 0;
  const padBottom = last === undefined ? 0 : virtualizer.getTotalSize() - last.end;
  const visible = virtual
    ? items.flatMap((item) => {
        const row = rows[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : rows.map((row, index) => ({ row, index }));

  return (
    <div
      ref={scrollRef}
      className={virtual ? "max-h-[70vh] overflow-auto" : undefined}
      {...(virtual ? { tabIndex: 0, "aria-label": "Transactions list, scrollable" } : {})}
    >
      <Table aria-labelledby="ledger" {...(virtual ? { "aria-rowcount": rows.length + 1 } : {})}>
        <TableHeader className={virtual ? "sticky top-0 bg-background" : undefined}>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} {...(virtual ? { "aria-rowindex": 1 } : {})}>
              {group.headers.map((header) => (
                <TableHead key={header.id} scope="col">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {padTop > 0 ? <Spacer height={padTop} /> : null}
          {visible.map(({ row, index }) => (
            <TableRow
              key={row.id}
              className={virtual ? "h-10" : undefined}
              {...(virtual ? { "aria-rowindex": index + 2 } : {})}
            >
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {padBottom > 0 ? <Spacer height={padBottom} /> : null}
        </TableBody>
      </Table>
    </div>
  );
}

/** The transactions the signed-in person may see: shared accounts and their own private ones. */
export function LedgerPage() {
  const navigate = useNavigate();
  const ledger = useQuery({
    queryKey: ["ledger", "transactions"],
    queryFn: fetchTransactions,
    retry: false,
  });
  const data = useMemo(() => ledger.data ?? [], [ledger.data]);
  return (
    <section aria-labelledby="ledger">
      <h2 id="ledger">Transactions</h2>
      {ledger.isPending ? <p>Loading…</p> : null}
      {ledger.isError ? <p role="alert">Transactions unavailable</p> : null}
      {ledger.data === undefined ? null : ledger.data.length === 0 ? (
        <p>No transactions yet</p>
      ) : (
        <TransactionsTable data={data} />
      )}
      <button type="button" onClick={() => navigate({ to: "/", replace: true })}>
        Back
      </button>
    </section>
  );
}
