// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllocationStageData, GoalData, GoalRuleData } from "../api.ts";
import * as api from "../api.ts";
import { StageEditorSheet } from "./StageEditorSheet.tsx";

vi.mock("../api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.ts")>();
  return {
    ...actual,
    createStage: vi.fn(),
    updateStage: vi.fn(),
    deleteStage: vi.fn(),
    setStageRules: vi.fn(),
  };
});

const stageOne: AllocationStageData = {
  id: "stage-1",
  personId: null,
  name: "Debt first",
  sort: 0,
  exitGoalId: "goal-ef",
  fallbackThresholdBp: 8000,
  completedSharePolicy: "rescale",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const stageTwo: AllocationStageData = {
  ...stageOne,
  id: "stage-2",
  name: "Then travel",
  sort: 1,
  exitGoalId: null,
};

const rules: GoalRuleData[] = [
  {
    id: "rule-1",
    stageId: "stage-1",
    goalId: "goal-ef",
    shareBp: 7000,
    source: "rule",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "rule-2",
    stageId: "stage-1",
    goalId: "goal-couch",
    shareBp: 2500,
    source: "rule",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "rule-3",
    stageId: "stage-2",
    goalId: "goal-ef",
    shareBp: 1000,
    source: "shortfall_override",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const goals: GoalData[] = [
  {
    id: "goal-ef",
    name: "Rainy day",
    pool: "shared",
    personId: null,
    targetCents: 800000,
    targetDate: null,
    kind: "protected",
    priority: 0,
    isEmergencyFund: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "goal-couch",
    name: "New couch",
    pool: "shared",
    personId: null,
    targetCents: 200000,
    targetDate: null,
    kind: "flexible",
    priority: 1,
    isEmergencyFund: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function renderSheet(props: Partial<Parameters<typeof StageEditorSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <StageEditorSheet
      pool="shared"
      poolLabel="Shared savings"
      stages={[stageOne, stageTwo]}
      rules={rules}
      goals={goals}
      isOpen
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onClose, onSaved };
}

describe("StageEditorSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens on the first stage with its settings and shares prefilled", () => {
    renderSheet();

    expect(screen.getByText("Allocation stages")).toBeTruthy();
    expect((screen.getByLabelText("Stage name") as HTMLInputElement).value).toBe("Debt first");
    expect((screen.getByLabelText("Ends when") as HTMLSelectElement).value).toBe("goal-ef");
    expect((screen.getByLabelText("Fallback at (%)") as HTMLInputElement).value).toBe("80");
    expect((screen.getByLabelText("Rainy day share percent") as HTMLInputElement).value).toBe("70");
    expect((screen.getByLabelText("New couch share percent") as HTMLInputElement).value).toBe("25");
    expect(screen.getByText("Goals take 95% · buffer keeps 5%")).toBeTruthy();
  });

  it("switches stages from the ladder", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Then travel" }));
    expect((screen.getByLabelText("Stage name") as HTMLInputElement).value).toBe("Then travel");
    expect((screen.getByLabelText("Ends when") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Rainy day share percent") as HTMLInputElement).value).toBe("0");
  });

  it("saves an existing stage and replaces its rules wholesale", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateStage).mockResolvedValue({ ...stageOne, name: "Kill the debt" });
    vi.mocked(api.setStageRules).mockResolvedValue([]);
    const { onSaved, onClose } = renderSheet();

    const nameInput = screen.getByLabelText("Stage name");
    await user.clear(nameInput);
    await user.type(nameInput, "Kill the debt");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateStage).toHaveBeenCalledWith(
        "stage-1",
        expect.objectContaining({
          name: "Kill the debt",
          exitGoalId: "goal-ef",
          fallbackThresholdBp: 8000,
          completedSharePolicy: "rescale",
        }),
      );
      expect(api.setStageRules).toHaveBeenCalledWith("stage-1", [
        { goalId: "goal-ef", shareBp: 7000 },
        { goalId: "goal-couch", shareBp: 2500 },
      ]);
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses shares that sum over 100% inline", async () => {
    const user = userEvent.setup();
    renderSheet();

    const couch = screen.getByLabelText("New couch share percent");
    await user.clear(couch);
    await user.type(couch, "40");
    expect(screen.getByText("Goals take 110% · buffer keeps 0%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/must total at most 100%/i)).toBeTruthy();
    expect(api.setStageRules).not.toHaveBeenCalled();
    expect(api.updateStage).not.toHaveBeenCalled();
  });

  it("creates a new stage and leaves the ladder selection on it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStage).mockResolvedValue({
      ...stageTwo,
      id: "stage-3",
      name: "Invest more",
    });
    vi.mocked(api.setStageRules).mockResolvedValue([]);
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Add a stage" }));
    expect((screen.getByLabelText("Stage name") as HTMLInputElement).value).toBe("");

    await user.type(screen.getByLabelText("Stage name"), "Invest more");
    await user.type(screen.getByLabelText("Rainy day share percent"), "50");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createStage).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Invest more", pool: null }),
      );
      expect(api.setStageRules).toHaveBeenCalledWith("stage-3", [
        { goalId: "goal-ef", shareBp: 5000 },
      ]);
    });
  });

  it("deletes a stage after confirming", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteStage).mockResolvedValue(undefined);
    const { onSaved } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Delete stage" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => {
      expect(api.deleteStage).toHaveBeenCalledWith("stage-1");
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("warns that allocations stop when deleting the only stage", async () => {
    const user = userEvent.setup();
    renderSheet({ stages: [stageOne] });

    await user.click(screen.getByRole("button", { name: "Delete stage" }));
    expect(screen.getByText(/allocations stop until you add one back/i)).toBeTruthy();
  });
});
