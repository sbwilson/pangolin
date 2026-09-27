import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { fakeCodeHasher, fakeTokens } from "../testing/tokens.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createPerson } from "./create-person.ts";
import { dismissNotice, listNotices } from "./notices.ts";
import {
  checkReEnrolmentLink,
  issueReEnrolmentLink,
  partnerResetDedupeKey,
  redeemReEnrolmentLink,
  reEnrolmentUrl,
  revokeMyReEnrolmentLinks,
} from "./re-enrolment.ts";
import {
  formatRecoveryCode,
  issueInitialRecoveryCodes,
  normaliseRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  redeemRecoveryCode,
  regenerateRecoveryCodes,
} from "./recovery-codes.ts";
import { resetUser } from "./reset-user.ts";

/** Two enrolled people, Alex (user-a) and Sam (user-b), each with one session. */
function household() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:test"), clock);
  const tokens = fakeTokens();
  const codes = fakeCodeHasher();
  const alex = createPerson(ctx, { displayName: "Alex", colour: "#2563eb", userId: "user-a" });
  const sam = createPerson(ctx, { displayName: "Sam", colour: "#16a34a", userId: "user-b" });
  uow.state.users.push("user-a", "user-b");
  uow.state.enrolments = {
    "user-a": { totp: true, passkeys: 1 },
    "user-b": { totp: true, passkeys: 2 },
  };
  uow.state.sessions = { "user-a": 1, "user-b": 2 };
  uow.state.passwords = { "user-a": "hash-a", "user-b": "hash-b" };
  uow.state.audit = [];
  const as = (viewer: Viewer) => ({ ...ctx, viewer, tokens, codes });
  const person = (id: Id<"Person">) => as(personViewer(id, clock.now()));
  const identity = { clock, newId: ctx.newId, uow, tokens, codes };
  return { ctx, uow, clock, tokens, alex, sam, as, person, identity };
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

const secretsIn = (value: unknown) => JSON.stringify(value);

describe("recovery code format", () => {
  it("has 32 unambiguous characters and normalises what people type", () => {
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);
    expect(RECOVERY_CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(formatRecoveryCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(normaliseRecoveryCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(normaliseRecoveryCode("ABCDE FGHJK")).toBe("ABCDEFGHJK");
    expect(normaliseRecoveryCode("ABCDE-FGHJ0")).toBeUndefined();
    expect(normaliseRecoveryCode("ABCDE")).toBeUndefined();
  });
});

describe("identity.issueInitialRecoveryCodes", () => {
  it("issues 10 codes once, storing only hashes, audited without them", () => {
    const { uow, alex, person } = household();
    const { codes } = issueInitialRecoveryCodes(person(alex));
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(new Set(codes).size).toBe(10);
    expect(uow.state.recoveryCodes).toHaveLength(10);
    expect(uow.state.recoveryCodes.map((r) => r.codeHash)).toEqual(
      codes.map((c) => `hmac:${c.replace("-", "")}`),
    );
    expect(uow.state.audit.map((a) => [a.entity, a.action, a.personId])).toEqual([
      ["recovery_code", "generate", alex],
    ]);
    for (const c of codes) expect(secretsIn(uow.state.audit)).not.toContain(c.replace("-", ""));
    expect(codeOf(() => issueInitialRecoveryCodes(person(alex)))).toBe("Conflict");
  });

  it("refuses while enrolment is incomplete, and for anyone but a person", () => {
    const { uow, alex, person, as } = household();
    uow.state.enrolments = { ...uow.state.enrolments, "user-a": { totp: true, passkeys: 0 } };
    expect(codeOf(() => issueInitialRecoveryCodes(person(alex)))).toBe("Conflict");
    expect(codeOf(() => issueInitialRecoveryCodes(as(systemViewer("cli:x"))))).toBe(
      "Unauthenticated",
    );
    expect(uow.state.recoveryCodes).toEqual([]);
  });
});

describe("identity.regenerateRecoveryCodes", () => {
  it("replaces unused codes; needs a recent sign-in", () => {
    const { uow, clock, alex, person, identity } = household();
    const first = issueInitialRecoveryCodes(person(alex)).codes;
    redeemRecoveryCode(identity, { userId: "user-a", code: first[0] ?? "" });
    const stale = person(alex);
    clock.advance(6 * 60_000);
    expect(codeOf(() => regenerateRecoveryCodes(stale))).toBe("ReauthRequired");
    const fresh = regenerateRecoveryCodes(person(alex)).codes;
    expect(fresh).toHaveLength(10);
    expect(uow.state.recoveryCodes.filter((r) => r.usedAt === null)).toHaveLength(10);
    expect(uow.state.recoveryCodes).toHaveLength(11);
    expect(
      codeOf(() => redeemRecoveryCode(identity, { userId: "user-a", code: first[1] ?? "" })),
    ).toBe("Unauthenticated");
    expect(uow.state.audit.at(-1)).toMatchObject({
      entity: "recovery_code",
      action: "generate",
      before: JSON.stringify({ unused: 9 }),
      after: JSON.stringify({ unused: 10 }),
    });
  });
});

describe("identity.redeemRecoveryCode", () => {
  it("uses the code, removes passkeys and sessions, keeps TOTP; refuses reuse alike", () => {
    const { uow, alex, sam, person, identity } = household();
    const { codes } = issueInitialRecoveryCodes(person(alex));
    const code = codes[3] ?? "";
    expect(redeemRecoveryCode(identity, { userId: "user-a", code })).toEqual({
      personId: alex,
      userId: "user-a",
      remaining: 9,
    });
    expect(uow.state.enrolments["user-a"]).toEqual({ totp: true, passkeys: 0 });
    expect(uow.state.sessions["user-a"]).toBe(0);
    expect(uow.state.enrolments["user-b"]).toEqual({ totp: true, passkeys: 2 });
    expect(uow.state.audit.slice(-2).map((a) => [a.actor, a.entity, a.action])).toEqual([
      [`person:${alex}`, "recovery_code", "use"],
      [`person:${alex}`, "user", "recover"],
    ]);
    expect(secretsIn(uow.state.audit)).not.toContain(code.replace("-", ""));

    const refusals = [
      () => redeemRecoveryCode(identity, { userId: "user-a", code }),
      () => redeemRecoveryCode(identity, { userId: "user-a", code: "nonsense" }),
      () => redeemRecoveryCode(identity, { userId: "user-x", code: codes[4] ?? "" }),
      // Sam cannot use Alex's code.
      () => redeemRecoveryCode(identity, { userId: "user-b", code: codes[4] ?? "" }),
    ];
    const messages = refusals.map((fn) => {
      try {
        fn();
      } catch (error) {
        return error instanceof AppError ? `${error.code}: ${error.message}` : "other";
      }
      return "none";
    });
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toMatch(/^Unauthenticated: /);
    expect(sam).toBeDefined();
  });
});

describe("partner re-enrolment links", () => {
  it("issues a 24-hour link for the partner, raising their notice only", () => {
    const { uow, alex, sam, person } = household();
    const link = issueReEnrolmentLink(person(alex), { personId: sam });
    expect(link).toMatchObject({ personId: sam, token: "token-1" });
    expect(link.expiresAt).toBe("2026-09-28T00:00:00.000Z");
    expect(uow.state.reEnrolmentLinks).toEqual([
      {
        id: link.id,
        personId: sam,
        issuedBy: `person:${alex}`,
        tokenHash: "hash:token-1",
        createdAt: "2026-09-27T00:00:00.000Z",
        expiresAt: "2026-09-28T00:00:00.000Z",
        usedAt: null,
      },
    ]);
    // Issuing changes nothing about Sam's sign-in.
    expect(uow.state.enrolments["user-b"]).toEqual({ totp: true, passkeys: 2 });
    expect(listNotices(person(sam))).toEqual([
      {
        id: uow.state.reviewItems[0]?.id,
        kind: "identity.partner-reset",
        createdAt: "2026-09-27T00:00:00.000Z",
        issuedBy: "Alex",
      },
    ]);
    expect(uow.state.reviewItems[0]).toMatchObject({
      personId: sam,
      entityRef: `re_enrolment_link:${link.id}`,
    });
    expect(uow.state.reviewItems[0]?.dedupeKey).toBe(partnerResetDedupeKey(link.id));
    expect(listNotices(person(alex))).toEqual([]);
    expect(uow.state.audit.map((a) => [a.entity, a.action])).toEqual([
      ["re_enrolment_link", "create"],
      ["review_item", "raise"],
    ]);
    expect(secretsIn(uow.state.audit)).not.toContain("token-1");
    expect(reEnrolmentUrl("https://money.example", "a b")).toBe(
      "https://money.example/recover?token=a%20b",
    );
  });

  it("refuses yourself, a stranger, a stale sign-in and a system viewer", () => {
    const { clock, alex, person, as } = household();
    expect(codeOf(() => issueReEnrolmentLink(person(alex), { personId: alex }))).toBe("Validation");
    expect(codeOf(() => issueReEnrolmentLink(person(alex), { personId: "nobody" }))).toBe(
      "NotFound",
    );
    const stale = person(alex);
    clock.advance(6 * 60_000);
    expect(codeOf(() => issueReEnrolmentLink(stale, { personId: "x" }))).toBe("ReauthRequired");
    expect(
      codeOf(() => issueReEnrolmentLink(as(systemViewer("cli:reset-user")), { personId: "x" })),
    ).toBe("Unauthenticated");
  });

  it("a newer link revokes the older one and supersedes its notice", () => {
    const { uow, alex, sam, person, identity } = household();
    const first = issueReEnrolmentLink(person(alex), { personId: sam });
    const second = issueReEnrolmentLink(person(alex), { personId: sam });
    expect(codeOf(() => checkReEnrolmentLink(identity, { token: first.token }))).toBe("Validation");
    expect(checkReEnrolmentLink(identity, { token: second.token })).toBeUndefined();
    const open = uow.state.reviewItems.filter((item) => item.resolvedAt === null);
    expect(open.map((item) => item.entityRef)).toEqual([`re_enrolment_link:${second.id}`]);
    expect(listNotices(person(sam))).toHaveLength(1);
    expect(uow.state.audit.filter((a) => a.action === "revoke")).toHaveLength(1);
  });

  it("redeeming sets the password and clears everything; then the link is dead", () => {
    const { uow, alex, sam, person, identity } = household();
    issueInitialRecoveryCodes(person(sam));
    const link = issueReEnrolmentLink(person(alex), { personId: sam });
    const redeemed = redeemReEnrolmentLink(identity, {
      token: link.token,
      passwordHash: "new-hash",
    });
    expect(redeemed).toEqual({ personId: sam, userId: "user-b" });
    expect(uow.state.passwords["user-b"]).toBe("new-hash");
    expect(uow.state.enrolments["user-b"]).toEqual({ totp: false, passkeys: 0 });
    expect(uow.state.sessions["user-b"]).toBe(0);
    expect(uow.state.recoveryCodes.filter((r) => r.personId === sam)).toEqual([]);
    expect(uow.state.reEnrolmentLinks[0]?.usedAt).toBe("2026-09-27T00:00:00.000Z");
    // Alex is untouched.
    expect(uow.state.enrolments["user-a"]).toEqual({ totp: true, passkeys: 1 });
    expect(uow.state.passwords["user-a"]).toBe("hash-a");
    const reset = uow.state.audit.find((a) => a.entity === "user" && a.action === "reset");
    expect(reset?.actor).toBe(`person:${sam}`);
    expect(JSON.parse(reset?.after ?? "{}")).toEqual({
      reason: "re-enrolment-link",
      passwordChanged: true,
      passkeysRemoved: 2,
      twoFactorDisabled: true,
      sessionsRevoked: 2,
      recoveryCodesRemoved: 10,
    });
    expect(uow.state.audit.at(-1)).toMatchObject({ entity: "re_enrolment_link", action: "use" });
    expect(secretsIn(uow.state.audit)).not.toContain("new-hash");
    expect(secretsIn(uow.state.audit)).not.toContain(link.token);
    // The notice stays for Sam to read.
    expect(listNotices(person(sam))).toHaveLength(1);
    const again = () =>
      redeemReEnrolmentLink(identity, { token: link.token, passwordHash: "other" });
    expect(codeOf(again)).toBe("Validation");
    expect(uow.state.passwords["user-b"]).toBe("new-hash");
  });

  it("expires 24 hours after issue, with the same message as an unknown token", () => {
    const { alex, sam, person, identity, clock } = household();
    const link = issueReEnrolmentLink(person(alex), { personId: sam });
    clock.advance(24 * 60 * 60_000 - 1000);
    expect(checkReEnrolmentLink(identity, { token: link.token })).toBeUndefined();
    clock.advance(2000);
    const messageOf = (token: string) => {
      try {
        redeemReEnrolmentLink(identity, { token, passwordHash: "x" });
      } catch (error) {
        return error instanceof AppError ? `${error.code}: ${error.message}` : "other";
      }
      return "none";
    };
    expect(messageOf(link.token)).toBe(messageOf("unknown"));
    expect(messageOf(link.token)).toMatch(/^Validation: /);
  });
});

describe("identity.resetUser", () => {
  it("clears at once and issues a cli:reset-user link, audited as the CLI", () => {
    const { uow, sam, as, person } = household();
    const result = resetUser(as(systemViewer("cli:reset-user")), { personId: sam });
    expect(result.link).toMatchObject({ personId: sam, token: "token-1" });
    expect(result.cleared).toEqual({
      passwordChanged: true,
      passkeysRemoved: 2,
      twoFactorDisabled: true,
      sessionsRevoked: 2,
      recoveryCodesRemoved: 0,
    });
    // The old password is replaced by one nobody knows: random `salt:key` hex, never returned.
    const unusable = uow.state.passwords["user-b"] ?? "";
    expect(unusable).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(JSON.stringify(result)).not.toContain(unusable);
    expect(JSON.stringify(uow.state.audit)).not.toContain(unusable);
    expect(uow.state.reEnrolmentLinks[0]?.issuedBy).toBe("cli:reset-user");
    expect(new Set(uow.state.audit.map((a) => a.actor))).toEqual(new Set(["cli:reset-user"]));
    expect(listNotices(person(sam))).toEqual([
      expect.objectContaining({ kind: "identity.partner-reset", issuedBy: "the server console" }),
    ]);
  });

  it("refuses every other viewer, and unknown people", () => {
    const { uow, alex, sam, as, person } = household();
    for (const viewer of [systemViewer("cli:other"), systemViewer("job:x")]) {
      expect(codeOf(() => resetUser(as(viewer), { personId: sam }))).toBe("Unauthenticated");
    }
    expect(codeOf(() => resetUser(person(alex), { personId: sam }))).toBe("Unauthenticated");
    expect(codeOf(() => resetUser(as(systemViewer("cli:reset-user")), { personId: "x" }))).toBe(
      "NotFound",
    );
    expect(uow.state.reEnrolmentLinks).toEqual([]);
  });
});

describe("notices", () => {
  it("only the affected person can dismiss their notice", () => {
    const { uow, alex, sam, person } = household();
    issueReEnrolmentLink(person(alex), { personId: sam });
    const [notice] = listNotices(person(sam));
    if (notice === undefined) throw new Error("no notice");
    expect(codeOf(() => dismissNotice(person(alex), { id: notice.id }))).toBe("NotFound");
    expect(codeOf(() => dismissNotice(person(sam), { id: "nope" }))).toBe("NotFound");
    dismissNotice(person(sam), { id: notice.id });
    expect(listNotices(person(sam))).toEqual([]);
    expect(uow.state.reviewItems[0]?.resolution).toBe("dismissed");
    expect(codeOf(() => dismissNotice(person(sam), { id: notice.id }))).toBe("NotFound");
  });
});

describe("recovery-code notice", () => {
  it("a redeemed code raises a notice for that person only", () => {
    const { alex, sam, person, identity } = household();
    const { codes } = issueInitialRecoveryCodes(person(alex));
    redeemRecoveryCode(identity, { userId: "user-a", code: codes[0] ?? "" });
    redeemRecoveryCode(identity, { userId: "user-a", code: codes[1] ?? "" });
    expect(listNotices(person(alex))).toEqual([
      expect.objectContaining({ kind: "identity.recovery-code-used", issuedBy: null }),
      expect.objectContaining({ kind: "identity.recovery-code-used", issuedBy: null }),
    ]);
    expect(listNotices(person(sam))).toEqual([]);
  });
});

describe("identity.revokeMyReEnrolmentLinks", () => {
  it("the affected person ends links against them, resolving the notice as revoked", () => {
    const { uow, alex, sam, person, identity } = household();
    const link = issueReEnrolmentLink(person(alex), { personId: sam });
    expect(listNotices(person(sam))).toEqual([
      expect.objectContaining({ kind: "identity.partner-reset", issuedBy: "Alex" }),
    ]);
    // Alex's own links (none) are all Alex can revoke.
    expect(revokeMyReEnrolmentLinks(person(alex))).toEqual({ revoked: 0 });
    expect(checkReEnrolmentLink(identity, { token: link.token })).toBeUndefined();
    expect(revokeMyReEnrolmentLinks(person(sam))).toEqual({ revoked: 1 });
    expect(codeOf(() => checkReEnrolmentLink(identity, { token: link.token }))).toBe("Validation");
    expect(listNotices(person(sam))).toEqual([]);
    expect(uow.state.reviewItems[0]?.resolution).toBe("revoked");
    expect(uow.state.audit.filter((a) => a.action === "revoke")).toHaveLength(1);
  });
});
