// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LedgerTransaction } from "../api.ts";
import { LatestTransactionsCard } from "./LatestTransactionsCard.tsx";

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

const txn = (over: Partial<LedgerTransaction>): LedgerTransaction =>
  ({
    id: "t1",
    accountId: "acc1",
    postedOn: "2026-09-10",
    amountCents: -1200,
    descriptionRaw: "Woolies checkout",
    status: "posted",
    notes: null,
    nameHidden: false,
    nameHiddenBy: null,
    nameHiddenUntil: null,
    remainingCents: 0,
    splits: [],
    payeeId: null,
    payeeName: null,
    logoAttachmentId: null,
    ...over,
  }) as LedgerTransaction;

describe("LatestTransactionsCard", () => {
  it("shows the logo on a row whose payee has one", async () => {
    renderWithRouter(
      <LatestTransactionsCard
        transactions={[txn({ payeeId: "p1", payeeName: "Woolworths", logoAttachmentId: "a1" })]}
        range={{ from: "2026-09-01", to: "2026-09-30" }}
      />,
    );
    const card = await screen.findByTestId("latest-transactions-card");
    expect(card.querySelector('[data-testid="merchant-logo-img"]')?.getAttribute("src")).toBe(
      "/api/payees/p1/logo",
    );
  });

  it("shows the payee initial when there is no logo", async () => {
    renderWithRouter(
      <LatestTransactionsCard
        transactions={[txn({ payeeId: "p1", payeeName: "Qantas" })]}
        range={{ from: "2026-09-01", to: "2026-09-30" }}
      />,
    );
    await screen.findByTestId("latest-transactions-card");
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("Q");
  });

  it("falls back to the description initial without a payee", async () => {
    renderWithRouter(
      <LatestTransactionsCard
        transactions={[txn({ descriptionRaw: "coff" })]}
        range={{ from: "2026-09-01", to: "2026-09-30" }}
      />,
    );
    await screen.findByTestId("latest-transactions-card");
    expect(screen.getByTestId("merchant-logo-initial").textContent).toBe("C");
  });

  it("keeps the hidden-name mascot row without a logo box", async () => {
    renderWithRouter(
      <LatestTransactionsCard
        transactions={[
          txn({
            nameHidden: true,
            descriptionRaw: "Hidden until 31 Dec 2026",
            nameHiddenUntil: "2026-12-31T00:00:00.000Z",
          }),
        ]}
        range={{ from: "2026-09-01", to: "2026-09-30" }}
      />,
    );
    await screen.findByTestId("latest-transactions-card");
    expect(screen.getByTestId("wink-row")).toBeDefined();
    expect(screen.queryByTestId("merchant-logo-img")).toBeNull();
    expect(screen.queryByTestId("merchant-logo-initial")).toBeNull();
  });
});
