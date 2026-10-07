import type { AppType } from "@pangolin/server";
import { hc } from "hono/client";
import type { TransactionsSearch } from "./routes/search.ts";

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

/** A weekly repository check or monthly restore drill result (story 1.14). */
export interface BackupVerification {
  readonly at: string;
  readonly ok: boolean;
  readonly summary: string;
}

/** The last backup, its stale warning and the latest check and drill, as the page shows them. */
export interface BackupStatus {
  /** False when no backup repository is configured. */
  readonly configured: boolean;
  readonly last: {
    readonly snapshotId: string;
    readonly takenAt: string;
    readonly pushedAt: string;
  } | null;
  /** The last good backup is older than 48 hours. */
  readonly stale: boolean;
  readonly check: BackupVerification | null;
  readonly drill: BackupVerification | null;
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
  const res = await api.api.system.backup.$get();
  if (!res.ok) throw new Error(`GET /api/system/backup failed with ${res.status}`);
  return await res.json();
}

/** Whether the current recovery bundle is confirmed stored safely (story 1.17). */
export interface RecoveryBundleStatus {
  /** True when confirmed, or when the server has no bundle id (nothing to confirm). */
  readonly confirmed: boolean;
  /** The bundle's id as printed in it; absent when the server has none. */
  readonly bundleId?: string;
}

export async function fetchRecoveryBundle(): Promise<RecoveryBundleStatus> {
  const res = await api.api.system["recovery-bundle"].$get();
  if (!res.ok) throw new Error(`GET /api/system/recovery-bundle failed with ${res.status}`);
  const { confirmed, bundleId } = await res.json();
  return bundleId === undefined ? { confirmed } : { confirmed, bundleId };
}

/** An error answered in the API's error shape. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** The error's own details (a refused split edit carries `remainingCents`), when it has any. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function apiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; details?: unknown };
  };
  const details = body.error?.details;
  return new ApiError(
    res.status,
    body.error?.code ?? "Internal",
    body.error?.message ?? `Request failed with ${res.status}`,
    typeof details === "object" && details !== null
      ? (details as Record<string, unknown>)
      : undefined,
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

/** A tag as a split carries it. */
export interface LedgerTag {
  readonly id: string;
  readonly name: string;
}

/** Who last set a classified split field; `user` outranks the rest. */
export type SplitSource = "user" | "rule" | "payee" | "activity" | "llm";

/** One split of a transaction. `beneficiary` is `shared` or a person ID. */
export interface LedgerSplit {
  readonly id: string;
  readonly amountCents: number;
  readonly beneficiary: string;
  readonly memo: string | null;
  readonly categoryId: string | null;
  readonly tags: readonly LedgerTag[];
  /** Where the category and the beneficiary came from; null while unset. */
  readonly categorySource: SplitSource | null;
  readonly beneficiarySource: SplitSource | null;
}

/** A transaction in an account the signed-in person can see, with its splits. */
export interface LedgerTransaction {
  readonly id: string;
  readonly accountId: string;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed integer minor units. */
  readonly amountCents: number;
  /** "Hidden until <date>" (short month) while the name is hidden from the viewer. */
  readonly descriptionRaw: string;
  readonly status: "pending" | "posted";
  readonly notes: string | null;
  /** True while the name is hidden from the signed-in person. */
  readonly nameHidden: boolean;
  /** Who hid the name; set on the hider's own view and the partner's alike. */
  readonly nameHiddenBy: string | null;
  /** UTC ISO timestamp, or null. */
  readonly nameHiddenUntil: string | null;
  /** The amount less its splits, worked out by the server (0 when they add up). */
  readonly remainingCents: number;
  readonly splits: readonly LedgerSplit[];
}

/** Where a page sits in the whole filtered list; the server's numbers, never worked out here. */
export interface TransactionPageInfo {
  readonly total: number;
  readonly pageCount: number;
  readonly page: number;
  /** Pass as `after` for the following page; null on the last. */
  readonly next: string | null;
  /** Pass as `before` for the preceding page; null on the first. */
  readonly prev: string | null;
}

/** One page of the transaction list, its summary and the day nets, all from the server. */
export interface TransactionList {
  readonly transactions: LedgerTransaction[];
  readonly page: TransactionPageInfo;
  /** Count and money in and out over the whole filter (`outCents` is not negative). */
  readonly summary: { readonly count: number; readonly inCents: number; readonly outCents: number };
  /** The net of each date shown on the page, over the whole filter. */
  readonly dayNets: Readonly<Record<string, number>>;
}

/**
 * One page of the transactions the signed-in person may see (shared accounts and their own private
 * ones), newest first, narrowed and positioned by `params` (the page's URL search params, which
 * are the API's query names).
 */
export async function fetchTransactions(params: TransactionsSearch = {}): Promise<TransactionList> {
  // The route reads its query by hand (`parseTransactionQuery`), so the typed client has no
  // `query` input for it; the client still sends one.
  const res = await api.api.ledger.transactions.$get({ query: params } as never);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as TransactionList;
}

/** An account the signed-in person can see, for the Account filter and the Account column. */
export interface AccountSummary {
  readonly id: string;
  readonly name: string;
}

/** Every account the list can name, closed ones included (a closed account still has rows). */
export async function fetchAccounts(): Promise<AccountSummary[]> {
  // The route reads `includeClosed` by hand, so the typed client has no `query` input for it.
  const res = await api.api.accounts.$get({ query: { includeClosed: "true" } } as never);
  if (!res.ok) throw await apiError(res);
  return (await res.json()).accounts.map(({ id, name }) => ({ id, name }));
}

/** A category with its report group, for the Category filter and the category combobox. */
export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  readonly groupId: string;
  readonly groupName: string;
}

export async function fetchCategories(): Promise<CategorySummary[]> {
  const [categories, groups] = await Promise.all([
    api.api.classify.categories.$get(),
    api.api.classify["category-groups"].$get(),
  ]);
  if (!categories.ok) throw await apiError(categories);
  if (!groups.ok) throw await apiError(groups);
  const names = new Map((await groups.json()).categoryGroups.map((g) => [g.id, g.name]));
  return (await categories.json()).categories.map(({ id, name, groupId }) => ({
    id,
    name,
    groupId,
    groupName: names.get(groupId) ?? "",
  }));
}

/** A tag the signed-in person may put on a split. */
export async function fetchTags(): Promise<LedgerTag[]> {
  const res = await api.api.classify.tags.$get();
  if (!res.ok) throw await apiError(res);
  return (await res.json()).tags.map(({ id, name }) => ({ id, name }));
}

/** A JSON write (PATCH, PUT or DELETE) to one of our routes; throws `ApiError` on failure. */
async function sendJson<T>(method: "PATCH" | "PUT" | "DELETE", path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

const transactionPath = (id: string) => `/api/ledger/transactions/${encodeURIComponent(id)}`;

/** What a write answers: the whole transaction with the server's `remainingCents`. */
export async function updateNotes(id: string, notes: string | null): Promise<LedgerTransaction> {
  const { transaction } = await sendJson<{ transaction: LedgerTransaction }>(
    "PATCH",
    transactionPath(id),
    { notes },
  );
  return transaction;
}

/** One split as the editor sends it: an `id` updates that split, none adds a new one. */
export interface SplitDraft {
  readonly id?: string;
  readonly amountCents: number;
  readonly memo?: string | null;
}

/** Makes `splits` the whole split list; amounts are sent, never summed here. */
export async function setSplits(
  id: string,
  splits: readonly SplitDraft[],
): Promise<LedgerTransaction> {
  const { transaction } = await sendJson<{ transaction: LedgerTransaction }>(
    "PUT",
    `${transactionPath(id)}/splits`,
    { splits },
  );
  return transaction;
}

/** The outcome of one split-field write; `applied` is false when a higher-ranked source holds it. */
export interface SplitFieldResult {
  readonly applied: boolean;
  readonly changed: boolean;
  readonly reason?: string;
  readonly transaction: LedgerTransaction;
}

/** Sets a split's category (a category ID or null) or beneficiary (`shared` or a person ID). */
export async function setSplitField(
  transactionId: string,
  splitId: string,
  field: "category" | "beneficiary",
  value: string | null,
): Promise<SplitFieldResult> {
  return sendJson<SplitFieldResult>(
    "PATCH",
    `${transactionPath(transactionId)}/splits/${encodeURIComponent(splitId)}`,
    { field, value },
  );
}

/** Makes `tagIds` the whole tag set of a split. */
export async function setSplitTags(
  transactionId: string,
  splitId: string,
  tagIds: readonly string[],
): Promise<LedgerTransaction> {
  const { transaction } = await sendJson<{ transaction: LedgerTransaction }>(
    "PUT",
    `${transactionPath(transactionId)}/splits/${encodeURIComponent(splitId)}/tags`,
    { tagIds },
  );
  return transaction;
}

/** Hides the name from the partner until `until` (`YYYY-MM-DD`; the server defaults to 12 months). */
export async function hideName(id: string, until?: string): Promise<LedgerTransaction> {
  const { transaction } = await sendJson<{ transaction: LedgerTransaction }>(
    "PUT",
    `${transactionPath(id)}/name-hidden`,
    until === undefined ? {} : { until },
  );
  return transaction;
}

export async function unhideName(id: string): Promise<LedgerTransaction> {
  const { transaction } = await sendJson<{ transaction: LedgerTransaction }>(
    "DELETE",
    `${transactionPath(id)}/name-hidden`,
  );
  return transaction;
}
