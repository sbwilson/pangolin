// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdSettings } from "./HouseholdSettings.tsx";

const settings = (sharedAttribution: string) => ({
  baseCurrency: "AUD",
  fyStart: "07-01",
  timezone: "Australia/Sydney",
  sharedAttribution,
  updatedAt: "2026-09-27T00:00:00.000Z",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("HouseholdSettings", () => {
  let original: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    original = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = original;
  });

  function renderIt() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <HouseholdSettings />
      </QueryClientProvider>,
    );
    return invalidate;
  }

  it("shows the current attribution and patches the other one, then refreshes reports", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json(settings(JSON.parse(init.body as string).sharedAttribution))
        : json(settings("contribution")),
    );
    const invalidate = renderIt();
    const group = await screen.findByRole("radiogroup", { name: "Shared spending attribution" });
    expect(group).toBeTruthy();
    const contribution = screen.getByRole("radio", { name: /By contribution/ });
    const even = screen.getByRole("radio", { name: /50\/50/ });
    expect(contribution.getAttribute("aria-checked")).toBe("true");
    expect(even.getAttribute("aria-checked")).toBe("false");
    await user.click(even);
    await waitFor(() => expect(even.getAttribute("aria-checked")).toBe("true"));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/system/household");
    expect(JSON.parse(patch?.[1].body)).toEqual({ sharedAttribution: "even" });
    expect(contribution.getAttribute("aria-checked")).toBe("false");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reports"] });
  });

  it("says when the change fails and keeps the old choice", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json({ error: { code: "Conflict", message: "Demo mode is read-only" } }, 409)
        : json(settings("even")),
    );
    renderIt();
    await user.click(await screen.findByRole("radio", { name: /By contribution/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not change/);
    expect(screen.getByRole("radio", { name: /50\/50/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("says when the settings are unavailable", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: "Internal", message: "x" } }, 500));
    renderIt();
    expect((await screen.findByRole("alert")).textContent).toMatch(/unavailable/);
  });
});
