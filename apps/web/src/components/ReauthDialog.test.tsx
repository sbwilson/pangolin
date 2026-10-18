// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { authClient } from "../auth-client.ts";
import { ReauthDialog } from "./ReauthDialog.tsx";

vi.mock("../auth-client.ts", () => ({
  authClient: {
    signIn: {
      passkey: vi.fn(),
      email: vi.fn(),
    },
    twoFactor: {
      verifyTotp: vi.fn(),
    },
  },
  authMessage: (err: { message?: string } | null | undefined) =>
    err?.message ?? "Authentication failed",
}));

describe("ReauthDialog", () => {
  const defaultAction = "perform sensitive action";
  let onSuccess: Mock<() => Promise<void>>;
  let onCancel: Mock<() => void>;

  beforeEach(() => {
    vi.resetAllMocks();
    onSuccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    onCancel = vi.fn<() => void>();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when open is false", () => {
    render(
      <ReauthDialog
        open={false}
        action={defaultAction}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders passkey sign-in by default when open is true", () => {
    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    const dialog = screen.getByRole("dialog", { name: "For your security, sign in again" });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByText(
        `Confirm it's you to ${defaultAction}. Once you're in, the change goes through.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in with passkey/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use password instead" })).toBeTruthy();
  });

  it("authenticates with passkey, invokes onSuccess, and closes dialog on success", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.passkey).mockResolvedValueOnce({
      data: { session: { token: "sess-token" } },
      error: null,
    } as unknown as never);

    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /Sign in with passkey/ }));

    await waitFor(() => {
      expect(authClient.signIn.passkey).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("displays error banner when passkey authentication fails", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.passkey).mockResolvedValueOnce({
      data: null,
      error: { message: "Passkey verification timed out" },
    } as unknown as never);

    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /Sign in with passkey/ }));

    await waitFor(() => {
      expect(authClient.signIn.passkey).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Passkey verification timed out")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("supports password fallback and TOTP verification flow", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
      data: { twoFactorRedirect: true },
      error: null,
    } as unknown as never);
    vi.mocked(authClient.twoFactor.verifyTotp).mockResolvedValueOnce({
      data: { session: { token: "totp-sess" } },
      error: null,
    } as unknown as never);

    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    // Switch to password mode
    await user.click(screen.getByRole("button", { name: "Use password instead" }));

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();

    await user.type(screen.getByLabelText("Email"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "supersecret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: "alex@example.com",
        password: "supersecret",
      });
    });

    // Should prompt for TOTP code
    const totpInput = await screen.findByLabelText("Authenticator code");
    expect(totpInput).toBeTruthy();

    await user.type(totpInput, "654321");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(authClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "654321" });
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("can switch back to passkey sign-in from password mode", async () => {
    const user = userEvent.setup();
    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: "Use password instead" }));
    expect(screen.getByLabelText("Email")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use passkey instead" }));
    expect(screen.getByRole("button", { name: /Sign in with passkey/ })).toBeTruthy();
  });

  it("calls onCancel when Cancel button or close icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel on Escape key press", async () => {
    const user = userEvent.setup();
    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel on backdrop click", async () => {
    const user = userEvent.setup();
    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    const backdrop = screen.getByRole("button", { name: "Close modal backdrop" });
    await user.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("displays error banner when onSuccess throws during re-auth completion", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.passkey).mockResolvedValueOnce({
      data: { session: {} },
      error: null,
    } as unknown as never);
    onSuccess.mockRejectedValueOnce(new Error("Downstream operation refused"));

    render(
      <ReauthDialog open={true} action={defaultAction} onSuccess={onSuccess} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /Sign in with passkey/ }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Downstream operation refused")).toBeTruthy();
    // onCancel should not be called so dialog remains open
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
