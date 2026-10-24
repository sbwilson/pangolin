// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LeakMerchant } from "../api.ts";
import { BiggestLittleLeaksCard } from "./BiggestLittleLeaksCard.tsx";

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

describe("BiggestLittleLeaksCard", () => {
  const range = { from: "2026-07-01", to: "2026-09-30" };

  it("renders empty state when there are no qualifying leaks", async () => {
    renderWithRouter(<BiggestLittleLeaksCard leaks={[]} range={range} />);

    expect(await screen.findByText("Biggest little leaks")).not.toBeNull();
    expect(await screen.findByText("No little leaks found in this period")).not.toBeNull();
  });

  it("renders qualifying leak tiles with details and drill links without category tags", async () => {
    const leaks: LeakMerchant[] = [
      {
        payeeId: "payee-1",
        payeeName: "Corner Cafe",
        count: 10,
        totalCents: 9255,
        medianCents: 920,
      },
      {
        payeeId: "payee-2",
        payeeName: "Quick Stop Newsagent",
        count: 6,
        totalCents: 4500,
        medianCents: 750,
      },
    ];

    renderWithRouter(<BiggestLittleLeaksCard leaks={leaks} range={range} />);

    expect(await screen.findByText("Corner Cafe")).not.toBeNull();
    expect(await screen.findByText("$92.55")).not.toBeNull();
    expect(await screen.findByText("10 txns")).not.toBeNull();
    expect(await screen.findByText("~$9.20 med")).not.toBeNull();

    expect(await screen.findByText("Quick Stop Newsagent")).not.toBeNull();
    expect(await screen.findByText("$45.00")).not.toBeNull();
    expect(await screen.findByText("6 txns")).not.toBeNull();
    expect(await screen.findByText("~$7.50 med")).not.toBeNull();

    // Verify links
    const cafeLink = await screen.findByTestId("leak-tile-payee-1");
    expect(cafeLink.getAttribute("href")).toBe(
      "/transactions?payee=payee-1&from=2026-07-01&to=2026-09-30",
    );

    // Verify no flexible category tags exist
    expect(screen.queryByText(/flexible/i)).toBeNull();
  });
});
