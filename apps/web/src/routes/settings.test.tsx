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
}));

vi.mock("../auth-client.ts", () => ({
  authClient: {
    getSession: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    signOut: vi.fn(),
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
    partner: null,
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
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  function renderSettings() {
    const sessionValue: Session = {
      me: defaultMe,
      signOut: mockSignOut as () => Promise<void>,
      refresh: vi.fn(),
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

    // Section cards
    expect(document.getElementById("appearance")).toBeTruthy();
    expect(document.getElementById("devices")).toBeTruthy();
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
});
