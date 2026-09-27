import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { fakeTokens } from "../testing/tokens.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { ensureFirstSetupLink, issueSetupLink, type SetupLinkContext } from "./setup-links.ts";

const alex = idSchema("Person").parse("01J0000000000000000000000A");

function setup(viewer: Viewer, start = "2026-09-27T00:00:00Z") {
  const clock = manualClock(start);
  const { ctx, uow } = memoryContext(viewer, clock);
  const tokens = fakeTokens();
  const linkCtx: SetupLinkContext = { ...ctx, tokens };
  return { ctx: linkCtx, uow, clock, tokens };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return undefined;
}

describe("identity.ensureFirstSetupLink", () => {
  it("issues a 24-hour cli link on an empty database, storing only the hash", () => {
    const { ctx, uow } = setup(systemViewer("cli:setup-link"));
    const first = ensureFirstSetupLink(ctx);
    if (first.status !== "issued") throw new Error(first.status);
    const { link } = first;
    expect(link).toEqual({
      id: expect.any(String),
      token: "token-1",
      expiresAt: "2026-09-28T00:00:00.000Z",
    });
    expect(uow.state.setupLinks).toEqual([
      {
        id: link.id,
        tokenHash: "hash:token-1",
        issuedBy: "cli",
        createdAt: "2026-09-27T00:00:00.000Z",
        expiresAt: "2026-09-28T00:00:00.000Z",
        usedAt: null,
      },
    ]);
    const [audit] = uow.state.audit;
    expect(audit).toMatchObject({
      actor: "cli:setup-link",
      entity: "setup_link",
      action: "create",
    });
    expect(audit?.after).not.toContain("token-1");
    expect(audit?.after).not.toContain("hash:");
  });

  it("issues nothing while a live link exists, and a new one once it expires", () => {
    const { ctx, uow, clock } = setup(systemViewer("cli:setup-link"));
    ensureFirstSetupLink(ctx);
    clock.advance(23 * 3_600_000);
    expect(ensureFirstSetupLink(ctx)).toEqual({ status: "live" });
    clock.advance(3_600_000);
    expect(ensureFirstSetupLink(ctx)).toMatchObject({
      status: "issued",
      link: { token: "token-3" },
    });
    expect(uow.state.setupLinks).toHaveLength(2);
  });

  it("on reissue, revokes the live link (audited) and issues a new one", () => {
    const { ctx, uow, clock } = setup(systemViewer("cli:setup-link"));
    ensureFirstSetupLink(ctx);
    clock.advance(60_000);
    expect(ensureFirstSetupLink(ctx, { reissue: true })).toMatchObject({ status: "issued" });
    expect(uow.state.setupLinks.map((l) => l.expiresAt)).toEqual([
      "2026-09-27T00:01:00.000Z",
      "2026-09-28T00:01:00.000Z",
    ]);
    expect(uow.state.audit.map((a) => a.action)).toEqual(["create", "revoke", "create"]);
  });

  it("issues nothing once anyone has a login", () => {
    const { ctx, uow } = setup(systemViewer("cli:setup-link"));
    uow.state.users.push("user-1");
    expect(ensureFirstSetupLink(ctx)).toEqual({ status: "closed" });
    expect(ensureFirstSetupLink(ctx, { reissue: true })).toEqual({ status: "closed" });
    expect(uow.state.setupLinks).toEqual([]);
    expect(uow.state.audit).toEqual([]);
  });
});

describe("identity.issueSetupLink", () => {
  const now = "2026-09-27T00:00:00Z";

  it("lets a recently signed-in person invite their partner", () => {
    const { ctx, uow } = setup(personViewer(alex, Temporal.Instant.from(now)), now);
    uow.state.users.push("user-a");
    const link = issueSetupLink(ctx, {});
    expect(link.token).toBe("token-1");
    expect(uow.state.setupLinks[0]).toMatchObject({ issuedBy: `person:${alex}`, usedAt: null });
    expect(uow.state.audit[0]).toMatchObject({ actor: `person:${alex}`, entity: "setup_link" });
  });

  it("allows exactly 5 minutes after sign-in, and refuses 6 minutes after with ReauthRequired", () => {
    const { ctx, uow, clock } = setup(personViewer(alex, Temporal.Instant.from(now)), now);
    uow.state.users.push("user-a");
    clock.advance(5 * 60_000);
    expect(codeOf(() => issueSetupLink(ctx, {}))).toBeUndefined();
    clock.advance(60_000);
    expect(codeOf(() => issueSetupLink(ctx, {}))).toBe("ReauthRequired");
    expect(uow.state.setupLinks).toHaveLength(1);
  });

  it("revokes the earlier unused partner link, leaving only the newest live", () => {
    const { ctx, uow } = setup(personViewer(alex, Temporal.Instant.from(now)), now);
    uow.state.users.push("user-a");
    issueSetupLink(ctx, {});
    issueSetupLink(ctx, {});
    const live = uow.state.setupLinks.filter((l) => l.expiresAt > "2026-09-27T00:00:00.000Z");
    expect(live.map((l) => l.tokenHash)).toEqual(["hash:token-2"]);
    expect(uow.state.audit.map((a) => a.action)).toEqual(["create", "revoke", "create"]);
  });

  it("leaves the first-boot (cli) link alone", () => {
    const system = setup(systemViewer("cli:setup-link"), now);
    ensureFirstSetupLink(system.ctx);
    const person: SetupLinkContext = {
      ...system.ctx,
      viewer: personViewer(alex, Temporal.Instant.from(now)),
    };
    system.uow.state.users.push("user-a");
    issueSetupLink(person, {});
    expect(system.uow.state.setupLinks.map((l) => l.expiresAt)).toEqual([
      "2026-09-28T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);
  });

  it("refuses with Conflict once two people have a login", () => {
    const { ctx, uow } = setup(personViewer(alex, Temporal.Instant.from(now)), now);
    uow.state.users.push("user-a", "user-b");
    let error: unknown;
    try {
      issueSetupLink(ctx, {});
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "Conflict", message: "Registration is closed" });
    expect(uow.state.setupLinks).toEqual([]);
    expect(uow.state.audit).toEqual([]);
  });

  it("rejects unknown input", () => {
    const { ctx } = setup(personViewer(alex, Temporal.Instant.from(now)), now);
    expect(codeOf(() => issueSetupLink(ctx, { issuedBy: "cli" } as never))).toBe("Validation");
  });
});
