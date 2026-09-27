// Story 1.6 end to end, after the auth project registered Alex and Sam: a recovery code replaces
// Alex's lost passkey (once only), and Alex resets Sam's access with a re-enrolment link that Sam
// redeems to set a new password and enrol again; only Sam sees the notice. In order.
import {
  loadAccount,
  saveAccount,
  saveRecoveryCodes,
  signInWithPassword,
} from "./helpers/account.ts";
import { expect, test, watchCsp } from "./helpers/csp.ts";
import { totp } from "./helpers/totp.ts";
import { addVirtualAuthenticator } from "./helpers/webauthn.ts";

test.describe.configure({ mode: "serial" });

const ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

test("a recovery code and the password sign in to a forced new passkey; the code works once", async ({
  page,
  request,
}) => {
  const account = loadAccount();
  const [code, ...rest] = account.recoveryCodes;
  if (code === undefined) throw new Error("the auth project saved no recovery codes");
  await addVirtualAuthenticator(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByLabel("Recovery code").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Recover" }).click();

  // Only passkey enrolment is reachable until a new passkey exists.
  await expect(page.getByRole("button", { name: "Add a passkey" })).toBeVisible();
  const gated = await page.evaluate(async () => {
    const res = await fetch("/api/system/jobs");
    return { status: res.status, body: await res.json() };
  });
  expect(gated).toMatchObject({
    status: 401,
    body: { error: { details: { enrolment: "incomplete", needs: ["passkey"] } } },
  });
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText(`Signed in as Alex`)).toBeVisible();
  await expect(page.getByText("9 unused recovery codes left.")).toBeVisible();

  // The same code again is refused.
  const reuse = await request.post("/api/identity/recover", {
    headers: { Origin: ORIGIN },
    data: { email: account.email, password: account.password, code },
  });
  expect(reuse.status()).toBe(401);
  expect(await reuse.json()).toMatchObject({ error: { code: "Unauthenticated" } });
  saveAccount({ ...account, recoveryCodes: rest });

  // The new passkey signs in.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  // Alex is told a code was used.
  await expect(page.getByText(/One of your recovery codes was used/)).toBeVisible();
});

test("regenerating recovery codes from home gives 10 new ones and ends the old ones", async ({
  page,
  request,
}) => {
  const account = loadAccount();
  const [oldCode] = account.recoveryCodes;
  if (oldCode === undefined) throw new Error("no saved recovery codes left");
  await signInWithPassword(page, account);
  await expect(page.getByText("9 unused recovery codes left.")).toBeVisible();
  await page.getByRole("button", { name: "Regenerate recovery codes" }).click();
  const list = page.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = (await list.getByRole("listitem").allTextContents()).map((c) => c.trim());
  expect(codes).not.toContain(oldCode);
  await page.getByLabel("I have saved these codes").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("10 unused recovery codes left.")).toBeVisible();

  const old = await request.post("/api/identity/recover", {
    headers: { Origin: ORIGIN },
    data: { email: account.email, password: account.password, code: oldCode },
  });
  expect(old.status()).toBe(401);
  saveAccount({ ...account, recoveryCodes: codes });
});

test("Alex resets Sam's access: Sam sets a new password, re-enrols and alone sees the notice", async ({
  page,
  browser,
  request,
  cspViolations,
}) => {
  await signInWithPassword(page, loadAccount());
  await expect(page.getByText("Signed in as Alex")).toBeVisible();
  await page.getByRole("button", { name: "Reset partner's access" }).click();
  const link = await page.getByLabel("Partner recovery link").inputValue();
  expect(link).toMatch(/\/recover\?token=[\w-]{43}$/);
  const token = new URL(link).searchParams.get("token") ?? "";

  const samContext = await browser.newContext();
  try {
    await watchCsp(samContext, cspViolations);
    const sam = await samContext.newPage();
    await addVirtualAuthenticator(sam);
    await sam.goto(link);
    const newPassword = "Sam's brand new passphrase";
    await sam.getByLabel("New password (at least 12 characters)").fill(newPassword);
    await sam.getByLabel("Confirm new password").fill(newPassword);
    await sam.getByRole("button", { name: "Set new password" }).click();
    // Both a passkey and TOTP must be enrolled again; the new password is still in memory.
    await sam.getByRole("button", { name: "Add a passkey" }).click();
    const secret = await sam.getByLabel("Secret key").inputValue();
    await sam.getByLabel("Authenticator code").fill(totp(secret));
    await sam.getByRole("button", { name: "Finish" }).click();
    expect(await saveRecoveryCodes(sam)).toHaveLength(10);
    await expect(sam.getByText("Signed in as Sam")).toBeVisible();
    await expect(sam.getByRole("heading", { name: "Notices" })).toBeVisible();
    await expect(
      sam.getByText(/A one-time recovery link for your account was issued on .* by Alex\./),
    ).toBeVisible();

    const notices = await sam.evaluate(async () => {
      const res = await fetch("/api/identity/notices");
      return (await res.json()) as { notices: { id: string; kind: string }[] };
    });
    expect(notices.notices.map((n) => n.kind)).toEqual(["identity.partner-reset"]);
    const noticeId = notices.notices[0]?.id ?? "";

    // Alex does not see it and cannot dismiss it.
    await page.reload();
    await expect(page.getByText("Signed in as Alex")).toBeVisible();
    await expect(page.getByText(/A one-time recovery link for your account/)).toHaveCount(0);
    const alexDismiss = await page.evaluate(async (id) => {
      const res = await fetch(`/api/identity/notices/${id}/dismiss`, { method: "POST" });
      return res.status;
    }, noticeId);
    expect(alexDismiss).toBe(404);

    // The link is spent.
    const reuse = await request.post("/api/identity/re-enrol", {
      headers: { Origin: ORIGIN },
      data: { token, newPassword: "yet another long passphrase" },
    });
    expect(reuse.status()).toBe(400);
    expect(await reuse.json()).toMatchObject({ error: { code: "Validation" } });

    // Sam dismisses it.
    await sam.getByRole("button", { name: "Dismiss" }).click();
    await expect(sam.getByRole("heading", { name: "Notices" })).toHaveCount(0);
  } finally {
    await samContext.close();
  }
});
