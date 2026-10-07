// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerTransaction, TransactionList as ListData, Me } from "../api.ts";
import * as api from "../api.ts";
import { type TransactionsSearch, validateTransactionsSearch } from "../routes/search.ts";
import { type Session, SessionContext } from "../session.tsx";
import { TransactionList } from "./TransactionList.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchTransactions: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchTags: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchAccounts).mockResolvedValue([{ id: "a1", name: "Joint" }]);
  vi.mocked(api.fetchCategories).mockResolvedValue([]);
  vi.mocked(api.fetchTags).mockResolvedValue([]);
});

const me: Me = {
  personId: "p-alex",
  displayName: "Alex",
  colour: "#000000",
  authAt: "2026-10-07T00:00:00Z",
  canInvite: false,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 10 },
  partner: { personId: "p-sam", displayName: "Sam" },
};

const session: Session = {
  me,
  signOut: vi.fn(),
  refresh: vi.fn(),
  signedIn: vi.fn(),
  signedUp: vi.fn(),
  token: "",
};

const row: LedgerTransaction = {
  id: "t1",
  accountId: "a1",
  postedOn: "2026-09-01",
  amountCents: -14285,
  descriptionRaw: "Plumber",
  status: "posted",
  notes: null,
  nameHidden: false,
  nameHiddenBy: null,
  nameHiddenUntil: null,
  remainingCents: 0,
  splits: [],
} as unknown as LedgerTransaction;

const list = (transactions: LedgerTransaction[]): ListData => ({
  transactions,
  page: { total: transactions.length, pageCount: 1, page: 1, next: null, prev: null },
  summary: { count: transactions.length, inCents: 0, outCents: 14285 * transactions.length },
  dayNets: {},
});

/** Holds the search as the route would, in state instead of the URL. */
function Harness({ initial = {} }: { initial?: TransactionsSearch }) {
  const [search, setSearch] = useState(initial);
  return (
    <TransactionList
      search={search}
      onSearch={(update) => setSearch((prev) => validateTransactionsSearch(update(prev)))}
      title={<h2>Transactions</h2>}
    />
  );
}

function renderList(initial?: TransactionsSearch) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <Harness {...(initial === undefined ? {} : { initial })} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("TransactionList search box", () => {
  it("puts what is typed into q after a pause, fetching once, and clears it with Clear filters", async () => {
    vi.mocked(api.fetchTransactions).mockImplementation(async (params) =>
      list(params?.q === "plumb" ? [row] : []),
    );
    const user = userEvent.setup();
    renderList();
    const box = (await screen.findByRole("searchbox", {
      name: "Search transactions",
    })) as HTMLInputElement;
    await waitFor(() => expect(api.fetchTransactions).toHaveBeenCalledTimes(1));

    await user.type(box, "  plumb ");
    // Nothing is fetched on each key: one call, for the settled text.
    await waitFor(() => expect(api.fetchTransactions).toHaveBeenCalledWith({ q: "plumb" }));
    expect(
      vi.mocked(api.fetchTransactions).mock.calls.filter(([p]) => p?.q !== undefined),
    ).toHaveLength(1);
    expect(await screen.findByText("Plumber")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(box.value).toBe(""));
    await waitFor(() => expect(vi.mocked(api.fetchTransactions).mock.lastCall?.[0]).toEqual({}));
  });

  it("keeps what is typed when the URL echoes an earlier value late", async () => {
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([row]));
    const user = userEvent.setup();
    let setQ: (q: string | undefined) => void = () => {};
    function Delayed() {
      // The URL lags the box: it only changes when the test says so.
      const [q, set] = useState<string | undefined>(undefined);
      setQ = set;
      return (
        <TransactionList
          search={q === undefined ? {} : { q }}
          onSearch={() => {}}
          title={<h2>Transactions</h2>}
        />
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={session}>
          <Delayed />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    const box = (await screen.findByRole("searchbox")) as HTMLInputElement;
    // Nothing reaches the URL in this harness (onSearch is a no-op), so "sent" values are only
    // known to the box: type, let it send "pl", type on, then deliver the echo of "pl".
    await user.type(box, "pl");
    await new Promise((r) => setTimeout(r, 400));
    await user.type(box, "umb");
    setQ("pl");
    await new Promise((r) => setTimeout(r, 50));
    expect(box.value).toBe("plumb");
  });

  it("drops the pending send and the typed text when Clear filters is pressed", async () => {
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([]));
    const user = userEvent.setup();
    renderList({ q: "old", type: "in" });
    const box = (await screen.findByRole("searchbox")) as HTMLInputElement;
    await user.type(box, "er");
    await user.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(box.value).toBe(""));
    await new Promise((r) => setTimeout(r, 450));
    expect(box.value).toBe("");
    expect(vi.mocked(api.fetchTransactions).mock.calls.some(([p]) => p?.q === "older")).toBe(false);
    expect(vi.mocked(api.fetchTransactions).mock.lastCall?.[0]).toEqual({});
  });

  it("starts from q in the URL and removes it when the box is emptied", async () => {
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([row]));
    const user = userEvent.setup();
    renderList({ q: "142.85" });
    const box = (await screen.findByRole("searchbox")) as HTMLInputElement;
    expect(box.value).toBe("142.85");
    expect(api.fetchTransactions).toHaveBeenCalledWith({ q: "142.85" });
    await user.clear(box);
    await waitFor(() => expect(vi.mocked(api.fetchTransactions).mock.lastCall?.[0]).toEqual({}));
  });
});
