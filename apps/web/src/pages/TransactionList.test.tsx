// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  setSplitField: vi.fn(),
  setSplitTags: vi.fn(),
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
    <>
      <button
        type="button"
        data-testid="change-page"
        onClick={() => setSearch((prev) => ({ ...prev, page: "2" }))}
      >
        Change Page
      </button>
      <TransactionList
        search={search}
        onSearch={(update) => setSearch((prev) => validateTransactionsSearch(update(prev)))}
        title={<h2>Transactions</h2>}
      />
    </>
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

const makeTxn = (
  id: string,
  description: string,
  accountId = "a1",
  splits?: api.LedgerSplit[],
): LedgerTransaction =>
  ({
    id,
    accountId,
    postedOn: "2026-09-01",
    amountCents: -5000,
    descriptionRaw: description,
    status: "posted",
    notes: null,
    nameHidden: false,
    nameHiddenBy: null,
    nameHiddenUntil: null,
    remainingCents: 0,
    splits: splits ?? [
      {
        id: `s-${id}`,
        amountCents: -5000,
        beneficiary: "p-alex",
        memo: null,
        categoryId: null,
        tags: [],
        categorySource: null,
        beneficiarySource: null,
      },
    ],
  }) as unknown as LedgerTransaction;

describe("TransactionList bulk selection & actions", () => {
  it("selects all page rows when header checkbox is clicked, shows toolbar, and supports indeterminate state", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    const t3 = makeTxn("t3", "Row 3");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2, t3]));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    expect(screen.getByText(/3 transactions/)).toBeTruthy();

    const headerCheckbox = screen.getByRole("checkbox", {
      name: "Select all transactions on this page",
    }) as HTMLInputElement;
    expect(headerCheckbox.checked).toBe(false);
    expect(headerCheckbox.indeterminate).toBe(false);

    // Click header checkbox to select all
    await user.click(headerCheckbox);
    expect(headerCheckbox.checked).toBe(true);
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
    expect(screen.getByText("3 selected")).toBeTruthy();

    const row1Checkbox = screen.getByRole("checkbox", { name: "Select Row 1" }) as HTMLInputElement;
    const row2Checkbox = screen.getByRole("checkbox", { name: "Select Row 2" }) as HTMLInputElement;
    const row3Checkbox = screen.getByRole("checkbox", { name: "Select Row 3" }) as HTMLInputElement;
    expect(row1Checkbox.checked).toBe(true);
    expect(row2Checkbox.checked).toBe(true);
    expect(row3Checkbox.checked).toBe(true);

    // Deselect row 2 -> indeterminate header
    await user.click(row2Checkbox);
    expect(row2Checkbox.checked).toBe(false);
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(headerCheckbox.indeterminate).toBe(true);

    // Click indeterminate header -> select all again
    await user.click(headerCheckbox);
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(row2Checkbox.checked).toBe(true);

    // Click all-checked header -> deselect all
    await user.click(headerCheckbox);
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
    expect(screen.getByText(/3 transactions/)).toBeTruthy();
  });

  it("supports Shift-click range selection", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    const t3 = makeTxn("t3", "Row 3");
    const t4 = makeTxn("t4", "Row 4");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2, t3, t4]));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();

    const row1Checkbox = screen.getByRole("checkbox", { name: "Select Row 1" });
    const row4Checkbox = screen.getByRole("checkbox", { name: "Select Row 4" });

    // Select row 1
    await user.click(row1Checkbox);
    expect(screen.getByText("1 selected")).toBeTruthy();

    // Shift-click row 4
    await user.keyboard("{Shift>}");
    await user.click(row4Checkbox);
    await user.keyboard("{/Shift}");

    expect(screen.getByText("4 selected")).toBeTruthy();
    const row2Checkbox = screen.getByRole("checkbox", { name: "Select Row 2" }) as HTMLInputElement;
    const row3Checkbox = screen.getByRole("checkbox", { name: "Select Row 3" }) as HTMLInputElement;
    expect(row2Checkbox.checked).toBe(true);
    expect(row3Checkbox.checked).toBe(true);
  });

  it("supports keyboard Space and Enter toggle on checkboxes, and Esc to clear selection", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();

    const row1Checkbox = screen.getByRole("checkbox", { name: "Select Row 1" }) as HTMLInputElement;
    const row2Checkbox = screen.getByRole("checkbox", { name: "Select Row 2" }) as HTMLInputElement;

    row1Checkbox.focus();
    await user.keyboard(" ");
    expect(row1Checkbox.checked).toBe(true);

    row2Checkbox.focus();
    await user.keyboard("{Enter}");
    expect(row2Checkbox.checked).toBe(true);
    expect(screen.getByText("2 selected")).toBeTruthy();

    // Escape clears selection
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
    expect(row1Checkbox.checked).toBe(false);
    expect(row2Checkbox.checked).toBe(false);
    expect(screen.getByText(/2 transactions/)).toBeTruthy();
  });

  it("clicking a row checkbox does not open the transaction sheet", async () => {
    const t1 = makeTxn("t1", "Row 1");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1]));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    const row1Checkbox = screen.getByRole("checkbox", { name: "Select Row 1" });
    await user.click(row1Checkbox);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("bulk categorises selected rows and allows undo", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { id: "c1", name: "Groceries", groupId: "g1", groupName: "Living" },
    ]);
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    vi.mocked(api.setSplitField).mockImplementation(async (txnId, splitId, _field, val) => ({
      applied: true,
      changed: true,
      transaction: makeTxn(txnId, txnId, "a1", [
        {
          id: splitId,
          amountCents: -5000,
          beneficiary: "p-alex",
          memo: null,
          categoryId: val as string,
          tags: [],
          categorySource: "user",
          beneficiarySource: null,
        },
      ]),
    }));

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    const headerCheckbox = screen.getByRole("checkbox", {
      name: "Select all transactions on this page",
    });
    await user.click(headerCheckbox);

    await user.click(screen.getByRole("button", { name: "Categorise" }));
    await user.click(screen.getByRole("combobox", { name: "Choose category" }));
    const listbox = await screen.findByRole("listbox", { name: "Choose category" });
    await user.click(within(listbox).getByRole("option", { name: "Groceries" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "category", "c1"),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t2", "s-t2", "category", "c1");

    expect(await screen.findByText("Updated 2 transactions")).toBeTruthy();
    const undoButton = screen.getByRole("button", { name: "Undo" });
    await user.click(undoButton);

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "category", null),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t2", "s-t2", "category", null);
    expect(await screen.findByText("Restored previous values")).toBeTruthy();
  });

  it("bulk tags selected rows and allows undo", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTags).mockResolvedValue([{ id: "tag1", name: "Holiday" }]);
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    vi.mocked(api.setSplitTags).mockImplementation(async (txnId, splitId, tagIds) =>
      makeTxn(txnId, txnId, "a1", [
        {
          id: splitId,
          amountCents: -5000,
          beneficiary: "p-alex",
          memo: null,
          categoryId: null,
          tags: tagIds.map((id) => ({ id, name: "Holiday" })),
          categorySource: null,
          beneficiarySource: null,
        },
      ]),
    );

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );

    await user.click(screen.getByRole("button", { name: "Tag" }));
    await user.click(screen.getByRole("combobox", { name: "Add a tag" }));
    await user.click(await screen.findByRole("option", { name: "Holiday" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(api.setSplitTags).toHaveBeenCalledWith("t1", "s-t1", ["tag1"]));
    expect(api.setSplitTags).toHaveBeenCalledWith("t2", "s-t2", ["tag1"]);

    expect(await screen.findByText("Updated 2 transactions")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(api.setSplitTags).toHaveBeenCalledWith("t1", "s-t1", []));
    expect(api.setSplitTags).toHaveBeenCalledWith("t2", "s-t2", []);
    expect(await screen.findByText("Restored previous values")).toBeTruthy();
  });

  it("bulk marks shared for shared rows and allows undo", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    vi.mocked(api.setSplitField).mockImplementation(async (txnId, splitId, _field, val) => ({
      applied: true,
      changed: true,
      transaction: makeTxn(txnId, txnId, "a1", [
        {
          id: splitId,
          amountCents: -5000,
          beneficiary: val as string,
          memo: null,
          categoryId: null,
          tags: [],
          categorySource: null,
          beneficiarySource: "user",
        },
      ]),
    }));

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );

    await user.click(screen.getByRole("button", { name: "Mark shared" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "beneficiary", "shared"),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t2", "s-t2", "beneficiary", "shared");

    expect(await screen.findByText("Updated 2 transactions")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "beneficiary", "p-alex"),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t2", "s-t2", "beneficiary", "p-alex");
    expect(await screen.findByText("Restored previous values")).toBeTruthy();
  });

  it("refuses private account rows on mark shared and names each refused row in notice", async () => {
    const t1 = makeTxn("t1", "Shared Dinner", "a1");
    const t2 = makeTxn("t2", "Secret Gift", "a-priv");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    vi.mocked(api.setSplitField).mockImplementation(async (txnId) => {
      if (txnId === "t2") {
        throw new Error("A private account's splits belong to its owner");
      }
      return {
        applied: true,
        changed: true,
        transaction: makeTxn(txnId, txnId),
      };
    });

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Shared Dinner")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );

    await user.click(screen.getByRole("button", { name: "Mark shared" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "beneficiary", "shared"),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t2", "s-t2", "beneficiary", "shared");

    // Notice reports refused row by description
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Secret Gift");
    expect(alert.textContent).toContain("A private account's splits belong to its owner");

    // Successful row gets toast with Undo
    expect(await screen.findByText("Updated 1 transaction")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "beneficiary", "p-alex"),
    );
    // t2 was never updated, so it is never undone
    expect(api.setSplitField).not.toHaveBeenCalledWith("t2", "s-t2", "beneficiary", "p-alex");
  });

  it("handles forced single-row failure during bulk action, reports failed row, and allows undo for successful rows", async () => {
    const t1 = makeTxn("t1", "Coffee");
    const t2 = makeTxn("t2", "Lunch");
    const t3 = makeTxn("t3", "Dinner");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2, t3]));
    vi.mocked(api.setSplitField).mockImplementation(async (txnId) => {
      if (txnId === "t2") {
        throw new Error("Write rejected by server");
      }
      return {
        applied: true,
        changed: true,
        transaction: makeTxn(txnId, txnId),
      };
    });

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Coffee")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );

    await user.click(screen.getByRole("button", { name: "Mark shared" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Lunch");
    expect(alert.textContent).toContain("Write rejected by server");

    expect(await screen.findByText("Updated 2 transactions")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "beneficiary", "p-alex"),
    );
    expect(api.setSplitField).toHaveBeenCalledWith("t3", "s-t3", "beneficiary", "p-alex");
    expect(api.setSplitField).not.toHaveBeenCalledWith("t2", "s-t2", "beneficiary", "p-alex");
  });

  it("Escape key closes bulk popovers while keeping selection", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { id: "c1", name: "Groceries", groupId: "g1", groupName: "Living" },
    ]);
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );
    expect(screen.getByText("2 selected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Categorise" }));
    expect(screen.getByRole("combobox", { name: "Choose category" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Choose category" })).toBeNull();
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
  });

  it("shows alert message when Undo API call fails", async () => {
    const t1 = makeTxn("t1", "Coffee");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1]));
    vi.mocked(api.setSplitField).mockResolvedValueOnce({
      applied: true,
      changed: true,
      transaction: makeTxn("t1", "Coffee"),
    });

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Coffee")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );

    await user.click(screen.getByRole("button", { name: "Mark shared" }));
    expect(await screen.findByText("Updated 1 transaction")).toBeTruthy();

    vi.mocked(api.setSplitField).mockRejectedValueOnce(new Error("Server failed on undo"));

    await user.click(screen.getByRole("button", { name: "Undo" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Server failed on undo");
  });

  it("toolbar Clear button clears selection and restores summary line", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );
    expect(screen.getByText("2 selected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
    expect(screen.getByText(/2 transactions · In/)).toBeTruthy();

    const row1Cb = screen.getByRole("checkbox", { name: "Select Row 1" }) as HTMLInputElement;
    expect(row1Cb.checked).toBe(false);
  });

  it("clears selection when search or page filter changes", async () => {
    const t1 = makeTxn("t1", "Row 1");
    const t2 = makeTxn("t2", "Row 2");
    vi.mocked(api.fetchTransactions).mockResolvedValue(list([t1, t2]));

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );
    expect(screen.getByText("2 selected")).toBeTruthy();

    await user.click(screen.getByTestId("change-page"));

    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
    expect(screen.getByText(/2 transactions · In/)).toBeTruthy();
  });

  it("table row category chip updates DOM after bulk categorisation and undo", async () => {
    const t1 = makeTxn("t1", "Row 1");
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { id: "c1", name: "Groceries", groupId: "g1", groupName: "Living" },
    ]);
    let currentTxn = t1;
    vi.mocked(api.fetchTransactions).mockImplementation(async () => list([currentTxn]));
    vi.mocked(api.setSplitField).mockImplementation(async (txnId, splitId, _field, val) => {
      currentTxn = makeTxn(txnId, "Row 1", "a1", [
        {
          id: splitId,
          amountCents: -5000,
          beneficiary: "p-alex",
          memo: null,
          categoryId: val as string | null,
          tags: [],
          categorySource: "user",
          beneficiarySource: null,
        },
      ]);
      return {
        applied: true,
        changed: true,
        transaction: currentTxn,
      };
    });

    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Row 1")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Category for Row 1: Uncategorised. Edit" }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("checkbox", { name: "Select all transactions on this page" }),
    );
    await user.click(screen.getByRole("button", { name: "Categorise" }));
    await user.click(screen.getByRole("combobox", { name: "Choose category" }));
    const listbox = await screen.findByRole("listbox", { name: "Choose category" });
    await user.click(within(listbox).getByRole("option", { name: "Groceries" }));

    await waitFor(() =>
      expect(api.setSplitField).toHaveBeenCalledWith("t1", "s-t1", "category", "c1"),
    );
    const updatedChip = await screen.findByRole("button", {
      name: "Category for Row 1: Groceries. Edit",
    });
    expect(updatedChip).toBeTruthy();
    expect(updatedChip.textContent).toBe("Groceries");

    const undoButton = screen.getByRole("button", { name: "Undo" });
    await user.click(undoButton);

    const revertedChip = await screen.findByRole("button", {
      name: "Category for Row 1: Uncategorised. Edit",
    });
    expect(revertedChip).toBeTruthy();
    expect(revertedChip.textContent).toBe("Uncategorised");
  });
});
