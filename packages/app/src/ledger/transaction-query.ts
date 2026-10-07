import { z } from "zod";
import { dayInput, idInput } from "../accounts/inputs.ts";
import { AppError } from "../errors.ts";
import type { TransactionCursor, TransactionFilter } from "../ports/unit-of-work.ts";

/** Rows on a page of the transaction list. */
export const TRANSACTION_PAGE_SIZE = 50;

const CURSOR = /^(\d{4}-\d{2}-\d{2})~([0-9A-Za-z_-]{1,100})$/;

/** The opaque keyset cursor for a row: its `postedOn` and `id`, the list's sort key. */
export function encodeCursor(cursor: TransactionCursor): string {
  return `${cursor.postedOn}~${cursor.id}`;
}

/** The cursor in `text`, or undefined when it is not one `encodeCursor` makes. */
export function decodeCursor(text: string): TransactionCursor | undefined {
  const match = CURSOR.exec(text);
  return match === null ? undefined : { postedOn: match[1] as string, id: match[2] as string };
}

const cursorInput = z.string().refine((v) => decodeCursor(v) !== undefined, {
  message: "Expected a cursor from a previous page",
});

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * The input of `ledger.listTransactions`: the filters of a transaction list and where to start.
 * At most one of `page`, `after` and `before` (none is the first page).
 */
export const listTransactionsInput = z
  .object({
    accountId: idInput.optional(),
    from: dayInput.optional(),
    to: dayInput.optional(),
    categoryId: idInput.optional(),
    tagId: idInput.optional(),
    payeeId: idInput.optional(),
    minCents: cents.optional(),
    maxCents: cents.optional(),
    type: z.enum(["in", "out"]).optional(),
    uncategorised: z.literal(true).optional(),
    transfers: z.literal(true).optional(),
    hidden: z.literal(true).optional(),
    page: z.number().int().min(1).max(1_000_000).optional(),
    after: cursorInput.optional(),
    before: cursorInput.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if ([q.page, q.after, q.before].filter((v) => v !== undefined).length > 1) {
      ctx.addIssue({ code: "custom", message: "Give one of page, after and before" });
    }
    if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
      ctx.addIssue({ code: "custom", message: "from is after to", path: ["from"] });
    }
    if (q.minCents !== undefined && q.maxCents !== undefined && q.minCents > q.maxCents) {
      ctx.addIssue({ code: "custom", message: "minCents is above maxCents", path: ["minCents"] });
    }
  });
export type ListTransactionsInput = z.input<typeof listTransactionsInput>;

/** The filter part of a parsed list input (everything that narrows rows). */
export function toTransactionFilter(q: z.output<typeof listTransactionsInput>): TransactionFilter {
  const { page: _p, after: _a, before: _b, ...filter } = q;
  return filter;
}

/** The query-string name of each field of `ListTransactionsInput`. */
const PARAMS = {
  account: "accountId",
  from: "from",
  to: "to",
  category: "categoryId",
  tag: "tagId",
  payee: "payeeId",
  minCents: "minCents",
  maxCents: "maxCents",
  type: "type",
  uncategorised: "uncategorised",
  transfers: "transfers",
  hidden: "hidden",
  page: "page",
  after: "after",
  before: "before",
} as const;

const NUMBERS = new Set(["minCents", "maxCents", "page"]);
const FLAGS = new Set(["uncategorised", "transfers", "hidden"]);

/** Query-string values as a parser takes them: a `URLSearchParams` or a plain record. */
export type TransactionQuery =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Reads the transaction list filters and paging from a query string (`account`, `from`, `to`,
 * `category`, `tag`, `payee`, `minCents`, `maxCents`, `type`, `uncategorised`, `transfers`,
 * `hidden`, `page`, `after`, `before`) and checks their syntax only: a flag is `true` or `false`
 * (false is the same as absent), a number is digits, and an unknown or repeated name is a
 * `Validation` error. The values themselves (dates, ranges, cursors, the one paging position) are
 * validated by `listTransactions`.
 */
export function parseTransactionQuery(query: TransactionQuery): ListTransactionsInput {
  const entries: [string, readonly string[]][] =
    query instanceof URLSearchParams
      ? [...new Set(query.keys())].map((k) => [k, query.getAll(k)])
      : Object.entries(query).flatMap(([k, v]): [string, readonly string[]][] =>
          v === undefined ? [] : [[k, typeof v === "string" ? [v] : v]],
        );
  const out: Record<string, unknown> = {};
  for (const [name, values] of entries) {
    const field = (PARAMS as Record<string, string>)[name];
    if (field === undefined) throw new AppError("Validation", `Unknown filter: ${name}`);
    if (values.length !== 1) throw new AppError("Validation", `Give ${name} once`);
    const value = values[0] as string;
    if (FLAGS.has(field)) {
      if (value !== "true" && value !== "false") {
        throw new AppError("Validation", `${name} must be true or false`);
      }
      if (value === "true") out[field] = true;
    } else if (NUMBERS.has(field)) {
      if (!/^\d{1,15}$/.test(value)) throw new AppError("Validation", `${name} must be a number`);
      out[field] = Number(value);
    } else {
      out[field] = value;
    }
  }
  return out as ListTransactionsInput;
}
