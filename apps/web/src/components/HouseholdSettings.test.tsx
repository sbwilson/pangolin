// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Session, SessionContext } from "../session.tsx";
import { HouseholdSettings } from "./HouseholdSettings.tsx";

const settings = (sharedAttribution: string, householdPayAnchorPersonId: string | null = null) => ({
  baseCurrency: "AUD",
  fyStart: "07-01",
  timezone: "Australia/Sydney",
  sharedAttribution,
  householdPayAnchorPersonId,
  updatedAt: "2026-09-27T00:00:00.000Z",
});

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
  partner: { personId: "p2", displayName: "Taylor" },
};

const sessionValue: Session = {
  me: defaultMe,
  signOut: vi.fn(),
  refresh: vi.fn(),
  signedIn: vi.fn(),
  signedUp: vi.fn(),
  token: "",
};

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
        <SessionContext.Provider value={sessionValue}>
          <HouseholdSettings />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    return invalidate;
  }

  it("shows the current attribution and patches the other one, then refreshes reports", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/system/household" && init?.method === "PATCH") {
        return json(settings(JSON.parse(init.body as string).sharedAttribution));
      }
      if (url === "/api/system/household") return json(settings("contribution"));
      if (url === "/api/planning/pay-anchors") return json({ payAnchor: null });
      if (url.includes("/api/accounts"))
        return json({ accounts: [{ id: "acc1", name: "Everyday" }] });
      return json({});
    });
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/system/household" && init?.method === "PATCH") {
        return json({ error: { code: "Conflict", message: "Demo mode is read-only" } }, 409);
      }
      if (url === "/api/system/household") return json(settings("even"));
      if (url === "/api/planning/pay-anchors") return json({ payAnchor: null });
      if (url.includes("/api/accounts")) return json({ accounts: [] });
      return json({});
    });
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

  it("allows selecting household pay cycle leader", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/system/household" && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        return json(settings("contribution", body.householdPayAnchorPersonId));
      }
      if (url === "/api/system/household") return json(settings("contribution", null));
      if (url === "/api/planning/pay-anchors") return json({ payAnchor: null });
      if (url.includes("/api/accounts"))
        return json({ accounts: [{ id: "acc1", name: "Everyday" }] });
      return json({});
    });
    renderIt();

    const select = await screen.findByRole("combobox", { name: "Household pay cycle leader" });
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe("");

    await user.selectOptions(select, "p1");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("p1"));

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/system/household");
    expect(JSON.parse(patch?.[1].body)).toEqual({ householdPayAnchorPersonId: "p1" });
  });

  it("loads and saves personal pay anchor", async () => {
    const user = userEvent.setup();
    let savedAnchor: any = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/system/household") return json(settings("contribution", null));
      if (url === "/api/planning/pay-anchors" && init?.method === "PUT") {
        savedAnchor = JSON.parse(init.body as string);
        return json({
          id: "pa1",
          personId: "p1",
          ...savedAnchor,
        });
      }
      if (url === "/api/planning/pay-anchors") {
        return json({
          payAnchors: [
            {
              id: "pa1",
              personId: "p1",
              accountId: "acc1",
              cadence: "fortnightly",
              anchorDate: "2026-10-10",
              dayOfMonth: null,
              alignment: "calendar",
              expectedNetCents: 320000,
              expectedGrossCents: 450000,
            },
          ],
        });
      }
      if (url.includes("/api/accounts"))
        return json({ accounts: [{ id: "acc1", name: "Everyday" }] });
      return json({});
    });

    renderIt();

    const netInput = await screen.findByRole("textbox", { name: "Expected net pay" });
    await waitFor(() => expect((netInput as HTMLInputElement).value).toBe("3200.00"));

    await user.clear(netInput);
    await user.type(netInput, "3500.00");

    const saveBtn = screen.getByRole("button", { name: "Save Pay Anchor" });
    await user.click(saveBtn);

    await waitFor(() => expect(screen.getByText("Pay anchor saved successfully.")).toBeTruthy());
    expect(savedAnchor).toMatchObject({
      accountId: "acc1",
      cadence: "fortnightly",
      expectedNetCents: 350000,
      expectedGrossCents: 450000,
    });
  });
});
