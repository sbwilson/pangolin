import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { createPerson } from "./create-person.ts";
import { recordCredentialChange } from "./credentials.ts";
import { demoViewer, enrolmentNeeds, me, personForUser, sessionViewer } from "./me.ts";

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:test"), clock);
  const alex = createPerson(ctx, { displayName: "Alex", colour: "#2563eb", userId: "user-a" });
  return { ctx, uow, clock, alex };
}

describe("sessionViewer", () => {
  it("resolves a session's user to their person, authenticated when the session began", () => {
    const { ctx, alex } = setup();
    const viewer = sessionViewer(ctx, {
      userId: "user-a",
      createdAt: new Date("2026-09-26T23:00:00.000Z"),
    });
    expect(viewer?.personId).toBe(alex);
    expect(viewer?.authAt.toString()).toBe("2026-09-26T23:00:00Z");
    expect(personForUser(ctx, "user-a")).toBe(alex);
  });

  it("is undefined for a user with no person, or a deleted one", () => {
    const { ctx, uow } = setup();
    expect(sessionViewer(ctx, { userId: "user-x", createdAt: new Date() })).toBeUndefined();
    uow.state.people = uow.state.people.map((p) => ({ ...p, deletedAt: "2026-09-27" }));
    expect(sessionViewer(ctx, { userId: "user-a", createdAt: new Date() })).toBeUndefined();
  });
});

describe("demoViewer", () => {
  it("is the first person, authenticated now", () => {
    const { ctx, alex } = setup();
    expect(demoViewer(ctx)).toEqual({
      kind: "person",
      personId: alex,
      authAt: Temporal.Instant.from("2026-09-27T00:00:00Z"),
    });
  });
});

describe("identity.me", () => {
  it("describes the signed-in person and whether a partner can still be invited", () => {
    const { ctx, uow, alex } = setup();
    uow.state.users.push("user-a");
    const viewer = sessionViewer(ctx, {
      userId: "user-a",
      createdAt: new Date("2026-09-27T00:00:00.000Z"),
    });
    if (viewer === undefined) throw new Error("no viewer");
    expect(me({ ...ctx, viewer }, {})).toEqual({
      personId: alex,
      displayName: "Alex",
      colour: "#2563eb",
      authAt: "2026-09-27T00:00:00.000Z",
      canInvite: true,
    });
    uow.state.users.push("user-b");
    expect(me({ ...ctx, viewer }, {}).canInvite).toBe(false);
  });

  it("is Unauthenticated for a system viewer", () => {
    const { ctx } = setup();
    expect(() => me(ctx, {})).toThrow(AppError);
  });
});

describe("enrolmentNeeds", () => {
  it("lists what a login still lacks: a passkey, then a confirmed TOTP", () => {
    const { ctx, uow } = setup();
    expect(enrolmentNeeds(ctx, "user-a")).toEqual(["passkey", "totp"]);
    uow.state.users.push("user-a");
    expect(enrolmentNeeds(ctx, "user-a")).toEqual(["passkey", "totp"]);
    uow.state.enrolments["user-a"] = { totp: false, passkeys: 1 };
    expect(enrolmentNeeds(ctx, "user-a")).toEqual(["totp"]);
    uow.state.enrolments["user-a"] = { totp: true, passkeys: 2 };
    expect(enrolmentNeeds(ctx, "user-a")).toEqual([]);
  });
});

describe("recordCredentialChange", () => {
  it("audits the change as the login's person, scoped to them", () => {
    const { ctx, uow, alex } = setup();
    const before = uow.state.audit.length;
    expect(
      recordCredentialChange(ctx, {
        userId: "user-a",
        entity: "passkey",
        entityId: "pk-1",
        action: "create",
      }),
    ).toBe(true);
    expect(uow.state.audit.slice(before)).toEqual([
      expect.objectContaining({
        actor: `person:${alex}`,
        entity: "passkey",
        entityId: "pk-1",
        action: "create",
        personId: alex,
      }),
    ]);
    expect(
      recordCredentialChange(ctx, {
        userId: "nobody",
        entity: "two_factor",
        entityId: "nobody",
        action: "enable",
      }),
    ).toBe(false);
  });
});
