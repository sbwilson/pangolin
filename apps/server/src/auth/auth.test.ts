import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultAuthConfig } from "../config.ts";
import { Browser, createHarness, type Harness } from "../testing/auth-harness.ts";
import { secretOf, totp } from "../testing/totp.ts";
import { cookieSettings } from "./auth.ts";
import { authHooks } from "./hooks.ts";

// One household, built up test by test: the order matters.
let h: Harness;
let token: string;
const alex = { email: "alex@example.com", password: "correct horse battery staple" };
const sam = { email: "sam@example.com", password: "another long passphrase" };
let alexSecret: string;

/** The current TOTP code. better-auth accepts a code again within its step, so no waiting. */
async function nextCode(secret: string): Promise<string> {
  return totp(secret);
}

async function signUp(b: Browser, t: string, who: typeof alex, name: string) {
  return b.json("/api/identity/sign-up", {
    body: {
      token: t,
      email: who.email,
      password: who.password,
      displayName: name,
      colour: "#2563eb",
    },
  });
}

function count(table: string): number {
  return h.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

beforeAll(() => {
  h = createHarness();
  token = h.firstLink();
});

afterAll(() => {
  h.close();
});

describe("cookieSettings", () => {
  it("uses the __Host- prefix on https and a plain name on http, strict either way", () => {
    expect(cookieSettings("https://money.example.com")).toMatchObject({
      cookiePrefix: "__Host-pangolin",
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "strict", path: "/" },
    });
    expect(cookieSettings("http://localhost:3000").cookiePrefix).toBe("pangolin");
  });
});

describe("cookies behind https", () => {
  it("sets and reads back a __Host- session cookie", async () => {
    const https = createHarness({ publicUrl: "https://money.example.com" });
    try {
      const b = new Browser(https.app, https.origin);
      const res = await b.json("/api/identity/sign-up", {
        body: {
          token: https.firstLink(),
          email: alex.email,
          password: alex.password,
          displayName: "Alex",
          colour: "#2563eb",
        },
      });
      expect(res.status).toBe(201);
      const session = b.setCookies.find((c) => c.startsWith("__Host-pangolin.session_token="));
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/Secure/i);
      expect(session).toMatch(/SameSite=Strict/i);
      expect(session).toMatch(/Path=\/(;|$)/i);
      expect(session).not.toMatch(/Domain=/i);
      expect((await b.json("/api/identity/me")).body).toMatchObject({ displayName: "Alex" });
    } finally {
      https.close();
    }
  });
});

describe("sign-up, sign-in and lockout", () => {
  it("refuses an unknown token with 400 Validation and creates no user", async () => {
    const res = await signUp(new Browser(h.app), "not-a-token", alex, "Alex");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "Validation" } });
    expect(count("auth_user")).toBe(0);
  });

  it("rejects a bad form in the error shape", async () => {
    const res = await new Browser(h.app).json("/api/identity/sign-up", {
      body: { token, email: "nope", password: "x", displayName: "", colour: "red" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "Validation" } });
  });

  it("signs up with the first link: user, person and used link, audited, signed in", async () => {
    const b = new Browser(h.app);
    const res = await signUp(b, token, alex, "Alex");
    expect(res.status).toBe(201);
    const session = b.setCookies.find((c) => c.startsWith("pangolin.session_token="));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Strict/i);
    expect(session).toMatch(/Path=\//i);
    const me = await b.json("/api/identity/me");
    expect(me.body).toMatchObject({
      displayName: "Alex",
      canInvite: true,
      demo: false,
      enrolment: "incomplete",
      needs: ["passkey", "totp"],
    });
    // Until enrolment is finished, nothing else is reachable.
    const jobs = await b.json("/api/system/jobs");
    expect(jobs.status).toBe(401);
    expect(jobs.body).toEqual({
      error: {
        code: "Unauthenticated",
        message: "Finish setting up your sign-in first",
        details: { enrolment: "incomplete", needs: ["passkey", "totp"] },
      },
    });
    expect(count("person")).toBe(1);
    expect(h.db.prepare("SELECT used_at FROM setup_link").pluck().get()).not.toBeNull();
    const audit = h.db.prepare("SELECT entity, action FROM audit_log ORDER BY id").all();
    expect(audit).toEqual([
      { entity: "setup_link", action: "create" },
      { entity: "user", action: "create" },
      { entity: "person", action: "create" },
      { entity: "setup_link", action: "use" },
    ]);

    // Enrol TOTP in the same session, then prove it with a code.
    const enabled = await b.json<{ totpURI: string }>("/api/auth/two-factor/enable", {
      body: { password: alex.password },
    });
    expect(enabled.status).toBe(200);
    alexSecret = secretOf(enabled.body.totpURI);
    const verified = await b.request("/api/auth/two-factor/verify-totp", {
      body: { code: await nextCode(alexSecret) },
    });
    expect(verified.status).toBe(200);
    // better-auth's own TOTP write is audited, as Alex.
    const enabledAudit = h.db
      .prepare("SELECT actor, entity, action, person_id FROM audit_log WHERE entity = 'two_factor'")
      .all() as { actor: string; person_id: string }[];
    expect(enabledAudit).toEqual([
      expect.objectContaining({ entity: "two_factor", action: "enable" }),
    ]);
    expect(enabledAudit[0]?.actor).toBe(`person:${enabledAudit[0]?.person_id}`);
    expect((await b.json("/api/identity/me")).body).toMatchObject({ needs: ["passkey"] });
    h.addPasskey(alex.email);
    expect((await b.json("/api/identity/me")).body).toMatchObject({
      enrolment: "complete",
      needs: [],
    });
    expect((await b.request("/api/system/jobs")).status).toBe(200);
    expect((await b.request("/api/auth/sign-out", { body: {} })).status).toBe(200);
    expect((await b.request("/api/identity/me")).status).toBe(401);
  });

  it("refuses the same link again with 400 Validation, creating no user", async () => {
    const res = await signUp(new Browser(h.app), token, sam, "Sam");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "Validation" } });
    expect(count("auth_user")).toBe(1);
  });

  it("refuses better-auth's own sign-up route", async () => {
    const res = await new Browser(h.app).request("/api/auth/sign-up/email", {
      body: { email: sam.email, password: sam.password, name: "Sam" },
    });
    expect(res.status).toBe(404);
    expect(count("auth_user")).toBe(1);
  });

  it("signs in with password, then a TOTP code", async () => {
    const b = new Browser(h.app);
    const first = await b.json("/api/auth/sign-in/email", { body: alex });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ twoFactorRedirect: true });
    expect((await b.request("/api/identity/me")).status).toBe(401);
    const second = await b.request("/api/auth/two-factor/verify-totp", {
      body: { code: await nextCode(alexSecret) },
    });
    expect(second.status).toBe(200);
    expect((await b.json("/api/identity/me")).body).toMatchObject({ displayName: "Alex" });
  });

  it("issues a partner link after a recent sign-in, and refuses it 6 minutes later", async () => {
    const b = new Browser(h.app);
    await b.request("/api/auth/sign-in/email", { body: alex });
    await b.request("/api/auth/two-factor/verify-totp", {
      body: { code: await nextCode(alexSecret) },
    });
    const issued = await b.json<{ url: string; expiresAt: string }>("/api/identity/setup-links", {
      method: "POST",
    });
    expect(issued.status).toBe(201);
    expect(issued.body.url).toMatch(/^http:\/\/localhost:3000\/setup\?token=[\w-]{43}$/);
    const partnerToken = new URL(issued.body.url).searchParams.get("token") ?? "";

    h.advanceMinutes(6);
    try {
      const stale = await b.json("/api/identity/setup-links", { method: "POST" });
      expect(stale.status).toBe(403);
      expect(stale.body).toMatchObject({ error: { code: "ReauthRequired" } });
    } finally {
      h.advanceMinutes(-6);
    }

    // Sam registers with it; then registration is closed for any token.
    const samBrowser = new Browser(h.app);
    expect((await signUp(samBrowser, partnerToken, sam, "Sam")).status).toBe(201);
    expect((await samBrowser.json("/api/identity/me")).body).toMatchObject({
      displayName: "Sam",
      canInvite: false,
      enrolment: "incomplete",
    });
    for (const t of [partnerToken, "anything"]) {
      const third = await signUp(
        new Browser(h.app),
        t,
        { ...sam, email: "third@example.com" },
        "C",
      );
      expect(third.status).toBe(409);
      expect(third.body).toEqual({
        error: { code: "Conflict", message: "Registration is closed" },
      });
    }
    expect(count("auth_user")).toBe(2);
    const more = await b.json("/api/identity/setup-links", { method: "POST" });
    expect(more.status).toBe(409);
  });

  it("lets an unenrolled login reach only its identity and its enrolment", async () => {
    // Sam registered but never enrolled: a password-only login.
    const b = new Browser(h.app);
    expect((await b.request("/api/auth/sign-in/email", { body: sam })).status).toBe(200);
    expect((await b.json("/api/identity/me")).body).toMatchObject({
      enrolment: "incomplete",
      needs: ["passkey", "totp"],
    });
    for (const [path, method] of [
      ["/api/system/jobs", "GET"],
      ["/api/identity/setup-links", "POST"],
      ["/api/auth/list-sessions", "GET"],
      ["/api/auth/update-user", "POST"],
    ] as const) {
      const res = await b.json(path, { method, ...(method === "POST" ? { body: {} } : {}) });
      expect(res.status, path).toBe(401);
      expect(res.body, path).toMatchObject({
        error: { details: { enrolment: "incomplete", needs: ["passkey", "totp"] } },
      });
    }
    const enable = await b.request("/api/auth/two-factor/enable", {
      body: { password: sam.password },
    });
    expect(enable.status).toBe(200);
    expect((await b.request("/api/auth/sign-out", { body: {} })).status).toBe(200);
  });

  it("refuses credential changes 6 minutes after sign-in with ReauthRequired", async () => {
    const b = new Browser(h.app);
    await b.request("/api/auth/sign-in/email", { body: alex });
    await b.request("/api/auth/two-factor/verify-totp", {
      body: { code: await nextCode(alexSecret) },
    });
    h.advanceMinutes(6);
    try {
      for (const [path, method, body] of [
        ["/api/auth/two-factor/disable", "POST", { password: alex.password }],
        ["/api/auth/two-factor/get-totp-uri", "POST", { password: alex.password }],
        ["/api/auth/passkey/generate-register-options", "GET", undefined],
        [
          "/api/auth/change-password",
          "POST",
          { currentPassword: alex.password, newPassword: "x".repeat(20) },
        ],
      ] as const) {
        const res = await b.json(path, { method, ...(body === undefined ? {} : { body }) });
        expect(res.status, path).toBe(403);
        expect(res.body, path).toMatchObject({ code: "ReauthRequired" });
      }
    } finally {
      h.advanceMinutes(-6);
    }
    expect(
      h.db
        .prepare("SELECT two_factor_enabled FROM auth_user WHERE email = ?")
        .pluck()
        .get(alex.email),
    ).toBe(1);
  });

  it("answers 404 for recovery-code and OTP routes", async () => {
    const b = new Browser(h.app);
    for (const path of [
      "/api/auth/two-factor/verify-backup-code",
      "/api/auth/two-factor/generate-backup-codes",
      "/api/auth/two-factor/send-otp",
      "/api/auth/two-factor/verify-otp",
    ]) {
      expect((await b.request(path, { body: { code: "x" } })).status, path).toBe(404);
    }
  });

  it("refuses a write from another origin before anything runs", async () => {
    const before = count("setup_link");
    const res = await h.app.request("http://localhost:3000/api/identity/setup-links", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(count("setup_link")).toBe(before);
  });

  it("locks an email after 5 wrong passwords, refusing even the right one", async () => {
    const b = new Browser(h.app);
    for (let i = 0; i < 5; i++) {
      const res = await b.request("/api/auth/sign-in/email", {
        body: { email: sam.email, password: "wrong password!!" },
      });
      expect(res.status).toBe(401);
    }
    const locked = await b.json("/api/auth/sign-in/email", { body: sam });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: "RateLimited" });
    expect(b.cookies.size).toBe(0);
    // Alex is unaffected.
    const other = await new Browser(h.app).json("/api/auth/sign-in/email", { body: alex });
    expect(other.body).toMatchObject({ twoFactorRedirect: true });
    // Once 15 minutes pass, the right password works again.
    h.advanceMinutes(15);
    const after = await new Browser(h.app).request("/api/auth/sign-in/email", { body: sam });
    expect(after.status).toBe(200);
  });

  it("never logs a token or secret", () => {
    const text = h.logged.join("\n");
    expect(text).not.toContain(token);
    expect(text).not.toContain(alexSecret);
  });
});

/** A fresh household with one fully enrolled login; returns its TOTP secret. */
async function enrolled(hh: Harness): Promise<string> {
  const b = new Browser(hh.app);
  expect((await signUp(b, hh.firstLink(), alex, "Alex")).status).toBe(201);
  const enabled = await b.json<{ totpURI: string }>("/api/auth/two-factor/enable", {
    body: { password: alex.password },
  });
  const secret = secretOf(enabled.body.totpURI);
  await b.request("/api/auth/two-factor/verify-totp", { body: { code: totp(secret) } });
  hh.addPasskey(alex.email);
  return secret;
}

/** A six-digit code that is not the current one (nor its neighbours). */
function wrongCode(secret: string): string {
  const now = Date.now();
  const valid = new Set([-30_000, 0, 30_000].map((d) => totp(secret, now + d)));
  for (let n = 0; ; n++) {
    const code = String(n).padStart(6, "0");
    if (!valid.has(code)) return code;
  }
}

describe("TOTP lockout", () => {
  it("5 wrong codes lock the email; a right password awaiting its code records nothing", async () => {
    const hh = createHarness();
    try {
      const secret = await enrolled(hh);
      const attempts = () => hh.db.prepare("SELECT count(*) FROM login_attempt").pluck().get();
      const before = attempts();
      const b = new Browser(hh.app);
      const first = await b.json("/api/auth/sign-in/email", { body: alex });
      expect(first.body).toMatchObject({ twoFactorRedirect: true });
      expect(attempts()).toBe(before);
      for (let i = 0; i < 5; i++) {
        const res = await b.request("/api/auth/two-factor/verify-totp", {
          body: { code: wrongCode(secret) },
        });
        expect(res.status).toBe(401);
      }
      expect(hh.db.prepare("SELECT count(*) FROM login_attempt WHERE ok = 0").pluck().get()).toBe(
        5,
      );
      const again = new Browser(hh.app);
      const locked = await again.json("/api/auth/sign-in/email", { body: alex });
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: "RateLimited" });
    } finally {
      hh.close();
    }
  });
});

describe("idle timeout", () => {
  it("ends a session unused for longer than the idle time", async () => {
    const hh = createHarness({ sessionIdleMs: 2000 });
    try {
      const b = new Browser(hh.app);
      await signUp(b, hh.firstLink(), alex, "Alex");
      expect((await b.request("/api/identity/me")).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect((await b.request("/api/identity/me")).status).toBe(401);
    } finally {
      hh.close();
    }
  });
});

describe("passkey sign-in and the lockout", () => {
  it("resets the password-failure count: 4 wrong, a passkey sign-in, 1 wrong is 401, not 429", async () => {
    const hh = createHarness();
    try {
      await enrolled(hh);
      const wrong = async () =>
        (
          await new Browser(hh.app).request("/api/auth/sign-in/email", {
            body: { email: alex.email, password: "wrong password!!" },
          })
        ).status;
      for (let i = 0; i < 4; i++) expect(await wrong()).toBe(401);
      // better-auth's passkey verification needs a real authenticator, which the harness lacks:
      // run our after-hook as it runs once that verification has created the session.
      const hooks = authHooks(hh.identity, {
        maxFailures: 5,
        windowMs: 15 * 60_000,
        lockMs: 15 * 60_000,
      });
      await (hooks.after as unknown as (input: unknown) => Promise<unknown>)({
        path: "/passkey/verify-authentication",
        context: { newSession: { user: { email: alex.email } } },
        headers: new Headers(),
      });
      expect(await wrong()).toBe(401);
      // The count restarted at the passkey sign-in: four more wrong passwords, then the lock.
      for (let i = 0; i < 4; i++) expect(await wrong()).toBe(401);
      expect(await wrong()).toBe(429);
    } finally {
      hh.close();
    }
  });
});

// Seam S11a (spike "Check the suspected seams"): real. The lockout is check-then-act across the
// scrypt hash: the before-hook reads the attempts, better-auth hashes the password (async scrypt,
// off the event loop), and only the after-hook records the failure, so concurrent sign-ins all
// pass the check before any failure is recorded. In the spike's run all 20 concurrent wrong
// passwords were evaluated (401), and a right one sent last in the same burst signed in (200);
// with the production per-client limit (10 a minute) one client still got 10. The fix story
// turns this test on.
describe("concurrent sign-ins and the lockout (seam S11a)", () => {
  it.fails("S11a: evaluates at most maxFailures of a concurrent burst, and refuses a right password in it", {
    timeout: 20_000,
  }, async () => {
    // The harness runs with this lockout, so the limit is read from its auth config.
    const { lockout } = defaultAuthConfig("/unused");
    const hh = createHarness({ lockout });
    try {
      const b = new Browser(hh.app);
      expect((await signUp(b, hh.firstLink(), alex, "Alex")).status).toBe(201);
      // 19 wrong passwords, then the right one, all at once.
      const statuses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          new Browser(hh.app)
            .request("/api/auth/sign-in/email", {
              body: { email: alex.email, password: i === 19 ? alex.password : "wrong password!!" },
            })
            .then((res) => res.status),
        ),
      );
      // Each is refused: 401 for a password evaluated, 429 once the email is locked.
      expect(statuses.filter((status) => status !== 401 && status !== 429)).toEqual([]);
      expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(
        lockout.maxFailures,
      );
      // The right password, sent after more than maxFailures wrong ones, is refused.
      expect(statuses[19]).toBe(429);
    } finally {
      hh.close();
    }
  });
});
