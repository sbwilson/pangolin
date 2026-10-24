// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetWorthReport } from "../api.ts";
import * as api from "../api.ts";
import { ImportProvider } from "../components/import/index.ts";
import { type Session, SessionContext } from "../session.tsx";
import { NetWorthPage } from "./NetWorthPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchNetWorth: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
});

const me: api.Me = {
  personId: "p-simon",
  displayName: "Simon",
  colour: "#2C6681",
  authAt: "2026-10-05T00:00:00Z",
  canInvite: false,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 10 },
  partner: { personId: "p-carissa", displayName: "Carissa" },
};

const session: Session = {
  me,
  signOut: vi.fn(),
  refresh: vi.fn(),
  signedIn: vi.fn(),
  signedUp: vi.fn(),
  token: "",
};

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const sampleReport: NetWorthReport = {
  asOf: "2026-10-05",
  netWorthCents: 33_320_534, // $333,205.34
  assetsCents: 82_773_055, // $827,730.55
  liabilitiesCents: -49_452_521, // -$494,525.21
  subtotals: {
    cashCents: 713_055, // $7,130.55
    savingsCents: 6_060_000, // $60,600.00
    loansCents: -49_324_061, // -$493,240.61
    cardsCents: -128_460, // -$1,284.60
  },
  subtotalsByType: {
    transaction: 713_055,
    savings: 6_060_000,
    offset: 0,
    credit_card: -128_460,
    home_loan: -49_324_061,
  },
  trend: [
    {
      date: "2025-11-30",
      netWorthCents: 28_050_000,
      assetsCents: 75_000_000,
      liabilitiesCents: -46_950_000,
    },
    {
      date: "2025-12-31",
      netWorthCents: 28_500_000,
      assetsCents: 76_000_000,
      liabilitiesCents: -47_500_000,
    },
    {
      date: "2026-01-31",
      netWorthCents: 29_000_000,
      assetsCents: 77_000_000,
      liabilitiesCents: -48_000_000,
    },
    {
      date: "2026-02-28",
      netWorthCents: 29_500_000,
      assetsCents: 78_000_000,
      liabilitiesCents: -48_500_000,
    },
    {
      date: "2026-03-31",
      netWorthCents: 30_000_000,
      assetsCents: 79_000_000,
      liabilitiesCents: -49_000_000,
    },
    {
      date: "2026-04-30",
      netWorthCents: 30_500_000,
      assetsCents: 80_000_000,
      liabilitiesCents: -49_500_000,
    },
    {
      date: "2026-05-31",
      netWorthCents: 31_000_000,
      assetsCents: 80_500_000,
      liabilitiesCents: -49_500_000,
    },
    {
      date: "2026-06-30",
      netWorthCents: 31_500_000,
      assetsCents: 81_000_000,
      liabilitiesCents: -49_500_000,
    },
    {
      date: "2026-07-31",
      netWorthCents: 32_000_000,
      assetsCents: 81_500_000,
      liabilitiesCents: -49_500_000,
    },
    {
      date: "2026-08-31",
      netWorthCents: 32_500_000,
      assetsCents: 82_000_000,
      liabilitiesCents: -49_500_000,
    },
    {
      date: "2026-09-30",
      netWorthCents: 32_898_634,
      assetsCents: 82_350_000,
      liabilitiesCents: -49_451_366,
    },
    {
      date: "2026-10-05",
      netWorthCents: 33_320_534,
      assetsCents: 82_773_055,
      liabilitiesCents: -49_452_521,
    },
  ],
  accounts: [
    {
      id: "a-everyday",
      name: "Everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: "i-commbank",
      institutionName: "CommBank",
      openedOn: null,
      closedOn: null,
      isSavings: false,
      owners: [{ personId: "p-simon", shareBp: 10000 }],
      pool: "p-simon",
      balanceCents: 482_015,
      lastImport: { through: "2026-09-30", source: "csv", importedAt: "2026-10-05T09:14:00Z" },
    },
    {
      id: "a-bills",
      name: "Shared bills",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: "i-commbank",
      institutionName: "CommBank",
      openedOn: null,
      closedOn: null,
      isSavings: false,
      owners: [
        { personId: "p-simon", shareBp: 5000 },
        { personId: "p-carissa", shareBp: 5000 },
      ],
      pool: "shared",
      balanceCents: 231_040,
      lastImport: { through: "2026-09-30", source: "csv", importedAt: "2026-10-05T09:14:00Z" },
    },
    {
      id: "a-saver",
      name: "House deposit saver",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      institutionId: "i-ing",
      institutionName: "ING",
      openedOn: null,
      closedOn: null,
      isSavings: true,
      owners: [
        { personId: "p-simon", shareBp: 5000 },
        { personId: "p-carissa", shareBp: 5000 },
      ],
      pool: "shared",
      balanceCents: 4_820_000,
      lastImport: { through: "2026-09-30", source: "ofx", importedAt: "2026-10-05T09:14:00Z" },
    },
    {
      id: "a-private-saver",
      name: "Simon's saver",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      institutionId: "i-ing",
      institutionName: "ING",
      openedOn: null,
      closedOn: null,
      isSavings: true,
      owners: [{ personId: "p-simon", shareBp: 10000 }],
      pool: "p-simon",
      balanceCents: 1_240_000,
      lastImport: { through: daysAgo(50), source: "ofx", importedAt: "2026-08-18T10:00:00Z" },
    },
    {
      id: "a-loan",
      name: "Investment home loan",
      type: "home_loan",
      currency: "AUD",
      isPrivate: false,
      institutionId: "i-commbank",
      institutionName: "CommBank",
      openedOn: null,
      closedOn: null,
      isSavings: false,
      owners: [{ personId: "p-simon", shareBp: 10000 }],
      pool: "p-simon",
      balanceCents: -49_324_061,
      lastImport: { through: "2026-09-30", source: "csv", importedAt: "2026-10-05T09:14:00Z" },
    },
    {
      id: "a-card",
      name: "Low Rate card",
      type: "credit_card",
      currency: "AUD",
      isPrivate: false,
      institutionId: "i-commbank",
      institutionName: "CommBank",
      openedOn: null,
      closedOn: null,
      isSavings: false,
      owners: [{ personId: "p-simon", shareBp: 10000 }],
      pool: "p-simon",
      balanceCents: -128_460,
      lastImport: { through: "2026-09-30", source: "csv", importedAt: "2026-10-05T09:14:00Z" },
    },
  ],
  latestImport: { through: "2026-09-30", source: "csv", importedAt: "2026-10-05T09:14:00Z" },
};

function renderPage() {
  const root = createRootRoute({ component: NetWorthPage });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/net-worth"] }),
    isServer: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        <ImportProvider>
          <RouterProvider router={router} />
        </ImportProvider>
      </QueryClientProvider>
    </SessionContext.Provider>,
  );
}

describe("NetWorthPage component", () => {
  it("renders 3-up KPIs, Assets and Liabilities cards with subtotals matching hand sum", async () => {
    vi.mocked(api.fetchNetWorth).mockResolvedValue(sampleReport);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("kpi-net-worth")).toBeTruthy();
    });

    // KPI values
    expect(screen.getByTestId("kpi-net-worth").textContent).toBe("$333,205.34");
    expect(screen.getByTestId("kpi-assets").textContent).toBe("$827,730.55");
    expect(screen.getByTestId("kpi-liabilities").textContent).toBe("-$494,525.21");

    // KPI note comparison: up $4,219 since September
    expect(screen.getByText(/Up \$4,219\.00 since September\./)).toBeTruthy();

    // Assets Card and Subtotals
    const assetsCard = screen.getByTestId("assets-card");
    expect(assetsCard.textContent).toContain("$827,730.55");
    expect(assetsCard.textContent).toContain("$7,130.55"); // Cash subtotal
    expect(assetsCard.textContent).toContain("$60,600.00"); // Savings subtotal

    // Liabilities Card and Subtotals
    const liabilitiesCard = screen.getByTestId("liabilities-card");
    expect(liabilitiesCard.textContent).toContain("-$494,525.21");
    expect(liabilitiesCard.textContent).toContain("-$493,240.61"); // Loans subtotal
    expect(liabilitiesCard.textContent).toContain("-$1,284.60"); // Cards subtotal

    // Accounts rendered
    expect(screen.getByText("Everyday")).toBeTruthy();
    expect(screen.getByText("Shared bills")).toBeTruthy();
    expect(screen.getByText("House deposit saver")).toBeTruthy();
    expect(screen.getByText("Simon's saver")).toBeTruthy();
    expect(screen.getByText("Investment home loan")).toBeTruthy();
    expect(screen.getByText("Low Rate card")).toBeTruthy();
  });

  it("toggles between trend chart and trend table", async () => {
    vi.mocked(api.fetchNetWorth).mockResolvedValue(sampleReport);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("net-worth-chart")).toBeTruthy();
    });

    const toggle = screen.getByTestId("trend-view-toggle");
    expect(toggle.textContent).toBe("View as table");

    // Click toggle to show table
    await user.click(toggle);

    expect(screen.queryByTestId("net-worth-chart")).toBeNull();
    const table = screen.getByTestId("net-worth-table");
    expect(table).toBeTruthy();
    expect(table.getAttribute("tabIndex")).toBe("0");
    expect(table.getAttribute("role")).toBe("region");
    expect(table.getAttribute("aria-label")).toBe("12-month net worth trend");
    expect(toggle.textContent).toBe("View as chart");

    // Table has 12 rows, most recent first (October 2026)
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBe(12);
    expect(rows[0]?.textContent).toContain("October 2026");
    const monthHeader = rows[0]?.querySelector("th[scope='row']");
    expect(monthHeader).toBeTruthy();
    expect(monthHeader?.textContent).toContain("October 2026");

    // Click toggle back to chart
    await user.click(toggle);
    expect(screen.getByTestId("net-worth-chart")).toBeTruthy();
  });

  it("displays stale indicator and allows clicking Import shortcut", async () => {
    vi.mocked(api.fetchNetWorth).mockResolvedValue(sampleReport);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Simon's saver")).toBeTruthy();
    });

    const privateSaverRow = screen.getByTestId("account-row-a-private-saver");
    const importBtn = privateSaverRow.querySelector("button");
    expect(importBtn).toBeTruthy();
    expect(importBtn?.getAttribute("aria-label")).toBe("Import statement for Simon's saver");
    if (importBtn) {
      await user.click(importBtn);
    }
    expect(screen.getByText("Import a bank file")).toBeTruthy();
  });

  it("displays lock icon with aria-label on private accounts owned by viewer", async () => {
    vi.mocked(api.fetchNetWorth).mockResolvedValue(sampleReport);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Simon's saver")).toBeTruthy();
    });

    const privateSaverRow = screen.getByTestId("account-row-a-private-saver");
    const lock = privateSaverRow.querySelector('[aria-label="Private"]');
    expect(lock).toBeTruthy();

    // Verify account name is a Link to /accounts/$id
    const link = privateSaverRow.querySelector('a[href="/accounts/a-private-saver"]');
    expect(link).toBeTruthy();
  });

  it("renders disabled forecast link card", async () => {
    vi.mocked(api.fetchNetWorth).mockResolvedValue(sampleReport);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("forecast-card")).toBeTruthy();
    });

    const forecastLink = screen.getByText("Where will we be in 2 years? →");
    expect(forecastLink.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders empty state when viewer has zero accounts", async () => {
    const emptyReport: NetWorthReport = {
      asOf: "2026-10-05",
      netWorthCents: 0,
      assetsCents: 0,
      liabilitiesCents: 0,
      subtotals: { cashCents: 0, savingsCents: 0, loansCents: 0, cardsCents: 0 },
      subtotalsByType: { transaction: 0, savings: 0, offset: 0, credit_card: 0, home_loan: 0 },
      trend: [],
      accounts: [],
      latestImport: null,
    };
    vi.mocked(api.fetchNetWorth).mockResolvedValue(emptyReport);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("net-worth-empty")).toBeTruthy();
    });

    expect(screen.getByText("Nothing to calculate yet")).toBeTruthy();
    expect(screen.queryByTestId("net-worth-kpis")).toBeNull();
  });
});
