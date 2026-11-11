// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { SessionContext } from "../session.tsx";
import { BudgetsPage } from "./BudgetsPage.tsx";

vi.mock("../api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.ts")>();
  return {
    ...actual,
    fetchBudgetSummaries: vi.fn(),
    fetchCategories: vi.fn(),
    fetchCategoryGroups: vi.fn(),
    fetchSuggestedLimit: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
    listAccounts: vi.fn(),
    fetchRecurringSeries: vi.fn(),
    fetchPayees: vi.fn(),
    confirmRecurringSeries: vi.fn(),
    rejectRecurringSeries: vi.fn(),
    createRecurringSeries: vi.fn(),
    deleteRecurringSeries: vi.fn(),
    detectRecurringBills: vi.fn(),
  };
});

const simonMe: api.Me = {
  personId: "person-simon",
  displayName: "Simon",
  colour: "#2C6681",
  authAt: "2026-10-05T00:00:00Z",
  canInvite: false,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 10 },
  partner: { personId: "person-carissa", displayName: "Carissa" },
};

const sampleSummaries: api.BudgetSummaryData[] = [
  {
    budget: {
      id: "b-eating-out",
      personId: null, // Shared
      categoryId: "cat-eating-out",
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 40000,
      rollover: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    period: {
      start: "2026-09-24",
      end: "2026-10-07",
    },
    spentCents: 46000,
    remainingCents: -6000,
    paceCents: 20000,
    projectedCents: 92000,
    rolloverCents: 0,
    effectiveLimitCents: 40000,
    status: "over-budget",
  },
  {
    budget: {
      id: "b-groceries",
      personId: null, // Shared
      categoryId: "cat-groceries",
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 60000,
      rollover: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    period: {
      start: "2026-09-24",
      end: "2026-10-07",
    },
    spentCents: 28000,
    remainingCents: 32000,
    paceCents: 30000,
    projectedCents: 56000,
    rolloverCents: 0,
    effectiveLimitCents: 60000,
    status: "on-track",
  },
  {
    budget: {
      id: "b-transport",
      personId: "person-simon", // Personal Simon
      categoryId: "cat-transport",
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 18000,
      rollover: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    period: {
      start: "2026-09-24",
      end: "2026-10-07",
    },
    spentCents: 14000,
    remainingCents: 4000,
    paceCents: 9000,
    projectedCents: 28000,
    rolloverCents: 0,
    effectiveLimitCents: 18000,
    status: "heading-over",
  },
  {
    budget: {
      id: "b-lifestyle",
      personId: "person-simon", // Personal Simon
      categoryId: null,
      categoryGroupId: "grp-lifestyle",
      fundingAccountId: null,
      cadence: "month",
      limitCents: 25000,
      rollover: true,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
    period: {
      start: "2026-09-16",
      end: "2026-10-15",
    },
    spentCents: 8200,
    remainingCents: 16800,
    paceCents: 12500,
    projectedCents: 16400,
    rolloverCents: 4000,
    effectiveLimitCents: 29000,
    status: "on-track",
  },
];

function renderPage(initialUrl = "/planning/budgets") {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/planning/budgets",
    component: BudgetsPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
    isServer: false,
    origin: "http://localhost",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const session = {
    me: simonMe,
    signOut: vi.fn(),
    refresh: vi.fn(),
    signedIn: vi.fn(),
    signedUp: vi.fn(),
    token: "",
  };

  render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionContext.Provider>,
  );
  return { router, client };
}

describe("BudgetsPage", () => {
  beforeEach(() => {
    vi.mocked(api.fetchBudgetSummaries).mockResolvedValue(sampleSummaries);
    vi.mocked(api.fetchCategories).mockResolvedValue([
      {
        id: "cat-eating-out",
        name: "Eating out",
        groupId: "grp-living",
        groupName: "Daily Living",
      },
      { id: "cat-groceries", name: "Groceries", groupId: "grp-living", groupName: "Daily Living" },
      { id: "cat-transport", name: "Transport", groupId: "grp-living", groupName: "Daily Living" },
    ]);
    vi.mocked(api.fetchCategoryGroups).mockResolvedValue([
      { id: "grp-lifestyle", name: "Lifestyle", kind: "expense" },
      { id: "grp-living", name: "Daily Living", kind: "expense" },
    ]);
    vi.mocked(api.listAccounts).mockResolvedValue([
      {
        id: "acc-1",
        name: "Everyday",
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        institutionId: null,
        openedOn: "2026-01-01",
        closedOn: null,
        isSavings: false,
        pool: "shared",
        owners: [{ personId: "person-simon", shareBp: 10000 }],
        lastImport: {
          through: "2026-09-30",
          source: "cba",
          importedAt: "2026-09-30T21:14:00Z",
        },
      },
    ]);
    vi.mocked(api.fetchSuggestedLimit).mockResolvedValue(18500);
    vi.mocked(api.fetchRecurringSeries).mockResolvedValue([]);
    vi.mocked(api.fetchPayees).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders page header, summary line, and all budget cards", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Eating out")).toBeTruthy();
    });

    // Header greeting
    expect(screen.getByText("G’day, Simon")).toBeTruthy();

    // Summary line
    const summaryLine = screen.getByTestId("budget-summary-line");
    expect(summaryLine.textContent).toContain("4 budgets you can see");
    expect(summaryLine.textContent).toContain("1 over");
    expect(summaryLine.textContent).toContain("1 heading over");
    expect(summaryLine.textContent).toContain("2 on track");

    // Cards rendered
    expect(screen.getByText("Eating out")).toBeTruthy();
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
    expect(screen.getByText("Lifestyle")).toBeTruthy();

    // Over budget card warning banner
    expect(screen.getByText("Eating out’s had a big fortnight.")).toBeTruthy();
    expect(screen.getByText("Open in Needs review")).toBeTruthy();
  });

  it("filters cards when toggling Shared, Personal, and All", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Eating out")).toBeTruthy();
    });

    // Click "Shared" filter
    const sharedFilterBtn = screen.getByRole("button", { name: "Shared" });
    await user.click(sharedFilterBtn);

    // Eating out and Groceries are shared
    expect(screen.getByText("Eating out")).toBeTruthy();
    expect(screen.getByText("Groceries")).toBeTruthy();
    // Transport and Lifestyle are personal
    expect(screen.queryByText("Transport")).toBeNull();
    expect(screen.queryByText("Lifestyle")).toBeNull();

    // Click "Personal" filter
    const personalFilterBtn = screen.getByRole("button", { name: "Personal" });
    await user.click(personalFilterBtn);

    expect(screen.queryByText("Eating out")).toBeNull();
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(screen.getByText("Transport")).toBeTruthy();
    expect(screen.getByText("Lifestyle")).toBeTruthy();

    // Click "All"
    const allFilterBtn = screen.getByRole("button", { name: "All" });
    await user.click(allFilterBtn);

    expect(screen.getByText("Eating out")).toBeTruthy();
    expect(screen.getByText("Lifestyle")).toBeTruthy();
  });

  it("opens the Budget editor modal on 'New budget' and pre-fills suggested limit", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("New budget")).toBeTruthy();
    });

    // Click New budget
    const newBudgetBtn = screen.getByRole("button", { name: /New budget/i });
    await user.click(newBudgetBtn);

    // Sheet is opened
    expect(screen.getByRole("dialog", { name: "New budget" })).toBeTruthy();

    // Select category "Groceries"
    const select = screen.getByLabelText("Category");
    await user.selectOptions(select, "cat-groceries");

    // Suggested limit should load and display helper
    await waitFor(() => {
      expect(screen.getByText(/You’ve averaged \$185\.00 a fortnight\./i)).toBeTruthy();
    });

    // Limit input should have prefilled 185
    const limitInput = screen.getByLabelText("Limit") as HTMLInputElement;
    expect(limitInput.value).toBe("185");

    // Fill in and submit
    vi.mocked(api.createBudget).mockResolvedValueOnce({
      id: "b-new",
      personId: null,
      categoryId: "cat-groceries",
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 18500,
      rollover: false,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(api.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "cat-groceries",
          cadence: "fortnight",
          limitCents: 18500,
        }),
      );
    });
  });

  it("opens the Budget editor modal on card edit button and updates budget", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Edit Eating out budget")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit Eating out budget");
    await user.click(editBtn);

    expect(screen.getByRole("dialog", { name: "Edit budget" })).toBeTruthy();

    // Change limit input to 450
    const limitInput = screen.getByLabelText("Limit");
    await user.clear(limitInput);
    await user.type(limitInput, "450");

    vi.mocked(api.updateBudget).mockResolvedValueOnce({
      ...sampleSummaries[0]?.budget,
      limitCents: 45000,
    } as api.BudgetData);

    const saveBtn = screen.getByRole("button", { name: "Save" });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(api.updateBudget).toHaveBeenCalledWith(
        "b-eating-out",
        expect.objectContaining({
          limitCents: 45000,
        }),
      );
    });
  });

  it("renders empty state when there are no budgets", async () => {
    vi.mocked(api.fetchBudgetSummaries).mockResolvedValueOnce([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Nothing to sniff at yet")).toBeTruthy();
    });

    expect(
      screen.getByText(
        "Set limits on your categories or groups to track spending pace across pay cycles.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create your first budget/i })).toBeTruthy();
  });

  it("renders recurring bills section with candidates, active bills, and allows one-click confirmation", async () => {
    const user = userEvent.setup();
    const candidateSeries: api.RecurringSeriesData = {
      id: "series-cand-1",
      accountId: "acc-1",
      payeeId: "payee-1",
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-10-15",
      status: "candidate",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    const confirmedSeries: api.RecurringSeriesData = {
      id: "series-conf-1",
      accountId: "acc-1",
      payeeId: "payee-2",
      direction: "bill",
      cadence: "weekly",
      expectedCents: 4500,
      toleranceBp: 1500,
      nextDueOn: "2026-10-08",
      status: "confirmed",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    vi.mocked(api.fetchRecurringSeries).mockResolvedValue([candidateSeries, confirmedSeries]);
    vi.mocked(api.fetchPayees).mockResolvedValue([
      { id: "payee-1", name: "Netflix" },
      { id: "payee-2", name: "Gym Membership" },
    ]);
    vi.mocked(api.confirmRecurringSeries).mockResolvedValue({
      ...candidateSeries,
      status: "confirmed",
    });

    renderPage();

    // Verify candidates section and bills rendered
    await waitFor(() => {
      expect(screen.getByText("Netflix")).toBeTruthy();
      expect(screen.getByText("Gym Membership")).toBeTruthy();
    });

    expect(screen.getByText("Detected candidates (1)")).toBeTruthy();
    expect(screen.getByText("Active bills (1)")).toBeTruthy();

    // One-click confirm
    const confirmBtn = screen.getByRole("button", { name: /Confirm bill/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.confirmRecurringSeries).toHaveBeenCalledWith("series-cand-1");
    });
  });
});
