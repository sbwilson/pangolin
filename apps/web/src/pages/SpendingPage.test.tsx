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
import { formatCategoryChange, formatDiffAmount } from "../components/SpendingCategoryBarsCard.tsx";
import { formatCents } from "../lib/money.ts";
import { parseSearch, stringifySearch, validateCashFlowSearch } from "../routes/search.ts";
import { SpendingPage } from "./SpendingPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchSharedShare: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchProfitAndLoss: vi.fn(),
  fetchMerchants: vi.fn(),
  fetchLeaks: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.resetAllMocks();
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

const categoriesList = [
  {
    id: "cat-rent",
    name: "Rent",
    groupId: "grp-housing",
    groupName: "Housing",
    isFixedCost: true,
  },
  {
    id: "cat-groceries",
    name: "Groceries",
    groupId: "grp-food",
    groupName: "Food",
    isFixedCost: false,
  },
  {
    id: "cat-flights",
    name: "Flights",
    groupId: "grp-travel",
    groupName: "Travel",
    isFixedCost: false,
  },
];

const pnlGroupReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "group" as const,
  income: {
    totalCents: 500000,
    rows: [{ id: "grp-salary", name: "Salary", cents: 500000 }],
  },
  expense: {
    totalCents: 444000,
    rows: [
      { id: "grp-housing", name: "Housing", cents: 200000 },
      { id: "grp-travel", name: "Travel", cents: 164000 },
      { id: "grp-food", name: "Food", cents: 80000 },
    ],
  },
  uncategorised: { inCents: 0, outCents: 0 },
});

const pnlCategoryReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "category" as const,
  income: {
    totalCents: 500000,
    rows: [
      {
        id: "cat-wages",
        name: "Salary",
        groupId: "grp-salary",
        groupName: "Salary",
        cents: 500000,
      },
    ],
  },
  expense: {
    totalCents: 444000,
    rows: [
      {
        id: "cat-rent",
        name: "Rent",
        groupId: "grp-housing",
        groupName: "Housing",
        cents: 200000,
      },
      {
        id: "cat-flights",
        name: "Flights",
        groupId: "grp-travel",
        groupName: "Travel",
        cents: 164000,
      },
      {
        id: "cat-groceries",
        name: "Groceries",
        groupId: "grp-food",
        groupName: "Food",
        cents: 80000,
      },
    ],
  },
  uncategorised: { inCents: 0, outCents: 0 },
});

const prevPnlCategoryReport = (range: { from: string; to: string }) => ({
  ...range,
  by: "category" as const,
  income: {
    totalCents: 500000,
    rows: [],
  },
  expense: {
    totalCents: 288600,
    rows: [
      {
        id: "cat-rent",
        name: "Rent",
        groupId: "grp-housing",
        groupName: "Housing",
        cents: 200000,
      },
      {
        id: "cat-groceries",
        name: "Groceries",
        groupId: "grp-food",
        groupName: "Food",
        cents: 88600,
      },
    ],
  },
  uncategorised: { inCents: 0, outCents: 0 },
});

const merchantsIncomeReport = (range: { from: string; to: string }) => ({
  ...range,
  flow: "income" as const,
  totalCents: 500000,
  rows: [
    { payeeId: "payee-employer", payeeName: "Acme Corp", logoAttachmentId: null, cents: 500000 },
  ],
});

const merchantsExpenseReport = (range: { from: string; to: string }) => ({
  ...range,
  flow: "expense" as const,
  totalCents: 444000,
  rows: [
    { payeeId: "payee-landlord", payeeName: "Landlord", logoAttachmentId: null, cents: 200000 },
    { payeeId: "payee-airline", payeeName: "Qantas", logoAttachmentId: null, cents: 164000 },
    { payeeId: "payee-woolies", payeeName: "Woolworths", logoAttachmentId: "att1", cents: 80000 },
  ],
});

function renderPage(url: string) {
  const root = createRootRoute();
  const spendingRoute = createRoute({
    getParentRoute: () => root,
    path: "/spending",
    validateSearch: validateCashFlowSearch,
    component: SpendingPage,
  });
  const transactionsRoute = createRoute({
    getParentRoute: () => root,
    path: "/transactions",
    component: () => <div data-testid="transactions-page">Transactions</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([spendingRoute, transactionsRoute]),
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

describe("SpendingPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 7, 14, 12), toFake: ["Date"] });
    vi.mocked(api.fetchAccounts).mockResolvedValue(accountsList as never);
    vi.mocked(api.fetchCategories).mockResolvedValue(categoriesList as never);
    vi.mocked(api.fetchSharedShare).mockImplementation(async (range) => shareReport(range));
    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async (opts) => {
      if (opts.by === "group") return pnlGroupReport(opts);
      if (opts.from === "2026-07-01") return pnlCategoryReport(opts);
      return prevPnlCategoryReport(opts);
    });
    vi.mocked(api.fetchMerchants).mockImplementation(async (opts) =>
      opts.flow === "income" ? merchantsIncomeReport(opts) : merchantsExpenseReport(opts),
    );
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

  it("renders spending header, share line, bar lists, and category bars on default load", async () => {
    renderPage("/spending");

    // Header
    expect(await screen.findByRole("heading", { name: "Spending", level: 2 })).toBeTruthy();

    // Share line
    const shareLine = await screen.findByTestId("share-line");
    expect(
      within(shareLine).getByText(
        `Your share: ${formatCents(74074)} of ${formatCents(123456)} shared (60%)`,
      ),
    ).toBeTruthy();

    // Bar lists card
    expect(await screen.findByTestId("bar-lists-card")).toBeTruthy();

    // Spending category bars card
    const categoryCard = await screen.findByTestId("spending-category-bars-card");
    expect(categoryCard).toBeTruthy();
    expect(within(categoryCard).getByText("Spending by category")).toBeTruthy();
    const scrollContainer = categoryCard.querySelector('[role="region"]');
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer?.getAttribute("tabIndex")).toBe("0");
    expect(scrollContainer?.getAttribute("role")).toBe("region");
    expect(scrollContainer?.getAttribute("aria-label")).toBe("Category spending breakdown");

    // Biggest little leaks card
    const leaksCard = await screen.findByTestId("biggest-little-leaks-card");
    expect(leaksCard).toBeTruthy();
    expect(within(leaksCard).getByText("Biggest little leaks")).toBeTruthy();
    expect(within(leaksCard).getByText("Corner Cafe")).toBeTruthy();
    const leakTile = within(leaksCard).getByTestId("leak-tile-payee-leak");
    expect(leakTile.getAttribute("href")).toBe(
      "/transactions?payee=payee-leak&from=2026-07-01&to=2026-09-30",
    );
  });

  it("sorts category expense rows descending by amount", async () => {
    renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const categoryCard = await screen.findByTestId("spending-category-bars-card");
    const rows = within(categoryCard).getAllByTestId(/^category-row-/);
    expect(rows).toHaveLength(3);
    const [row1, row2, row3] = rows;
    if (!row1 || !row2 || !row3) throw new Error("Expected 3 rows");

    // Row 1: Rent ($2,000.00)
    expect(within(row1).getByText("Rent")).toBeTruthy();
    expect(within(row1).getByText(formatCents(200000))).toBeTruthy();

    // Row 2: Flights ($1,640.00)
    expect(within(row2).getByText("Flights")).toBeTruthy();
    expect(within(row2).getByText(formatCents(164000))).toBeTruthy();

    // Row 3: Groceries ($800.00)
    expect(within(row3).getByText("Groceries")).toBeTruthy();
    expect(within(row3).getByText(formatCents(80000))).toBeTruthy();
  });

  it("renders flexible tag when isFixedCost is false, and omits it when true", async () => {
    renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const categoryCard = await screen.findByTestId("spending-category-bars-card");

    // Flights is flexible
    const flightsRow = within(categoryCard).getByTestId("category-row-cat-flights");
    expect(within(flightsRow).getByTestId("flexible-badge")).toBeTruthy();
    expect(within(flightsRow).getByText("flexible")).toBeTruthy();

    // Groceries is flexible
    const groceriesRow = within(categoryCard).getByTestId("category-row-cat-groceries");
    expect(within(groceriesRow).getByTestId("flexible-badge")).toBeTruthy();

    // Rent is fixed (isFixedCost === true)
    const rentRow = within(categoryCard).getByTestId("category-row-cat-rent");
    expect(within(rentRow).queryByTestId("flexible-badge")).toBeNull();
  });

  it("displays correct change vs previous period (increase, decrease, same)", async () => {
    renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const categoryCard = await screen.findByTestId("spending-category-bars-card");

    // Rent: 200,000 this quarter vs 200,000 last quarter -> same as last quarter
    const rentChange = within(categoryCard).getByTestId("category-change-cat-rent");
    expect(rentChange.textContent).toBe("same as last quarter");

    // Flights: 164,000 this quarter vs 0 last quarter -> ↑ $1,640
    const flightsChange = within(categoryCard).getByTestId("category-change-cat-flights");
    expect(flightsChange.textContent).toBe("↑ $1,640");

    // Groceries: 80,000 this quarter vs 88,600 last quarter -> ↓ $86
    const groceriesChange = within(categoryCard).getByTestId("category-change-cat-groceries");
    expect(groceriesChange.textContent).toBe("↓ $86");
  });

  it("drills down to transactions when a category row is clicked", async () => {
    const user = userEvent.setup();
    const router = renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const categoryCard = await screen.findByTestId("spending-category-bars-card");
    const groceriesRow = within(categoryCard).getByTestId("category-row-cat-groceries");

    await user.click(groceriesRow);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/transactions");
      expect(router.state.location.search).toEqual({
        category: "cat-groceries",
        from: "2026-07-01",
        to: "2026-09-30",
      });
    });
  });

  it("drills down to transactions with uncategorised=true when uncategorised row is clicked", async () => {
    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async (opts) => {
      if (opts.by === "group") return pnlGroupReport(opts);
      return {
        ...opts,
        by: "category" as const,
        income: { totalCents: 0, rows: [] },
        expense: {
          totalCents: 20000,
          rows: [
            {
              id: null,
              name: null,
              groupId: null,
              groupName: null,
              cents: 20000,
            },
          ],
        },
        uncategorised: { inCents: 0, outCents: 20000 },
      };
    });

    const user = userEvent.setup();
    const router = renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const categoryCard = await screen.findByTestId("spending-category-bars-card");
    const uncatRow = within(categoryCard).getByTestId("category-row-uncategorised");

    await user.click(uncatRow);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/transactions");
      expect(router.state.location.search).toEqual({
        uncategorised: "true",
        from: "2026-07-01",
        to: "2026-09-30",
      });
    });
  });

  it("toggles My share scope and updates URL search", async () => {
    const user = userEvent.setup();
    const router = renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const myShareBtn = await screen.findByRole("button", { name: "My share" });
    await user.click(myShareBtn);

    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-09-30",
        share: "mine",
      });
    });

    const everythingBtn = await screen.findByRole("button", { name: "Everything I can see" });
    await user.click(everythingBtn);

    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        from: "2026-07-01",
        to: "2026-09-30",
      });
    });
  });

  it("renders empty database state when there are 0 accounts", async () => {
    vi.mocked(api.fetchAccounts).mockResolvedValue([]);
    renderPage("/spending");

    const emptyState = await screen.findByTestId("empty-database-state");
    expect(within(emptyState).getByText("Nothing to sniff at yet")).toBeTruthy();
    expect(within(emptyState).getByRole("button", { name: "Import a bank file" })).toBeTruthy();
    expect(screen.queryByTestId("spending-category-bars-card")).toBeNull();
  });

  it("renders nothing in range state when accounts exist but 0 transactions in range", async () => {
    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async (opts) => ({
      ...opts,
      by: opts.by,
      income: { totalCents: 0, rows: [] },
      expense: { totalCents: 0, rows: [] },
      uncategorised: { inCents: 0, outCents: 0 },
    }));

    renderPage("/spending?from=2026-01-01&to=2026-01-31");

    const nothingState = await screen.findByTestId("nothing-in-range-state");
    expect(within(nothingState).getByText("Nothing in this period")).toBeTruthy();
    expect(screen.queryByTestId("spending-category-bars-card")).toBeNull();
  });

  it("renders fallback alert when report query fails", async () => {
    vi.mocked(api.fetchProfitAndLoss).mockRejectedValue(new Error("Server error"));
    renderPage("/spending");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Spending is unavailable. Reload to try again.");
  });

  it("renders fallback alert when previous period query fails", async () => {
    vi.mocked(api.fetchProfitAndLoss).mockImplementation(async (opts) => {
      if (opts.by === "group") return pnlGroupReport(opts);
      if (opts.from === "2026-07-01") return pnlCategoryReport(opts);
      throw new Error("Previous period failed");
    });
    renderPage("/spending?from=2026-07-01&to=2026-09-30");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Spending is unavailable. Reload to try again.");
    expect(screen.queryByTestId("spending-category-bars-card")).toBeNull();
  });
});

describe("formatDiffAmount & formatCategoryChange helpers", () => {
  it("formats diff amounts to whole dollars", () => {
    expect(formatDiffAmount(8600)).toBe("$86");
    expect(formatDiffAmount(164000)).toBe("$1,640");
    expect(formatDiffAmount(0)).toBe("$0");
  });

  it("formats sub-dollar diffs as same as last quarter rather than ↑ $0", () => {
    const range = { from: "2026-07-01", to: "2026-09-30" };
    const today = "2026-08-14";

    expect(formatCategoryChange(10040, 10000, range, today)).toBe("same as last quarter");
    expect(formatCategoryChange(10000, 10040, range, today)).toBe("same as last quarter");
  });

  it("formats quarter change with proper direction and text", () => {
    const range = { from: "2026-07-01", to: "2026-09-30" };
    const today = "2026-08-14";

    expect(formatCategoryChange(271800, 280400, range, today)).toBe("↓ $86");
    expect(formatCategoryChange(164000, 0, range, today)).toBe("↑ $1,640");
    expect(formatCategoryChange(936000, 936000, range, today)).toBe("same as last quarter");
  });

  it("formats custom range zero diff as same as last period", () => {
    const range = { from: "2026-08-01", to: "2026-08-10" };
    const today = "2026-08-14";

    expect(formatCategoryChange(1000, 1000, range, today)).toBe("same as last period");
  });
});
