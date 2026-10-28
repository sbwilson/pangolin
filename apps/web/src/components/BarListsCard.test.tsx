// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MerchantsReport, ProfitAndLossReport } from "../api.ts";
import { BarListsCard } from "./BarListsCard.tsx";

afterEach(() => {
  cleanup();
});

function renderWithRouter(ui: React.ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => ui,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  return render(<RouterProvider router={router} />);
}

const range = { from: "2026-09-01", to: "2026-09-30" };

const emptySide = {
  totalCents: 0,
  rows: [] as { id: null; name: null; cents: number; groupId: null; groupName: null }[],
};

const pnl = (expenseRows: ProfitAndLossReport["expense"]["rows"]): ProfitAndLossReport =>
  ({
    ...range,
    by: "group",
    income: emptySide,
    expense: { totalCents: 300, rows: expenseRows },
    uncategorised: { inCents: 0, outCents: 0 },
  }) as ProfitAndLossReport;

const merchants = (rows: MerchantsReport["rows"]): MerchantsReport =>
  ({ ...range, flow: "expense", totalCents: 300, rows }) as MerchantsReport;

describe("BarListsCard", () => {
  it("shows the stored logo, the payee initial and no box on the merchant tab", async () => {
    renderWithRouter(
      <BarListsCard
        pnlGroup={pnl([])}
        pnlCategory={pnl([])}
        incomeMerchants={merchants([])}
        expenseMerchants={merchants([
          { payeeId: "p-logo", payeeName: "Woolworths", logoAttachmentId: "a1", cents: 200 },
          { payeeId: "p-initial", payeeName: "Qantas", logoAttachmentId: null, cents: 100 },
          { payeeId: null, payeeName: null, logoAttachmentId: null, cents: 50 },
        ])}
        range={range}
      />,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Merchant" }))[1] as HTMLElement);

    const logoRow = screen.getByTestId("expense-bar-row-p-logo");
    expect(within(logoRow).getByTestId("merchant-logo-img").getAttribute("src")).toBe(
      "/api/payees/p-logo/logo",
    );
    const initialRow = screen.getByTestId("expense-bar-row-p-initial");
    expect(within(initialRow).getByTestId("merchant-logo-initial").textContent).toBe("Q");
    const unknownRow = screen.getByTestId("expense-bar-row-null");
    expect(within(unknownRow).queryByTestId("merchant-logo-img")).toBeNull();
    expect(within(unknownRow).queryByTestId("merchant-logo-initial")).toBeNull();
  });
});
