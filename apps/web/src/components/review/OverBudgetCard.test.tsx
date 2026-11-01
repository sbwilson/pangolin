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
import { OverBudgetCard } from "./OverBudgetCard.tsx";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

vi.mock("../../api.ts", async () => {
  const actual = await vi.importActual<typeof import("../../api.ts")>("../../api.ts");
  return {
    ...actual,
    dismissBudgetReviewItem: vi.fn(),
    adjustBudgetLimitFromReview: vi.fn(),
  };
});

function renderCard(card: api.ReviewCard, detail: Extract<api.ReviewDetail, { type: "budget" }>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <ul>
            <OverBudgetCard card={card} detail={detail} />
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

describe("OverBudgetCard", () => {
  const mockCard: api.ReviewCard = {
    id: "card-1",
    kind: "planning.over_budget",
    createdAt: "2026-10-08T12:00:00Z",
    accountId: null,
    detail: {
      type: "budget",
      budgetId: "b-1",
      targetName: "Groceries",
      cadence: "fortnight",
      spentCents: 46000,
      limitCents: 40000,
      overCents: 6000,
    },
  };

  const detail = mockCard.detail as Extract<api.ReviewDetail, { type: "budget" }>;

  it("renders card heading, cheeky nudge copy, and progress bar with warning tokens", async () => {
    renderCard(mockCard, detail);

    expect(await screen.findByText("Over budget")).toBeTruthy();
    // Nudge copy: "${targetName}'s had a big ${cadence}: $${spent} of $${limit}"
    expect(screen.getByText("Groceries's had a big fortnight: $460.00 of $400.00")).toBeTruthy();
    expect(screen.getByText("$60.00")).toBeTruthy();

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar.getAttribute("aria-valuenow")).toBe("100");

    // Action buttons
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adjust limit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open budget" })).toBeTruthy();
  });

  it("calls dismissBudgetReviewItem when 'Got it' is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.dismissBudgetReviewItem).mockResolvedValue(undefined);

    renderCard(mockCard, detail);

    const gotItBtn = await screen.findByRole("button", { name: "Got it" });
    await user.click(gotItBtn);

    expect(api.dismissBudgetReviewItem).toHaveBeenCalledWith("card-1");
  });

  it("opens inline input and adjusts limit when 'Adjust limit' is clicked and saved", async () => {
    const user = userEvent.setup();
    vi.mocked(api.adjustBudgetLimitFromReview).mockResolvedValue(undefined);

    renderCard(mockCard, detail);

    const adjustBtn = await screen.findByRole("button", { name: "Adjust limit" });
    await user.click(adjustBtn);

    const input = (await screen.findByPlaceholderText("500")) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("400");

    await user.clear(input);
    await user.type(input, "500");

    const saveBtn = screen.getByRole("button", { name: "Save limit" });
    await user.click(saveBtn);

    expect(api.adjustBudgetLimitFromReview).toHaveBeenCalledWith("card-1", 50000);
  });
});
