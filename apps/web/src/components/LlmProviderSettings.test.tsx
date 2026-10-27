// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api.ts";
import { authClient } from "../auth-client.ts";
import { LlmProviderSettings } from "./LlmProviderSettings.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  fetchLlmSettings: vi.fn(),
  createLlmProvider: vi.fn(),
  updateLlmProvider: vi.fn(),
  deleteLlmProvider: vi.fn(),
  testLlmProvider: vi.fn(),
  assignLlmPurpose: vi.fn(),
  fetchLlmRequestPreview: vi.fn(),
}));

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

describe("LlmProviderSettings", () => {
  let queryClient: QueryClient;

  const mockProviderLocal: api.LlmProviderSafeView = {
    id: "prov-local-1",
    name: "Ollama Local",
    kind: "openai",
    baseUrl: "http://192.168.1.50:11434/v1",
    model: "llama3.2",
    apiKeyLast4: null,
    isLocal: true,
    cloudPdf: false,
    cloudRows: false,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
  };

  const mockProviderCloud: api.LlmProviderSafeView = {
    id: "prov-cloud-1",
    name: "OpenAI Cloud",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyLast4: "7Q2a",
    isLocal: false,
    cloudPdf: true,
    cloudRows: false,
    createdAt: "2026-10-26T12:00:00Z",
    updatedAt: "2026-10-26T12:00:00Z",
  };

  beforeEach(() => {
    vi.resetAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.mocked(api.fetchLlmSettings).mockResolvedValue({
      providers: [mockProviderLocal, mockProviderCloud],
      assignments: [
        {
          purpose: "categorise",
          providerId: mockProviderLocal.id,
          updatedAt: "2026-10-26T12:00:00Z",
        },
      ],
    });

    vi.mocked(api.fetchLlmRequestPreview).mockResolvedValue({
      provider: mockProviderLocal,
      isLocal: true,
      model: "llama3.2",
      systemPrompt: "You are a financial transaction categorisation assistant.",
      prompt:
        "Available categories:\n- groceries: Groceries\n\nCategorise the following transactions:\n[0] Description: WOOLWORTHS | Amount: 54.20 AUD",
      schemaName: "categorise",
      schemaDescription: "Transaction categorisation suggestions",
      sampleItems: [
        {
          index: 0,
          description: "WOOLWORTHS",
          amountCents: -5420,
          postedOn: "2026-10-26",
          isPrivate: false,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderComponent() {
    return render(
      <QueryClientProvider client={queryClient}>
        <LlmProviderSettings />
      </QueryClientProvider>,
    );
  }

  it("renders configured providers and capability assignments with safe attributes", async () => {
    renderComponent();

    expect(await screen.findByText("Ollama Local")).toBeTruthy();
    expect(screen.getByText("OpenAI Cloud")).toBeTruthy();

    // Locality badges
    expect(screen.getByText("Local (LAN)")).toBeTruthy();
    expect(screen.getByText("Cloud")).toBeTruthy();

    // Masked API key
    expect(screen.getByText(/••••••••7Q2a/)).toBeTruthy();

    // Purpose dropdown has "Ollama Local" selected for categorise
    const categoriseSelect = screen.getByLabelText(
      "Select provider for Transaction categorisation",
    ) as HTMLSelectElement;
    expect(categoriseSelect.value).toBe(mockProviderLocal.id);
  });

  it("handles test connection success and failure", async () => {
    const user = userEvent.setup();
    vi.mocked(api.testLlmProvider).mockResolvedValueOnce({
      ok: true,
      latencyMs: 45,
    });

    renderComponent();
    await screen.findByText("Ollama Local");

    const testButtons = screen.getAllByRole("button", { name: "Test connection" });
    await user.click(testButtons[0]!);

    expect(api.testLlmProvider).toHaveBeenCalledWith(mockProviderLocal.id);
    expect(await screen.findByText("✓ Connected (45ms)")).toBeTruthy();

    // Test failure on second provider
    vi.mocked(api.testLlmProvider).mockResolvedValueOnce({
      ok: false,
      error: "401 Unauthorized: Invalid API key",
    });

    await user.click(testButtons[1]!);
    expect(api.testLlmProvider).toHaveBeenCalledWith(mockProviderCloud.id);
    expect(await screen.findByText(/401 Unauthorized: Invalid API key/)).toBeTruthy();
  });

  it("allows adding a new provider", async () => {
    const user = userEvent.setup();
    const newProvider: api.LlmProviderSafeView = {
      id: "prov-3",
      name: "Anthropic Claude",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-5-sonnet-latest",
      apiKeyLast4: "9xyz",
      isLocal: false,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T12:00:00Z",
      updatedAt: "2026-10-26T12:00:00Z",
    };
    vi.mocked(api.createLlmProvider).mockResolvedValueOnce(newProvider);

    renderComponent();
    await screen.findByText("Ollama Local");

    // Click Add provider
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    // Fill form
    await user.type(screen.getByLabelText("Name"), "Anthropic Claude");
    await user.selectOptions(screen.getByLabelText("Provider kind"), "anthropic");
    await user.type(screen.getByLabelText("Base URL"), "https://api.anthropic.com/v1");
    await user.type(screen.getByLabelText("Model name"), "claude-3-5-sonnet-latest");
    await user.type(screen.getByLabelText(/API key/), "sk-ant-test-key-9xyz");

    // Submit form
    const submitBtn = screen.getByRole("button", { name: "Add provider" });
    await user.click(submitBtn);

    expect(api.createLlmProvider).toHaveBeenCalledWith({
      name: "Anthropic Claude",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-5-sonnet-latest",
      apiKey: "sk-ant-test-key-9xyz",
      cloudPdf: false,
      cloudRows: false,
    });
  });

  it("triggers ReauthDialog on 403 ReauthRequired and retries after success", async () => {
    const user = userEvent.setup();
    const reauthErr = new api.ApiError(403, "ReauthRequired", "Sign in again to do this");

    vi.mocked(api.deleteLlmProvider)
      .mockRejectedValueOnce(reauthErr)
      .mockResolvedValueOnce({ success: true });

    // Mock passkey sign-in for reauth
    vi.mocked(authClient.signIn.passkey).mockResolvedValueOnce({
      data: {} as never,
      error: null,
    });

    renderComponent();
    await screen.findByText("OpenAI Cloud");

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deleteButtons[1]!); // delete OpenAI Cloud

    // ReauthDialog should now be visible
    expect(
      await screen.findByRole("dialog", { name: "For your security, sign in again" }),
    ).toBeTruthy();

    // Complete re-authentication
    const passkeyBtn = screen.getByRole("button", { name: /Sign in with passkey/i });
    await user.click(passkeyBtn);

    // After reauth success, deleteLlmProvider should have been retried
    await waitFor(() => {
      expect(api.deleteLlmProvider).toHaveBeenCalledTimes(2);
    });
  });

  it("toggles and displays live request preview", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Live request preview");

    // Initially collapsed
    expect(
      screen.queryByText(/You are a financial transaction categorisation assistant/),
    ).toBeNull();

    // Toggle open
    await user.click(screen.getByRole("button", { name: "View preview" }));

    expect(
      await screen.findByText(/You are a financial transaction categorisation assistant/),
    ).toBeTruthy();
    expect(screen.getByText(/WOOLWORTHS/)).toBeTruthy();
  });
});
