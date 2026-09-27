// Story 1.5 end to end, on a freshly started server: the first setup link, registration with a
// passkey and TOTP, both ways of signing in, the partner invite, closed registration, lockout,
// and the request guards. The tests build on each other, so they run in order.
import {
  type Account,
  readSetupLink,
  saveAccount,
  saveRecoveryCodes,
  signInWithPassword,
} from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";
import { totp } from "./helpers/totp.ts";
import { addVirtualAuthenticator } from "./helpers/webauthn.ts";

test.describe.configure({ mode: "serial" });

const ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const alex = { email: "alex@example.com", password: "correct horse battery staple", name: "Alex" };
const sam = { email: "sam@example.com", password: "another long passphrase", name: "Sam" };
let alexAccount: Account;
let partnerLink: string;

/**
 * Fills the setup form, adds a passkey, confirms TOTP and saves the recovery codes; returns the
 * TOTP secret and the codes. With
 * `reload`, reloads the page after the account step and again after the passkey, proving an
 * interrupted setup resumes where it stopped (asking for the password again for TOTP).
 */
async function register(
  page: import("@playwright/test").Page,
  link: string,
  who: typeof alex,
  reload = false,
): Promise<{ secret: string; codes: string[] }> {
  await page.goto(link);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password (at least 12 characters)").fill(who.password);
  await page.getByLabel("Display name").fill(who.name);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  if (reload) {
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Finish setting up your sign-in" }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Add a passkey" }).click();
  if (reload) {
    await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();
    await page.reload();
    // Only TOTP is missing now: no second passkey.
    await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a passkey" })).toHaveCount(0);
    await page.getByLabel("Password").fill(who.password);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
  }
  const secret = await page.getByLabel("Secret key").inputValue();
  expect(await page.getByLabel("Authenticator URI").inputValue()).toMatch(/^otpauth:\/\/totp\//);
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Finish" }).click();
  const codes = await saveRecoveryCodes(page);
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  await expect(page.getByText(`Signed in as ${who.name}`)).toBeVisible();
  // Shown once: a reload goes straight home.
  await page.reload();
  await expect(page.getByText(`Signed in as ${who.name}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show my recovery codes" })).toHaveCount(0);
  return { secret, codes };
}

test("registers from the setup link with a passkey and TOTP (resuming after reloads), then signs in with the passkey", async ({
  page,
  context,
}) => {
  await addVirtualAuthenticator(page);
  const { secret, codes } = await register(page, readSetupLink(), alex, true);
  alexAccount = {
    email: alex.email,
    password: alex.password,
    totpSecret: secret,
    recoveryCodes: codes,
  };
  saveAccount(alexAccount);

  const [session] = (await context.cookies()).filter((c) => c.name.endsWith("session_token"));
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  const [again] = (await context.cookies()).filter((c) => c.name.endsWith("session_token"));
  expect(again).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
});

test("signs in with password and a computed TOTP code", async ({ page }) => {
  await signInWithPassword(page, alexAccount);
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
});

test("invites the partner, who registers; then any further sign-up is refused", async ({
  page,
  browser,
  request,
  cspViolations,
}) => {
  await signInWithPassword(page, alexAccount);
  await page.getByRole("button", { name: "Invite partner" }).click();
  partnerLink = await page.getByLabel("Partner setup link").inputValue();
  expect(partnerLink).toMatch(/\/setup\?token=[\w-]{43}$/);

  const samContext = await browser.newContext();
  try {
    await watchCsp(samContext, cspViolations);
    const samPage = await samContext.newPage();
    await addVirtualAuthenticator(samPage);
    await register(samPage, partnerLink, sam);
  } finally {
    await samContext.close();
  }

  // A third person, with the used token or any other, is refused and no user is created.
  const token = new URL(partnerLink).searchParams.get("token") ?? "";
  for (const t of [token, "some-other-token"]) {
    const res = await request.post("/api/identity/sign-up", {
      headers: { Origin: ORIGIN },
      data: {
        token: t,
        email: "third@example.com",
        password: "yet another passphrase",
        displayName: "Third",
        colour: "#000000",
      },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "Conflict", message: "Registration is closed" },
    });
  }
  const third = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email: "third@example.com", password: "yet another passphrase" },
  });
  expect(third.status()).toBe(401);

  await page.reload();
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite partner" })).toHaveCount(0);
});

test("5 wrong passwords lock the email: the right one is then refused", async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const res = await request.post("/api/auth/sign-in/email", {
      headers: { Origin: ORIGIN },
      data: { email: sam.email, password: "not the password" },
    });
    expect(res.status()).toBe(401);
  }
  const locked = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email: sam.email, password: sam.password },
  });
  expect(locked.status()).toBe(429);
  expect(await locked.json()).toMatchObject({ code: "RateLimited" });
});

test("refuses API calls without a session, and writes from another origin", async ({ request }) => {
  const jobs = await request.get("/api/system/jobs");
  expect(jobs.status()).toBe(401);
  expect(await jobs.json()).toMatchObject({ error: { code: "Unauthenticated" } });

  const evil = await request.post("/api/identity/setup-links", {
    headers: { Origin: "https://evil.example" },
  });
  expect(evil.status()).toBe(403);
  expect(await evil.json()).toMatchObject({ error: { code: "Forbidden" } });
});

test("every page carries the CSP, and the page's nonce matches the header", async ({ page }) => {
  for (const path of ["/", "/setup?token=x"]) {
    const res = await page.goto(path);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const pageNonce = await page
      .locator('meta[property="csp-nonce"]')
      .evaluate((meta) => (meta as HTMLMetaElement).nonce);
    expect(pageNonce).toBe(nonce);
  }
});
