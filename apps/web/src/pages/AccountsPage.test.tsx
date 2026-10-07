// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { type AccountView, ApiError, type Me } from "../api.ts";
import { type Session, SessionContext } from "../session.tsx";
import { AccountsPage } from "./AccountsPage.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  listAccounts: vi.fn(),
  fetchInstitutions: vi.fn(),
  fetchAccountBalance: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  setAccountPrivacy: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchInstitutions).mockResolvedValue([{ id: "i1", name: "Harbour Bank" }]);
  vi.mocked(api.fetchAccountBalance).mockResolvedValue(123_456);
});

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

/** `YYYY-MM-DD` of `days` ago, as the page's own local-day clock sees it. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const both = [
  { personId: "p-alex", shareBp: 5000 },
  { personId: "p-sam", shareBp: 5000 },
];

const account = (over: Partial<AccountView> = {}): AccountView => ({
  id: "a1",
  name: "Joint everyday",
  type: "transaction",
  currency: "AUD",
  isPrivate: false,
  institutionId: "i1",
  openedOn: null,
  closedOn: null,
  isSavings: false,
  owners: both,
  pool: "shared",
  newestPostedOn: daysAgo(2),
  ...over,
});

const session: Session = {
  me,
  signOut: vi.fn(),
  refresh: vi.fn(),
  signedIn: vi.fn(),
  signedUp: vi.fn(),
  token: "",
};

function renderPage() {
  const root = createRootRoute({ component: AccountsPage });
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/accounts/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("AccountsPage", () => {
  it("groups the accounts, shows the Properties placeholder and the right balances", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([
      account(),
      account({ id: "a2", name: "Rainy day", type: "savings" }),
      account({ id: "a3", name: "Visa", type: "credit_card" }),
      account({ id: "a4", name: "Mortgage", type: "home_loan" }),
      account({ id: "a5", name: "Shares", type: "brokerage" }),
      account({ id: "a6", name: "Ute", type: "vehicle" }),
    ]);
    renderPage();
    for (const [label, name] of [
      ["Cash · 1", "Joint everyday"],
      ["Savings · 1", "Rainy day"],
      ["Cards · 1", "Visa"],
      ["Loans · 1", "Mortgage"],
      ["Investments · 1", "Shares"],
      ["Other · 1", "Ute"],
    ] as const) {
      const heading = await screen.findByRole("heading", { name: label });
      const group = heading.closest("section") as HTMLElement;
      expect(within(group).getByRole("link", { name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Properties" })).toBeTruthy();
    // Only the cash types have a balance, and the web shows the server's figure as is.
    expect(api.fetchAccountBalance).toHaveBeenCalledTimes(4);
    const shares = screen.getByRole("link", { name: "Shares" }).closest("li") as HTMLElement;
    expect(within(shares).queryByText("$1,234.56")).toBeNull();
    const everyday = screen.getByRole("link", { name: "Joint everyday" }).closest("li");
    expect(await within(everyday as HTMLElement).findByText("$1,234.56")).toBeTruthy();
  });

  it("marks a stale account in the warning colour and a private one with a lock", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([
      account({ id: "a1", name: "Old", newestPostedOn: daysAgo(46) }),
      account({ id: "a2", name: "Fresh", newestPostedOn: daysAgo(45) }),
      account({
        id: "a3",
        name: "Mine",
        isPrivate: true,
        owners: [{ personId: "p-alex", shareBp: 10000 }],
        pool: "p-alex",
      }),
    ]);
    renderPage();
    const old = (await screen.findByRole("link", { name: "Old" })).closest("li") as HTMLElement;
    const caption = within(old).getByText(/\(stale\)/);
    expect(caption.className).toContain("text-warning");
    const fresh = screen.getByRole("link", { name: "Fresh" }).closest("li") as HTMLElement;
    expect(within(fresh).queryByText(/stale/)).toBeNull();
    const mine = screen.getByRole("link", { name: "Mine" }).closest("li") as HTMLElement;
    expect(within(mine).getByRole("img", { name: "Private" })).toBeTruthy();
    expect(within(old).queryByRole("img", { name: "Private" })).toBeNull();
  });

  it("creates an account for its owner", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([]);
    vi.mocked(api.createAccount).mockResolvedValue(account({ name: "Holiday" }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Name"), "Holiday");
    await user.selectOptions(screen.getByLabelText("Type"), "savings");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add account" }),
    );
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledTimes(1));
    expect(api.createAccount).toHaveBeenCalledWith({
      name: "Holiday",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: "p-alex", shareBp: 10000 }],
      isSavings: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("splits the shares evenly when a second owner is ticked", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([]);
    vi.mocked(api.createAccount).mockResolvedValue(account());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Name"), "Joint");
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    expect((screen.getByLabelText("Alex share (%)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Sam share (%)") as HTMLInputElement).value).toBe("50");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add account" }),
    );
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createAccount).mock.calls[0]?.[0].owners).toEqual(both);
  });

  it("shows the server's message when it refuses an owner change", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([account()]);
    vi.mocked(api.updateAccount).mockRejectedValue(
      new ApiError(400, "Validation", "You can only join this account, not change its owners"),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You can only join this account, not change its owners",
    );
    expect(api.updateAccount).toHaveBeenCalledWith("a1", {
      owners: [{ personId: "p-alex", shareBp: 10000 }],
    });
  });

  it("shows a privacy refusal and what the server listed with it", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([
      account({
        isPrivate: true,
        owners: [{ personId: "p-alex", shareBp: 10000 }],
        pool: "p-alex",
      }),
    ]);
    vi.mocked(api.setAccountPrivacy).mockRejectedValue(
      new ApiError(409, "Conflict", "These are private to Alex and cannot be used yet", {
        payees: [{ name: "Corner Cafe" }],
        tags: [{ name: "Holiday" }],
        activities: [],
        owners: [{ personId: "p-alex", displayName: "Alex" }],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.click(screen.getByRole("button", { name: "Make public" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("These are private to Alex and cannot be used yet");
    expect(alert.textContent).toContain('payee "Corner Cafe"');
    expect(alert.textContent).toContain('tag "Holiday"');
    expect(alert.textContent).toContain("Owners: Alex");
    expect(api.setAccountPrivacy).toHaveBeenCalledWith("a1", false);
  });

  it("shows the server's message when it refuses to make an account private", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([account({ owners: [both[0] as never] })]);
    vi.mocked(api.setAccountPrivacy).mockRejectedValue(
      new ApiError(409, "Conflict", "The account has splits for someone other than its owner"),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.click(screen.getByRole("button", { name: "Make private" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The account has splits for someone other than its owner",
    );
  });
  it("makes a private account for its owner only", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([]);
    vi.mocked(api.createAccount).mockResolvedValue(account());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Name"), "Mine");
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    await user.click(screen.getByRole("checkbox", { name: /^Private/ }));
    const sam = screen.getByRole("checkbox", { name: "Sam" }) as HTMLInputElement;
    expect(sam.disabled).toBe(true);
    expect(sam.checked).toBe(false);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add account" }),
    );
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.createAccount).mock.calls[0]?.[0];
    expect(sent?.isPrivate).toBe(true);
    expect(sent?.owners).toEqual([{ personId: "p-alex", shareBp: 10000 }]);
  });

  it("sends only the details that changed", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([account({ institutionId: null })]);
    vi.mocked(api.updateAccount).mockResolvedValue(account());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.selectOptions(screen.getByLabelText("Institution"), "i1");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledTimes(1));
    expect(api.updateAccount).toHaveBeenCalledWith("a1", { name: "Renamed", institutionId: "i1" });
  });

  it("sends null, not an empty string, when the institution is cleared", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([account()]);
    vi.mocked(api.updateAccount).mockResolvedValue(account());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.selectOptions(screen.getByLabelText("Institution"), "");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledTimes(1));
    expect(api.updateAccount).toHaveBeenCalledWith("a1", { institutionId: null });
  });

  it("makes no call and still closes when nothing changed", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([account()]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.updateAccount).not.toHaveBeenCalled();
  });

  it("never sends owners for a private account", async () => {
    vi.mocked(api.listAccounts).mockResolvedValue([
      account({
        isPrivate: true,
        owners: [{ personId: "p-alex", shareBp: 10000 }],
        pool: "p-alex",
      }),
    ]);
    vi.mocked(api.updateAccount).mockResolvedValue(account());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Joint everyday" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledTimes(1));
    expect(api.updateAccount).toHaveBeenCalledWith("a1", { name: "Renamed" });
  });
});
