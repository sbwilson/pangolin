// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { ApiError, type ReviewCard, type ReviewCounts, type ReviewTransaction } from "../api.ts";
import { ReviewPage } from "./ReviewPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchReviewItems: vi.fn(),
  fetchReviewCounts: vi.fn(),
  reviewAction: vi.fn(),
  bulkAcceptSuggestions: vi.fn(),
  listAccounts: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.reviewAction).mockResolvedValue(undefined);
  vi.mocked(api.bulkAcceptSuggestions).mockResolvedValue({ acceptedCount: 2 });
  vi.mocked(api.fetchReviewCounts).mockResolvedValue({ open: 0, partner: null });
  vi.mocked(api.listAccounts).mockResolvedValue([
    { id: "acc-1", name: "Sam everyday" },
    { id: "acc-2", name: "Sam savings" },
  ] as never);
});

const txn = (over: Partial<ReviewTransaction> = {}): ReviewTransaction => ({
  id: "t1",
  accountId: "a1",
  accountName: "Joint everyday",
  postedOn: "2026-10-19",
  amountCents: -2500,
  description: "Coffee shop",
  payeeName: null,
  ...over,
});

const card = (over: Partial<ReviewCard> & Pick<ReviewCard, "kind" | "detail">): ReviewCard => ({
  id: `item-${over.kind}`,
  createdAt: "2026-10-20T10:00:00.000Z",
  accountId: null,
  ...over,
});

const inTransaction = (kind: string, candidates: ReviewTransaction[] = []): ReviewCard =>
  card({ kind, detail: { type: "transaction", transaction: txn(), candidates } });

const ALL: ReviewCard[] = [
  inTransaction("classify.unclassified"),
  inTransaction("classify.rule_offer"),
  inTransaction("import.probable_duplicate"),
  inTransaction("import.transfer_ambiguous", [
    txn({ id: "c1", description: "From joint", amountCents: 2500, accountName: "Savings" }),
    txn({ id: "c2", description: "From joint again", amountCents: 2500, accountName: "Savings" }),
  ]),
  inTransaction("import.transfer_ambiguous_private", [
    txn({ id: "p1", description: "From private", amountCents: 2500, accountName: "Mine" }),
  ]),
  card({
    kind: "import.set_aside",
    detail: {
      type: "batch",
      source: "commbank_csv",
      accountName: "Joint everyday",
      rows: [{ id: "row-1", rowNumber: 3, rawLine: "bad,line", reason: "Bad date", proposal: null }],
    },
  }),
  card({
    kind: "imports.handoff",
    detail: { type: "handoff", filename: "september.csv", senderName: "Alex" },
  }),
  card({
    kind: "identity.partner-reset",
    detail: { type: "notice", issuedBy: "Alex" },
  }),
  card({ kind: "identity.recovery-code-used", detail: { type: "notice", issuedBy: null } }),
  card({ kind: "accounts.closing-balance", detail: { type: "account", accountName: "Old card" } }),
  card({ kind: "system.upgrade-failed", detail: { type: "none" } }),
  card({ kind: "system.restored", detail: { type: "none" } }),
  card({ kind: "system.backup-verification-failed", detail: { type: "none" } }),
  card({ kind: "job.dead", detail: { type: "none" } }),
  card({ kind: "some.future-kind", detail: { type: "none" } }),
];

function renderPage() {
  const root = createRootRoute({ component: ReviewPage });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

const cardOf = async (kind: string): Promise<HTMLElement> => {
  await waitFor(() => expect(document.querySelector(`[data-kind="${kind}"]`)).not.toBeNull());
  return document.querySelector(`[data-kind="${kind}"]`) as HTMLElement;
};

describe("ReviewPage", () => {
  it("renders a card with its actions for every registered kind, and a generic one for the rest", async () => {
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    renderPage();
    expect(await screen.findByRole("heading", { name: "15 things need you" })).toBeTruthy();
    const actions: Record<string, string[]> = {
      "classify.unclassified": [],
      "classify.rule_offer": ["Make it a rule", "Not now"],
      "import.probable_duplicate": ["Keep both", "Remove this one"],
      "import.transfer_ambiguous": ["Yes, it's a transfer", "No, leave them"],
      "import.transfer_ambiguous_private": ["Yes, it's a transfer", "No, leave them"],
      "import.set_aside": ["Ask Pangolin to read these", "Save row 3", "Discard row 3"],
      "imports.handoff": ["Import", "Discard file"],
      "identity.partner-reset": ["Got it", "Revoke the link"],
      "identity.recovery-code-used": ["Got it"],
      "accounts.closing-balance": [],
      "system.upgrade-failed": [],
      "system.restored": [],
      "system.backup-verification-failed": [],
      "job.dead": [],
      "some.future-kind": [],
    };
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(15);
    for (const [kind, names] of Object.entries(actions)) {
      const el = await cardOf(kind);
      const buttons = within(el)
        .queryAllByRole("button")
        .map((b) => b.textContent);
      expect(buttons, kind).toEqual(names);
    }
    // A read-only card says what it is, and an unknown kind falls back to its own name.
    expect(
      within(await cardOf("accounts.closing-balance")).getByText(/Old card closed/),
    ).toBeTruthy();
    expect(within(await cardOf("some.future-kind")).getByRole("heading").textContent).toBe(
      "some.future-kind",
    );
    expect(within(await cardOf("imports.handoff")).getByText(/Alex/)).toBeTruthy();
  });

  it("explains a balance gap in words, with no action", async () => {
    vi.mocked(api.fetchReviewItems).mockResolvedValue([
      card({ kind: "import.balance_gap", detail: { type: "none" } }),
    ]);
    renderPage();
    const el = await cardOf("import.balance_gap");
    expect(within(el).getByText(/printed balances do not chain/)).toBeTruthy();
    expect(within(el).queryAllByRole("button")).toHaveLength(0);
  });

  it("says so when nothing needs you, and shows no partner chip", async () => {
    vi.mocked(api.fetchReviewItems).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Nothing needs you. Nice.")).toBeTruthy();
    expect(screen.queryByTestId("partner-chip")).toBeNull();
  });

  it("shows the partner chip as a number", async () => {
    vi.mocked(api.fetchReviewItems).mockResolvedValue([ALL[0] as ReviewCard]);
    const counts: ReviewCounts = { open: 1, partner: { displayName: "Sam", pending: 3 } };
    vi.mocked(api.fetchReviewCounts).mockResolvedValue(counts);
    renderPage();
    expect((await screen.findByTestId("partner-chip")).textContent).toBe("Sam: 3 left");
    expect(await screen.findByRole("heading", { name: "1 thing needs you" })).toBeTruthy();
  });

  it("calls the API for each action and refetches the inbox", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    const client = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await user.click(
      within(await cardOf("import.probable_duplicate")).getByRole("button", { name: "Keep both" }),
    );
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-import.probable_duplicate",
      "keep-duplicate",
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["review"] }));

    await user.click(
      within(await cardOf("import.probable_duplicate")).getByRole("button", {
        name: "Remove this one",
      }),
    );
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-import.probable_duplicate",
      "remove-duplicate",
    );

    const rule = await cardOf("classify.rule_offer");
    await user.click(within(rule).getByRole("button", { name: "Make it a rule" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-classify.rule_offer", "accept-rule");
    await user.click(within(rule).getByRole("button", { name: "Not now" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-classify.rule_offer", "dismiss-rule");

    const notice = await cardOf("identity.partner-reset");
    await user.click(within(notice).getByRole("button", { name: "Got it" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-identity.partner-reset",
      "dismiss-notice",
    );
    await user.click(within(notice).getByRole("button", { name: "Revoke the link" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-identity.partner-reset",
      "revoke-links",
    );
    expect(within(notice).getByText(/issued on 2026-10-20 by Alex/)).toBeTruthy();
  });

  it("links the chosen transfer candidate, or leaves them", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    renderPage();
    const el = await cardOf("import.transfer_ambiguous");
    const link = within(el).getByRole("button", {
      name: "Yes, it's a transfer",
    }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    await user.click(within(el).getAllByRole("radio")[1] as HTMLElement);
    await user.click(link);
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-import.transfer_ambiguous",
      "link-transfer",
      { candidateId: "c2" },
    );
    await user.click(within(el).getByRole("button", { name: "No, leave them" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith(
      "item-import.transfer_ambiguous",
      "dismiss-transfer",
    );
  });

  it("imports a hand-off into the chosen account, or discards it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    renderPage();
    const el = await cardOf("imports.handoff");
    const importBtn = within(el).getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    await waitFor(() =>
      expect(within(el).getByRole("option", { name: "Sam savings" })).toBeTruthy(),
    );
    await user.selectOptions(within(el).getByLabelText("Import into"), "acc-2");
    await user.click(importBtn);
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-imports.handoff", "accept-handoff", {
      accountId: "acc-2",
    });
    await user.click(within(el).getByRole("button", { name: "Discard file" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-imports.handoff", "dismiss-handoff");
  });

  it("fixes a set-aside row inline after checking the fields, or discards it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    renderPage();
    const el = await cardOf("import.set_aside");
    await user.click(within(el).getByRole("button", { name: "Save row 3" }));
    expect(within(el).getByRole("alert").textContent).toBe("Enter the date.");
    expect(api.reviewAction).not.toHaveBeenCalled();
    await user.type(within(el).getByLabelText("Date"), "2026-09-02");
    await user.type(within(el).getByLabelText("Amount"), "-12.5");
    await user.type(within(el).getByLabelText("Description"), "Bookstore");
    await user.click(within(el).getByRole("button", { name: "Save row 3" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-import.set_aside", "fix-row", {
      rowId: "row-1",
      postedOn: "2026-09-02",
      amountCents: -1250,
      description: "Bookstore",
    });
    await user.click(within(el).getByRole("button", { name: "Discard row 3" }));
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-import.set_aside", "discard-row", {
      rowId: "row-1",
    });
  });

  it("renders AI proposal beside raw line with Confirm, Edit prefill, and triggers Ask Pangolin to read these", async () => {
    const user = userEvent.setup();
    const setAsideCardWithProposal: ReviewCard = {
      id: "item-import.set_aside",
      kind: "import.set_aside",
      createdAt: "2026-10-20T10:00:00.000Z",
      accountId: null,
      detail: {
        type: "batch",
        source: "commbank_csv",
        accountName: "Joint everyday",
        rows: [
          {
            id: "row-prop-1",
            rowNumber: 1,
            rawLine: "31/09/2026,-36.00,BWS NEWTOWN",
            reason: "Bad date",
            proposal: {
              postedOn: "2026-09-30",
              amountCents: -3600,
              description: "BWS NEWTOWN",
              confidence: 0.95,
              explanation: "Adjusted 31 Sept to last day 30 Sept",
            },
          },
        ],
      },
    };

    vi.mocked(api.fetchReviewItems).mockResolvedValue([setAsideCardWithProposal]);
    renderPage();

    const el = await cardOf("import.set_aside");

    // 1. Trigger "Ask Pangolin to read these"
    const interpretBtn = within(el).getByRole("button", { name: "Ask Pangolin to read these" });
    await user.click(interpretBtn);
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-import.set_aside", "interpret-rows");

    // 2. Proposal box is displayed
    expect(within(el).getByText("AI proposal:")).toBeTruthy();
    expect(within(el).getByText("2026-09-30")).toBeTruthy();
    expect(within(el).getByText("-$36.00")).toBeTruthy();
    expect(within(el).getByText("BWS NEWTOWN")).toBeTruthy();
    expect(within(el).getByText("(95% sure)")).toBeTruthy();
    expect(within(el).getByText("Adjusted 31 Sept to last day 30 Sept")).toBeTruthy();

    // 3. Edit prefill: clicking Edit fills the date, amount, description inputs
    const editBtn = within(el).getByRole("button", { name: "Edit" });
    await user.click(editBtn);
    expect((within(el).getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-30");
    expect((within(el).getByLabelText("Amount") as HTMLInputElement).value).toBe("-36.00");
    expect((within(el).getByLabelText("Description") as HTMLInputElement).value).toBe("BWS NEWTOWN");

    // 4. Confirm proposal
    const confirmBtn = within(el).getByRole("button", { name: "Confirm" });
    await user.click(confirmBtn);
    expect(api.reviewAction).toHaveBeenLastCalledWith("item-import.set_aside", "confirm-proposal", {
      rowId: "row-prop-1",
    });
  });

  it("shows a failed action on its card and still refetches", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchReviewItems).mockResolvedValue(ALL);
    vi.mocked(api.reviewAction).mockRejectedValue(
      new ApiError(404, "NotFound", "Review item not found"),
    );
    renderPage();
    const el = await cardOf("import.probable_duplicate");
    await user.click(within(el).getByRole("button", { name: "Keep both" }));
    expect((await within(el).findByRole("alert")).textContent).toBe("Review item not found");
    await waitFor(() =>
      expect(vi.mocked(api.fetchReviewItems).mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("batches high-confidence suggestions (≥ 90%) into BulkAcceptCard, toggles unticking into individual card, and accepts all", async () => {
    const user = userEvent.setup();
    const high1: ReviewCard = {
      id: "sug-high-1",
      kind: "classify.unclassified",
      createdAt: "2026-10-20T10:00:00.000Z",
      accountId: "a1",
      detail: {
        type: "transaction",
        transaction: txn({ id: "t-high-1", description: "Woolworths", amountCents: -5420 }),
        candidates: [],
        suggestion: {
          id: "s1",
          splitId: "sp1",
          field: "category",
          suggestedValue: "groceries",
          categoryName: "Groceries",
          confidence: 0.95,
          payeeName: "Woolworths",
          websiteDomain: "woolworths.com.au",
        },
      },
    };
    const high2: ReviewCard = {
      id: "sug-high-2",
      kind: "classify.unclassified",
      createdAt: "2026-10-20T10:01:00.000Z",
      accountId: "a1",
      detail: {
        type: "transaction",
        transaction: txn({ id: "t-high-2", description: "BWS Liquor", amountCents: -3200 }),
        candidates: [],
        suggestion: {
          id: "s2",
          splitId: "sp2",
          field: "category",
          suggestedValue: "alcohol",
          categoryName: "Alcohol",
          confidence: 0.92,
          payeeName: "BWS",
          websiteDomain: "bws.com.au",
        },
      },
    };

    vi.mocked(api.fetchReviewItems).mockResolvedValue([high1, high2]);
    renderPage();

    // Verify BulkAcceptCard renders with 2 items pre-ticked
    const bulkCard = await screen.findByRole("listitem", { name: "Bulk accept suggestions" });
    expect(bulkCard).toBeTruthy();
    expect(within(bulkCard).getByText("2 more we're very sure about")).toBeTruthy();
    expect(within(bulkCard).getByText("Very sure · 90%+")).toBeTruthy();

    const checkboxes = within(bulkCard).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);

    // Untick first row: Woolworths
    await user.click(checkboxes[0]!);

    // Now Woolworths moves out into an individual AiSuggestionCard below
    await waitFor(() => {
      expect(within(bulkCard).getAllByRole("checkbox")).toHaveLength(1);
    });
    // Remaining in bulk card is BWS
    expect(within(bulkCard).getByText(/BWS Liquor/)).toBeTruthy();

    // Woolworths now appears below as an individual card with confidence meter and Accept/Dismiss
    const woolworthsCard = screen.getByRole("listitem", { name: "Needs a category" });
    expect(within(woolworthsCard).getByText("Woolworths")).toBeTruthy();
    expect(within(woolworthsCard).getByText("Suggested category:")).toBeTruthy();
    expect(within(woolworthsCard).getByText("Groceries")).toBeTruthy();
    expect(within(woolworthsCard).getByText("Very sure · 90%+")).toBeTruthy();
    expect(within(woolworthsCard).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(woolworthsCard).getByRole("button", { name: "Dismiss" })).toBeTruthy();

    // Accept all in bulk card: accepts remaining ticked items (sug-high-2)
    const acceptAllBtn = within(bulkCard).getByRole("button", { name: "Accept all" });
    await user.click(acceptAllBtn);
    expect(api.bulkAcceptSuggestions).toHaveBeenCalledWith({ ids: ["sug-high-2"] });
  });

  it("renders low/medium confidence suggestions as individual cards and executes accept and dismiss", async () => {
    const user = userEvent.setup();
    const lowSug: ReviewCard = {
      id: "sug-low-1",
      kind: "classify.unclassified",
      createdAt: "2026-10-20T10:00:00.000Z",
      accountId: "a1",
      detail: {
        type: "transaction",
        transaction: txn({ id: "t-low-1", description: "Corner Cafe", amountCents: -1450 }),
        candidates: [],
        suggestion: {
          id: "s-low",
          splitId: "sp-low",
          field: "category",
          suggestedValue: "dining",
          categoryName: "Eating out",
          confidence: 0.78,
          payeeName: "Corner Cafe",
          websiteDomain: null,
        },
      },
    };

    vi.mocked(api.fetchReviewItems).mockResolvedValue([lowSug]);
    renderPage();

    // Verify it renders as an individual card with "Fairly sure · 78%"
    const cardEl = await screen.findByRole("listitem", { name: "Needs a category" });
    expect(within(cardEl).getByText("Corner Cafe")).toBeTruthy();
    expect(within(cardEl).getByText("Eating out")).toBeTruthy();
    expect(within(cardEl).getByText("Fairly sure · 78%")).toBeTruthy();

    const acceptBtn = within(cardEl).getByRole("button", { name: "Accept" });
    const dismissBtn = within(cardEl).getByRole("button", { name: "Dismiss" });
    expect(acceptBtn).toBeTruthy();
    expect(dismissBtn).toBeTruthy();

    // Click Accept
    await user.click(acceptBtn);
    expect(api.reviewAction).toHaveBeenCalledWith("sug-low-1", "accept-suggestion");

    // Click Dismiss
    await user.click(dismissBtn);
    expect(api.reviewAction).toHaveBeenCalledWith("sug-low-1", "dismiss-suggestion");
  });

  it("renders a single high-confidence suggestion as an individual card and not bulk accept", async () => {
    const singleHigh: ReviewCard = {
      id: "sug-single-1",
      kind: "classify.unclassified",
      createdAt: "2026-10-20T10:00:00.000Z",
      accountId: "a1",
      detail: {
        type: "transaction",
        transaction: txn({ id: "t-single-1", description: "Bunnings", amountCents: -8500 }),
        candidates: [],
        suggestion: {
          id: "s-bunnings",
          splitId: "sp-bunnings",
          field: "category",
          suggestedValue: "hardware",
          categoryName: "Hardware",
          confidence: 0.94,
          payeeName: "Bunnings",
          websiteDomain: "bunnings.com.au",
        },
      },
    };

    vi.mocked(api.fetchReviewItems).mockResolvedValue([singleHigh]);
    renderPage();

    // No BulkAcceptCard should exist
    expect(screen.queryByRole("listitem", { name: "Bulk accept suggestions" })).toBeNull();

    // Individual card with "Very sure · 90%+"
    const cardEl = await screen.findByRole("listitem", { name: "Needs a category" });
    expect(within(cardEl).getByText("Bunnings")).toBeTruthy();
    expect(within(cardEl).getByText("Hardware")).toBeTruthy();
    expect(within(cardEl).getByText("Very sure · 90%+")).toBeTruthy();
    expect(within(cardEl).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(cardEl).getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
