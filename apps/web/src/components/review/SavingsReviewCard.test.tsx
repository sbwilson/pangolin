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
import { LargeWithdrawalCard, MismatchCard, ShortfallCard } from "./SavingsReviewCard.tsx";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

vi.mock("../../api.ts", async () => {
  const actual = await vi.importActual<typeof import("../../api.ts")>("../../api.ts");
  return {
    ...actual,
    dismissSavingsReviewItem: vi.fn(),
    takeFromBufferReviewItem: vi.fn(),
    linkWithdrawalToGoal: vi.fn(),
    adjustBufferForMismatch: vi.fn(),
    fetchGoalsSummary: vi.fn().mockResolvedValue({
      goals: [
        {
          id: "goal-1",
          personId: null,
          name: "Emergency Fund",
          targetCents: 500_000,
          currentBalance: 300_000,
          isEmergencyFund: true,
        },
      ],
      activeStage: null,
      rules: [],
    }),
  };
});

function renderLargeWithdrawal(
  card: api.ReviewCard,
  detail: Extract<api.ReviewDetail, { type: "savings_large_withdrawal" }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["planning", "goals", "summary"], {
    goals: [
      {
        id: "goal-1",
        personId: null,
        name: "Emergency Fund",
        targetCents: 500_000,
        currentBalance: 300_000,
        isEmergencyFund: true,
      },
    ],
    activeStage: null,
    rules: [],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ul>
          <LargeWithdrawalCard card={card} detail={detail} />
        </ul>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  return render(<RouterProvider router={router} />);
}

function renderShortfall(
  card: api.ReviewCard,
  detail: Extract<api.ReviewDetail, { type: "savings_shortfall" }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["planning", "goals", "summary"], {
    goals: [
      {
        id: "goal-1",
        personId: null,
        name: "Emergency Fund",
        targetCents: 500_000,
        currentBalance: 300_000,
        isEmergencyFund: true,
      },
    ],
    activeStage: null,
    rules: [],
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ul>
          <ShortfallCard card={card} detail={detail} />
        </ul>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  return render(<RouterProvider router={router} />);
}

function renderMismatch(
  card: api.ReviewCard,
  detail: Extract<api.ReviewDetail, { type: "savings_mismatch" }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ul>
          <MismatchCard card={card} detail={detail} />
        </ul>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  return render(<RouterProvider router={router} />);
}

describe("SavingsReviewCard", () => {
  const largeWithdrawalCard: api.ReviewCard = {
    id: "rev-lw-1",
    kind: "planning.savings.large_withdrawal",
    createdAt: "2026-01-15T12:00:00Z",
    accountId: "acc-1",
    detail: {
      type: "savings_large_withdrawal",
      pool: "shared",
      bufferCents: 400_000,
      canTakeFromBuffer: true,
      isPersonal: false,
      transaction: {
        id: "txn-1",
        accountId: "acc-1",
        postedOn: "2026-01-10",
        amountCents: -250_000,
        description: "Car Repair",
        payeeName: "Auto Shop",
        accountName: "Shared Savings",
        categoryId: null,
        transferGroupId: null,
      },
    },
  };

  it("renders LargeWithdrawalCard with summary and actions", async () => {
    const detail = largeWithdrawalCard.detail as Extract<
      api.ReviewDetail,
      { type: "savings_large_withdrawal" }
    >;
    renderLargeWithdrawal(largeWithdrawalCard, detail);

    expect(await screen.findByText(/\$2,500\.00 came out of Shared savings/)).toBeTruthy();
    expect(screen.getByText("Car Repair")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cover it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "It's for a goal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take it from the buffer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not an expense" })).toBeTruthy();

    // Clicking "Not an expense" calls dismissSavingsReviewItem
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Not an expense" }));
    expect(api.dismissSavingsReviewItem).toHaveBeenCalledWith("rev-lw-1", "not an expense");
  });

  it("handles 'Take it from the buffer' click", async () => {
    const detail = largeWithdrawalCard.detail as Extract<
      api.ReviewDetail,
      { type: "savings_large_withdrawal" }
    >;
    renderLargeWithdrawal(largeWithdrawalCard, detail);

    expect(await screen.findByRole("button", { name: "Take it from the buffer" })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Take it from the buffer" }));
    expect(api.takeFromBufferReviewItem).toHaveBeenCalledWith("rev-lw-1");
  });

  it("renders ShortfallCard pointing to open large withdrawal when present", async () => {
    const shortfallCard: api.ReviewCard = {
      id: "rev-sf-1",
      kind: "planning.savings.shortfall",
      createdAt: "2026-01-15T12:00:00Z",
      accountId: null,
      detail: {
        type: "savings_shortfall",
        pool: "shared",
        shortfallCents: 150_000,
        isPersonal: false,
        hasOpenLargeWithdrawal: true,
      },
    };
    const detail = shortfallCard.detail as Extract<api.ReviewDetail, { type: "savings_shortfall" }>;
    renderShortfall(shortfallCard, detail);

    expect(
      await screen.findByText(/Your goals are \$1,500\.00 ahead of what's in the bank/),
    ).toBeTruthy();
    expect(screen.getByText("Large withdrawal detected in this pool")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cover it" })).toBeNull();
  });

  it("renders ShortfallCard with Cover it action when no open large withdrawal", async () => {
    const shortfallCard: api.ReviewCard = {
      id: "rev-sf-2",
      kind: "planning.savings.shortfall",
      createdAt: "2026-01-15T12:00:00Z",
      accountId: null,
      detail: {
        type: "savings_shortfall",
        pool: "shared",
        shortfallCents: 150_000,
        isPersonal: false,
        hasOpenLargeWithdrawal: false,
      },
    };
    const detail = shortfallCard.detail as Extract<api.ReviewDetail, { type: "savings_shortfall" }>;
    renderShortfall(shortfallCard, detail);

    expect(
      await screen.findByText(/Your goals are \$1,500\.00 ahead of what's in the bank/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cover it" })).toBeTruthy();
  });

  it("renders MismatchCard and calls adjustBufferForMismatch", async () => {
    const mismatchCard: api.ReviewCard = {
      id: "rev-mm-1",
      kind: "planning.savings.mismatch",
      createdAt: "2026-01-15T12:00:00Z",
      accountId: null,
      detail: {
        type: "savings_mismatch",
        pool: "shared",
        differenceCents: 50_000,
        isPersonal: false,
      },
    };
    const detail = mismatchCard.detail as Extract<api.ReviewDetail, { type: "savings_mismatch" }>;
    renderMismatch(mismatchCard, detail);

    expect(await screen.findByText(/Savings and goals are \$500\.00 apart/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Put the difference in the buffer" });
    expect(btn).toBeTruthy();

    const user = userEvent.setup();
    await user.click(btn);
    expect(api.adjustBufferForMismatch).toHaveBeenCalledWith("rev-mm-1");
  });
});
