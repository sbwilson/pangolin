// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalData, Me } from "../api.ts";
import * as api from "../api.ts";
import { GoalEditorSheet } from "./GoalEditorSheet.tsx";

vi.mock("../api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.ts")>();
  return {
    ...actual,
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
  };
});

const me: Me = {
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

const rainyDay: GoalData = {
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
};

const japan: GoalData = {
  id: "goal-japan",
  name: "Japan trip",
  pool: "shared",
  personId: null,
  targetCents: 800000,
  targetDate: "2027-06-30",
  kind: "flexible",
  priority: 1,
  isEmergencyFund: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderSheet(props: Partial<Parameters<typeof GoalEditorSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <GoalEditorSheet
      me={me}
      goal={null}
      goals={[rainyDay, japan]}
      isOpen
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onClose, onSaved };
}

describe("GoalEditorSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a flexible shared goal", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockResolvedValue(japan);
    const { onSaved, onClose } = renderSheet();

    await user.type(screen.getByLabelText("Name"), "Japan trip");
    await user.type(screen.getByLabelText("Target"), "800");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith({
        name: "Japan trip",
        targetCents: 80000,
        targetDate: null,
        kind: "flexible",
        isEmergencyFund: false,
        pool: null,
      });
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("creates in the personal pool when Simon is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockResolvedValue(japan);
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Simon" }));
    await user.type(screen.getByLabelText("Name"), "Synth");
    await user.type(screen.getByLabelText("Target"), "300");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Synth", pool: "person-simon" }),
      );
    });
  });

  it("rejects a zero target inline", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("Name"), "Nope");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/target amount greater than zero/i)).toBeTruthy();
    expect(api.createGoal).not.toHaveBeenCalled();
  });

  it("hides the kind toggle and forces protected when the emergency-fund switch is on", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createGoal).mockResolvedValue(rainyDay);
    // No emergency fund in the pool yet, so the switch is live.
    renderSheet({ goals: [japan] });

    expect(screen.getByRole("group", { name: "Goal type" })).toBeTruthy();
    await user.click(screen.getByRole("switch"));
    expect(screen.queryByRole("group", { name: "Goal type" })).toBeNull();

    await user.type(screen.getByLabelText("Name"), "Rainy day");
    await user.type(screen.getByLabelText("Target"), "8000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "protected", isEmergencyFund: true }),
      );
    });
  });

  it("disables the emergency-fund switch when the pool already has one", () => {
    renderSheet({
      goal: japan,
      goals: [rainyDay, japan],
    });

    const toggle = screen.getByRole("switch");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Shared savings already has one: Rainy day")).toBeTruthy();
  });

  it("edits an existing goal and deletes it with a confirm step", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateGoal).mockResolvedValue({ ...japan, name: "Japan 2027" });
    vi.mocked(api.deleteGoal).mockResolvedValue(undefined);
    renderSheet({ goal: japan, goals: [rainyDay, japan] });

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Japan trip");
    await user.clear(nameInput);
    await user.type(nameInput, "Japan 2027");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.updateGoal).toHaveBeenCalledWith(
        "goal-japan",
        expect.objectContaining({ name: "Japan 2027", targetDate: "2027-06-30" }),
      );
    });

    // Re-open for the delete flow.
    cleanup();
    const { onSaved } = renderSheet({ goal: japan, goals: [rainyDay, japan] });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => {
      expect(api.deleteGoal).toHaveBeenCalledWith("goal-japan");
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("shows the delete error inline when the goal is blocked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteGoal).mockRejectedValue(
      new Error('Stage "Stage 1" still ends with this goal'),
    );
    renderSheet({ goal: japan, goals: [rainyDay, japan] });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByText('Stage "Stage 1" still ends with this goal')).toBeTruthy();
  });

  it("prefills the exact target cents and saves them unchanged", async () => {
    const user = userEvent.setup();
    const subDollar = { ...japan, targetCents: 12345 };
    vi.mocked(api.updateGoal).mockResolvedValue(subDollar);
    renderSheet({ goal: subDollar, goals: [rainyDay, subDollar] });

    const targetInput = screen.getByLabelText("Target") as HTMLInputElement;
    expect(targetInput.value).toBe("123.45");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.updateGoal).toHaveBeenCalledWith(
        "goal-japan",
        expect.objectContaining({ targetCents: 12345 }),
      );
    });
  });

  it("names the personal pool in the disabled emergency-fund caption", () => {
    const personalEf: GoalData = {
      ...rainyDay,
      id: "goal-pef",
      name: "Personal cushion",
      pool: "person-simon",
      personId: "person-simon",
    };
    const synth: GoalData = {
      ...japan,
      id: "goal-synth",
      name: "Synth",
      pool: "person-simon",
      personId: "person-simon",
      targetDate: null,
    };
    renderSheet({ goal: synth, goals: [personalEf, synth] });

    expect(screen.getByText("Your savings already has one: Personal cushion")).toBeTruthy();
    expect(screen.queryByText(/Shared savings already has one/)).toBeNull();
  });
});
