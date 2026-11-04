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
import { GoalsPage } from "./GoalsPage.tsx";

vi.mock("../api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.ts")>();
  return {
    ...actual,
    fetchGoalsSummary: vi.fn(),
    fetchGoals: vi.fn(),
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

const mockSummary: api.GoalsSummaryData = {
  asOf: "2026-07-15",
  pools: [
    {
      pool: "shared",
      personId: null,
      totalCents: 2500000,
      accounts: [
        {
          id: "acc-savings-joint",
          name: "Joint Saver",
          institution: "Up Bank",
          balanceCents: 2500000,
        },
      ],
    },
    {
      pool: "person-simon",
      personId: "person-simon",
      totalCents: 120000,
      accounts: [
        {
          id: "acc-savings-simon",
          name: "Simon Personal Stash",
          institution: "Up Bank",
          balanceCents: 120000,
        },
      ],
    },
  ],
  stages: [
    {
      id: "stage-1",
      personId: null,
      name: "Stage 1: Emergency fund first",
      sort: 0,
      fallbackThresholdBp: 8000,
      completedSharePolicy: "rescale",
      exitGoalId: "goal-ef",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  activeStage: {
    id: "stage-1",
    personId: null,
    name: "Stage 1: Emergency fund first",
    sort: 0,
    fallbackThresholdBp: 8000,
    completedSharePolicy: "rescale",
    exitGoalId: "goal-ef",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  rules: [
    {
      id: "rule-1",
      stageId: "stage-1",
      goalId: "goal-ef",
      shareBp: 8000,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "rule-2",
      stageId: "stage-1",
      goalId: "goal-house",
      shareBp: 2000,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  goals: [
    {
      id: "goal-ef",
      name: "Rainy day emergency fund",
      pool: "shared",
      personId: null,
      targetCents: 2000000,
      targetDate: null,
      kind: "protected",
      priority: 0,
      isEmergencyFund: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "goal-house",
      name: "House deposit",
      pool: "shared",
      personId: null,
      targetCents: 10000000,
      targetDate: "2028-12-31",
      kind: "flexible",
      priority: 1,
      isEmergencyFund: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "goal-synth",
      name: "Synthesizer fund",
      pool: "person-simon",
      personId: "person-simon",
      targetCents: 300000,
      targetDate: null,
      kind: "flexible",
      priority: 2,
      isEmergencyFund: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    },
  ],
};

function renderGoalsPage(me: api.Me = simonMe) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  const rootRoute = createRootRoute();
  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: GoalsPage,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const session = {
    me,
    signOut: vi.fn(),
    mutateMe: vi.fn(),
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={session}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("GoalsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders active stage banner, savings pools, and goals with allocations", async () => {
    vi.mocked(api.fetchGoalsSummary).mockResolvedValueOnce(mockSummary);

    renderGoalsPage();

    // Verify Active stage banner
    await waitFor(() => {
      expect(screen.getByText("Stage 1: Emergency fund first")).toBeTruthy();
    });
    expect(screen.getByText(/80% threshold/)).toBeTruthy();
    expect(screen.getByText(/Rescale remaining goals/)).toBeTruthy();

    // Verify Savings pools
    expect(screen.getByText("Shared Savings")).toBeTruthy();
    expect(screen.getByText("$25,000.00")).toBeTruthy();
    expect(screen.getByText(/Simon's Savings/)).toBeTruthy();
    expect(screen.getByText("$1,200.00")).toBeTruthy();

    // Verify Goals list
    expect(screen.getByText("Rainy day emergency fund")).toBeTruthy();
    expect(screen.getByText("Emergency Fund")).toBeTruthy();
    expect(screen.getByText("Protected")).toBeTruthy();
    expect(screen.getByText("Active allocation: 80.0%")).toBeTruthy();

    expect(screen.getByText("House deposit")).toBeTruthy();
    expect(screen.getByText("Active allocation: 20.0%")).toBeTruthy();
    expect(screen.getByText("Target date: 2028-12-31")).toBeTruthy();

    expect(screen.getByText("Synthesizer fund")).toBeTruthy();
    expect(screen.getByText("No active allocation")).toBeTruthy();
  });

  it("filters goals by scope", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchGoalsSummary).mockResolvedValueOnce(mockSummary);

    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByText("Goals (3)")).toBeTruthy();
    });

    // Click Shared filter
    await user.click(screen.getByRole("button", { name: "Shared" }));
    expect(screen.getByText("Goals (2)")).toBeTruthy();
    expect(screen.queryByText("Synthesizer fund")).toBeNull();

    // Click Personal filter
    await user.click(screen.getByRole("button", { name: "Personal" }));
    expect(screen.getByText("Goals (1)")).toBeTruthy();
    expect(screen.getByText("Synthesizer fund")).toBeTruthy();
    expect(screen.queryByText("Rainy day emergency fund")).toBeNull();
  });
});
