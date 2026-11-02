// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api.ts";
import { BillAlertCard } from "./BillAlertCard.tsx";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

vi.mock("../../api.ts", async () => {
  const actual = await vi.importActual<typeof import("../../api.ts")>("../../api.ts");
  return {
    ...actual,
    dismissBillAlert: vi.fn(),
  };
});

function renderCard(
  card: api.ReviewCard,
  detail: Extract<api.ReviewDetail, { type: "bill_alert" }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <ul>
            <BillAlertCard card={card} detail={detail} />
          </ul>
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  return render(<RouterProvider router={router} />);
}

describe("BillAlertCard", () => {
  const mockMissedCard: api.ReviewCard = {
    id: "card-missed-1",
    kind: "planning.bill_alert.missed_payment",
    createdAt: "2026-04-18T12:00:00Z",
    accountId: "acc-1",
    detail: {
      type: "bill_alert",
      seriesId: "series-1",
      payeeId: "payee-1",
      payeeName: "Netflix",
      accountName: "Joint Everyday",
      cadence: "monthly",
      expectedCents: 1999,
      dueDate: "2026-04-10",
      kind: "missed",
    },
  };

  const mockPriceRiseCard: api.ReviewCard = {
    id: "card-rise-1",
    kind: "planning.bill_alert.price_rise",
    createdAt: "2026-04-18T12:00:00Z",
    accountId: "acc-1",
    detail: {
      type: "bill_alert",
      seriesId: "series-2",
      payeeId: "payee-2",
      payeeName: "EnergyAustralia",
      accountName: "Joint Everyday",
      cadence: "quarterly",
      expectedCents: 10000,
      actualCents: 11400,
      increasePct: 14,
      dueDate: "2026-04-10",
      kind: "price_rise",
      transactionId: "txn-1",
    },
  };

  it("renders missed bill payment alert with heading, description, and actions", async () => {
    const detail = mockMissedCard.detail as Extract<api.ReviewDetail, { type: "bill_alert" }>;
    renderCard(mockMissedCard, detail);

    expect(await screen.findByText("Missed bill payment")).toBeTruthy();
    expect(screen.getByText("Netflix didn't turn up this month")).toBeTruthy();
    expect(
      screen.getByText(
        "Netflix payment of $19.99 expected by 2026-04-10 was not found in Joint Everyday.",
      ),
    ).toBeTruthy();

    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "View transactions" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toContain("payee=payee-1");
    expect(screen.getByRole("link", { name: "Open bill" })).toBeTruthy();
  });

  it("renders price rise alert with percentage, amounts, and actions", async () => {
    const detail = mockPriceRiseCard.detail as Extract<api.ReviewDetail, { type: "bill_alert" }>;
    renderCard(mockPriceRiseCard, detail);

    expect(await screen.findByText("Bill price increase")).toBeTruthy();
    expect(screen.getByText("EnergyAustralia is up 14% ($114.00 vs $100.00)")).toBeTruthy();
    expect(
      screen.getByText(
        "Payment of $114.00 was detected for EnergyAustralia (previously expected $100.00) in Joint Everyday.",
      ),
    ).toBeTruthy();
  });

  it("calls dismissBillAlert when 'Got it' is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.dismissBillAlert).mockResolvedValue(undefined);

    const detail = mockMissedCard.detail as Extract<api.ReviewDetail, { type: "bill_alert" }>;
    renderCard(mockMissedCard, detail);

    const gotItBtn = await screen.findByRole("button", { name: "Got it" });
    await user.click(gotItBtn);

    expect(api.dismissBillAlert).toHaveBeenCalledWith("card-missed-1");
  });
});
