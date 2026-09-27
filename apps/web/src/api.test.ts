import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  dismissNotice,
  fetchDeadJobs,
  fetchHealth,
  fetchMe,
  fetchNotices,
  invitePartner,
  recoverWithCode,
  reEnrol,
  regenerateRecoveryCodes,
} from "./api.ts";

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHealth", () => {
  it("maps 200 ok to healthy", async () => {
    stubFetch(200, { status: "ok", schemaVersion: 1, writable: true });
    expect(await fetchHealth()).toEqual({ healthy: true, schemaVersion: 1 });
  });

  it("maps 503 unhealthy to not healthy", async () => {
    stubFetch(503, { status: "unhealthy", schemaVersion: 1, writable: false });
    expect(await fetchHealth()).toEqual({ healthy: false, schemaVersion: 1 });
  });
});

describe("fetchDeadJobs", () => {
  it("returns the dead list", async () => {
    const dead = [{ kind: "price-fetch", failedAt: "2026-09-27T01:00:00.000Z" }];
    stubFetch(200, { dead });
    expect(await fetchDeadJobs()).toEqual(dead);
  });

  it("throws on an error response", async () => {
    stubFetch(500, { error: { code: "Internal", message: "Internal error" } });
    await expect(fetchDeadJobs()).rejects.toThrow(/500/);
  });
});

describe("fetchMe", () => {
  it("returns the signed-in person", async () => {
    const me = {
      personId: "p",
      displayName: "Alex",
      colour: "#000000",
      authAt: "t",
      canInvite: true,
      demo: false,
    };
    stubFetch(200, me);
    expect(await fetchMe()).toEqual(me);
  });

  it("returns null when nobody is signed in", async () => {
    stubFetch(401, { error: { code: "Unauthenticated", message: "Sign in first" } });
    expect(await fetchMe()).toBeNull();
  });
});

describe("invitePartner", () => {
  it("throws the error code, so the page can ask for a fresh sign-in", async () => {
    stubFetch(403, { error: { code: "ReauthRequired", message: "Sign in again to do this" } });
    const error = await invitePartner().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "ReauthRequired" });
  });
});

describe("recovery", () => {
  it("posts a recovery-code sign-in and surfaces the refusal", async () => {
    stubFetch(401, { error: { code: "Unauthenticated", message: "Those details did not match." } });
    const error = await recoverWithCode({ email: "a@example.com", password: "p", code: "c" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status: 401, code: "Unauthenticated" });
    const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(path).toBe("/api/identity/recover");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: "a@example.com",
      password: "p",
      code: "c",
    });
  });

  it("redeems a link and regenerates codes", async () => {
    stubFetch(200, { signedIn: true, needs: ["passkey", "totp"] });
    expect(await reEnrol({ token: "t", newPassword: "long enough pass" })).toEqual({
      signedIn: true,
    });
    stubFetch(200, { signedIn: false });
    expect(await reEnrol({ token: "t", newPassword: "long enough pass" })).toEqual({
      signedIn: false,
    });
    stubFetch(201, { codes: ["AAAAA-BBBBB"] });
    expect(await regenerateRecoveryCodes()).toEqual({ codes: ["AAAAA-BBBBB"] });
  });

  it("lists and dismisses notices", async () => {
    const notices = [{ id: "n", kind: "identity.partner-reset", createdAt: "t", issuedBy: "Alex" }];
    stubFetch(200, { notices });
    expect(await fetchNotices()).toEqual(notices);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(dismissNotice("n")).resolves.toBeUndefined();
    stubFetch(404, { error: { code: "NotFound", message: "No such notice" } });
    await expect(dismissNotice("n")).rejects.toMatchObject({ code: "NotFound" });
  });
});
