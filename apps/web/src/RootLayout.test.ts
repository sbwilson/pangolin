import { describe, expect, it } from "vitest";
import type { Me } from "./api.ts";
import { selectGate } from "./RootLayout.tsx";
import { normalizePath } from "./routes/search.ts";

const mockPerson = (overrides: Partial<Me> = {}): Me => ({
  personId: "person-1",
  displayName: "Alice",
  colour: "#123456",
  authAt: "2026-01-01T00:00:00Z",
  canInvite: true,
  demo: false,
  partner: null,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 8 },
  ...overrides,
});

describe("normalizePath", () => {
  it("strips trailing slash on multi-char paths", () => {
    expect(normalizePath("/setup/")).toBe("/setup");
    expect(normalizePath("/recover/")).toBe("/recover");
    expect(normalizePath("/transactions/")).toBe("/transactions");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizePath("/setup//")).toBe("/setup");
    expect(normalizePath("/recover///")).toBe("/recover");
  });

  it("leaves single-slash root unchanged", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("leaves multiple-slash root as single-slash", () => {
    expect(normalizePath("//")).toBe("/");
  });

  it("leaves path without trailing slash unchanged", () => {
    expect(normalizePath("/setup")).toBe("/setup");
    expect(normalizePath("/recover")).toBe("/recover");
  });
});

describe("selectGate", () => {
  it("selects pending when query is pending", () => {
    const gate = selectGate({ isPending: true, isError: false }, "/");
    expect(gate).toBe("pending");
  });

  it("selects error when query is in error", () => {
    const gate = selectGate({ isPending: false, isError: true }, "/");
    expect(gate).toBe("error");
  });

  it("selects recover-signed-in when signed-in person visits /recover or /recover/", () => {
    const person = mockPerson();
    expect(selectGate({ isPending: false, isError: false, data: person }, "/recover")).toBe(
      "recover-signed-in",
    );
    expect(selectGate({ isPending: false, isError: false, data: person }, "/recover/")).toBe(
      "recover-signed-in",
    );
  });

  it("selects recover when signed-out person visits /recover or /recover/", () => {
    expect(selectGate({ isPending: false, isError: false, data: null }, "/recover")).toBe(
      "recover",
    );
    expect(selectGate({ isPending: false, isError: false, data: null }, "/recover/")).toBe(
      "recover",
    );
  });

  it("selects enrol when person has incomplete enrolment", () => {
    const person = mockPerson({ enrolment: "incomplete", needs: ["passkey"] });
    expect(selectGate({ isPending: false, isError: false, data: person }, "/")).toBe("enrol");
    expect(selectGate({ isPending: false, isError: false, data: person }, "/setup")).toBe("enrol");
  });

  it("selects setup when signed-out person visits /setup or /setup/", () => {
    expect(selectGate({ isPending: false, isError: false, data: null }, "/setup")).toBe("setup");
    expect(selectGate({ isPending: false, isError: false, data: null }, "/setup/")).toBe("setup");
  });

  it("selects sign-in when signed-out person visits /sign-in or /sign-in/", () => {
    expect(selectGate({ isPending: false, isError: false, data: null }, "/sign-in")).toBe(
      "sign-in",
    );
    expect(selectGate({ isPending: false, isError: false, data: null }, "/sign-in/")).toBe(
      "sign-in",
    );
  });

  it("selects login when signed-out person visits other routes", () => {
    expect(selectGate({ isPending: false, isError: false, data: null }, "/")).toBe("login");
    expect(selectGate({ isPending: false, isError: false, data: null }, "/transactions")).toBe(
      "login",
    );
    expect(selectGate({ isPending: false, isError: false, data: null }, "/accounts")).toBe("login");
  });

  it("selects recovery-codes when person is not demo and recovery codes are not issued", () => {
    const person = mockPerson({
      demo: false,
      recoveryCodes: { issued: false, remaining: 0 },
    });
    expect(selectGate({ isPending: false, isError: false, data: person }, "/")).toBe(
      "recovery-codes",
    );
  });

  it("selects setup-signed-in when fully onboarded person visits /setup or /setup/", () => {
    const person = mockPerson();
    expect(selectGate({ isPending: false, isError: false, data: person }, "/setup")).toBe(
      "setup-signed-in",
    );
    expect(selectGate({ isPending: false, isError: false, data: person }, "/setup/")).toBe(
      "setup-signed-in",
    );
  });

  it("selects sign-in-signed-in when fully onboarded person visits /sign-in or /sign-in/", () => {
    const person = mockPerson();
    expect(selectGate({ isPending: false, isError: false, data: person }, "/sign-in")).toBe(
      "sign-in-signed-in",
    );
    expect(selectGate({ isPending: false, isError: false, data: person }, "/sign-in/")).toBe(
      "sign-in-signed-in",
    );
  });

  it("selects app when person is fully enrolled on regular paths", () => {
    const person = mockPerson();
    expect(selectGate({ isPending: false, isError: false, data: person }, "/")).toBe("app");
    expect(selectGate({ isPending: false, isError: false, data: person }, "/transactions")).toBe(
      "app",
    );
    expect(selectGate({ isPending: false, isError: false, data: person }, "/accounts/123")).toBe(
      "app",
    );
  });

  it("allows demo user without recovery codes into app", () => {
    const demoPerson = mockPerson({
      demo: true,
      recoveryCodes: { issued: false, remaining: 0 },
    });
    expect(selectGate({ isPending: false, isError: false, data: demoPerson }, "/")).toBe("app");
  });
});
