// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { BudgetEditorSheet } from "./BudgetEditorSheet.tsx";

vi.mock("../api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.ts")>();
  return {
    ...actual,
    fetchCategories: vi.fn(),
    fetchCategoryGroups: vi.fn(),
    fetchSuggestedLimit: vi.fn(),
    listAccounts: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
  };
});

const me: api.Me = {
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

function account(overrides: Partial<api.AccountView>): api.AccountView {
  return {
    id: "acc-1",
    name: "Everyday",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    institutionId: null,
    openedOn: "2026-01-01",
    closedOn: null,
    isSavings: false,
    lowBalanceThresholdCents: 0,
    pool: "shared",
    owners: [{ personId: "person-simon", shareBp: 10_000 }],
    lastImport: null,
    ...overrides,
  };
}

function budget(overrides: Partial<api.BudgetData> = {}): api.BudgetData {
  return {
    id: "bud-coffee",
    personId: "person-simon",
    categoryId: "cat-coffee",
    categoryGroupId: null,
    fundingAccountId: null,
    cadence: "fortnight",
    limitCents: 4_000,
    rollover: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderSheet(props: Partial<Parameters<typeof BudgetEditorSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BudgetEditorSheet
        me={me}
        budget={null}
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

/** The funding select, as the component exposes it. */
function fundingSelect(): HTMLSelectElement {
  return screen.getByLabelText("Forecast charged to") as HTMLSelectElement;
}

/** Let the accounts query land before reading the funding select. */
async function awaitFundingOption(name: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("option", { name })).toBeDefined();
  });
}

describe("BudgetEditorSheet", () => {
  beforeEach(() => {
    vi.mocked(api.fetchCategories).mockResolvedValue([
      { id: "cat-coffee", name: "Coffee", groupId: "grp-food", groupName: "Food" },
    ]);
    vi.mocked(api.fetchCategoryGroups).mockResolvedValue([
      { id: "grp-food", name: "Food", kind: "expense" },
    ]);
    vi.mocked(api.fetchSuggestedLimit).mockResolvedValue(null);
    vi.mocked(api.listAccounts).mockResolvedValue([
      account({ id: "acc-everyday", name: "Everyday" }),
      account({ id: "acc-pot", name: "Savings pot", type: "savings", isSavings: true }),
      account({ id: "acc-old", name: "Old card", closedOn: "2026-02-01" }),
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers the pay-account default plus only open transaction accounts", async () => {
    renderSheet({ budget: budget() });
    await awaitFundingOption("Everyday");

    const select = fundingSelect();
    expect(select.value).toBe(""); // stored null reads back as the default option
    const names = Array.from(select.options).map((o) => o.textContent);
    expect(names).toEqual(["Pay account (default)", "Everyday"]);
  });

  it("round-trips the funding account: stored id displays, default maps back to null on save", async () => {
    const user = userEvent.setup();
    const withFunding = budget({ fundingAccountId: "acc-everyday" });
    vi.mocked(api.updateBudget).mockResolvedValue(withFunding);
    renderSheet({ budget: withFunding });
    await awaitFundingOption("Everyday");

    expect(fundingSelect().value).toBe("acc-everyday");

    await user.selectOptions(
      fundingSelect(),
      screen.getByRole("option", { name: "Pay account (default)" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.updateBudget).toHaveBeenCalledWith(
        "bud-coffee",
        expect.objectContaining({ fundingAccountId: null }),
      );
    });
  });

  it("sends the chosen funding account when creating", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBudget).mockResolvedValue(budget({ fundingAccountId: "acc-everyday" }));
    renderSheet();
    await awaitFundingOption("Everyday");

    await user.selectOptions(screen.getByLabelText("Category"), "cat-coffee");
    await user.selectOptions(fundingSelect(), "acc-everyday");
    await user.type(screen.getByLabelText("Limit"), "40");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({ fundingAccountId: "acc-everyday" }),
      );
    });
  });

  it("shows a stored funding account that is no longer open as its own labelled option and keeps it", async () => {
    const user = userEvent.setup();
    const stale = budget({ fundingAccountId: "acc-old" });
    vi.mocked(api.updateBudget).mockResolvedValue(stale);
    renderSheet({ budget: stale });
    await awaitFundingOption("Old card (unavailable)");

    const select = fundingSelect();
    // The displayed value is the stored id, not the default it would silently fall back to.
    expect(select.value).toBe("acc-old");
    expect(screen.getByRole("option", { name: "Old card (unavailable)" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.updateBudget).toHaveBeenCalledWith(
        "bud-coffee",
        expect.objectContaining({ fundingAccountId: "acc-old" }),
      );
    });
  });
});
