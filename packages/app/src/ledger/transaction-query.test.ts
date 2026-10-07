import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import {
  decodeCursor,
  encodeCursor,
  listTransactionsInput,
  parseTransactionQuery,
  toTransactionFilter,
} from "./transaction-query.ts";

describe("parseTransactionQuery", () => {
  it("reads every filter and the paging position from a query string", () => {
    const query = new URLSearchParams(
      "account=a1&from=2026-07-01&to=2026-09-30&category=c1&tag=t1&payee=p1&minCents=100&maxCents=900&type=out&uncategorised=true&transfers=true&hidden=true&page=2",
    );
    expect(parseTransactionQuery(query)).toEqual({
      accountId: "a1",
      from: "2026-07-01",
      to: "2026-09-30",
      categoryId: "c1",
      tagId: "t1",
      payeeId: "p1",
      minCents: 100,
      maxCents: 900,
      type: "out",
      uncategorised: true,
      transfers: true,
      hidden: true,
      page: 2,
    });
  });

  it("reads a record (Hono's queries), and treats false as absent", () => {
    expect(parseTransactionQuery({ type: ["in"], hidden: ["false"], after: undefined })).toEqual({
      type: "in",
    });
    expect(parseTransactionQuery({})).toEqual({});
  });

  it("refuses an unknown or repeated name and a malformed value", () => {
    for (const bad of [
      "colour=red",
      "type=in&type=out",
      "page=1.5",
      "page=-1",
      "minCents=ten",
      "hidden=1",
      "uncategorised=",
    ]) {
      expect(() => parseTransactionQuery(new URLSearchParams(bad)), bad).toThrow(AppError);
    }
  });
});

describe("listTransactionsInput", () => {
  const parse = (input: unknown) => listTransactionsInput.safeParse(input).success;

  it("accepts the empty input and each filter", () => {
    expect(parse({})).toBe(true);
    expect(parse({ type: "in", from: "2026-01-01", to: "2026-01-01", minCents: 0 })).toBe(true);
  });

  it("refuses two paging positions, a reversed range, a fake date and an unknown key", () => {
    expect(parse({ page: 1, after: "2026-08-01~abc" })).toBe(false);
    expect(parse({ after: "2026-08-01~abc", before: "2026-08-01~abc" })).toBe(false);
    expect(parse({ from: "2026-02-01", to: "2026-01-01" })).toBe(false);
    expect(parse({ minCents: 5, maxCents: 4 })).toBe(false);
    expect(parse({ from: "2026-02-30" })).toBe(false);
    expect(parse({ page: 0 })).toBe(false);
    expect(parse({ after: "garbage" })).toBe(false);
    expect(parse({ colour: "red" })).toBe(false);
  });

  it("splits the filter from the paging position", () => {
    const parsed = listTransactionsInput.parse({ type: "in", page: 3 });
    expect(toTransactionFilter(parsed)).toEqual({ type: "in" });
  });
});

describe("cursors", () => {
  it("round-trips a position and rejects anything else", () => {
    const cursor = { postedOn: "2026-08-01", id: "01J0000000000000000000ABCD" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor("2026-08-01")).toBeUndefined();
    expect(decodeCursor("2026-08-01~a b")).toBeUndefined();
    expect(decodeCursor("2026-8-1~abc")).toBeUndefined();
  });
});
