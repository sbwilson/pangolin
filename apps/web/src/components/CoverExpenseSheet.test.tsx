// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { CoverExpenseSheet } from "./CoverExpenseSheet.tsx";

vi.mock("../api.ts", async () => {
  const actual = await vi.importActual<typeof import("../api.ts")>("../api.ts");
  return {
    ...actual,
    proposeDrawdown: vi.fn(),
    executeDrawdown: vi.fn(),
    applyBufferDivert: vi.fn(),
  };
});

describe("CoverExpenseSheet", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  const goals: api.GoalData[] = [
    {
      id: "G-EF",
      name: "Rainy day",
      targetCents: 800_000,
      targetDate: null,
      priority: 0,
      kind: "flexible",
      isEmergencyFund: true,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      pool: "shared",
      currentBalance: 800_000,
      projection: null,
      personId: null,
    },
    {
      id: "G-FLEX",
      name: "Japan trip",
      targetCents: 600_000,
      targetDate: "2027-01-01",
      priority: 1,
      kind: "flexible",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      pool: "shared",
      currentBalance: 600_000,
      projection: null,
      personId: null,
    },
    {
      id: "G-PROT",
      name: "House deposit",
      targetCents: 5_000_000,
      targetDate: "2028-03-01",
      priority: 2,
      kind: "protected",
      isEmergencyFund: false,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      pool: "shared",
      currentBalance: 4_820_000,
      projection: null,
      personId: null,
    },
  ];

  const activeStage: api.AllocationStageData = {
    id: "S2",
    personId: null,
    name: "Stage 2 · Build",
    sort: 2,
    exitGoalId: "G-PROT",
    fallbackThresholdBp: 8000,
    completedSharePolicy: "rescale",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const rules: api.GoalRuleData[] = [
    {
      id: "R1",
      goalId: "G-PROT",
      stageId: "S2",
      shareBp: 8000,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "R2",
      goalId: "G-FLEX",
      stageId: "S2",
      shareBp: 1500,
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      source: "rule",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    // Buffer has 5% (500 bp)
  ];

  it("renders large_purchase proposal with EF first, Flex second, Protected locked", async () => {
    vi.mocked(api.proposeDrawdown).mockResolvedValueOnce({
      pool: "shared",
      reason: "large_purchase",
      amountCents: 1_000_000,
      coveredCents: 1_000_000,
      remainingCents: 0,
      unlockedProtected: false,
      warnings: [],
      proposals: [
        {
          goalId: "G-EF",
          goalName: "Rainy day",
          kind: "flexible",
          isEmergencyFund: true,
          currentBalanceCents: 800_000,
          proposedAmountCents: 800_000,
        },
        {
          goalId: "G-FLEX",
          goalName: "Japan trip",
          kind: "flexible",
          isEmergencyFund: false,
          currentBalanceCents: 600_000,
          proposedAmountCents: 200_000,
        },
        {
          goalId: "G-PROT",
          goalName: "House deposit",
          kind: "protected",
          isEmergencyFund: false,
          currentBalanceCents: 4_820_000,
          proposedAmountCents: 0,
        },
      ],
    });

    const onCovered = vi.fn();
    const onClose = vi.fn();

    render(
      <CoverExpenseSheet
        isOpen={true}
        onClose={onClose}
        initialReason="large_purchase"
        initialAmountCents={1_000_000}
        initialLabel="Car repair"
        goals={goals}
        activeStage={activeStage}
        rules={rules}
        onCovered={onCovered}
      />,
    );

    expect(screen.getByText("Cover an expense")).toBeDefined();
    expect(screen.getByText("Things break. Here's where it can come from.")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Rainy day")).toBeDefined();
      expect(screen.getByText("Japan trip")).toBeDefined();
      expect(screen.getByText("House deposit")).toBeDefined();
    });

    // Protected goal is locked and has "Use protected goals" button
    expect(screen.getByText("Use protected goals")).toBeDefined();

    // Left to cover is $0
    expect(screen.getByText("$0.00")).toBeDefined();

    // Confirm button is enabled
    const confirmBtn = screen.getByRole("button", { name: "Confirm cover" });
    expect(confirmBtn.getAttribute("disabled")).toBeNull();
  });

  it("synchronizes slider and numeric input, and allows reset to Pangolin's split", async () => {
    vi.mocked(api.proposeDrawdown).mockResolvedValue({
      pool: "shared",
      reason: "large_purchase",
      amountCents: 1_000_000,
      coveredCents: 1_000_000,
      remainingCents: 0,
      unlockedProtected: false,
      warnings: [],
      proposals: [
        {
          goalId: "G-EF",
          goalName: "Rainy day",
          kind: "flexible",
          isEmergencyFund: true,
          currentBalanceCents: 800_000,
          proposedAmountCents: 800_000,
        },
        {
          goalId: "G-FLEX",
          goalName: "Japan trip",
          kind: "flexible",
          isEmergencyFund: false,
          currentBalanceCents: 600_000,
          proposedAmountCents: 200_000,
        },
      ],
    });

    render(
      <CoverExpenseSheet
        isOpen={true}
        onClose={vi.fn()}
        initialReason="large_purchase"
        initialAmountCents={1_000_000}
        goals={goals}
        activeStage={activeStage}
        rules={rules}
        onCovered={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Japan trip cover amount")).toBeDefined();
    });

    const slider = screen.getByLabelText("Japan trip cover amount");
    fireEvent.change(slider, { target: { value: "300000" } });

    // "Back to Pangolin's split" appears
    await waitFor(() => {
      expect(screen.getByText("Back to Pangolin's split")).toBeDefined();
    });

    // Verify decimal cents input works
    const textInput = screen.getByDisplayValue("3000.00");
    fireEvent.change(textInput, { target: { value: "350.50" } });
    expect(screen.getByDisplayValue("350.50")).toBeDefined();

    // Clicking reset restores original split
    fireEvent.click(screen.getByText("Back to Pangolin's split"));
    await waitFor(() => {
      expect(screen.queryByText("Back to Pangolin's split")).toBeNull();
    });
  });

  it("unlocks Protected goals when user clicks 'Use protected goals'", async () => {
    vi.mocked(api.proposeDrawdown).mockResolvedValue({
      pool: "shared",
      reason: "large_purchase",
      amountCents: 1_600_000,
      coveredCents: 1_400_000,
      remainingCents: 200_000,
      unlockedProtected: false,
      warnings: [],
      proposals: [
        {
          goalId: "G-EF",
          goalName: "Rainy day",
          kind: "flexible",
          isEmergencyFund: true,
          currentBalanceCents: 800_000,
          proposedAmountCents: 800_000,
        },
        {
          goalId: "G-FLEX",
          goalName: "Japan trip",
          kind: "flexible",
          isEmergencyFund: false,
          currentBalanceCents: 600_000,
          proposedAmountCents: 600_000,
        },
        {
          goalId: "G-PROT",
          goalName: "House deposit",
          kind: "protected",
          isEmergencyFund: false,
          currentBalanceCents: 4_820_000,
          proposedAmountCents: 0,
        },
      ],
    });

    render(
      <CoverExpenseSheet
        isOpen={true}
        onClose={vi.fn()}
        initialReason="large_purchase"
        initialAmountCents={1_600_000}
        goals={goals}
        activeStage={activeStage}
        rules={rules}
        onCovered={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Use protected goals")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Use protected goals"));

    await waitFor(() => {
      expect(screen.getByText("Protected goals are unlocked. Drawing from them will postpone their target arrival dates.")).toBeDefined();
    });
  });

  it("displays buffer divert option for shortfall and calls applyBufferDivert", async () => {
    vi.mocked(api.proposeDrawdown).mockResolvedValue({
      pool: "shared",
      reason: "shortfall",
      amountCents: 32_000,
      coveredCents: 32_000,
      remainingCents: 0,
      unlockedProtected: false,
      warnings: [],
      proposals: [
        {
          goalId: "G-FLEX",
          goalName: "Japan trip",
          kind: "flexible",
          isEmergencyFund: false,
          currentBalanceCents: 600_000,
          proposedAmountCents: 32_000,
        },
      ],
    });

    vi.mocked(api.applyBufferDivert).mockResolvedValue({
      rule: {
        id: "R-DIVERT",
        goalId: "G-FLEX",
        stageId: "S2",
        shareBp: 0,
        effectiveFrom: "2026-10-05",
        effectiveUntil: "2027-01-05",
        source: "shortfall_override",
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      },
      activeStageId: "S2",
      shareBp: 0,
      effectiveUntil: "2027-01-05",
    });

    const onBufferDiverted = vi.fn();
    const onClose = vi.fn();

    render(
      <CoverExpenseSheet
        isOpen={true}
        onClose={onClose}
        initialReason="shortfall"
        initialAmountCents={32_000}
        goals={goals}
        activeStage={activeStage}
        rules={rules}
        onCovered={vi.fn()}
        onBufferDiverted={onBufferDiverted}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rather leave your goals alone?")).toBeDefined();
    });

    const divertBtn = screen.getByRole("button", { name: "Move from the buffer instead" });
    fireEvent.click(divertBtn);

    await waitFor(() => {
      expect(api.applyBufferDivert).toHaveBeenCalledWith(
        expect.objectContaining({ pool: "shared" }),
      );
      expect(onClose).toHaveBeenCalled();
      expect(onBufferDiverted).toHaveBeenCalled();
    });
  });

  it("executes drawdown on confirm and passes summary message", async () => {
    vi.mocked(api.proposeDrawdown).mockResolvedValue({
      pool: "shared",
      reason: "large_purchase",
      amountCents: 800_000,
      coveredCents: 800_000,
      remainingCents: 0,
      unlockedProtected: false,
      warnings: [],
      proposals: [
        {
          goalId: "G-EF",
          goalName: "Rainy day",
          kind: "flexible",
          isEmergencyFund: true,
          currentBalanceCents: 800_000,
          proposedAmountCents: 800_000,
        },
      ],
    });

    vi.mocked(api.executeDrawdown).mockResolvedValue({
      drawdown: {
        id: "DD-1",
        personId: null,
        pool: "shared",
        reason: "large_purchase",
        label: "Car repair",
        amountCents: 800_000,
        transactionId: null,
        undoneAt: null,
        createdAt: "2026-10-05T00:00:00Z",
      },
      adjustments: [
        {
          id: "ADJ-1",
          goalId: "G-EF",
          goalDrawdownId: "DD-1",
          periodStart: null,
          amountCents: 800_000,
          source: "drawdown",
          note: null,
          createdAt: "2026-10-05T00:00:00Z",
        },
      ],
    });

    const onCovered = vi.fn();
    const onClose = vi.fn();

    render(
      <CoverExpenseSheet
        isOpen={true}
        onClose={onClose}
        initialReason="large_purchase"
        initialAmountCents={800_000}
        initialLabel="Car repair"
        goals={goals}
        activeStage={activeStage}
        rules={rules}
        onCovered={onCovered}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm cover" })).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirm cover" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.executeDrawdown).toHaveBeenCalledWith(
        expect.objectContaining({
          pool: "shared",
          amountCents: 800_000,
          adjustments: [{ goalId: "G-EF", amountCents: 800_000 }],
        }),
      );
      expect(onClose).toHaveBeenCalled();
      expect(onCovered).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Covered Car repair, $8,000.00: Rainy day $8,000.00."),
      );
    });
  });
});
