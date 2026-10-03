// Story 1.6 through the real HTTP app and real better-auth: recovery codes, the partner
// re-enrolment link, notices, and what they leave in the audit log.
import { createHash } from "node:crypto";
import { lockedUntil, resetUser } from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Browser, createHarness, type Harness } from "../testing/auth-harness.ts";
import { secretOf, totp } from "../testing/totp.ts";
import { type RecoveryAuth, recoveryGateway } from "./recovery.ts";
import { nodeTokens, recoveryCodeHasher } from "./secret.ts";

const alex = { email: "alex@example.com", password: "correct horse battery staple" };
const sam = { email: "sam@example.com", password: "another long passphrase" };

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(() => {
  h.close();
});

function count(sql: string, ...args: unknown[]): number {
  return h.db
    .prepare(sql)
    .pluck()
    .get(...args) as number;
}

/** Signs up with `token`, enrols TOTP and a passkey; returns the browser and TOTP secret. */
async function enrolled(token: string, who: typeof alex, name: string) {
  const b = new Browser(h.app);
  const res = await b.json("/api/identity/sign-up", {
    body: { token, email: who.email, password: who.password, displayName: name, colour: "#2563eb" },
  });
  expect(res.status).toBe(201);
  const enabled = await b.json<{ totpURI: string }>("/api/auth/two-factor/enable", {
    body: { password: who.password },
  });
  const secret = secretOf(enabled.body.totpURI);
  await b.request("/api/auth/two-factor/verify-totp", { body: { code: totp(secret) } });
  h.addPasskey(who.email);
  expect((await b.json("/api/identity/me")).body).toMatchObject({ enrolment: "complete" });
  return { b, secret };
}

/** Alex and Sam, both fully enrolled; Sam registered through Alex's invite. */
async function household() {
  const a = await enrolled(h.firstLink(), alex, "Alex");
  const invite = await a.b.json<{ url: string }>("/api/identity/setup-links", { method: "POST" });
  const token = new URL(invite.body.url).searchParams.get("token") ?? "";
  const s = await enrolled(token, sam, "Sam");
  const people = h.db.prepare("SELECT id, display_name FROM person").all() as {
    id: string;
    display_name: string;
  }[];
  const idOf = (name: string) => people.find((p) => p.display_name === name)?.id ?? "";
  return { a, s, alexId: idOf("Alex"), samId: idOf("Sam") };
}

async function signInWithTotp(who: typeof alex, secret: string): Promise<Browser> {
  const b = new Browser(h.app);
  await b.request("/api/auth/sign-in/email", { body: who });
  const res = await b.request("/api/auth/two-factor/verify-totp", { body: { code: totp(secret) } });
  expect(res.status).toBe(200);
  return b;
}

function auditText(): string {
  return JSON.stringify(h.db.prepare("SELECT * FROM audit_log").all());
}

describe("recovery codes", () => {
  it("are issued once at enrolment, then redeem once for a passkey-only enrolment", async () => {
    const { b } = await enrolled(h.firstLink(), alex, "Alex");
    expect((await b.json("/api/identity/me")).body).toMatchObject({
      recoveryCodes: { issued: false, remaining: 0 },
    });
    const issued = await b.json<{ codes: string[] }>("/api/identity/recovery-codes/initial", {
      method: "POST",
    });
    expect(issued.status).toBe(201);
    const { codes } = issued.body;
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(count("SELECT count(*) FROM recovery_code")).toBe(10);
    const again = await b.json("/api/identity/recovery-codes/initial", { method: "POST" });
    expect(again.status).toBe(409);

    // Recover in another browser: the old session ends, the new one can only enrol a passkey.
    const r = new Browser(h.app);
    const code = codes[0] ?? "";
    const res = await r.json("/api/identity/recover", { body: { ...alex, code } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ signedIn: true, needs: ["passkey"] });
    const cookie = r.setCookies.find((c) => c.startsWith("pangolin.session_token="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
    expect((await r.json("/api/identity/me")).body).toMatchObject({
      enrolment: "incomplete",
      needs: ["passkey"],
      recoveryCodes: { issued: true, remaining: 9 },
    });
    expect((await r.request("/api/system/jobs")).status).toBe(401);
    expect((await r.request("/api/auth/passkey/generate-register-options")).status).toBe(200);
    expect((await b.request("/api/identity/me")).status).toBe(401);
    expect(count("SELECT count(*) FROM auth_passkey")).toBe(0);
    expect(count("SELECT count(*) FROM auth_session")).toBe(1);

    // The same code again is refused like any other wrong detail.
    const reuse = await new Browser(h.app).json("/api/identity/recover", {
      body: { ...alex, code },
    });
    expect(reuse.status).toBe(401);
    const wrongPassword = await new Browser(h.app).json("/api/identity/recover", {
      body: { ...alex, password: "not the password at all", code: codes[1] },
    });
    const unknownEmail = await new Browser(h.app).json("/api/identity/recover", {
      body: { ...alex, email: "nobody@example.com", code: codes[1] },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(reuse.body);
    expect(unknownEmail.body).toEqual(reuse.body);
    expect(reuse.body).toMatchObject({ error: { code: "Unauthenticated" } });
    // A wrong password never uses the code it came with.
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NULL")).toBe(9);
    expect(count("SELECT count(*) FROM login_attempt WHERE ok = 0")).toBe(3);

    const text = auditText();
    for (const c of codes) expect(text).not.toContain(c.replace("-", ""));
    expect(text).not.toContain(alex.password);
    const actions = h.db
      .prepare(
        "SELECT entity, action FROM audit_log WHERE entity IN ('recovery_code', 'user') ORDER BY id",
      )
      .all();
    expect(actions).toEqual([
      { entity: "user", action: "create" },
      { entity: "recovery_code", action: "generate" },
      { entity: "recovery_code", action: "use" },
      { entity: "user", action: "recover" },
    ]);
  });

  it("5 wrong codes lock the email: then even the right code is refused", async () => {
    const { b } = await enrolled(h.firstLink(), alex, "Alex");
    const { body } = await b.json<{ codes: string[] }>("/api/identity/recovery-codes/initial", {
      method: "POST",
    });
    for (let i = 0; i < 5; i++) {
      const res = await new Browser(h.app).request("/api/identity/recover", {
        body: { ...alex, code: "AAAAA-AAAAA" },
      });
      expect(res.status).toBe(401);
    }
    const locked = await new Browser(h.app).json("/api/identity/recover", {
      body: { ...alex, code: body.codes[0] },
    });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ error: { code: "RateLimited" } });
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NULL")).toBe(10);
    // Password sign-in is locked too: the count is per email.
    const signIn = await new Browser(h.app).json("/api/auth/sign-in/email", { body: alex });
    expect(signIn.status).toBe(429);
  });

  it("a concurrent burst of wrong codes evaluates exactly 5, and refuses a right code in it", {
    timeout: 20_000,
  }, async () => {
    const { b } = await enrolled(h.firstLink(), alex, "Alex");
    const { body } = await b.json<{ codes: string[] }>("/api/identity/recovery-codes/initial", {
      method: "POST",
    });
    const attempts = (ok: number) =>
      count("SELECT count(*) FROM login_attempt WHERE email = ? AND ok = ?", alex.email, ok);
    const failuresBefore = attempts(0);
    const successesBefore = attempts(1);
    // 19 wrong codes, then the right one, all at once (seam S11a on /recover).
    const statuses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        new Browser(h.app)
          .request("/api/identity/recover", {
            body: { ...alex, code: i === 19 ? body.codes[0] : "AAAAA-AAAAA" },
          })
          .then((res) => res.status),
      ),
    );
    expect(statuses.filter((status) => status !== 401 && status !== 429)).toEqual([]);
    expect(statuses.filter((status) => status === 401).length).toBe(5);
    expect(statuses[19]).toBe(429);
    expect(attempts(0)).toBe(failuresBefore + 5);
    expect(attempts(1)).toBe(successesBefore);
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NULL")).toBe(10);
  });

  it("regenerating needs a recent sign-in and invalidates the unused codes", async () => {
    const { b, secret } = await enrolled(h.firstLink(), alex, "Alex");
    const first = await b.json<{ codes: string[] }>("/api/identity/recovery-codes/initial", {
      method: "POST",
    });
    h.advanceMinutes(6);
    const stale = await b.json("/api/identity/recovery-codes", { method: "POST" });
    expect(stale.status).toBe(403);
    expect(stale.body).toMatchObject({ error: { code: "ReauthRequired" } });
    h.advanceMinutes(-6);
    const fresh = await signInWithTotp(alex, secret);
    const next = await fresh.json<{ codes: string[] }>("/api/identity/recovery-codes", {
      method: "POST",
    });
    expect(next.status).toBe(201);
    expect(next.body.codes).toHaveLength(10);
    const old = await new Browser(h.app).request("/api/identity/recover", {
      body: { ...alex, code: first.body.codes[0] },
    });
    expect(old.status).toBe(401);
    const ok = await new Browser(h.app).request("/api/identity/recover", {
      body: { ...alex, code: next.body.codes[0] },
    });
    expect(ok.status).toBe(200);
  });

  it("is refused without the Origin, like every write", async () => {
    const res = await h.app.request("http://localhost:3000/api/identity/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ ...alex, code: "AAAAA-AAAAA" }),
    });
    expect(res.status).toBe(403);
    expect(count("SELECT count(*) FROM login_attempt")).toBe(0);
  });
});

describe("partner re-enrolment", () => {
  it("A resets B: B's notice, redemption, new password, full re-enrolment, no reuse", async () => {
    const { a, s, alexId, samId } = await household();
    await s.b.request("/api/identity/recovery-codes/initial", { method: "POST" });
    expect((await a.b.json("/api/identity/me")).body).toMatchObject({
      partner: { personId: samId, displayName: "Sam" },
    });

    const self = await a.b.json("/api/identity/re-enrolment-links", {
      body: { personId: alexId },
    });
    expect(self.status).toBe(400);
    expect(self.body).toMatchObject({ error: { code: "Validation" } });

    const first = await a.b.json<{ url: string; expiresAt: string }>(
      "/api/identity/re-enrolment-links",
      { body: { personId: samId } },
    );
    expect(first.status).toBe(201);
    expect(first.body.url).toMatch(/^http:\/\/localhost:3000\/recover\?token=[\w-]{43}$/);
    const issued = await a.b.json<{ url: string }>("/api/identity/re-enrolment-links", {
      body: { personId: samId },
    });
    const firstToken = new URL(first.body.url).searchParams.get("token") ?? "";
    const token = new URL(issued.body.url).searchParams.get("token") ?? "";

    // Notices: Sam sees it, Alex does not and cannot dismiss it. A household item (a dead job)
    // is not a notice.
    h.db
      .prepare(
        `INSERT INTO review_item (id, kind, entity_ref, dedupe_key, created_at)
         VALUES ('rv-job', 'job.dead', 'job:x', 'job.dead:x', '2026-09-27T00:00:00.000Z')`,
      )
      .run();
    const open = h.db
      .prepare("SELECT id, created_at FROM review_item WHERE resolved_at IS NULL AND person_id = ?")
      .get(samId) as { id: string; created_at: string };
    const samNotices = await s.b.json<{ notices: { id: string; kind: string }[] }>(
      "/api/identity/notices",
    );
    expect(samNotices.body).toEqual({
      notices: [
        {
          id: open.id,
          kind: "identity.partner-reset",
          createdAt: open.created_at,
          issuedBy: "Alex",
        },
      ],
    });
    const noticeId = samNotices.body.notices[0]?.id ?? "";
    const alexNotices = await a.b.json<{ notices: unknown[] }>("/api/identity/notices");
    expect(alexNotices.body.notices).toEqual([]);
    const dismiss = await a.b.request(`/api/identity/notices/${noticeId}/dismiss`, {
      method: "POST",
    });
    expect(dismiss.status).toBe(404);

    // The superseded link is dead.
    const r0 = await new Browser(h.app).json("/api/identity/re-enrol", {
      body: { token: firstToken, newPassword: "a brand new passphrase" },
    });
    expect(r0.status).toBe(400);
    expect(r0.body).toMatchObject({ error: { code: "Validation" } });

    const tooShort = await new Browser(h.app).json("/api/identity/re-enrol", {
      body: { token, newPassword: "short" },
    });
    expect(tooShort.status).toBe(400);

    const newPassword = "a brand new passphrase";
    const r = new Browser(h.app);
    const redeemed = await r.json("/api/identity/re-enrol", { body: { token, newPassword } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toEqual({ signedIn: true, needs: ["passkey", "totp"] });
    expect(r.setCookies.find((c) => c.startsWith("pangolin.session_token="))).toMatch(
      /SameSite=Strict/i,
    );
    expect((await r.json("/api/identity/me")).body).toMatchObject({
      displayName: "Sam",
      enrolment: "incomplete",
      needs: ["passkey", "totp"],
      recoveryCodes: { issued: false, remaining: 0 },
    });
    expect((await r.request("/api/identity/notices")).status).toBe(401);
    // Sam's old session and credentials are gone; Alex's are not.
    expect((await s.b.request("/api/identity/me")).status).toBe(401);
    expect((await a.b.request("/api/identity/me")).status).toBe(200);
    expect(count("SELECT count(*) FROM auth_passkey")).toBe(1);
    expect(count("SELECT count(*) FROM auth_two_factor")).toBe(1);
    expect(count("SELECT count(*) FROM recovery_code")).toBe(0);

    // Re-enrol TOTP with the new password, then a passkey; the notice is there.
    const enabled = await r.json<{ totpURI: string }>("/api/auth/two-factor/enable", {
      body: { password: newPassword },
    });
    expect(enabled.status).toBe(200);
    await r.request("/api/auth/two-factor/verify-totp", {
      body: { code: totp(secretOf(enabled.body.totpURI)) },
    });
    h.addPasskey(sam.email);
    const after = await r.json<{ notices: { id: string }[] }>("/api/identity/notices");
    expect(after.body.notices.map((n) => n.id)).toEqual([noticeId]);
    expect(
      (await r.request(`/api/identity/notices/${noticeId}/dismiss`, { method: "POST" })).status,
    ).toBe(204);
    expect((await r.json<{ notices: unknown[] }>("/api/identity/notices")).body.notices).toEqual(
      [],
    );

    // The old password no longer works; the new one does.
    const old = await new Browser(h.app).request("/api/auth/sign-in/email", { body: sam });
    expect(old.status).toBe(401);
    const fresh = await new Browser(h.app).json("/api/auth/sign-in/email", {
      body: { email: sam.email, password: newPassword },
    });
    expect(fresh.body).toMatchObject({ twoFactorRedirect: true });

    const reuse = await new Browser(h.app).json("/api/identity/re-enrol", {
      body: { token, newPassword: "yet another passphrase" },
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toEqual(r0.body);

    const text = auditText();
    for (const secret of [token, firstToken, newPassword, sam.password]) {
      expect(text).not.toContain(secret);
    }
    const actions = h.db
      .prepare("SELECT actor, action FROM audit_log WHERE entity = 're_enrolment_link' ORDER BY id")
      .all();
    expect(actions).toEqual([
      { actor: `person:${alexId}`, action: "create" },
      { actor: `person:${alexId}`, action: "revoke" },
      { actor: `person:${alexId}`, action: "create" },
      { actor: `person:${samId}`, action: "use" },
    ]);
    expect(
      h.db.prepare("SELECT action FROM audit_log WHERE entity = 'user' AND action = 'reset'").all(),
    ).toHaveLength(1);
  });

  it("a redemption ends a lockout on the old password, so re-enrolment can finish", async () => {
    const { a, samId } = await household();
    for (let i = 0; i < 5; i++) {
      await new Browser(h.app).request("/api/auth/sign-in/email", {
        body: { email: sam.email, password: "wrong password!!" },
      });
    }
    expect(
      (await new Browser(h.app).request("/api/auth/sign-in/email", { body: sam })).status,
    ).toBe(429);
    const issued = await a.b.json<{ url: string }>("/api/identity/re-enrolment-links", {
      body: { personId: samId },
    });
    const token = new URL(issued.body.url).searchParams.get("token") ?? "";
    const r = new Browser(h.app);
    const newPassword = "a brand new passphrase";
    expect(
      (await r.request("/api/identity/re-enrol", { body: { token, newPassword } })).status,
    ).toBe(200);
    const enabled = await r.json<{ totpURI: string }>("/api/auth/two-factor/enable", {
      body: { password: newPassword },
    });
    const verified = await r.request("/api/auth/two-factor/verify-totp", {
      body: { code: totp(secretOf(enabled.body.totpURI)) },
    });
    expect(verified.status).toBe(200);
  });

  it("refuses a link 24 hours after issue, and a stale sign-in issuing one", async () => {
    const { a, samId } = await household();
    const issued = await a.b.json<{ url: string }>("/api/identity/re-enrolment-links", {
      body: { personId: samId },
    });
    const token = new URL(issued.body.url).searchParams.get("token") ?? "";
    h.advanceMinutes(24 * 60);
    const expired = await new Browser(h.app).json("/api/identity/re-enrol", {
      body: { token, newPassword: "a brand new passphrase" },
    });
    expect(expired.status).toBe(400);
    expect(expired.body).toMatchObject({ error: { code: "Validation" } });
    const stale = await a.b.json("/api/identity/re-enrolment-links", {
      body: { personId: samId },
    });
    expect(stale.status).toBe(403);
    expect(stale.body).toMatchObject({ error: { code: "ReauthRequired" } });
    h.advanceMinutes(-24 * 60);
  });

  it("needs a session to issue a link or read notices", async () => {
    const b = new Browser(h.app);
    expect(
      (await b.request("/api/identity/re-enrolment-links", { body: { personId: "x" } })).status,
    ).toBe(401);
    expect((await b.request("/api/identity/notices")).status).toBe(401);
    expect((await b.request("/api/identity/recovery-codes", { method: "POST" })).status).toBe(401);
  });

  it("never serves the session-starting endpoint over HTTP", async () => {
    await enrolled(h.firstLink(), alex, "Alex");
    const userId = h.db.prepare("SELECT id FROM auth_user").pluck().get() as string;
    const b = new Browser(h.app);
    const res = await b.request("/api/auth/pangolin/start-session", { body: { userId } });
    expect(res.status).toBe(404);
    expect(b.cookies.size).toBe(0);
  });
});

async function initialCodes(b: Browser): Promise<string[]> {
  const res = await b.json<{ codes: string[] }>("/api/identity/recovery-codes/initial", {
    method: "POST",
  });
  expect(res.status).toBe(201);
  return res.body.codes;
}

describe("recovery hardening", () => {
  it("stores codes as HMAC under a key derived from the auth secret, never plain SHA-256", async () => {
    const { b } = await enrolled(h.firstLink(), alex, "Alex");
    const codes = await initialCodes(b);
    const stored = h.db.prepare("SELECT code_hash FROM recovery_code").pluck().all() as string[];
    const keyed = recoveryCodeHasher(h.secret);
    const plain = (code: string) => createHash("sha256").update(code).digest("hex");
    expect(stored.sort()).toEqual(codes.map((c) => keyed.hash(c.replace("-", ""))).sort());
    for (const c of codes) expect(stored).not.toContain(plain(c.replace("-", "")));
    expect(recoveryCodeHasher("another secret").hash("ABCDEFGHJK")).not.toBe(
      keyed.hash("ABCDEFGHJK"),
    );
  });

  it("a used code raises a notice for that person only", async () => {
    const { a, s } = await household();
    const codes = await initialCodes(a.b);
    const r = new Browser(h.app);
    expect(
      (await r.request("/api/identity/recover", { body: { ...alex, code: codes[0] } })).status,
    ).toBe(200);
    h.addPasskey(alex.email);
    const mine = await r.json<{ notices: { kind: string; issuedBy: unknown }[] }>(
      "/api/identity/notices",
    );
    expect(mine.body.notices).toEqual([
      expect.objectContaining({ kind: "identity.recovery-code-used", issuedBy: null }),
    ]);
    const theirs = await s.b.json<{ notices: unknown[] }>("/api/identity/notices");
    expect(theirs.body.notices).toEqual([]);
  });

  it("a successful recovery records one success: 4 failures, success, 1 failure → not locked", async () => {
    const { b } = await enrolled(h.firstLink(), alex, "Alex");
    const codes = await initialCodes(b);
    const successes = () =>
      count("SELECT count(*) FROM login_attempt WHERE ok = 1 AND email = ?", alex.email);
    const before = successes();
    for (let i = 0; i < 4; i++) {
      await new Browser(h.app).request("/api/identity/recover", {
        body: { ...alex, code: "AAAAA-AAAAA" },
      });
    }
    const ok = await new Browser(h.app).request("/api/identity/recover", {
      body: { ...alex, code: codes[0] },
    });
    expect(ok.status).toBe(200);
    expect(successes()).toBe(before + 1);
    await new Browser(h.app).request("/api/identity/recover", {
      body: { ...alex, code: "AAAAA-AAAAA" },
    });
    const attempts = h.db
      .prepare("SELECT email, at, ok FROM login_attempt WHERE email = ? ORDER BY id")
      .all(alex.email) as { email: string; at: string; ok: number }[];
    expect(attempts.slice(-6).map((a) => a.ok)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(
      lockedUntil(
        attempts.map((a) => ({ ...a, ok: a.ok === 1 })),
        { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
      ),
    ).toBeUndefined();
    const signIn = await new Browser(h.app).json("/api/auth/sign-in/email", { body: alex });
    expect(signIn.status).toBe(200);
  });

  it("refuses /recover with no Origin header before anything runs", async () => {
    const res = await h.app.request("http://localhost:3000/api/identity/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...alex, code: "AAAAA-AAAAA" }),
    });
    expect(res.status).toBe(403);
    expect(count("SELECT count(*) FROM login_attempt")).toBe(0);
  });

  it("limits /recover and /re-enrol per client: the 11th call in a minute gets 429", async () => {
    const limited = createHarness({ rateLimitPerMinute: 10 });
    try {
      for (const [path, body] of [
        // A different email each time, so the per-email lockout never answers first.
        [
          "/api/identity/recover",
          (i: number) => ({ email: `x${i}@example.com`, password: "p", code: "c" }),
        ],
        ["/api/identity/re-enrol", () => ({ token: "t", newPassword: "a long enough passphrase" })],
      ] as const) {
        const statuses: number[] = [];
        for (let i = 0; i < 10; i++) {
          statuses.push((await new Browser(limited.app).request(path, { body: body(i) })).status);
        }
        expect(statuses.includes(429), path).toBe(false);
        const eleventh = await new Browser(limited.app).json(path, { body: body(10) });
        expect(eleventh.status, path).toBe(429);
        expect(eleventh.body, path).toMatchObject({
          error: { code: "RateLimited", message: "Too many attempts. Try again in a minute." },
        });
      }
    } finally {
      limited.close();
    }
  });
});

describe("reset-user", () => {
  it("makes the old password useless at once; the cli link then sets a new one", async () => {
    const { samId } = await household();
    const result = resetUser(
      { ...h.identity, tokens: nodeTokens, viewer: systemViewer("cli:reset-user") },
      { personId: samId },
    );
    const old = await new Browser(h.app).request("/api/auth/sign-in/email", { body: sam });
    expect(old.status).toBe(401);
    expect(
      count(
        "SELECT count(*) FROM auth_session WHERE user_id IN (SELECT user_id FROM person WHERE id = ?)",
        samId,
      ),
    ).toBe(0);
    const newPassword = "a brand new passphrase";
    const r = new Browser(h.app);
    const redeemed = await r.json("/api/identity/re-enrol", {
      body: { token: result.link.token, newPassword },
    });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toEqual({ signedIn: true, needs: ["passkey", "totp"] });
    const fresh = await new Browser(h.app).request("/api/auth/sign-in/email", {
      body: { email: sam.email, password: newPassword },
    });
    expect(fresh.status).toBe(200);
  });
});

describe("the affected person revokes a link", () => {
  it("ends every unused link against them and resolves the notice as revoked", async () => {
    const { a, s, samId } = await household();
    const issued = await a.b.json<{ url: string }>("/api/identity/re-enrolment-links", {
      body: { personId: samId },
    });
    const token = new URL(issued.body.url).searchParams.get("token") ?? "";
    // Alex revoking touches only links against Alex (none).
    expect((await a.b.json("/api/identity/re-enrolment-links/revoke", { body: {} })).body).toEqual({
      revoked: 0,
    });
    const revoked = await s.b.json("/api/identity/re-enrolment-links/revoke", { body: {} });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ revoked: 1 });
    expect((await s.b.json<{ notices: unknown[] }>("/api/identity/notices")).body.notices).toEqual(
      [],
    );
    expect(
      h.db.prepare("SELECT resolution FROM review_item WHERE person_id = ?").pluck().get(samId),
    ).toBe("revoked");
    const dead = await new Browser(h.app).request("/api/identity/re-enrol", {
      body: { token, newPassword: "a brand new passphrase" },
    });
    expect(dead.status).toBe(400);
    expect(
      count(
        "SELECT count(*) FROM audit_log WHERE entity = 're_enrolment_link' AND action = 'revoke'",
      ),
    ).toBe(1);
  });
});

describe("a session that cannot be started after the redemption committed", () => {
  const failing = (): RecoveryAuth => ({
    $context: Promise.resolve({
      internalAdapter: {
        findUserById: async () => ({ email: alex.email }),
        findUserByEmail: async () => {
          const id = h.db
            .prepare("SELECT id FROM auth_user WHERE email = ?")
            .pluck()
            .get(alex.email) as string;
          return {
            user: { id },
            accounts: [{ providerId: "credential", accountId: id, password: "h" }],
          };
        },
      },
      password: { hash: async () => "salt:key", verify: async () => true },
    }),
    api: {
      startSession: async () => {
        throw new Error("session store down");
      },
    },
  });

  it("answers signedIn: false (logged) instead of an error, with the code or link spent", async () => {
    const { a, s, samId } = await household();
    const codes = await initialCodes(a.b);
    const logged: string[] = [];
    const gateway = recoveryGateway(
      h.identity,
      { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
      failing(),
      (_level, message) => logged.push(message),
    );
    const recovered = await gateway.recover({ ...alex, code: codes[0] ?? "" }, new Headers());
    expect(recovered).toEqual(expect.objectContaining({ signedIn: false, setCookies: [] }));
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NOT NULL")).toBe(1);

    const issued = await s.b.json<{ url: string }>("/api/identity/re-enrolment-links", {
      body: {
        personId: h.db.prepare("SELECT id FROM person WHERE id != ?").pluck().get(samId) as string,
      },
    });
    const token = new URL(issued.body.url).searchParams.get("token") ?? "";
    const reEnrolled = await gateway.reEnrol(
      { token, newPassword: "a brand new passphrase" },
      new Headers(),
    );
    expect(reEnrolled.signedIn).toBe(false);
    expect(count("SELECT count(*) FROM re_enrolment_link WHERE used_at IS NOT NULL")).toBe(1);
    expect(logged).toHaveLength(2);
    expect(logged.join("\n")).not.toContain(token);
    expect(logged.join("\n")).not.toContain(codes[0] ?? "-");
  });

  it("releases the attempt when recover fails with an error other than Unauthenticated", async () => {
    const { a } = await household();
    const codes = await initialCodes(a.b);
    const broken: RecoveryAuth = {
      ...failing(),
      $context: failing().$context.then((ctx) => ({
        ...ctx,
        password: {
          ...ctx.password,
          verify: async () => {
            throw new Error("hasher down");
          },
        },
      })),
    };
    const gateway = recoveryGateway(
      h.identity,
      { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
      broken,
      () => {},
    );
    const before = count("SELECT count(*) FROM login_attempt");
    await expect(gateway.recover({ ...alex, code: codes[0] ?? "" }, new Headers())).rejects.toThrow(
      "hasher down",
    );
    expect(count("SELECT count(*) FROM login_attempt")).toBe(before);
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NOT NULL")).toBe(0);
  });
});
