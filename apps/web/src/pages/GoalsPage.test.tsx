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
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    fetchStages: vi.fn(),
    createStage: vi.fn(),
    updateStage: vi.fn(),
    deleteStage: vi.fn(),
    setStageRules: vi.fn(),
    fetchDrawdowns: vi.fn(),
    proposeDrawdown: vi.fn(),
    executeDrawdown: vi.fn(),
    undoDrawdown: vi.fn(),
    applyBufferDivert: vi.fn(),
    clearBufferDivert: vi.fn(),
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
  asOf: "2026-09-30",
  nextStageChangeDate: "2027-11-20",
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
      source: "rule",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "rule-2",
      stageId: "stage-1",
      goalId: "goal-house",
      shareBp: 2000,
      source: "rule",
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
      currentBalance: 2000000,
      projection: null,
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
      currentBalance: 800000,
      projection: {
        averagePerPeriodCents: 50000,
        pace: "fortnightly",
        periodsRemaining: 40,
        projectedCompletion: "2028-03-15",
      },
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
      currentBalance: 40000,
      projection: null,
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
    refresh: vi.fn(),
    signedIn: vi.fn(),
    signedUp: vi.fn(),
    token: "",
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
    vi.mocked(api.fetchGoalsSummary).mockResolvedValue(mockSummary);
    vi.mocked(api.fetchDrawdowns).mockResolvedValue([]);
    vi.mocked(api.proposeDrawdown).mockResolvedValue({
      pool: "shared",
      reason: "large_purchase",
      amountCents: 100_000,
      coveredCents: 100_000,
      remainingCents: 0,
      unlockedProtected: false,
      warnings: [],
      proposals: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the active stage card with share chips, tiles, and goal cards with arrivals", async () => {
    renderGoalsPage();

    // Stage card
    await waitFor(() => {
      expect(screen.getByText("Stage 1: Emergency fund first")).toBeTruthy();
    });
    expect(screen.getByText("Shared savings · active stage")).toBeTruthy();
    expect(screen.getByText(/Falls back at 80%/)).toBeTruthy();
    expect(screen.getByText(/ends around Nov 2027/)).toBeTruthy();

    // Stat tiles
    expect(screen.getByText("In shared savings")).toBeTruthy();
    expect(screen.getByText("$25,000.00")).toBeTruthy();
    expect(screen.getByText("Set aside for goals")).toBeTruthy();
    expect(screen.getByText("$28,000.00")).toBeTruthy();
    expect(screen.getByText("Buffer")).toBeTruthy();

    // Goal cards: the full emergency fund shows the done chip; others show shares.
    expect(screen.getByText("Stage 1: Emergency fund first · done")).toBeTruthy();
    expect(screen.getByText("Stage 1: Emergency fund first · 20%")).toBeTruthy();
    expect(screen.getByText(/At the current rate, you.ll arrive by/)).toBeTruthy();
    expect(screen.getByText("Mar 2028")).toBeTruthy();
    expect(screen.getByText("— Not enough history yet")).toBeTruthy();
    expect(screen.getByText(/Full\. Nothing more goes here/)).toBeTruthy();
  });

  it("follows the engine's active stage when it differs from the client heuristic", async () => {
    // Engine reports Stage 1 active (fallback), while the client heuristic would
    // pick Stage 2 (EF is full). Header, chips and card chips must agree on Stage 1.
    const stage2: api.AllocationStageData = {
      ...mockSummary.stages[0]!,
      id: "stage-2",
      name: "Stage 2: House push",
      sort: 1,
      exitGoalId: "goal-house",
    };
    vi.mocked(api.fetchGoalsSummary).mockResolvedValue({
      ...mockSummary,
      stages: [...mockSummary.stages, stage2],
      activeStage: mockSummary.activeStage ?? null,
      rules: [
        { ...mockSummary.rules[0]!, shareBp: 6000 },
        { ...mockSummary.rules[1]!, shareBp: 3000 },
        {
          id: "rule-3",
          stageId: "stage-2",
          goalId: "goal-house",
          shareBp: 10000,
          source: "rule",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByText("Goals (3)")).toBeTruthy();
    });
    expect(screen.getByText("Stage 1: Emergency fund first · 30%")).toBeTruthy();
    expect(screen.queryByText("Stage 2: House push · 100%")).toBeNull();
  });

  it("filters goals by scope", async () => {
    const user = userEvent.setup();
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

  it("opens the goal editor from the pencil and saves the new name", async () => {
    const user = userEvent.setup();
    const saved = { ...(mockSummary.goals[1] as api.GoalData), name: "House deposit plus" };
    vi.mocked(api.updateGoal).mockResolvedValue(saved);
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Edit House deposit")).toBeTruthy();
    });
    await user.click(screen.getByLabelText("Edit House deposit"));

    const nameInput = await screen.findByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "House deposit plus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateGoal).toHaveBeenCalledWith(
        "goal-house",
        expect.objectContaining({ name: "House deposit plus" }),
      );
    });
  });

  it("creates a shared goal from Add a goal", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockResolvedValue({
      ...(mockSummary.goals[1] as api.GoalData),
      id: "goal-camera",
      name: "Camera",
    });
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add a goal" })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Add a goal" }));

    await user.type(await screen.findByLabelText("Name"), "Camera");
    await user.type(screen.getByLabelText("Target"), "1234");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Camera",
          targetCents: 123400,
          kind: "flexible",
          pool: null,
        }),
      );
    });
  });

  it("opens the stage editor with the stage ladder", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateStage).mockResolvedValue({
      ...(mockSummary.stages[0] as api.AllocationStageData),
      name: "EF first",
    });
    vi.mocked(api.setStageRules).mockResolvedValue([]);
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit stages" })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Edit stages" }));

    expect(await screen.findByText("Allocation stages")).toBeTruthy();
    const nameInput = screen.getByLabelText("Stage name");
    expect((nameInput as HTMLInputElement).value).toBe("Stage 1: Emergency fund first");

    // The share inputs are prefilled from the stage's rules.
    expect(
      (screen.getByLabelText("Rainy day emergency fund share percent") as HTMLInputElement).value,
    ).toBe("80");
    expect((screen.getByLabelText("House deposit share percent") as HTMLInputElement).value).toBe(
      "20",
    );

    await user.clear(nameInput);
    await user.type(nameInput, "EF first");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateStage).toHaveBeenCalledWith(
        "stage-1",
        expect.objectContaining({ name: "EF first" }),
      );
      expect(api.setStageRules).toHaveBeenCalledWith("stage-1", [
        { goalId: "goal-ef", shareBp: 8000 },
        { goalId: "goal-house", shareBp: 2000 },
      ]);
    });
  });

  it("hides every edit affordance in demo mode", async () => {
    renderGoalsPage({ ...simonMe, demo: true });

    await waitFor(() => {
      expect(screen.getByText("Stage 1: Emergency fund first")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Add a goal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit stages" })).toBeNull();
    expect(screen.queryByLabelText("Edit House deposit")).toBeNull();
  });

  it("shows the empty state when there are no goals", async () => {
    vi.mocked(api.fetchGoalsSummary).mockResolvedValue({
      ...mockSummary,
      goals: [],
    });
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByText("No goals yet.")).toBeTruthy();
    });
    expect(screen.getByText("Goals (0)")).toBeTruthy();
  });

  it("renders shortfall warning banner with Cover it and Move from buffer when over-committed", async () => {
    const user = userEvent.setup();
    // In mockSummary: goal-ef is 2000000 ($20,000), goal-house is 800000 ($8,000). Total setAside = $28,000.
    // If pool total is $27,680 (2768000 cents), shortfall is $320 (32000 cents).
    // And stage-1 has rules summing to 10000 bp (80% + 20%). Give buffer 5% (500 bp) by setting house to 1500 bp:
    vi.mocked(api.fetchGoalsSummary).mockResolvedValue({
      ...mockSummary,
      rules: [
        {
          id: "rule-1",
          stageId: "stage-1",
          goalId: "goal-ef",
          shareBp: 8000,
          source: "rule",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "rule-2",
          stageId: "stage-1",
          goalId: "goal-house",
          shareBp: 1500,
          source: "rule",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      pools: [
        {
          pool: "shared",
          totalCents: 2_768_000,
          accounts: [
            {
              id: "acc-shared-savings",
              name: "Joint Savings",
              balanceCents: 2_768_000,
              isPrivate: false,
            },
          ],
        },
      ],
    });

    renderGoalsPage();

    await waitFor(() => {
      expect(
        screen.getByText(/Your goals are \$320\.00 ahead of what's in the bank/i),
      ).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Cover it" })).toBeTruthy();
    expect(screen.getByText("Or move $50/fortnight from the buffer")).toBeTruthy();

    // Clicking Cover it opens the sheet
    await user.click(screen.getByRole("button", { name: "Cover it" }));
    await waitFor(() => {
      expect(screen.getByTestId("cover-expense-sheet")).toBeTruthy();
    });
  });

  it("opens Cover an expense sheet from header button", async () => {
    const user = userEvent.setup();
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cover an expense" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Cover an expense" }));
    await waitFor(() => {
      expect(screen.getByTestId("cover-expense-sheet")).toBeTruthy();
    });
  });

  it("displays latest drawdown history line and allows undoing", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchDrawdowns).mockResolvedValue([
      {
        id: "DD-99",
        personId: null,
        pool: "shared",
        reason: "large_purchase",
        label: "Car repair",
        amountCents: 1_640_000,
        transactionId: null,
        undoneAt: null,
        createdAt: "2026-10-05T00:00:00Z",
        adjustments: [
          {
            id: "ADJ-1",
            goalId: "goal-ef",
            goalDrawdownId: "DD-99",
            periodStart: null,
            amountCents: 800_000,
            source: "drawdown",
            note: null,
            createdAt: "2026-10-05T00:00:00Z",
          },
        ],
      },
    ]);
    vi.mocked(api.undoDrawdown).mockResolvedValue({
      drawdown: {
        id: "DD-99",
        personId: null,
        pool: "shared",
        reason: "large_purchase",
        label: "Car repair",
        amountCents: 1_640_000,
        transactionId: null,
        undoneAt: "2026-10-05T01:00:00Z",
        createdAt: "2026-10-05T00:00:00Z",
      },
    });

    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByTestId("drawdown-history-line")).toBeTruthy();
      expect(screen.getByText(/Car repair/)).toBeTruthy();
      expect(screen.getByText(/\$16,400\.00 from 1 goals/)).toBeTruthy();
    });

    const undoBtn = screen.getByRole("button", { name: "Undo" });
    await user.click(undoBtn);

    await waitFor(() => {
      expect(api.undoDrawdown).toHaveBeenCalledWith("DD-99");
    });
  });
});
