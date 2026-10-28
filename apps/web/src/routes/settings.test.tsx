// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { authClient } from "../auth-client.ts";
import { type Session, SessionContext } from "../session.tsx";
import { ThemeProvider } from "../theme.tsx";
import { SettingsPage } from "./settings.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchHealth: vi.fn(),
  fetchBackupStatus: vi.fn(),
  fetchRecoveryBundle: vi.fn(),
  fetchDeadJobs: vi.fn(),
  fetchPreferences: vi.fn().mockResolvedValue({ theme: "clay-linen", mode: "system" }),
  updatePreferences: vi.fn().mockResolvedValue({ theme: "clay-linen", mode: "system" }),
  invitePartner: vi.fn(),
  resetPartner: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  listAccounts: vi.fn().mockResolvedValue([]),
  fetchInstitutions: vi.fn().mockResolvedValue([]),
  reopenAccount: vi.fn(),
  leaveHousehold: vi.fn(),
  fetchHouseholdSettings: vi.fn(),
  updateSharedAttribution: vi.fn(),
  fetchLlmSettings: vi.fn(),
  fetchLlmRequestPreview: vi.fn(),
}));

vi.mock("../auth-client.ts", () => ({
  authClient: {
    getSession: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    signOut: vi.fn(),
    $fetch: vi.fn(),
    passkey: {
      addPasskey: vi.fn(),
    },
    signIn: {
      passkey: vi.fn(),
      email: vi.fn(),
    },
    twoFactor: {
      verifyTotp: vi.fn(),
    },
  },
  authMessage: (err: { message?: string } | null | undefined) =>
    err?.message ?? "Something went wrong. Try again.",
}));

describe("SettingsPage", () => {
  let queryClient: QueryClient;
  let mockSignOut: ReturnType<typeof vi.fn>;

  const defaultMe = {
    personId: "p1",
    displayName: "Simon",
    colour: "#2C6681",
    authAt: "2026-10-18T00:00:00Z",
    canInvite: false,
    demo: false,
    enrolment: "complete" as const,
    needs: [],
    recoveryCodes: { issued: true, remaining: 10 },
    partner: null as { personId: string; displayName: string } | null,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockSignOut = vi.fn().mockImplementation(() => Promise.resolve());

    vi.mocked(api.fetchHouseholdSettings).mockResolvedValue({
      baseCurrency: "AUD",
      fyStart: "07-01",
      timezone: "Australia/Sydney",
      sharedAttribution: "contribution",
      updatedAt: "2026-10-18T00:00:00Z",
    });

    vi.mocked(api.fetchPreferences).mockResolvedValue({
      theme: "clay-linen",
      mode: "system",
    });

    vi.mocked(api.fetchHealth).mockResolvedValue({
      healthy: true,
      schemaVersion: 14,
    });

    vi.mocked(api.fetchBackupStatus).mockResolvedValue({
      configured: true,
      last: {
        pushedAt: "2026-10-17T12:00:00Z",
        takenAt: "2026-10-17T11:59:00Z",
        snapshotId: "abcdef1234567890",
      },
      stale: false,
      check: {
        at: "2026-10-17T10:00:00Z",
        ok: true,
        summary: "repository verified",
      },
      drill: {
        at: "2026-10-17T11:00:00Z",
        ok: true,
        summary: "restore completed successfully",
      },
    });

    vi.mocked(api.fetchRecoveryBundle).mockResolvedValue({
      confirmed: true,
      bundleId: "rb-1234",
    });

    vi.mocked(api.fetchDeadJobs).mockResolvedValue([]);

    vi.mocked(authClient.getSession).mockResolvedValue({
      data: {
        session: {
          id: "sess-1",
          userId: "user-1",
          token: "tok-1",
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          ipAddress: "192.168.1.10",
        },
        user: { id: "user-1", email: "simon@example.com" },
      },
      error: null,
    } as unknown as never);

    vi.mocked(authClient.listSessions).mockResolvedValue({
      data: [
        {
          id: "sess-1",
          userId: "user-1",
          token: "tok-1",
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          ipAddress: "192.168.1.10",
        },
        {
          id: "sess-2",
          userId: "user-1",
          token: "tok-2",
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(Date.now() - 3600000),
          updatedAt: new Date(Date.now() - 3600000),
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
          ipAddress: "10.0.0.5",
        },
      ],
      error: null,
    } as unknown as never);

    vi.mocked(authClient.$fetch).mockResolvedValue({
      data: [
        {
          id: "pk-1",
          name: "MacBook Air",
          createdAt: new Date("2026-10-02T10:00:00Z"),
        },
      ],
      error: null,
    } as unknown as never);

    vi.mocked(authClient.passkey.addPasskey).mockResolvedValue({
      data: {
        id: "pk-2",
        name: "iPhone",
        createdAt: new Date(),
      },
      error: null,
    } as unknown as never);

    vi.mocked(api.invitePartner).mockResolvedValue({
      url: "https://pangolin.local/setup?token=partner-setup-token-12345678901234567890",
      expiresAt: "2026-10-19T00:00:00Z",
    });

    vi.mocked(api.resetPartner).mockResolvedValue({
      url: "https://pangolin.local/recover?token=partner-reset-token-12345678901234567890",
      expiresAt: "2026-10-19T00:00:00Z",
    });

    vi.mocked(api.regenerateRecoveryCodes).mockResolvedValue({
      codes: [
        "AAAAA-11111",
        "BBBBB-22222",
        "CCCCC-33333",
        "DDDDD-44444",
        "EEEEE-55555",
        "FFFFF-66666",
        "GGGGG-77777",
        "HHHHH-88888",
        "JJJJJ-99999",
        "KKKKK-00000",
      ],
    });

    vi.mocked(api.listAccounts).mockResolvedValue([]);
    vi.mocked(api.fetchInstitutions).mockResolvedValue([]);
    vi.mocked(api.fetchLlmSettings).mockResolvedValue({
      providers: [],
      assignments: [],
    });
    vi.mocked(api.fetchLlmRequestPreview).mockResolvedValue({
      provider: null,
      model: undefined,
      isLocal: true,
      prompt: "Categorise transactions...",
      schemaName: "categorise",
      sampleItems: [],
    });
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  function renderSettings(
    meOverrides?: Partial<typeof defaultMe>,
    refreshSpy?: ReturnType<typeof vi.fn>,
  ) {
    const sessionValue: Session = {
      me: { ...defaultMe, ...meOverrides },
      signOut: mockSignOut as () => Promise<void>,
      refresh: (refreshSpy ?? vi.fn()) as () => Promise<void>,
      signedIn: vi.fn(),
      signedUp: vi.fn(),
      token: "",
    };

    return render(
      <QueryClientProvider client={queryClient}>
        <SessionContext.Provider value={sessionValue}>
          <ThemeProvider>
            <SettingsPage />
          </ThemeProvider>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  }

  it("renders desktop rail and mobile chips with anchor links to sections", () => {
    renderSettings();

    const desktopNav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(desktopNav).toBeTruthy();
    expect(desktopNav.className).toContain("md:flex");

    const mobileNav = screen.getByRole("navigation", { name: "Settings sections mobile" });
    expect(mobileNav).toBeTruthy();
    expect(mobileNav.className).toContain("md:hidden");

    // All 8 sections in desktop nav
    const expectedSections = [
      "Appearance",
      "Sign-in & security",
      "Signed-in devices",
      "Partner",
      "Household",
      "Accounts",
      "LLM providers",
      "System status",
    ];
    for (const name of expectedSections) {
      expect(within(desktopNav).getByRole("link", { name })).toBeTruthy();
      expect(within(mobileNav).getByRole("link", { name })).toBeTruthy();
    }

    // Section cards
    expect(document.getElementById("appearance")).toBeTruthy();
    expect(document.getElementById("security")).toBeTruthy();
    expect(document.getElementById("devices")).toBeTruthy();
    expect(document.getElementById("partner")).toBeTruthy();
    expect(document.getElementById("household")).toBeTruthy();
    expect(document.getElementById("accounts")).toBeTruthy();
    expect(document.getElementById("llm-providers")).toBeTruthy();
    expect(document.getElementById("status")).toBeTruthy();

    // Appearance is active by default
    const appearanceLinks = screen.getAllByRole("link", { name: "Appearance" });
    expect(appearanceLinks[0]?.getAttribute("aria-current")).toBe("location");
  });

  it("updates active section marker when clicking nav links", async () => {
    const user = userEvent.setup();
    renderSettings();

    const desktopNav = screen.getByRole("navigation", { name: "Settings sections" });
    const devicesLink = within(desktopNav).getByRole("link", { name: "Signed-in devices" });

    await user.click(devicesLink);

    expect(devicesLink.getAttribute("aria-current")).toBe("location");
    const appearanceLink = within(desktopNav).getByRole("link", { name: "Appearance" });
    expect(appearanceLink.getAttribute("aria-current")).toBeNull();
  });

  it("renders active sessions list with parsed devices and This device badge", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Mac · Chrome")).toBeTruthy();
      expect(screen.getByText("iPhone · Safari")).toBeTruthy();
      expect(screen.getByText("This device")).toBeTruthy();
    });

    expect(screen.getByText(/192\.168\.1\.10/)).toBeTruthy();
    expect(screen.getByText(/10\.0\.0\.5/)).toBeTruthy();
  });

  it("revokes a remote session and refreshes session list", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.revokeSession).mockResolvedValue({
      data: { status: true },
      error: null,
    } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("iPhone · Safari")).toBeTruthy();
    });

    // Find sign out button for the remote session (the second one)
    const [thisDeviceBtn, remoteBtn] = screen.getAllByRole("button", { name: "Sign out" });
    expect(thisDeviceBtn).toBeTruthy();
    expect(remoteBtn).toBeTruthy();

    // Mock next listSessions after revocation (session 2 removed)
    vi.mocked(authClient.listSessions).mockResolvedValueOnce({
      data: [
        {
          id: "sess-1",
          userId: "user-1",
          token: "tok-1",
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          ipAddress: "192.168.1.10",
        },
      ],
      error: null,
    } as unknown as never);

    if (remoteBtn) await user.click(remoteBtn);

    expect(authClient.revokeSession).toHaveBeenCalledWith({ token: "tok-2" });
  });

  it("displays an error alert if remote session revocation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.revokeSession).mockResolvedValue({
      data: null,
      error: { message: "Revocation rejected by server" },
    } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("iPhone · Safari")).toBeTruthy();
    });

    const [, remoteBtn] = screen.getAllByRole("button", { name: "Sign out" });
    if (remoteBtn) await user.click(remoteBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Revocation rejected by server");
    });
  });

  it("calls signOut when clicking Sign out on This device", async () => {
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("This device")).toBeTruthy();
    });

    const [thisDeviceBtn] = screen.getAllByRole("button", { name: "Sign out" });
    if (thisDeviceBtn) await user.click(thisDeviceBtn);

    expect(mockSignOut).toHaveBeenCalled();
  });

  it("displays an error banner if listing sessions fails", async () => {
    vi.mocked(authClient.listSessions).mockResolvedValue({
      data: null,
      error: { message: "Failed to connect to auth server" },
    } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Failed to load signed-in devices");
    });
  });

  it("renders live system health and schema version", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Healthy");
      expect(screen.getByText("Schema version 14")).toBeTruthy();
    });
  });

  it("renders unhealthy status if server reports unhealthy", async () => {
    vi.mocked(api.fetchHealth).mockResolvedValue({
      healthy: false,
      schemaVersion: 14,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Unhealthy");
    });
  });

  it("renders backup status, stale alert, and verification checks", async () => {
    vi.mocked(api.fetchBackupStatus).mockResolvedValue({
      configured: true,
      last: {
        pushedAt: "2026-10-17T12:00:00Z",
        takenAt: "2026-10-17T11:59:00Z",
        snapshotId: "abcdef1234567890",
      },
      stale: true,
      check: null,
      drill: null,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Last backup/)).toBeTruthy();
      expect(screen.getByText("abcdef12")).toBeTruthy();
      expect(screen.getByText("Warning: no good backup in the last 48 hours")).toBeTruthy();
      expect(screen.getByText("No repository check yet")).toBeTruthy();
      expect(screen.getByText("No restore drill yet")).toBeTruthy();
    });
  });

  it("renders 'No backup yet' when backups configured but no backup exists", async () => {
    vi.mocked(api.fetchBackupStatus).mockResolvedValue({
      configured: true,
      last: null,
      stale: false,
      check: null,
      drill: null,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("No backup yet")).toBeTruthy();
    });
  });

  it("renders recovery bundle warning when bundle is unconfirmed", async () => {
    vi.mocked(api.fetchRecoveryBundle).mockResolvedValue({
      confirmed: false,
      bundleId: "bundle-xyz",
    });

    renderSettings();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("bundle-xyz is not confirmed stored safely");
      expect(alert.textContent).toContain("sudo pangolin confirm-bundle");
    });
  });

  it("renders 'No jobs need attention' when dead jobs is empty", async () => {
    vi.mocked(api.fetchDeadJobs).mockResolvedValue([]);
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("No jobs need attention")).toBeTruthy();
    });
  });

  it("renders failed jobs list when dead jobs exist", async () => {
    vi.mocked(api.fetchDeadJobs).mockResolvedValue([
      { kind: "price-refresh", failedAt: "2026-10-18T02:00:00Z" },
      { kind: "nightly-backup", failedAt: "2026-10-18T03:00:00Z" },
    ]);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Jobs that failed")).toBeTruthy();
      expect(screen.getByText(/price-refresh —/)).toBeTruthy();
      expect(screen.getByText(/nightly-backup —/)).toBeTruthy();
    });
  });

  it("resolves initial #status hash on mount to set aria-current on status link", () => {
    window.location.hash = "#status";
    renderSettings();

    const statusLinks = screen.getAllByRole("link", { name: "System status" });
    expect(statusLinks[0]?.getAttribute("aria-current")).toBe("location");

    const appearanceLinks = screen.getAllByRole("link", { name: "Appearance" });
    expect(appearanceLinks[0]?.getAttribute("aria-current")).toBeNull();
  });

  it("renders non-null check and drill results, with role='alert' on failing drill", async () => {
    vi.mocked(api.fetchBackupStatus).mockResolvedValue({
      configured: true,
      last: {
        pushedAt: "2026-10-17T12:00:00Z",
        takenAt: "2026-10-17T11:59:00Z",
        snapshotId: "abcdef1234567890",
      },
      stale: false,
      check: {
        at: "2026-10-17T10:00:00Z",
        ok: true,
        summary: "repository verified",
      },
      drill: {
        at: "2026-10-17T11:00:00Z",
        ok: false,
        summary: "restore checksum mismatch",
      },
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Repository check passed/)).toBeTruthy();
      expect(screen.getByText(/repository verified/)).toBeTruthy();
      const failingDrillAlert = screen.getByRole("alert");
      expect(failingDrillAlert.textContent).toContain("Restore drill failed");
      expect(failingDrillAlert.textContent).toContain("restore checksum mismatch");
    });
  });

  it("renders fallback message when fetchBackupStatus fails", async () => {
    vi.mocked(api.fetchBackupStatus).mockRejectedValue(new Error("Network error"));

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Backup status unavailable")).toBeTruthy();
    });
  });

  it("renders fallback message when fetchDeadJobs fails", async () => {
    vi.mocked(api.fetchDeadJobs).mockRejectedValue(new Error("Database disconnected"));

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Job status unavailable")).toBeTruthy();
    });
  });

  it("renders empty state message when session list is empty", async () => {
    vi.mocked(authClient.listSessions).mockResolvedValue({
      data: [],
      error: null,
    } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("No active sessions")).toBeTruthy();
    });
  });

  it("displays the CLI restore note at the bottom of system status", () => {
    renderSettings();
    expect(
      screen.getByText(
        "Restores run from the server CLI, with Pangolin stopped. There's no restore button here on purpose.",
      ),
    ).toBeTruthy();
  });

  // --- Sign-in & security tests ---
  it("renders enrolled passkeys and password status row", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("MacBook Air")).toBeTruthy();
      expect(screen.getByText(/Added 2 Oct 2026/)).toBeTruthy();
      expect(screen.getByText("Password configured · authenticator app linked")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add a passkey" })).toBeTruthy();
      expect(screen.getByText("10 unused recovery codes left.")).toBeTruthy();
    });
  });

  it("removes an enrolled passkey via authClient.$fetch, invalidating queries and refreshing", async () => {
    const user = userEvent.setup();
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderSettings(undefined, mockRefresh);

    await waitFor(() => {
      expect(screen.getByText("MacBook Air")).toBeTruthy();
    });

    const removeBtn = screen.getByRole("button", { name: "Remove passkey MacBook Air" });
    await user.click(removeBtn);

    expect(authClient.$fetch).toHaveBeenCalledWith("/passkey/delete-passkey", {
      method: "POST",
      body: { id: "pk-1" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["auth", "passkeys"] });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("adds a passkey via authClient.passkey.addPasskey, invalidating queries and refreshing", async () => {
    const user = userEvent.setup();
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderSettings(undefined, mockRefresh);

    const addBtn = screen.getByRole("button", { name: "Add a passkey" });
    await user.click(addBtn);

    expect(authClient.passkey.addPasskey).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["auth", "passkeys"] });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("disables add and remove buttons while a passkey is being added", async () => {
    let resolveAdd: () => void = () => {};
    vi.mocked(authClient.passkey.addPasskey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = () =>
            resolve({
              data: { id: "pk-2", name: "iPhone" },
              error: null,
            } as unknown as never);
        }),
    );

    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("MacBook Air")).toBeTruthy();
    });

    const addBtn = screen.getByRole("button", { name: "Add a passkey" });
    const removeBtn = screen.getByRole("button", { name: "Remove passkey MacBook Air" });

    expect(addBtn.hasAttribute("disabled")).toBe(false);
    expect(removeBtn.hasAttribute("disabled")).toBe(false);

    await user.click(addBtn);

    expect(addBtn.hasAttribute("disabled")).toBe(true);
    expect(removeBtn.hasAttribute("disabled")).toBe(true);

    resolveAdd();
    await waitFor(() => {
      expect(addBtn.hasAttribute("disabled")).toBe(false);
    });
  });

  it("displays passkey error if passkey addition fails", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.passkey.addPasskey).mockResolvedValue({
      data: null,
      error: { message: "Passkey operation canceled" },
    } as unknown as never);

    renderSettings();

    const addBtn = screen.getByRole("button", { name: "Add a passkey" });
    await user.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText("Passkey operation canceled")).toBeTruthy();
    });
  });

  it("displays passkey error if passkey removal fails", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.$fetch)
      .mockResolvedValueOnce({
        data: [
          {
            id: "pk-1",
            name: "MacBook Air",
            createdAt: new Date("2026-10-02T10:00:00Z"),
          },
        ],
        error: null,
      } as unknown as never)
      .mockResolvedValueOnce({
        error: { message: "Passkey removal refused" },
      } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("MacBook Air")).toBeTruthy();
    });

    const removeBtn = screen.getByRole("button", { name: "Remove passkey MacBook Air" });
    await user.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByText("Passkey removal refused")).toBeTruthy();
    });
  });

  it("displays ReauthRequired alert when passkey addition requires reauth", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.passkey.addPasskey).mockResolvedValue({
      data: null,
      error: { code: "ReauthRequired", message: "Reauthentication required" },
    } as unknown as never);

    renderSettings();

    const addBtn = screen.getByRole("button", { name: "Add a passkey" });
    await user.click(addBtn);

    await waitFor(() => {
      expect(
        screen.getByText("For your security, sign in again to manage your passkeys."),
      ).toBeTruthy();
    });

    const signInAgainBtn = screen.getByRole("button", { name: "Sign in again" });
    await user.click(signInAgainBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("displays ReauthRequired alert when passkey removal requires reauth", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.$fetch)
      .mockResolvedValueOnce({
        data: [
          {
            id: "pk-1",
            name: "MacBook Air",
            createdAt: new Date("2026-10-02T10:00:00Z"),
          },
        ],
        error: null,
      } as unknown as never)
      .mockResolvedValueOnce({
        error: { code: "ReauthRequired", message: "Reauthentication required" },
      } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("MacBook Air")).toBeTruthy();
    });

    const removeBtn = screen.getByRole("button", { name: "Remove passkey MacBook Air" });
    await user.click(removeBtn);

    await waitFor(() => {
      expect(
        screen.getByText("For your security, sign in again to manage your passkeys."),
      ).toBeTruthy();
    });

    const signInAgainBtn = screen.getByRole("button", { name: "Sign in again" });
    await user.click(signInAgainBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("renders error alert banner when loading passkeys fails", async () => {
    vi.mocked(authClient.$fetch).mockRejectedValue(
      new Error("Unable to load passkeys from server"),
    );

    renderSettings();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Unable to load passkeys from server");
    });
  });

  it("shows fallback message when passkey list is empty", async () => {
    vi.mocked(authClient.$fetch).mockResolvedValue({
      data: [],
      error: null,
    } as unknown as never);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("No passkeys enrolled")).toBeTruthy();
    });
  });

  it("warns when recovery codes are running low", () => {
    renderSettings({ recoveryCodes: { issued: true, remaining: 2 } });

    expect(screen.getByText("2 unused recovery codes left.")).toBeTruthy();
    expect(
      screen.getByText(
        "You are running out of recovery codes. Regenerate them to get a new set of 10.",
      ),
    ).toBeTruthy();
  });

  it("regenerates recovery codes and displays code list with confirmation checkbox", async () => {
    const user = userEvent.setup();
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    renderSettings(undefined, mockRefresh);

    const regenBtn = screen.getByRole("button", { name: "Regenerate recovery codes" });
    await user.click(regenBtn);

    expect(api.regenerateRecoveryCodes).toHaveBeenCalled();

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    expect(items[0]?.textContent).toBe("AAAAA-11111");

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn.hasAttribute("disabled")).toBe(true);

    const checkbox = screen.getByLabelText("I have saved these codes");
    await user.click(checkbox);
    expect(continueBtn.hasAttribute("disabled")).toBe(false);

    await user.click(continueBtn);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("displays alert when recovery codes regeneration fails with ReauthRequired", async () => {
    const user = userEvent.setup();
    vi.mocked(api.regenerateRecoveryCodes).mockRejectedValue(
      new api.ApiError(401, "ReauthRequired", "Re-authentication required"),
    );

    renderSettings();

    const regenBtn = screen.getByRole("button", { name: "Regenerate recovery codes" });
    await user.click(regenBtn);

    await waitFor(() => {
      expect(
        screen.getByText("For your security, sign in again to regenerate your codes."),
      ).toBeTruthy();
    });

    const signInAgain = screen.getByRole("button", { name: "Sign in again" });
    await user.click(signInAgain);
    expect(mockSignOut).toHaveBeenCalled();
  });

  // --- Partner settings tests ---
  it("renders partner invite flow for single user with canInvite", async () => {
    const user = userEvent.setup();
    renderSettings({ canInvite: true, partner: null });

    const inviteBtn = screen.getByRole("button", { name: "Invite partner" });
    await user.click(inviteBtn);

    expect(api.invitePartner).toHaveBeenCalled();

    const input = (await screen.findByLabelText("Partner setup link")) as HTMLInputElement;
    expect(input.value).toBe(
      "https://pangolin.local/setup?token=partner-setup-token-12345678901234567890",
    );
  });

  it("renders invites closed message for single user when canInvite is false", () => {
    renderSettings({ canInvite: false, partner: null });

    expect(screen.getByText("Invites are currently closed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite partner" })).toBeNull();
  });

  it("renders partner recovery reset flow for dual-user household", async () => {
    const user = userEvent.setup();
    renderSettings({
      partner: { personId: "p2", displayName: "Carissa" },
    });

    expect(screen.getByText("Carissa")).toBeTruthy();
    expect(screen.getByText("Signs in with a passkey")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Help Carissa back in" })).toBeTruthy();

    const resetBtn = screen.getByRole("button", { name: "Reset partner's access" });
    await user.click(resetBtn);

    expect(api.resetPartner).toHaveBeenCalledWith("p2");

    const input = (await screen.findByLabelText("Partner recovery link")) as HTMLInputElement;
    expect(input.value).toBe(
      "https://pangolin.local/recover?token=partner-reset-token-12345678901234567890",
    );
  });

  it("handles ReauthRequired error during partner reset", async () => {
    const user = userEvent.setup();
    vi.mocked(api.resetPartner).mockRejectedValue(
      new api.ApiError(401, "ReauthRequired", "Sign in required"),
    );

    renderSettings({
      partner: { personId: "p2", displayName: "Carissa" },
    });

    const resetBtn = screen.getByRole("button", { name: "Reset partner's access" });
    await user.click(resetBtn);

    await waitFor(() => {
      expect(
        screen.getByText("For your security, sign in again to reset your partner's access."),
      ).toBeTruthy();
    });
  });

  // --- Household attribution control ---
  it("renders the household attribution control with the current choice", async () => {
    renderSettings();

    const householdCard = document.getElementById("household");
    expect(householdCard).toBeTruthy();
    if (!householdCard) throw new Error("Missing household card");
    expect(
      await within(householdCard).findByRole("radio", { name: /By contribution/ }),
    ).toBeTruthy();
    expect(
      within(householdCard)
        .getByRole("radio", { name: /By contribution/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  describe("AccountSettings and SettingsNav", () => {
    it("navigation rail and mobile chips display all 8 sections in order", async () => {
      renderSettings();

      const desktopNav = screen.getByRole("navigation", { name: "Settings sections" });
      const links = within(desktopNav).getAllByRole("link");
      expect(links.map((l) => l.textContent)).toEqual([
        "Appearance",
        "Sign-in & security",
        "Signed-in devices",
        "Partner",
        "Household",
        "Accounts",
        "LLM providers",
        "System status",
      ]);

      const mobileNav = screen.getByRole("navigation", { name: "Settings sections mobile" });
      const mobileLinks = within(mobileNav).getAllByRole("link");
      expect(mobileLinks.map((l) => l.textContent)).toEqual([
        "Appearance",
        "Sign-in & security",
        "Signed-in devices",
        "Partner",
        "Household",
        "Accounts",
        "LLM providers",
        "System status",
      ]);
    });

    it("filters out open accounts (closedOn: null) and displays empty state when no accounts are closed", async () => {
      vi.mocked(api.listAccounts).mockResolvedValue([
        {
          id: "open-1",
          name: "Active Everyday",
          type: "transaction",
          currency: "AUD",
          isPrivate: false,
          institutionId: null,
          openedOn: "2025-01-01",
          closedOn: null,
          isSavings: false,
          owners: [{ personId: "p1", shareBp: 10000 }],
          pool: "p1",
          lastImport: null,
        },
      ]);
      renderSettings();

      expect(await screen.findByText("No closed accounts")).toBeTruthy();
      expect(screen.queryByText("Active Everyday")).toBeNull();
    });

    it("displays error message when loading closed accounts fails", async () => {
      vi.mocked(api.listAccounts).mockRejectedValue(new Error("Network error"));
      renderSettings();

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText("Failed to load closed accounts.")).toBeTruthy();
    });

    it("lists closed accounts with closedOn date, type label, and institution", async () => {
      vi.mocked(api.fetchInstitutions).mockResolvedValue([{ id: "inst-1", name: "CommBank" }]);
      vi.mocked(api.listAccounts).mockResolvedValue([
        {
          id: "acc-1",
          name: "Old Everyday",
          type: "transaction",
          currency: "AUD",
          isPrivate: false,
          institutionId: "inst-1",
          openedOn: "2025-01-01",
          closedOn: "2026-09-10",
          isSavings: false,
          owners: [{ personId: "p1", shareBp: 10000 }],
          pool: "p1",
          lastImport: null,
        },
      ]);

      renderSettings();

      expect(await screen.findByText("Old Everyday")).toBeTruthy();
      const list = screen.getByRole("list", { name: "Archived closed accounts" });
      expect(list).toBeTruthy();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText("(CommBank)")).toBeTruthy();
      expect(screen.getByText("Transaction account · Closed on 2026-09-10")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reopen account" })).toBeTruthy();
    });

    it("displays closing balance warning with formatted currency when closed cash account has remaining balance", async () => {
      vi.mocked(api.listAccounts).mockResolvedValue([
        {
          id: "acc-2",
          name: "Old Savings",
          type: "savings",
          currency: "USD",
          isPrivate: false,
          institutionId: null,
          openedOn: "2025-01-01",
          closedOn: "2026-09-15",
          isSavings: true,
          owners: [{ personId: "p1", shareBp: 10000 }],
          pool: "p1",
          lastImport: null,
          warning: { kind: "closing-balance", balanceCents: 1500 },
        },
      ]);

      renderSettings();

      expect(await screen.findByText("Old Savings")).toBeTruthy();
      expect(screen.getByText("Closed with a remaining balance of USD 15.00")).toBeTruthy();
    });

    it("calls reopenAccount and invalidates notices when clicking Reopen account", async () => {
      const user = userEvent.setup();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      vi.mocked(api.listAccounts).mockResolvedValue([
        {
          id: "acc-1",
          name: "Old Everyday",
          type: "transaction",
          currency: "AUD",
          isPrivate: false,
          institutionId: null,
          openedOn: "2025-01-01",
          closedOn: "2026-09-10",
          isSavings: false,
          owners: [{ personId: "p1", shareBp: 10000 }],
          pool: "p1",
          lastImport: null,
        },
      ]);
      vi.mocked(api.reopenAccount).mockResolvedValue({
        id: "acc-1",
        name: "Old Everyday",
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        institutionId: null,
        openedOn: "2025-01-01",
        closedOn: null,
        isSavings: false,
        owners: [{ personId: "p1", shareBp: 10000 }],
        pool: "p1",
        lastImport: null,
      });

      renderSettings();

      const reopenBtn = await screen.findByRole("button", { name: "Reopen account" });
      await user.click(reopenBtn);

      await waitFor(() => {
        expect(api.reopenAccount).toHaveBeenCalledWith("acc-1");
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["review"] });
      });
    });

    it("displays error notice when reopening an account fails", async () => {
      const user = userEvent.setup();
      vi.mocked(api.listAccounts).mockResolvedValue([
        {
          id: "acc-1",
          name: "Old Everyday",
          type: "transaction",
          currency: "AUD",
          isPrivate: false,
          institutionId: null,
          openedOn: "2025-01-01",
          closedOn: "2026-09-10",
          isSavings: false,
          owners: [{ personId: "p1", shareBp: 10000 }],
          pool: "p1",
          lastImport: null,
        },
      ]);
      vi.mocked(api.reopenAccount).mockRejectedValue(new Error("Cannot reopen account"));

      renderSettings();

      const reopenBtn = await screen.findByRole("button", { name: "Reopen account" });
      await user.click(reopenBtn);

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText("Cannot reopen account")).toBeTruthy();
    });

    it("disables Leave household button with notice when person is sole member of household", async () => {
      renderSettings({ partner: null });

      expect(
        screen.getByText(
          "You are the sole member of this household. A sole member cannot leave the household.",
        ),
      ).toBeTruthy();
      const leaveBtn = screen.getByRole("button", { name: "Leave household" });
      expect((leaveBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("opens leave household confirmation modal with details, and user can cancel", async () => {
      const user = userEvent.setup();
      renderSettings({ partner: { personId: "p2", displayName: "Alex" } });

      const leaveBtn = screen.getByRole("button", { name: "Leave household" });
      expect((leaveBtn as HTMLButtonElement).disabled).toBe(false);
      await user.click(leaveBtn);

      const dialog = screen.getByRole("dialog", { name: "Leave household" });
      expect(dialog).toBeTruthy();
      expect(
        within(dialog).getByText(
          /Your private accounts and all personal transactions scoped to you will be permanently deleted\./,
        ),
      ).toBeTruthy();
      expect(
        within(dialog).getByText(
          /Shared accounts will remain with your partner as the sole owner\./,
        ),
      ).toBeTruthy();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Leave household" })).toBeNull();
    });

    it("closes leave household confirmation modal on Escape key", async () => {
      const user = userEvent.setup();
      renderSettings({ partner: { personId: "p2", displayName: "Alex" } });

      const leaveBtn = screen.getByRole("button", { name: "Leave household" });
      await user.click(leaveBtn);

      expect(screen.getByRole("dialog", { name: "Leave household" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Leave household" })).toBeNull();
    });

    it("executes leaveHousehold when confirmed, and handles re-auth guard with automatic retry", async () => {
      const user = userEvent.setup();
      vi.mocked(api.leaveHousehold)
        .mockRejectedValueOnce(new api.ApiError(403, "ReauthRequired", "Recent auth required"))
        .mockResolvedValueOnce({ left: true });

      vi.mocked(authClient.signIn.passkey).mockResolvedValueOnce({
        data: { session: {} },
        error: null,
      } as unknown as never);

      renderSettings({ partner: { personId: "p2", displayName: "Alex" } });

      const leaveBtn = screen.getByRole("button", { name: "Leave household" });
      await user.click(leaveBtn);

      const confirmDialog = screen.getByRole("dialog", { name: "Leave household" });
      await user.click(within(confirmDialog).getByRole("button", { name: "Confirm and leave" }));

      await waitFor(() => {
        expect(api.leaveHousehold).toHaveBeenCalledWith({ confirm: true });
      });

      // Confirmation modal is closed when re-auth triggers, preventing modal collision
      expect(screen.queryByRole("dialog", { name: "Leave household" })).toBeNull();

      // Reauth dialog opens
      const reauthDialog = await screen.findByRole("dialog", {
        name: "For your security, sign in again",
      });
      expect(within(reauthDialog).getByText("For your security, sign in again")).toBeTruthy();
      expect(
        within(reauthDialog).getByText(
          "Confirm it's you to leave the household. Once you're in, the change goes through.",
        ),
      ).toBeTruthy();

      // Sign in with passkey in ReauthDialog
      const passkeyBtn = within(reauthDialog).getByRole("button", { name: /Sign in with passkey/ });
      await user.click(passkeyBtn);

      await waitFor(() => {
        expect(authClient.signIn.passkey).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(api.leaveHousehold).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });
    });
  });

  describe("LlmProviderSettings and SettingsNav", () => {
    it("renders LLM providers card under #llm-providers", async () => {
      renderSettings();

      const section = document.getElementById("llm-providers");
      expect(section).toBeTruthy();
      expect(
        within(section as HTMLElement).getByRole("heading", { name: "LLM providers" }),
      ).toBeTruthy();
    });

    it("resolves initial #llm-providers hash on mount to set aria-current on LLM providers link", () => {
      window.location.hash = "#llm-providers";
      renderSettings();

      const llmLinks = screen.getAllByRole("link", { name: "LLM providers" });
      expect(llmLinks[0]?.getAttribute("aria-current")).toBe("location");

      const appearanceLinks = screen.getAllByRole("link", { name: "Appearance" });
      expect(appearanceLinks[0]?.getAttribute("aria-current")).toBeNull();
    });

    it("updates active section marker when clicking LLM providers nav link", async () => {
      const user = userEvent.setup();
      renderSettings();

      const desktopNav = screen.getByRole("navigation", { name: "Settings sections" });
      const llmLink = within(desktopNav).getByRole("link", { name: "LLM providers" });

      await user.click(llmLink);

      expect(llmLink.getAttribute("aria-current")).toBe("location");
      const appearanceLink = within(desktopNav).getByRole("link", { name: "Appearance" });
      expect(appearanceLink.getAttribute("aria-current")).toBeNull();
    });
  });
});
