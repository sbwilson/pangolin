import type { AppType } from "@pangolin/server";
import { hc } from "hono/client";

export const api = hc<AppType>("/");

export type Health =
  | { readonly healthy: true; readonly schemaVersion: number }
  | { readonly healthy: false; readonly schemaVersion: number | null };

export async function fetchHealth(): Promise<Health> {
  const res = await api.api.system.health.$get();
  const body = await res.json();
  if (res.ok && body.status === "ok") {
    return { healthy: true, schemaVersion: body.schemaVersion };
  }
  return { healthy: false, schemaVersion: body.schemaVersion };
}

/** A dead job as the status page shows it: kind and failure time only (AD-9). */
export interface DeadJob {
  readonly kind: string;
  readonly failedAt: string;
}

export async function fetchDeadJobs(): Promise<DeadJob[]> {
  const res = await api.api.system.jobs.$get();
  if (!res.ok) throw new Error(`GET /api/system/jobs failed with ${res.status}`);
  const body = await res.json();
  return body.dead;
}

/** An error answered in the API's error shape. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  return new ApiError(
    res.status,
    body.error?.code ?? "Internal",
    body.error?.message ?? `Request failed with ${res.status}`,
  );
}

export interface Me {
  readonly personId: string;
  readonly displayName: string;
  readonly colour: string;
  readonly authAt: string;
  readonly canInvite: boolean;
  readonly demo: boolean;
  /** `incomplete` until the login has a passkey and a confirmed TOTP authenticator. */
  readonly enrolment: "complete" | "incomplete";
  readonly needs: readonly ("passkey" | "totp")[];
  /** Whether recovery codes were ever issued (false until enrolment first completes), and how many are left. */
  readonly recoveryCodes: { readonly issued: boolean; readonly remaining: number };
  /** The other person with a login, whose access this person may reset. */
  readonly partner: { readonly personId: string; readonly displayName: string } | null;
}

/** The signed-in person, or null when nobody is signed in. */
export async function fetchMe(): Promise<Me | null> {
  const res = await api.api.identity.me.$get();
  // The session middleware answers 401 before the route, so the RPC type does not know it.
  if ((res.status as number) === 401) return null;
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as Me;
}

export interface SignUpForm {
  readonly token: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly colour: string;
}

/** Creates the login and the person from a setup link, and signs in. */
export async function signUp(form: SignUpForm): Promise<void> {
  // A plain fetch: the route parses its body itself, so the RPC client has no input type for it.
  const res = await fetch("/api/identity/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await apiError(res);
}

/** Issues a one-time link for the partner. Needs a sign-in in the last 5 minutes. */
export async function invitePartner(): Promise<{ url: string; expiresAt: string }> {
  const res = await api.api.identity["setup-links"].$post();
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as { url: string; expiresAt: string };
}

/** A JSON POST to one of our routes that parses its own body; throws `ApiError` on failure. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

/** 10 recovery codes, `XXXXX-XXXXX`, shown once. */
export interface RecoveryCodes {
  readonly codes: readonly string[];
}

/** The first set of recovery codes, right after enrolment first completes. Works once. */
export async function issueInitialRecoveryCodes(): Promise<RecoveryCodes> {
  const res = await api.api.identity["recovery-codes"].initial.$post();
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as RecoveryCodes;
}

/** Replaces every unused recovery code. Needs a sign-in in the last 5 minutes. */
export async function regenerateRecoveryCodes(): Promise<RecoveryCodes> {
  const res = await api.api.identity["recovery-codes"].$post();
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as RecoveryCodes;
}

/**
 * A redemption's outcome. `signedIn` is false when it went through but no session could be
 * started: the person then signs in normally.
 */
export interface Redeemed {
  readonly signedIn: boolean;
}

/** Signs in with email, password and a recovery code; a new passkey must then be added. */
export async function recoverWithCode(form: {
  readonly email: string;
  readonly password: string;
  readonly code: string;
}): Promise<Redeemed> {
  const { signedIn } = await postJson<Redeemed>("/api/identity/recover", form);
  return { signedIn };
}

/** Redeems a re-enrolment link with a new password, and signs in to enrol again. */
export async function reEnrol(form: {
  readonly token: string;
  readonly newPassword: string;
}): Promise<Redeemed> {
  const { signedIn } = await postJson<Redeemed>("/api/identity/re-enrol", form);
  return { signedIn };
}

/** Ends every unused recovery link issued against the signed-in person. */
export async function revokeMyRecoveryLinks(): Promise<{ revoked: number }> {
  return postJson("/api/identity/re-enrolment-links/revoke", {});
}

/** Issues a one-time re-enrolment link for the partner. Needs a sign-in in the last 5 minutes. */
export async function resetPartner(personId: string): Promise<{ url: string; expiresAt: string }> {
  return postJson("/api/identity/re-enrolment-links", { personId });
}

/** An in-app notice: one of the signed-in person's open review items. */
export interface Notice {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  /** Who issued a recovery link (`identity.partner-reset`); null for other kinds. */
  readonly issuedBy: string | null;
}

export async function fetchNotices(): Promise<Notice[]> {
  const res = await api.api.identity.notices.$get();
  if (!res.ok) throw await apiError(res);
  return (await res.json()).notices;
}

/** Dismisses one of the signed-in person's own notices. */
export async function dismissNotice(id: string): Promise<void> {
  const res = await api.api.identity.notices[":id"].dismiss.$post({ param: { id } });
  if (!res.ok) throw await apiError(res);
}
