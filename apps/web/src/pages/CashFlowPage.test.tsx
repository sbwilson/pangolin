// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { ApiError } from "../api.ts";
import { formatPercentOfIncome } from "../components/ProfitAndLossTable.tsx";
import { formatCents } from "../lib/money.ts";
import { parseSearch, stringifySearch, validateCashFlowSearch } from "../routes/search.ts";
import { CashFlowPage, formatSavingsRate } from "./CashFlowPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchCashFlow: vi.fn(),
  fetchSharedShare: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchProfitAndLoss: vi.fn(),
  fetchSpending: vi.fn(),
  fetchMerchants: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchLeaks: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.resetAllMocks();
});

const report = (range: { from: string; to: string }) => ({
  ...range,
  moneyInCents: 512345,
  moneyOutCents: 300000,
  keptCents: 212345,
  savingsRatePermille: 414,
});

const shareReport = (range: { from: string; to: string }) => ({
  ...range,
  setting: "contribution" as const,
  basis: "contribution" as const,
  sharedCents: 123456,
  shareCents: 74074,
  sharePercent: 60,
});

const accountsList = [
  {
    id: "acct-1",
    name: "Everyday",
    type: "depository" as const,
    pool: "shared" as const,
    closedOn: null,
  },
];

const pnlGroupReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "group" as const,
  income: {
    totalCents: 512345,
    rows: [
      { id: "grp-salary", name: "Salary", cents: 500000 },
      { id: null, name: null, cents: 12345 },
    ],
  },
  expense: {
    totalCents: 300000,
    rows: [
      { id: "grp-housing", name: "Housing", cents: 200000 },
      { id: "grp-food", name: "Food", cents: 80000 },
      { id: null, name: null, cents: 20000 },
    ],
  },
  uncategorised: { inCents: 12345, outCents: 20000 },
});

const pnlCategoryReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "category" as const,
  income: {
    totalCents: 512345,
    rows: [
      {
        id: "cat-wages",
        name: "Alex Wages",
        groupId: "grp-salary",
        groupName: "Salary",
        cents: 500000,
      },
      { id: null, name: null, groupId: null, groupName: null, cents: 12345 },
    ],
  },
  expense: {
    totalCents: 300000,
    rows: [
      { id: "cat-rent", name: "Rent", groupId: "grp-housing", groupName: "Housing", cents: 200000 },
      {
        id: "cat-groceries",
        name: "Groceries",
        groupId: "grp-food",
        groupName: "Food",
        cents: 80000,
      },
      { id: null, name: null, groupId: null, groupName: null, cents: 20000 },
    ],
  },
  uncategorised: { inCents: 12345, outCents: 20000 },
});

const spendingGroupReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "group" as const,
  totalCents: 300000,
  rows: [
    { id: "grp-housing", name: "Housing", cents: 200000 },
    { id: "grp-food", name: "Food", cents: 80000 },
    { id: null, name: null, cents: 20000 },
  ],
});

const spendingCategoryReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "category" as const,
  totalCents: 300000,
  rows: [
    { id: "cat-rent", name: "Rent", groupId: "grp-housing", groupName: "Housing", cents: 200000 },
    {
      id: "cat-groceries",
      name: "Groceries",
      groupId: "grp-food",
      groupName: "Food",
      cents: 80000,
    },
    { id: null, name: null, groupId: null, groupName: null, cents: 20000 },
  ],
});

const merchantsIncomeReport = (range: { from: string; to: string }) => ({
  ...range,
  flow: "income" as const,
  totalCents: 512345,
  rows: [
    { payeeId: "payee-employer", payeeName: "Acme Corp", logoAttachmentId: null, cents: 500000 },
  ],
});

const merchantsExpenseReport = (range: { from: string; to: string }) => ({
  ...range,
  flow: "expense" as const,
  totalCents: 300000,
  rows: [
    { payeeId: "payee-landlord", payeeName: "Landlord", logoAttachmentId: null, cents: 200000 },
    { payeeId: "payee-woolies", payeeName: "Woolworths", logoAttachmentId: null, cents: 80000 },
    { payeeId: null, payeeName: null, logoAttachmentId: null, cents: 20000 },
  ],
});

const transactionsReport = () => ({
  transactions: [
    {
      id: "txn-1",
      accountId: "acct-1",
      postedOn: "2026-08-10",
      amountCents: -5000,
      descriptionRaw: "Woolworths",
      payeeId: null,
      payeeName: null,
      logoAttachmentId: null,
      status: "posted" as const,
      notes: null,
      nameHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      remainingCents: 0,
      splits: [
        {
          id: "split-1",
          amountCents: -5000,
          beneficiary: "shared",
          memo: null,
          categoryId: "cat-groceries",
          tags: [],
          categorySource: "user" as const,
          beneficiarySource: "user" as const,
        },
      ],
    },
    {
      id: "txn-hidden",
      accountId: "acct-1",
      postedOn: "2026-08-12",
      amountCents: -12000,
      descriptionRaw: "Hidden until Aug 2026",
      payeeId: null,
      payeeName: null,
      logoAttachmentId: null,
      status: "posted" as const,
      notes: null,
      nameHidden: true,
      nameHiddenBy: "person-sam",
      nameHiddenUntil: "2026-09-01T00:00:00Z",
      remainingCents: 0,
      splits: [
        {
          id: "split-2",
          amountCents: -12000,
          beneficiary: "shared",
          memo: null,
          categoryId: null,
          tags: [],
          categorySource: null,
          beneficiarySource: null,
        },
      ],
    },
  ],
  page: { total: 2, pageCount: 1, page: 1, next: null, prev: null },
  summary: { count: 2, inCents: 0, outCents: 17000 },
  dayNets: { "2026-08-10": -5000, "2026-08-12": -12000 },
});

function renderPage(url: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/cash-flow",
    validateSearch: validateCashFlowSearch,
    component: CashFlowPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    parseSearch,
    stringifySearch,
    history: createMemoryHistory({ initialEntries: [url] }),
    isServer: false,
    origin: "http://localhost",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const figure = (tiles: HTMLElement, label: string) =>
  within(tiles).getByText(label).parentElement?.querySelector("dd")?.textContent;

describe("CashFlowPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 7, 14, 12), toFake: ["Date"] });
    vi.mocked(api.fetchCashFlow).mockImplementation(async (range) => report(range));
    vi.mocked(api.fetchSharedShare).mockImplementation(async (range) => shareReport(range));
    vi.mocked(api.fetchAccounts).mockResolvedValue(accountsList);
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { id: "cat-wages", name: "Alex Wages", groupId: "grp-salary", groupName: "Salary" },
      { id: "cat-rent", name: "Rent", groupId: "grp-housing", groupName: "Housing" },
      { id: "cat-groceries", name: "Groceries", groupId: "grp-food", groupName: "Food" },
    ]);
    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async ({ from, to, by }) =>
      by === "group" ? pnlGroupReport({ from, to }) : pnlCategoryReport({ from, to }),
    );
    vi.mocked(api.fetchSpending).mockImplementation(async ({ from, to, by }) =>
      by === "group" ? spendingGroupReport({ from, to }) : spendingCategoryReport({ from, to }),
    );
    vi.mocked(api.fetchMerchants).mockImplementation(async ({ from, to, flow }) =>
      flow === "income"
        ? merchantsIncomeReport({ from, to })
        : merchantsExpenseReport({ from, to }),
    );
    vi.mocked(api.fetchTransactions).mockResolvedValue(transactionsReport());
    vi.mocked(api.fetchLeaks).mockImplementation(async ({ from, to }) => ({
      from,
      to,
      rows: [
        {
          payeeId: "payee-leak",
          payeeName: "Corner Cafe",
          count: 5,
          totalCents: 4500,
          medianCents: 900,
        },
      ],
    }));
  });

  it("shows the share line under the tiles with the server's figures and percent", async () => {
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");
    const line = await screen.findByTestId("share-line-text");
    expect(line.textContent).toBe(
      `Your share: ${formatCents(74074)} of ${formatCents(123456)} shared (60%)`,
    );
    expect(api.fetchSharedShare).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    const tiles = screen.getByTestId("cash-flow-tiles");
    expect(tiles.nextElementSibling).toBe(screen.getByTestId("share-line"));
    expect(
      screen.getByRole("button", { name: "Everything I can see" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the toggle when the share fetch fails, so My share can be left", async () => {
    vi.mocked(api.fetchSharedShare).mockRejectedValue(new ApiError(500, "Internal", "boom"));
    renderPage("/cash-flow?share=mine");
    await screen.findByTestId("cash-flow-tiles");
    expect(screen.getByRole("button", { name: "Everything I can see" })).toBeTruthy();
    expect(screen.queryByTestId("share-line-text")).toBeNull();
  });

  it("drops the percentage when nothing is shared", async () => {
    vi.mocked(api.fetchSharedShare).mockImplementation(async (range) => ({
      ...shareReport(range),
      sharedCents: 0,
      shareCents: 0,
      sharePercent: null,
    }));
    renderPage("/cash-flow");
    expect((await screen.findByTestId("share-line-text")).textContent).toBe(
      "Your share: $0.00 of $0.00 shared",
    );
  });

  it("holds My share in the URL, refetches the tiles, and keeps it across range changes", async () => {
    const user = userEvent.setup();
    const router = renderPage("/cash-flow?from=2026-02-03&to=2026-03-14");
    await screen.findByTestId("share-line");
    expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2026-02-03", to: "2026-03-14" });
    await user.click(screen.getByRole("button", { name: "My share" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-02-03",
        to: "2026-03-14",
        share: "mine",
      }),
    );
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({
        from: "2026-02-03",
        to: "2026-03-14",
        share: "mine",
      }),
    );
    expect(screen.getByRole("button", { name: "My share" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "FY to date" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-08-14",
        share: "mine",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Everything I can see" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ from: "2026-07-01", to: "2026-08-14" }),
    );
  });

  it("reads share=mine from the URL on a fresh load, with or without a range", async () => {
    renderPage("/cash-flow?share=mine");
    await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({
      from: "2026-07-01",
      to: "2026-09-30",
      share: "mine",
    });
  });

  it("asks for the current quarter without a range and shows the server's four figures", async () => {
    renderPage("/cash-flow");
    expect(await screen.findByRole("heading", { level: 2, name: "Cash flow" })).toBeTruthy();
    const tiles = await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    expect(figure(tiles, "Money in")).toBe(formatCents(512345));
    expect(figure(tiles, "Money out")).toBe(formatCents(300000));
    expect(figure(tiles, "Kept")).toBe(formatCents(212345));
    expect(figure(tiles, "Savings rate")).toBe("41.4%");
    expect(screen.getByTestId("range-label").textContent).toBe("Jul – Sep 2026");
    expect(screen.getByRole("button", { name: "Quarter" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("drops a malformed or reversed range and shows the current quarter", async () => {
    for (const url of [
      "/cash-flow?from=x&to=2026-01-01",
      "/cash-flow?from=2026-03-01&to=2026-02-01",
      "/cash-flow?from=2026-02-30&to=2026-03-01",
      "/cash-flow?from=2026-03-01",
    ]) {
      vi.mocked(api.fetchCashFlow).mockClear();
      renderPage(url);
      await screen.findByTestId("cash-flow-tiles");
      expect(api.fetchCashFlow, url).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" });
      expect(api.fetchCashFlow, url).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("reads the range from the URL, and the control writes it back and refetches", async () => {
    const user = userEvent.setup();
    const router = renderPage("/cash-flow?from=2026-02-03&to=2026-03-14");
    await screen.findByTestId("cash-flow-tiles");
    expect(api.fetchCashFlow).toHaveBeenCalledWith({ from: "2026-02-03", to: "2026-03-14" });
    expect(screen.getByTestId("range-label").textContent).toBe("3 Feb – 14 Mar 2026");
    expect(screen.getByRole("button", { name: "Custom" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "FY to date" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-08-14",
      }),
    );
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2026-07-01", to: "2026-08-14" }),
    );
    await user.click(screen.getByRole("button", { name: "Previous year" }));
    await waitFor(() =>
      expect(api.fetchCashFlow).toHaveBeenLastCalledWith({ from: "2025-07-01", to: "2026-06-30" }),
    );
    expect(screen.getByTestId("range-label").textContent).toBe("FY2026");
  });

  it("shows a savings rate of —% when the server has none", async () => {
    vi.mocked(api.fetchCashFlow).mockImplementation(async (range) => ({
      ...report(range),
      moneyInCents: 0,
      keptCents: -300000,
      savingsRatePermille: null,
    }));
    renderPage("/cash-flow");
    const tiles = await screen.findByTestId("cash-flow-tiles");
    expect(figure(tiles, "Savings rate")).toBe("—%");
  });

  it("says when the figures are unavailable", async () => {
    vi.mocked(api.fetchCashFlow).mockRejectedValue(new Error("offline"));
    renderPage("/cash-flow");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cash flow is unavailable/);
    expect(screen.queryByTestId("cash-flow-tiles")).toBeNull();
  });

  it("renders the P&L table on desktop when toggled, expands groups to show sub-categories, and links to /transactions", async () => {
    const user = userEvent.setup();
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");

    // Toggle to Profit & loss table
    const tableButton = await screen.findByRole("button", { name: "Profit & loss" });
    await user.click(tableButton);

    const pnlTable = await screen.findByTestId("pnl-table");
    expect(pnlTable).toBeTruthy();

    // Verify groups and amounts
    expect(within(pnlTable).getByText("Housing")).toBeTruthy();
    expect(within(pnlTable).getByText(formatCents(200000))).toBeTruthy();
    expect(within(pnlTable).getByText("Food")).toBeTruthy();

    // Expand Housing group to reveal Rent sub-category
    const expandHousing = screen.getByRole("button", { name: "Expand Housing" });
    await user.click(expandHousing);

    const rentLink = await screen.findByRole("link", { name: "Rent" });
    expect(rentLink.getAttribute("href")).toContain("/transactions");
    expect(rentLink.getAttribute("href")).toContain("category=cat-rent");

    // Uncategorised row links with uncategorised=true
    const uncatLinks = screen.getAllByRole("link", { name: "Uncategorised" });
    expect(uncatLinks.length).toBeGreaterThan(0);
    expect(uncatLinks[0]?.getAttribute("href")).toContain("uncategorised=true");
  });

  it("switches bar lists between category, group, and merchant, with drill-through links", async () => {
    const user = userEvent.setup();
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");

    const incomeCard = await screen.findByTestId("income-bar-card");
    const expenseCard = await screen.findByTestId("expense-bar-card");

    // Default: Income by Category, Expense by Group
    expect(within(incomeCard).getByText("Alex Wages")).toBeTruthy();
    expect(within(expenseCard).getByText("Housing")).toBeTruthy();

    // Switch Income to Merchant
    const incomeMerchantBtn = within(incomeCard).getByRole("button", { name: "Merchant" });
    await user.click(incomeMerchantBtn);
    expect(await within(incomeCard).findByText("Acme Corp")).toBeTruthy();
    const acmeLink = within(incomeCard).getByRole("link", { name: "Acme Corp" });
    expect(acmeLink.getAttribute("href")).toContain("payee=payee-employer");

    // Switch Expense to Category
    const expenseCategoryBtn = within(expenseCard).getByRole("button", { name: "Category" });
    await user.click(expenseCategoryBtn);
    expect(await within(expenseCard).findByText("Groceries")).toBeTruthy();
    const grocLink = within(expenseCard).getByRole("link", { name: "Groceries" });
    expect(grocLink.getAttribute("href")).toContain("category=cat-groceries");

    // Switch Expense to Merchant
    const expenseMerchantBtn = within(expenseCard).getByRole("button", { name: "Merchant" });
    await user.click(expenseMerchantBtn);
    expect(await within(expenseCard).findByText("Woolworths")).toBeTruthy();
  });

  it("renders wink rows for hidden transactions in latest transactions", async () => {
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");

    await screen.findByTestId("latest-transactions-card");

    // Normal transaction shows description
    expect(screen.getByText("Woolworths")).toBeTruthy();

    // Hidden transaction renders wink row with mascot, WINK_LINE, hidden label, and omits payee
    const winkRow = await screen.findByTestId("wink-row");
    expect(within(winkRow).getByText(/Shh, it's a surprise/)).toBeTruthy();
    expect(within(winkRow).getByText(/Hidden until 1 September 2026/)).toBeTruthy();
    expect(within(winkRow).queryByText("Secret Present")).toBeNull();
  });

  it("renders Biggest little leaks card with drill-down link to filtered transactions", async () => {
    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");

    const leaksCard = await screen.findByTestId("biggest-little-leaks-card");
    expect(within(leaksCard).getByText("Biggest little leaks")).toBeTruthy();
    expect(within(leaksCard).getByText("Corner Cafe")).toBeTruthy();
    expect(within(leaksCard).getByText("$45.00")).toBeTruthy();

    const tile = within(leaksCard).getByTestId("leak-tile-payee-leak");
    expect(tile.getAttribute("href")).toBe(
      "/transactions?payee=payee-leak&from=2026-07-01&to=2026-09-30",
    );
  });

  it("renders the empty database state when there are no accounts", async () => {
    vi.mocked(api.fetchAccounts).mockResolvedValue([]);
    renderPage("/cash-flow");

    const emptyState = await screen.findByTestId("empty-database-state");
    expect(within(emptyState).getByText("Nothing to sniff at yet")).toBeTruthy();
    expect(within(emptyState).getByRole("button", { name: "Import a bank file" })).toBeTruthy();
    expect(screen.queryByTestId("sankey-card")).toBeNull();
  });

  it("renders the nothing-in-range state when accounts exist but no transactions in range", async () => {
    vi.mocked(api.fetchCashFlow).mockImplementation(async (range) => ({
      ...range,
      moneyInCents: 0,
      moneyOutCents: 0,
      keptCents: 0,
      savingsRatePermille: null,
    }));
    vi.mocked(api.fetchTransactions).mockResolvedValue({
      transactions: [],
      page: { total: 0, pageCount: 0, page: 1, next: null, prev: null },
      summary: { count: 0, inCents: 0, outCents: 0 },
      dayNets: {},
    });

    renderPage("/cash-flow?from=2026-01-01&to=2026-01-31");

    const nothingState = await screen.findByTestId("nothing-in-range-state");
    expect(within(nothingState).getByText("Nothing in this period")).toBeTruthy();
    expect(screen.queryByTestId("sankey-card")).toBeNull();
  });

  it("renders the P&L table directly on phone viewport (< md)", async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event("resize"));

    renderPage("/cash-flow?from=2026-07-01&to=2026-09-30");

    // P&L table is rendered directly, with no Sankey chart canvas or view toggles
    const phoneContainer = await screen.findByTestId("sankey-card-phone");
    expect(phoneContainer).toBeTruthy();
    expect(within(phoneContainer).getByTestId("pnl-table")).toBeTruthy();
    expect(screen.queryByTestId("sankey-chart")).toBeNull();
  });
});

describe("validateCashFlowSearch", () => {
  it("keeps share=mine only, with or without a valid range", () => {
    expect(validateCashFlowSearch({ share: "mine" })).toEqual({ share: "mine" });
    expect(validateCashFlowSearch({ share: "everything" })).toEqual({});
    expect(validateCashFlowSearch({ share: "x", from: "2026-01-01", to: "2026-02-01" })).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(validateCashFlowSearch({ share: "mine", from: "bad", to: "2026-02-01" })).toEqual({
      share: "mine",
    });
  });
});

describe("formatSavingsRate", () => {
  it("shows permille with one decimal", () => {
    expect(formatSavingsRate(373)).toBe("37.3%");
    expect(formatSavingsRate(0)).toBe("0.0%");
    expect(formatSavingsRate(5)).toBe("0.5%");
    expect(formatSavingsRate(-5)).toBe("-0.5%");
    expect(formatSavingsRate(-2500)).toBe("-250.0%");
    expect(formatSavingsRate(1000)).toBe("100.0%");
    expect(formatSavingsRate(null)).toBe("—%");
  });
});

describe("formatPercentOfIncome", () => {
  it("formats positive, negative and zero amounts relative to income", () => {
    expect(formatPercentOfIncome(50000, 100000)).toBe("50.0%");
    expect(formatPercentOfIncome(-20000, 100000)).toBe("-20.0%");
    expect(formatPercentOfIncome(0, 100000)).toBe("0.0%");
    expect(formatPercentOfIncome(50000, 0)).toBe("—%");
    expect(formatPercentOfIncome(50000, -1000)).toBe("—%");
  });
});
