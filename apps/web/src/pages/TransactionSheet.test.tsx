// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import {
  ApiError,
  type CategorySummary,
  type LedgerSplit,
  type LedgerTransaction,
  type Me,
} from "../api.ts";
import { TransactionSheet } from "./TransactionSheet.tsx";
import { TransactionsTable } from "./TransactionsTable.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  setSplits: vi.fn(),
  setSplitField: vi.fn(),
  setSplitTags: vi.fn(),
  updateNotes: vi.fn(),
  hideName: vi.fn(),
  unhideName: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

const me: Me = {
  personId: "p-alex",
  displayName: "Alex",
  colour: "#000000",
  authAt: "2026-10-07T00:00:00Z",
  canInvite: false,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 10 },
  partner: { personId: "p-sam", displayName: "Sam" },
};

const categories: CategorySummary[] = [
  { id: "c1", name: "Groceries", groupId: "g1", groupName: "Food" },
  { id: "c2", name: "Dining out", groupId: "g1", groupName: "Food" },
];

const split = (over: Partial<LedgerSplit> = {}): LedgerSplit => ({
  id: "s1",
  amountCents: -1000,
  beneficiary: "shared",
  memo: null,
  categoryId: null,
  tags: [],
  categorySource: null,
  beneficiarySource: null,
  ...over,
});

const txn = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: "t1",
  accountId: "a1",
  postedOn: "2026-09-01",
  amountCents: -1000,
  descriptionRaw: "Coffee Shop",
  status: "posted",
  notes: null,
  nameHidden: false,
  nameHiddenBy: null,
  nameHiddenUntil: null,
  remainingCents: 0,
  splits: [split()],
  ...over,
});

function open(transaction: LedgerTransaction, onChange = vi.fn(), onClose = vi.fn()) {
  render(
    <TransactionSheet
      transaction={transaction}
      me={me}
      accountName="Joint"
      categories={categories}
      tags={[{ id: "tag1", name: "holiday" }]}
      onChange={onChange}
      onClose={onClose}
    />,
  );
  return onChange;
}

describe("TransactionSheet", () => {
  it("sets a category through setSplitField and shows the returned transaction", async () => {
    const user = userEvent.setup();
    const returned = txn({ splits: [split({ categoryId: "c1" })] });
    vi.mocked(api.setSplitField).mockResolvedValue({
      applied: true,
      changed: true,
      transaction: returned,
    });
    const onChange = open(txn());
    await user.click(screen.getByRole("combobox", { name: "Split 1 category" }));
    await user.click(screen.getByRole("option", { name: "Groceries" }));
    expect(api.setSplitField).toHaveBeenCalledWith("t1", "s1", "category", "c1");
    expect(onChange).toHaveBeenCalledWith(returned);
    const input = (await screen.findByRole("combobox", {
      name: "Split 1 category",
    })) as HTMLInputElement;
    expect(input.value).toBe("Groceries");
  });

  it("says when a higher-ranked source kept the field", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setSplitField).mockResolvedValue({
      applied: false,
      changed: false,
      reason: "outranked",
      transaction: txn(),
    });
    open(txn());
    await user.click(screen.getByRole("combobox", { name: "Split 1 category" }));
    await user.click(screen.getByRole("option", { name: "Groceries" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Kept: a higher-ranked source set this",
    );
  });

  it("closes only the category list on the first Escape, and the sheet on the second", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    open(txn(), vi.fn(), onClose);
    const input = screen.getByRole("combobox", { name: "Split 1 category" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sets the beneficiary from shared, me and the partner", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setSplitField).mockResolvedValue({
      applied: true,
      changed: true,
      transaction: txn({ splits: [split({ beneficiary: "p-sam" })] }),
    });
    open(txn());
    const select = screen.getByRole("combobox", { name: "Split 1 beneficiary" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Shared", "Alex", "Sam"]);
    await user.selectOptions(select, "p-sam");
    expect(api.setSplitField).toHaveBeenCalledWith("t1", "s1", "beneficiary", "p-sam");
  });

  it("sends the two splits and shows the server's remaining amount", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setSplits).mockResolvedValue(
      txn({
        remainingCents: 0,
        splits: [split({ amountCents: -600 }), split({ id: "s2", amountCents: -400 })],
      }),
    );
    open(txn({ remainingCents: -1000 }));
    expect(screen.getByText(/Remaining/).textContent).toContain("-$10.00");
    const first = screen.getByLabelText("Split 1 amount");
    await user.clear(first);
    await user.type(first, "-6");
    await user.click(screen.getByRole("button", { name: "Add split" }));
    await user.type(screen.getByLabelText("Split 2 amount"), "-4.00");
    await user.click(screen.getByRole("button", { name: "Save splits" }));
    expect(api.setSplits).toHaveBeenCalledWith("t1", [
      { id: "s1", amountCents: -600 },
      { amountCents: -400 },
    ]);
    expect(await screen.findByText(/Remaining/)).toBeTruthy();
    expect(screen.getByText(/Remaining/).textContent).toContain("$0.00");
    expect((screen.getByLabelText("Split 2 amount") as HTMLInputElement).value).toBe("-4.00");
  });

  it("shows a refused split edit inline with the server's remaining amount", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setSplits).mockRejectedValue(
      new ApiError(400, "Validation", "Splits must add up to the transaction amount", {
        remainingCents: -400,
      }),
    );
    open(txn());
    await user.click(screen.getByRole("button", { name: "Save splits" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Splits must add up to the transaction amount",
    );
    expect(screen.getByText(/Remaining/).textContent).toContain("-$4.00");
  });

  it("keeps a bad amount from being sent", async () => {
    const user = userEvent.setup();
    open(txn());
    const first = screen.getByLabelText("Split 1 amount");
    await user.clear(first);
    await user.type(first, "ten");
    await user.click(screen.getByRole("button", { name: "Save splits" }));
    expect(api.setSplits).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("replaces a split's tags as a set", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setSplitTags).mockResolvedValue(
      txn({ splits: [split({ tags: [{ id: "tag1", name: "holiday" }] })] }),
    );
    open(txn());
    await user.click(screen.getByRole("combobox", { name: "Add a tag" }));
    await user.click(screen.getByRole("option", { name: "holiday" }));
    expect(api.setSplitTags).toHaveBeenCalledWith("t1", "s1", ["tag1"]);
    expect(await screen.findByRole("button", { name: "Remove tag holiday" })).toBeTruthy();
  });

  it("saves notes, clearing them when blank", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateNotes).mockResolvedValue(txn({ notes: "for Mum" }));
    open(txn());
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "for Mum");
    await user.click(screen.getByRole("button", { name: "Save notes" }));
    expect(api.updateNotes).toHaveBeenCalledWith("t1", "for Mum");
    await user.clear(screen.getByRole("textbox", { name: "Notes" }));
    await user.click(screen.getByRole("button", { name: "Save notes" }));
    expect(api.updateNotes).toHaveBeenLastCalledWith("t1", null);
  });

  it("warns that notes stay visible, and hides the name until the chosen day", async () => {
    const user = userEvent.setup();
    const future = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    vi.mocked(api.hideName).mockResolvedValue(
      txn({ nameHiddenBy: "p-alex", nameHiddenUntil: `${future}T00:00:00.000Z` }),
    );
    open(txn());
    expect(screen.getByText("Notes stay visible to Sam.")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Hide this name from Sam" }));
    expect(api.hideName).toHaveBeenCalledWith("t1", undefined);
    expect((await screen.findByText(/^Hidden from Sam until /)).textContent).toMatch(
      /^Hidden from Sam until \d{1,2} [A-Z][a-z]+ \d{4}$/,
    );
    vi.mocked(api.unhideName).mockResolvedValue(txn());
    await user.click(screen.getByRole("checkbox", { name: "Hide this name from Sam" }));
    expect(api.unhideName).toHaveBeenCalledWith("t1");
  });

  it("shows a refused hide's message", async () => {
    const user = userEvent.setup();
    vi.mocked(api.hideName).mockRejectedValue(
      new ApiError(400, "Validation", "A name in a private account cannot be hidden"),
    );
    open(txn());
    await user.click(screen.getByRole("checkbox", { name: "Hide this name from Sam" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A name in a private account cannot be hidden",
    );
  });

  it("shows the partner a hidden transaction as Hidden until a long date, with the wink line", () => {
    open(
      txn({
        nameHidden: true,
        nameHiddenBy: "p-sam",
        nameHiddenUntil: "2027-03-12T00:00:00.000Z",
        descriptionRaw: "Hidden until 12 Mar 2027",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Hidden until 12 March 2027" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(dialog.textContent).toContain("Shh, it's a surprise.");
    expect(screen.queryByRole("checkbox", { name: /Hide this name/ })).toBeNull();
  });
});

describe("Sheet placement", () => {
  it("anchors to the bottom edge below md and to the right edge from md up", () => {
    open(txn());
    const panel = screen.getByRole("dialog");
    // Layout is not computed under jsdom; the e2e spec measures it at 375 px.
    for (const name of ["inset-x-0", "bottom-0", "rounded-t-xl", "md:inset-y-0", "md:right-0"]) {
      expect(panel.classList.contains(name)).toBe(true);
    }
  });
});

describe("TransactionsTable", () => {
  const render_ = (rows: LedgerTransaction[], handlers = {}) =>
    render(
      <TransactionsTable
        transactions={rows}
        dayNets={{}}
        accountNames={new Map([["a1", "Joint"]])}
        categories={categories}
        viewerId="p-alex"
        partnerName="Sam"
        onOpen={vi.fn()}
        onCategory={vi.fn()}
        {...handlers}
      />,
    );

  it("edits a single-split row's category in place", async () => {
    const user = userEvent.setup();
    const onCategory = vi.fn();
    render_([txn()], { onCategory });
    await user.click(
      screen.getByRole("button", { name: /Category for Coffee Shop: Uncategorised/ }),
    );
    await user.click(screen.getByRole("option", { name: "Dining out" }));
    expect(onCategory).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "s1", "c2");
  });

  it("offers the sheet, not a chip, for a split row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render_([txn({ splits: [split(), split({ id: "s2" })] })], { onOpen });
    await user.click(screen.getByRole("button", { name: /2 splits/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("names the partner's hidden row with a long date and describes it with the wink line", () => {
    render_([
      txn({
        nameHidden: true,
        nameHiddenBy: "p-sam",
        nameHiddenUntil: "2027-03-12T00:00:00.000Z",
        descriptionRaw: "Hidden until 12 Mar 2027",
      }),
    ]);
    const row = screen.getByRole("button", { name: "Hidden until 12 March 2027" });
    const described = row.getAttribute("aria-describedby") as string;
    expect(document.getElementById(described)?.textContent).toBe("Shh, it's a surprise.");
  });

  it("shows the owner's hidden row with a Hidden from tag", () => {
    const future = new Date(Date.now() + 90 * 86_400_000).toISOString();
    render_([txn({ nameHiddenBy: "p-alex", nameHiddenUntil: future })]);
    expect(screen.getByText(/^Hidden from Sam until \d{1,2} [A-Z][a-z]+ \d{4}$/)).toBeTruthy();
  });

  it("shows no tag for a lapsed hiding or the partner's hiding", () => {
    render_([
      txn({ nameHiddenBy: "p-alex", nameHiddenUntil: "2020-01-01T00:00:00.000Z" }),
      txn({ id: "t2", nameHiddenBy: "p-sam", nameHiddenUntil: "2999-01-01T00:00:00.000Z" }),
    ]);
    expect(screen.queryByText(/^Hidden from/)).toBeNull();
  });

  it("disables the chip until categories are loaded", () => {
    render_([txn({ splits: [split({ categoryId: "c1" })] })], { categories: [] });
    expect(screen.queryByText("Uncategorised")).toBeNull();
    expect(screen.getAllByRole("button").some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
