import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { fakeTokens } from "../testing/tokens.ts";
import { ensureFirstSetupLink } from "./setup-links.ts";
import { checkSignUp, completeSignUp, type IdentityContext } from "./sign-up.ts";

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:setup-link"), clock);
  const tokens = fakeTokens();
  const first = ensureFirstSetupLink({ ...ctx, tokens });
  if (first.status !== "issued") throw new Error("no link");
  const { link } = first;
  const { viewer: _viewer, ...rest } = ctx;
  const identity: IdentityContext = { ...rest, tokens };
  return { ctx: identity, uow, clock, token: link.token };
}

function errorOf(fn: () => unknown): AppError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return undefined;
}

const form = { email: "alex@example.com", displayName: " Alex ", colour: "#2563eb" };

/** Stands in for better-auth: the user row exists before `completeSignUp` runs. */
function signUp(s: ReturnType<typeof setup>, userId: string, token = s.token) {
  s.uow.state.users.push(userId);
  try {
    return completeSignUp(s.ctx, { ...form, token, userId });
  } catch (error) {
    s.uow.state.users.pop();
    throw error;
  }
}

describe("identity.checkSignUp", () => {
  it("accepts a live link", () => {
    const s = setup();
    expect(errorOf(() => checkSignUp(s.ctx, { token: s.token }))).toBeUndefined();
  });

  it("refuses an unknown token with Validation", () => {
    const s = setup();
    expect(errorOf(() => checkSignUp(s.ctx, { token: "nope" }))?.code).toBe("Validation");
  });

  it("refuses a link older than 24 hours with Validation", () => {
    const s = setup();
    s.clock.advance(24 * 3_600_000);
    expect(errorOf(() => checkSignUp(s.ctx, { token: s.token }))?.code).toBe("Validation");
  });

  it("refuses a used link with Validation", () => {
    const s = setup();
    signUp(s, "user-a");
    // A second person may still register, but not with the used link.
    expect(errorOf(() => checkSignUp(s.ctx, { token: s.token }))?.code).toBe("Validation");
  });

  it("refuses everyone with Conflict once two people have a login, whatever the token", () => {
    const s = setup();
    s.uow.state.users.push("user-a", "user-b");
    for (const token of [s.token, "nope"]) {
      expect(errorOf(() => checkSignUp(s.ctx, { token }))).toMatchObject({
        code: "Conflict",
        message: "Registration is closed",
      });
    }
  });
});

describe("identity.completeSignUp", () => {
  it("consumes the link and creates the linked person, audited as that person", () => {
    const s = setup();
    const personId = signUp(s, "user-a");
    expect(s.uow.state.people).toEqual([
      expect.objectContaining({ id: personId, userId: "user-a", displayName: "Alex" }),
    ]);
    expect(s.uow.state.setupLinks[0]?.usedAt).toBe("2026-09-27T00:00:00.000Z");
    const audit = s.uow.state.audit.slice(1); // [0] is the link's create
    expect(audit.map((row) => [row.actor, row.entity, row.action])).toEqual([
      [`person:${personId}`, "user", "create"],
      [`person:${personId}`, "person", "create"],
      [`person:${personId}`, "setup_link", "use"],
    ]);
    expect(JSON.parse(audit[0]?.after ?? "")).toEqual({
      id: "user-a",
      email: "alex@example.com",
      personId,
    });
    for (const row of s.uow.state.audit) expect(row.after).not.toContain("token-");
  });

  it("refuses a reused link, writing nothing", () => {
    const s = setup();
    signUp(s, "user-a");
    const before = [...s.uow.state.audit];
    expect(errorOf(() => signUp(s, "user-b"))?.code).toBe("Validation");
    expect(s.uow.state.people).toHaveLength(1);
    expect(s.uow.state.audit).toEqual(before);
  });

  it("refuses a third user with Conflict", () => {
    const s = setup();
    s.uow.state.users.push("user-a", "user-b");
    expect(errorOf(() => signUp(s, "user-c"))).toMatchObject({
      code: "Conflict",
      message: "Registration is closed",
    });
    expect(s.uow.state.people).toEqual([]);
    expect(s.uow.state.setupLinks[0]?.usedAt).toBeNull();
  });

  it("validates the display name and colour", () => {
    const s = setup();
    s.uow.state.users.push("user-a");
    const error = errorOf(() =>
      completeSignUp(s.ctx, { ...form, colour: "red", token: s.token, userId: "user-a" }),
    );
    expect(error?.code).toBe("Validation");
    expect(s.uow.state.setupLinks[0]?.usedAt).toBeNull();
  });
});
