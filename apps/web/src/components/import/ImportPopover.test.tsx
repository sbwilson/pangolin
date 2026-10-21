// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api.ts";
import { ApiError, type Me } from "../../api.ts";
import { MAX_IMPORT_BYTES } from "../../lib/import-format.ts";
import { SessionContext } from "../../session.tsx";
import { ImportButton, ImportProvider, useImport } from "./index.ts";

vi.mock("../../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api.ts")>()),
  importFile: vi.fn(),
  handOffFile: vi.fn(),
  listAccounts: vi.fn(),
}));

afterEach(cleanup);

const me: Me = {
  personId: "me",
  displayName: "Alex",
  colour: "#123456",
  authAt: "2026-01-01T00:00:00Z",
  canInvite: true,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 8 },
  partner: { personId: "carissa", displayName: "Carissa" },
};

function Openers() {
  const { openImport } = useImport();
  return (
    <>
      <button type="button" onClick={() => openImport({ accountId: "a-mine" })}>
        Open for Everyday
      </button>
      <button type="button" onClick={() => openImport({ accountId: "gone" })}>
        Open for unknown
      </button>
      <button type="button" onClick={() => openImport()}>
        Open plain
      </button>
    </>
  );
}

const account = (id: string, name: string, pool: string) => ({ id, name, pool });

const result = (over: Partial<api.ImportResult> = {}): api.ImportResult => ({
  batchId: "b1",
  status: "committed",
  rowCount: 145,
  newCount: 142,
  dupCount: 3,
  setAsideCount: 0,
  needReviewCount: 0,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listAccounts).mockResolvedValue([
    account("a-mine", "Everyday", "me"),
    account("a-joint", "Joint", "shared"),
    account("a-hers", "Carissa savings", "carissa"),
  ] as never);
});

function renderApp() {
  const root = createRootRoute({
    component: () => (
      <SessionContext.Provider
        value={{
          me,
          signOut: async () => {},
          refresh: async () => {},
          signedIn: async () => {},
          signedUp: async () => {},
          token: "",
        }}
      >
        <ImportProvider>
          <ImportButton />
          <Openers />
          <Outlet />
        </ImportProvider>
      </SessionContext.Provider>
    ),
  });
  const review = createRoute({
    getParentRoute: () => root,
    path: "/review",
    component: () => <p>review page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([review]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const file = (name: string, body = "content") => new File([body], name);

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Import" }));
  return await screen.findByRole("dialog", { name: "Import a bank file" });
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  upload: File,
  target: string,
): Promise<void> {
  await user.upload(screen.getByTestId("import-file"), upload);
  await waitFor(() => expect(screen.getByRole("option", { name: "Everyday" })).toBeTruthy());
  await user.selectOptions(screen.getByLabelText("Which account is this for?"), target);
}

const importButton = () =>
  within(screen.getByRole("dialog")).getByRole("button", { name: "Import" });

describe("ImportPopover", () => {
  it("imports an OFX file into an own account and links to Needs review", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockResolvedValue(result({ dupCount: 0, needReviewCount: 3 }));
    const router = renderApp();
    await openPopover(user);
    await fill(user, file("commbank.ofx", "<OFX>"), "a-mine");
    await user.click(importButton());

    expect((await screen.findByTestId("import-status")).textContent).toContain("142 new");
    expect(api.importFile).toHaveBeenCalledWith({
      accountId: "a-mine",
      format: "commbank_ofx",
      content: "<OFX>",
    });
    await user.click(screen.getByRole("link", { name: "3 need review" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/review"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists Yours and Shared accounts, never the partner's, and 'For <partner>'", async () => {
    const user = userEvent.setup();
    renderApp();
    await openPopover(user);
    const select = screen.getByLabelText("Which account is this for?");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "Everyday" })).toBeTruthy(),
    );
    expect(within(select).getByRole("group", { name: "Yours" })).toBeTruthy();
    expect(within(select).getByRole("group", { name: "Shared" })).toBeTruthy();
    expect(within(select).queryByRole("option", { name: "Carissa savings" })).toBeNull();
    expect(within(select).getByRole("option", { name: "For Carissa" })).toBeTruthy();
  });

  it("reads a CSV by the chosen bank", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockResolvedValue(result());
    renderApp();
    await openPopover(user);
    await user.selectOptions(screen.getByLabelText("Which bank is the CSV from?"), "ubank_csv");
    await fill(user, file("ubank.csv", "a,b"), "a-joint");
    await user.click(importButton());
    await waitFor(() =>
      expect(api.importFile).toHaveBeenCalledWith({
        accountId: "a-joint",
        format: "ubank_csv",
        content: "a,b",
      }),
    );
  });

  it("says nothing is new when the same file is imported again", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockResolvedValue(
      result({ newCount: 0, dupCount: 145, rowCount: 145, needReviewCount: 0 }),
    );
    renderApp();
    await openPopover(user);
    await fill(user, file("a.ofx"), "a-mine");
    await user.click(importButton());
    expect((await screen.findByTestId("import-status")).textContent).toBe(
      "Nothing new. You've already imported all of this.",
    );
    expect(screen.queryByRole("link", { name: /need review/ })).toBeNull();
  });

  it("reports a partial import with a link to Needs review", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockResolvedValue(
      result({ newCount: 139, dupCount: 0, setAsideCount: 3, needReviewCount: 1 }),
    );
    renderApp();
    await openPopover(user);
    await fill(user, file("a.csv"), "a-mine");
    await user.click(importButton());
    const status = await screen.findByTestId("import-status");
    expect(status.textContent).toContain("139 imported · 3 set aside");
    expect(within(status).getByRole("link", { name: "1 needs review" })).toBeTruthy();
  });

  it("hands a file to the partner and shows only the hand-off message", async () => {
    const user = userEvent.setup();
    vi.mocked(api.handOffFile).mockResolvedValue(undefined);
    renderApp();
    await openPopover(user);
    await fill(user, file("up.csv", "x"), "handoff");
    await user.click(importButton());
    const status = await screen.findByTestId("import-status");
    expect(status.textContent).toBe("Handed to Carissa. It'll wait in their Needs review.");
    expect(api.handOffFile).toHaveBeenCalledWith({
      recipientId: "carissa",
      filename: "up.csv",
      format: "commbank_csv",
      content: "x",
    });
    expect(api.importFile).not.toHaveBeenCalled();
    expect(within(status).queryByRole("link")).toBeNull();
  });

  it.each(["statement.xlsx", "statement.pdf"])(
    "refuses %s and keeps Import disabled",
    async (name) => {
      const user = userEvent.setup();
      renderApp();
      await openPopover(user);
      await fill(user, file(name), "a-mine");
      const ext = name.slice(name.lastIndexOf("."));
      expect(screen.getByRole("alert").textContent).toBe(
        `We can't read ${ext} files. Try CSV, OFX or QIF.`,
      );
      expect((importButton() as HTMLButtonElement).disabled).toBe(true);
    },
  );

  it("refuses a file over 10 MiB", async () => {
    const user = userEvent.setup();
    renderApp();
    await openPopover(user);
    const big = file("big.csv");
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1 });
    await fill(user, big, "a-mine");
    expect(screen.getByRole("alert").textContent).toMatch(/over 10 MiB/);
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("needs a file and an account before Import is enabled", async () => {
    const user = userEvent.setup();
    renderApp();
    await openPopover(user);
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
    await user.upload(screen.getByTestId("import-file"), file("a.ofx"));
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows progress while pending, in the live region", async () => {
    const user = userEvent.setup();
    let finish: (value: api.ImportResult) => void = () => {};
    vi.mocked(api.importFile).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderApp();
    await openPopover(user);
    await fill(user, file("a.ofx"), "a-mine");
    await user.click(importButton());
    const status = screen.getByTestId("import-status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(status.textContent).toBe("Reading file…"));
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
    finish(result());
    await waitFor(() => expect(status.textContent).toContain("142 new"));
  });

  it("shows the server's reason when the import is refused", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockRejectedValue(
      new ApiError(400, "Validation", "Failed to parse statement: Invalid OFX"),
    );
    renderApp();
    await openPopover(user);
    await fill(user, file("a.ofx"), "a-mine");
    await user.click(importButton());
    expect((await screen.findByTestId("import-status")).textContent).toBe(
      "Failed to parse statement: Invalid OFX",
    );
  });

  it("shows a hidden account as not found and imports nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(api.importFile).mockRejectedValue(new ApiError(404, "NotFound", "Account not found"));
    renderApp();
    await openPopover(user);
    await fill(user, file("a.ofx"), "a-mine");
    await user.click(importButton());
    expect((await screen.findByTestId("import-status")).textContent).toBe("Account not found");
  });

  it("closes on Esc and returns focus to the Import button", async () => {
    const user = userEvent.setup();
    renderApp();
    await openPopover(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import" })),
    );
  });

  it("moves focus into the dialog and keeps Tab inside it", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openPopover(user);
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("ignores Esc, Cancel and the backdrop while an import is running", async () => {
    const user = userEvent.setup();
    let finish: (value: api.ImportResult) => void = () => {};
    vi.mocked(api.importFile).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderApp();
    await openPopover(user);
    await fill(user, file("a.ofx"), "a-mine");
    await user.click(importButton());
    await waitFor(() =>
      expect(screen.getByTestId("import-status").textContent).toBe("Reading file…"),
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close import", hidden: true }));
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    finish(result());
    await waitFor(() =>
      expect(screen.getByTestId("import-status").textContent).toContain("142 new"),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preselects the account from openImport, clears it on a plain open, and drops an unknown id", async () => {
    const user = userEvent.setup();
    renderApp();
    const select = () => screen.getByLabelText("Which account is this for?") as HTMLSelectElement;

    await user.click(await screen.findByRole("button", { name: "Open for Everyday" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(select().value).toBe("a-mine"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Open plain" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(select().value).toBe(""));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Open for unknown" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("option", { name: "Everyday" })).toBeTruthy());
    await waitFor(() => expect(select().value).toBe(""));
    await user.upload(screen.getByTestId("import-file"), file("a.ofx"));
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
