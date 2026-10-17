// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";

describe("ThemeSwitcher", () => {
  let queryClient: QueryClient;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    window.localStorage.clear();

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/identity/preferences")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body as string);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                theme: body.theme ?? "clay-linen",
                mode: body.mode ?? "system",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ theme: "clay-linen", mode: "system" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Reset documentElement attributes
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
    document.documentElement.removeAttribute("data-resolved-mode");
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderWithProviders() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ThemeSwitcher />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  it("sets default data-theme and data-mode attributes on <html>", () => {
    renderWithProviders();
    expect(document.documentElement.getAttribute("data-theme")).toBe("clay-linen");
    expect(document.documentElement.getAttribute("data-mode")).toBe("system");
    expect(document.documentElement.hasAttribute("data-resolved-mode")).toBe(true);
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("hydrates non-default preferences from the server on initial load", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/identity/preferences")) {
        return Promise.resolve(
          new Response(JSON.stringify({ theme: "fern-gully", mode: "dark" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    renderWithProviders();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("fern-gully");
      expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
      expect(document.documentElement.getAttribute("data-resolved-mode")).toBe("dark");
    });
  });

  it("updates data-theme attribute on <html> and dispatches API update when theme clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders();

    const harbourOption = screen.getByRole("radio", { name: /Harbour Morning/i });
    await user.click(harbourOption);

    expect(document.documentElement.getAttribute("data-theme")).toBe("harbour-morning");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/identity/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ theme: "harbour-morning" }),
      }),
    );
  });

  it("updates data-mode and data-resolved-mode on <html> and dispatches API update when mode clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders();

    const darkModeBtn = screen.getByRole("radio", { name: "Dark" });
    await user.click(darkModeBtn);

    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(document.documentElement.getAttribute("data-resolved-mode")).toBe("dark");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/identity/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ mode: "dark" }),
      }),
    );
  });

  it("resolves mode dynamically when set to system and listens to matchMedia changes", async () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    let currentMatches = false;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: currentMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: (e: { matches: boolean }) => void) => {
        listener = handler;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderWithProviders();
    expect(document.documentElement.getAttribute("data-resolved-mode")).toBe("light");

    // Simulate OS switching to dark scheme
    currentMatches = true;
    if (listener) {
      (listener as (e: { matches: boolean }) => void)({ matches: true });
    }

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-resolved-mode")).toBe("dark");
    });
  });

  it("complies with WAI-ARIA radiogroup: uses aria-checked, roving tabindex, and no aria-pressed", () => {
    renderWithProviders();

    const modeRadios = screen.getAllByRole("radio", { name: /(Light|Dark|System)/i });
    for (const radio of modeRadios) {
      expect(radio.getAttribute("aria-pressed")).toBeNull();
      const isChecked = radio.getAttribute("aria-checked") === "true";
      expect(radio.getAttribute("tabindex")).toBe(isChecked ? "0" : "-1");
    }

    const themeRadios = screen.getAllByRole("radio", {
      name: /(Clay|Harbour|Fern|Galah|Gelato|Black)/i,
    });
    for (const radio of themeRadios) {
      expect(radio.getAttribute("aria-pressed")).toBeNull();
      const isChecked = radio.getAttribute("aria-checked") === "true";
      expect(radio.getAttribute("tabindex")).toBe(isChecked ? "0" : "-1");
    }
  });

  it("maintains zero inline style attribute violations on html and body", async () => {
    const user = userEvent.setup();
    renderWithProviders();

    const galahOption = screen.getByRole("radio", { name: /Galah Party/i });
    await user.click(galahOption);

    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();
  });
});
