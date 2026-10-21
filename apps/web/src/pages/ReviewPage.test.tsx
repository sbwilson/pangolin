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
  listAccounts: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.reviewAction).mockResolvedValue(undefined);
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
  card({
    kind: "import.set_aside",
    detail: {
      type: "batch",
      source: "commbank_csv",
      accountName: "Joint everyday",
      rows: [{ id: "row-1", rowNumber: 3, rawLine: "bad,line", reason: "Bad date" }],
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
    expect(await screen.findByRole("heading", { name: "14 things need you" })).toBeTruthy();
    const actions: Record<string, string[]> = {
      "classify.unclassified": [],
      "classify.rule_offer": ["Make it a rule", "Not now"],
      "import.probable_duplicate": ["Keep both", "Remove this one"],
      "import.transfer_ambiguous": ["Yes, it's a transfer", "No, leave them"],
      "import.set_aside": ["Save row 3", "Discard row 3"],
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
    expect(document.querySelectorAll("[data-kind]")).toHaveLength(14);
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
});
