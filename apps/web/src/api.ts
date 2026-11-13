import type { AppType } from "@pangolin/server";
import { hc, type InferResponseType } from "hono/client";
import type { TransactionsSearch } from "./routes/search.ts";

export const api = hc<AppType>("/");

/**
 * The mapped health view, not the raw response: `status: "ok"` becomes `healthy: true` and the
 * `writable` flag is dropped, so it is not an `InferResponseType` derivation. Used only here.
 */
type Health =
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
type DeadJob = InferResponseType<(typeof api.api.system.jobs)["$get"], 200>["dead"][number];

export async function fetchDeadJobs(): Promise<DeadJob[]> {
  const res = await api.api.system.jobs.$get();
  if (!res.ok) throw new Error(`GET /api/system/jobs failed with ${res.status}`);
  const body = await res.json();
  return body.dead;
}

/** The last backup, its stale warning and the latest check and drill, as the page shows them. */
type BackupStatus = InferResponseType<(typeof api.api.system.backup)["$get"], 200>;

/** A weekly repository check or monthly restore drill result (story 1.14). */
export type BackupVerification = NonNullable<BackupStatus["check"]>;

export async function fetchBackupStatus(): Promise<BackupStatus> {
  const res = await api.api.system.backup.$get();
  if (!res.ok) throw new Error(`GET /api/system/backup failed with ${res.status}`);
  return await res.json();
}

/** Whether the current recovery bundle is confirmed stored safely (story 1.17). */
type RecoveryBundleStatus = InferResponseType<
  (typeof api.api.system)["recovery-bundle"]["$get"],
  200
>;

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

type MeResponse = InferResponseType<(typeof api.api.identity.me)["$get"], 200>;

/**
 * The signed-in person. Derived from the route response; the `Id` brands erase to the plain
 * strings the UI passes around, so `personId` (and `partner.personId`) stay `string`.
 */
export type Me = Omit<MeResponse, "personId" | "partner"> & {
  readonly personId: string;
  readonly partner: { readonly personId: string; readonly displayName: string } | null;
};

/** The signed-in person, or null when nobody is signed in. */
export async function fetchMe(): Promise<Me | null> {
  const res = await api.api.identity.me.$get();
  // The session middleware answers 401 before the route, so the RPC type does not know it.
  if ((res.status as number) === 401) return null;
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as Me;
}

interface SignUpForm {
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
type RecoveryCodes = InferResponseType<(typeof api.api.identity)["recovery-codes"]["$post"], 201>;

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
interface Redeemed {
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

/** Issues a one-time re-enrolment link for the partner. Needs a sign-in in the last 5 minutes. */
export async function resetPartner(personId: string): Promise<{ url: string; expiresAt: string }> {
  return postJson("/api/identity/re-enrolment-links", { personId });
}

/**
 * Money in, money out and kept over an inclusive range, summed on the server (AD-11), with the
 * savings rate `savingsRatePermille` (kept ÷ money in, in thousandths; null when money in ≤ 0).
 */
export type CashFlowTotals = InferResponseType<(typeof api.api.reports)["cash-flow"]["$get"], 200>;

/**
 * The cash-flow figures for `from`..`to` (inclusive `YYYY-MM-DD`); throws `ApiError`. `share:
 * "mine"` replaces the shared-beneficiary part of money out with the viewer's share (the server
 * does it); leave it out for everything the viewer can see.
 */
export async function fetchCashFlow(range: {
  readonly from: string;
  readonly to: string;
  readonly share?: "mine";
}): Promise<CashFlowTotals> {
  const res = await api.api.reports["cash-flow"].$get({
    query: {
      from: range.from,
      to: range.to,
      ...(range.share === undefined ? {} : { share: range.share }),
    },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/**
 * The shared total over a range and the viewer's share of it, with the whole percent the server
 * worked out (`sharePercent` is null when nothing is shared).
 */
export type SharedShare = InferResponseType<
  (typeof api.api.reports)["shared-apportionment"]["$get"],
  200
>;

/** The shared total and the viewer's share for `from`..`to`; throws `ApiError`. */
export async function fetchSharedShare(range: {
  readonly from: string;
  readonly to: string;
}): Promise<SharedShare> {
  const res = await api.api.reports["shared-apportionment"].$get({
    query: { from: range.from, to: range.to },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** P&L over an inclusive range as the viewer sees it, by group or category. */
export type ProfitAndLossReport = InferResponseType<(typeof api.api.reports)["pnl"]["$get"], 200>;
export type ReportRow = ProfitAndLossReport["income"]["rows"][number];

export async function fetchProfitAndLoss(range: {
  readonly from: string;
  readonly to: string;
  readonly by: "group" | "category";
}): Promise<ProfitAndLossReport> {
  const res = await api.api.reports.pnl.$get({
    query: { from: range.from, to: range.to, by: range.by },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** Spending over an inclusive range by group or category (the P&L expense section alone). */
type SpendingReport = InferResponseType<(typeof api.api.reports)["spending"]["$get"], 200>;

export async function fetchSpending(range: {
  readonly from: string;
  readonly to: string;
  readonly by: "group" | "category";
}): Promise<SpendingReport> {
  const res = await api.api.reports.spending.$get({
    query: { from: range.from, to: range.to, by: range.by },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** Merchants over an inclusive range for one flow kind (income or expense). */
export type MerchantsReport = InferResponseType<(typeof api.api.reports)["merchants"]["$get"], 200>;

export async function fetchMerchants(range: {
  readonly from: string;
  readonly to: string;
  readonly flow: "income" | "expense";
}): Promise<MerchantsReport> {
  const res = await api.api.reports.merchants.$get({
    query: { from: range.from, to: range.to, flow: range.flow },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** The "Biggest little leaks" report over an inclusive range. */
export type LeaksReport = InferResponseType<(typeof api.api.reports)["leaks"]["$get"], 200>;
export type LeakMerchant = LeaksReport["rows"][number];

export async function fetchLeaks(range: {
  readonly from: string;
  readonly to: string;
}): Promise<LeaksReport> {
  const res = await api.api.reports.leaks.$get({
    query: { from: range.from, to: range.to },
  });
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** The net worth report as of a given date (defaults to today). */
export type NetWorthReport = InferResponseType<(typeof api.api.reports)["net-worth"]["$get"], 200>;
export type NetWorthAccount = NetWorthReport["accounts"][number];
export type NetWorthTrendPoint = NetWorthReport["trend"][number];

export async function fetchNetWorth(options?: { readonly asOf?: string }): Promise<NetWorthReport> {
  const query = options?.asOf ? { asOf: options.asOf } : {};
  const res = await api.api.reports["net-worth"].$get({ query } as never);
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** How shared spending is split between the partners. */
export type SharedAttribution = "contribution" | "even";

/** The household-wide settings row (`fyStart` is read-only). */
export interface HouseholdSettingsData {
  readonly baseCurrency: string;
  readonly fyStart: string;
  readonly timezone: string;
  readonly sharedAttribution: SharedAttribution;
  readonly householdPayAnchorPersonId?: string | null;
  readonly updatedAt: string;
}

export async function fetchHouseholdSettings(): Promise<HouseholdSettingsData> {
  const res = await fetch("/api/system/household");
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as HouseholdSettingsData;
}

/** Updates household settings (shared attribution and/or household pay anchor); throws `ApiError`. */
export async function updateHouseholdSettings(input: {
  readonly sharedAttribution?: SharedAttribution;
  readonly householdPayAnchorPersonId?: string | null;
}): Promise<HouseholdSettingsData> {
  return await sendJson<HouseholdSettingsData>("PATCH", "/api/system/household", input);
}

/** Changes the shared attribution (the one setting the screen edits); throws `ApiError`. */
export async function updateSharedAttribution(
  sharedAttribution: SharedAttribution,
): Promise<HouseholdSettingsData> {
  return await updateHouseholdSettings({ sharedAttribution });
}

/** The Needs review list: one card per open item the signed-in person may see, oldest first. */
type ReviewListResponse = InferResponseType<typeof api.api.review.$get, 200>;
export type ReviewCard = ReviewListResponse["items"][number];
export type ReviewDetail = ReviewCard["detail"];
export type ReviewTransaction = Extract<
  ReviewDetail,
  { type: "transaction" }
>["candidates"][number];
export type ReviewSetAsideRow = Extract<ReviewDetail, { type: "batch" }>["rows"][number];
export type ReviewPdfRow = Extract<ReviewDetail, { type: "pdf_batch" }>["rows"][number];

/** The nav badge and partner chip: numbers only. */
export type ReviewCounts = InferResponseType<typeof api.api.review.count.$get, 200>;

export async function fetchReviewItems(): Promise<ReviewCard[]> {
  const res = await api.api.review.$get();
  if (!res.ok) throw await apiError(res);
  return (await res.json()).items;
}

export async function fetchReviewCounts(): Promise<ReviewCounts> {
  const res = await api.api.review.count.$get();
  if (!res.ok) throw await apiError(res);
  return await res.json();
}

/** The actions on a review item, one route each (`POST /api/review/:id/<action>`). */
type ReviewAction =
  | "accept-suggestion"
  | "dismiss-suggestion"
  | "accept-rule"
  | "dismiss-rule"
  | "keep-duplicate"
  | "remove-duplicate"
  | "dismiss-transfer"
  | "link-transfer"
  | "accept-handoff"
  | "dismiss-handoff"
  | "fix-row"
  | "discard-row"
  | "interpret-rows"
  | "confirm-proposal"
  | "correct-pdf-row"
  | "recheck-pdf"
  | "dismiss-notice"
  | "dismiss-budget"
  | "dismiss-bill-alert"
  | "adjust-budget-limit"
  | "dismiss-savings"
  | "take-from-buffer"
  | "link-to-goal"
  | "adjust-buffer-mismatch"
  | "revoke-links";

/** The outcome of a Re-check: `ok` false carries the exact remaining error (HTTP 200). */
interface PdfRecheckResult {
  readonly batchId: string;
  readonly ok: boolean;
  readonly error: string | null;
}

/**
 * Re-runs the deterministic PDF checks (no LLM). A passing batch turns ready and its card
 * disappears on the next fetch; a failing one reports its exact error and stays open.
 */
export async function recheckPdfReviewItem(id: string): Promise<PdfRecheckResult> {
  return await postJson<PdfRecheckResult>(`/api/review/${encodeURIComponent(id)}/recheck-pdf`, {});
}

interface BulkAcceptSuggestionsResult {
  readonly acceptedCount: number;
}

/** Bulk accepts AI categorisation suggestions for the given review item IDs. */
export async function bulkAcceptSuggestions(input: {
  readonly ids: readonly string[];
}): Promise<BulkAcceptSuggestionsResult> {
  return await sendJson<BulkAcceptSuggestionsResult>(
    "POST",
    "/api/review/bulk-accept-suggestions",
    input,
  );
}

/** Runs one action on review item `id`; throws `ApiError` (an item already resolved is `NotFound`). */
export async function reviewAction(
  id: string,
  action: ReviewAction,
  body?: Readonly<Record<string, unknown>>,
): Promise<void> {
  const res = await fetch(`/api/review/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await apiError(res);
}

/** Dismisses an over-budget review item. */
export async function dismissBudgetReviewItem(id: string): Promise<void> {
  await reviewAction(id, "dismiss-budget");
}

/** Dismisses a bill alert review item ("Got it"). */
export async function dismissBillAlert(id: string): Promise<void> {
  await reviewAction(id, "dismiss-bill-alert");
}

/** Adjusts a budget limit from an over-budget review item and resolves it. */
export async function adjustBudgetLimitFromReview(id: string, limitCents: number): Promise<void> {
  await reviewAction(id, "adjust-budget-limit", { limitCents });
}

/** Dismisses a savings review item (e.g. "Not an expense" or "Got it"). */
export async function dismissSavingsReviewItem(id: string, resolution?: string): Promise<void> {
  await reviewAction(id, "dismiss-savings", resolution ? { resolution } : undefined);
}

/** Resolves a large withdrawal review item by taking it from the pool buffer. */
export async function takeFromBufferReviewItem(id: string): Promise<void> {
  await reviewAction(id, "take-from-buffer");
}

/** Links a large withdrawal review item to a goal. */
export async function linkWithdrawalToGoal(
  id: string,
  goalId: string,
): Promise<{ drawdown: DrawdownData; adjustments: readonly unknown[] }> {
  return await sendJson<{ drawdown: DrawdownData; adjustments: readonly unknown[] }>(
    "POST",
    `/api/review/${encodeURIComponent(id)}/link-to-goal`,
    { goalId },
  );
}

/** Adjusts buffer for mismatch from review card. */
export async function adjustBufferForMismatch(id: string): Promise<void> {
  await reviewAction(id, "adjust-buffer-mismatch");
}

/** A tag as a split carries it. */
export interface LedgerTag {
  readonly id: string;
  readonly name: string;
}

/** Who last set a classified split field; `user` outranks the rest. */
type SplitSource = "user" | "rule" | "payee" | "activity" | "llm";

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
  /** The payee on the row; null while the name is hidden or it is another person's scoped payee. */
  readonly payeeId: string | null;
  /** The payee's name; null under the same conditions as `payeeId`. */
  readonly payeeName: string | null;
  /** The payee's logo attachment; null under the same conditions as `payeeId`. */
  readonly logoAttachmentId: string | null;
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
interface TransactionPageInfo {
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
  // `query` input for it; the client still sends one. `group` is a web drill-down filter.
  const { group: _g, ...serverParams } = params;
  const res = await api.api.ledger.transactions.$get({ query: serverParams } as never);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as TransactionList;
}

/** Exports transactions matching `params` to RFC 4180 CSV; needs recent sign-in (5 minutes). */
export async function exportTransactions(params: TransactionsSearch = {}): Promise<string> {
  const { group: _g, ...serverParams } = params;
  const res = await api.api.ledger.export.$get({ query: serverParams } as never);
  if (!res.ok) throw await apiError(res);
  return await res.text();
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
  readonly isFixedCost?: boolean;
}

export async function fetchCategories(): Promise<CategorySummary[]> {
  const [categories, groups] = await Promise.all([
    api.api.classify.categories.$get(),
    api.api.classify["category-groups"].$get(),
  ]);
  if (!categories.ok) throw await apiError(categories);
  if (!groups.ok) throw await apiError(groups);
  const names = new Map((await groups.json()).categoryGroups.map((g) => [g.id, g.name]));
  return (await categories.json()).categories.map(({ id, name, groupId, isFixedCost }) => ({
    id,
    name,
    groupId,
    groupName: names.get(groupId) ?? "",
    ...(isFixedCost !== undefined ? { isFixedCost } : {}),
  }));
}

export interface CategoryGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: "income" | "expense";
}

export async function fetchCategoryGroups(): Promise<CategoryGroupSummary[]> {
  const res = await api.api.classify["category-groups"].$get();
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return data.categoryGroups.map((g: { id: string; name: string; kind?: string }) => ({
    id: g.id,
    name: g.name,
    kind: (g.kind as "income" | "expense") ?? "expense",
  }));
}

/** A tag the signed-in person may put on a split. */
export async function fetchTags(): Promise<LedgerTag[]> {
  const res = await api.api.classify.tags.$get();
  if (!res.ok) throw await apiError(res);
  return (await res.json()).tags.map(({ id, name }) => ({ id, name }));
}

/** A JSON write (POST, PATCH, PUT or DELETE) to one of our routes; throws `ApiError` on failure. */
async function sendJson<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await apiError(res);
  if (res.status === 204) return undefined as T;
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
interface SplitDraft {
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
interface SplitFieldResult {
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

/** The kinds of account the server knows (`account.type`). */
export type AccountType =
  | "transaction"
  | "savings"
  | "offset"
  | "credit_card"
  | "home_loan"
  | "brokerage"
  | "super"
  | "property"
  | "vehicle"
  | "other";

interface AccountWarning {
  readonly kind: "closing-balance";
  readonly balanceCents: number;
}

/** How fresh an account's imported data is and where it came from. */
export interface LastImport {
  readonly through: string;
  readonly source: string;
  /** UTC ISO-8601 instant the import ran. */
  readonly importedAt: string;
}

/** An account as the accounts API returns it: the row, its owners and shares, and its pool. */
export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly isPrivate: boolean;
  readonly institutionId: string | null;
  readonly openedOn: string | null;
  readonly closedOn: string | null;
  readonly isSavings: boolean;
  /** Owners and their shares in basis points (5000 is 50%). */
  readonly owners: readonly { readonly personId: string; readonly shareBp: number }[];
  /** `shared`, or the sole owner's person ID. */
  readonly pool: string;
  /**
   * The newest `postedOn` (`through`) among the live transactions of the account's non-undone
   * imports, with the newest such import's source and time; null when it has none.
   */
  readonly lastImport: LastImport | null;
  /** Present when a closed cash account closed with a non-zero balance. */
  readonly warning?: AccountWarning;
}

/** A bank, broker or super fund. */
export interface InstitutionSummary {
  readonly id: string;
  readonly name: string;
}

/** The accounts the signed-in person may see (their own private ones and every public one). */
export function listAccounts(): Promise<AccountView[]>;
export function listAccounts(options: { includeClosed?: boolean }): Promise<AccountView[]>;
export function listAccounts(context: unknown): Promise<AccountView[]>;
export async function listAccounts(options?: unknown): Promise<AccountView[]> {
  const includeClosed =
    typeof options === "object" && options !== null && "includeClosed" in options
      ? Boolean((options as { includeClosed?: boolean }).includeClosed)
      : false;
  const query = includeClosed ? { includeClosed: "true" } : {};
  const res = await api.api.accounts.$get({ query } as never);
  if (!res.ok) throw await apiError(res);
  return (await res.json()).accounts as unknown as AccountView[];
}

/** Reopens an archived closed account by clearing `closedOn`. */
export async function reopenAccount(id: string): Promise<AccountView> {
  const { account } = await sendJson<{ account: AccountView }>(
    "PATCH",
    `/api/accounts/${encodeURIComponent(id)}`,
    { closedOn: null },
  );
  return account;
}

/**
 * Leaves the household, permanently deleting personal private data and revoking credentials.
 * Guarded by re-authentication within 5 minutes and explicit confirmation.
 */
export async function leaveHousehold(
  optionsOrConfirm?: { confirm?: boolean } | boolean,
): Promise<{ left: boolean }> {
  const confirm =
    typeof optionsOrConfirm === "boolean" ? optionsOrConfirm : (optionsOrConfirm?.confirm ?? true);
  return await sendJson<{ left: boolean }>("POST", "/api/accounts/leave-household", { confirm });
}

/** One account by ID; another person's private account is a 404 `NotFound`. */
export async function fetchAccount(id: string): Promise<AccountView> {
  const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { account: AccountView }).account;
}

export async function fetchInstitutions(): Promise<InstitutionSummary[]> {
  const res = await api.api.accounts.institutions.$get();
  if (!res.ok) throw await apiError(res);
  return (await res.json()).institutions.map(({ id, name }) => ({ id, name }));
}

/** What the create form sends: the server mints the ID and checks every rule. */
interface NewAccount {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly isPrivate: boolean;
  readonly owners: readonly { readonly personId: string; readonly shareBp: number }[];
  readonly institutionId?: string | null;
  readonly isSavings?: boolean;
}

export async function createAccount(input: NewAccount): Promise<AccountView> {
  const { account } = await sendJson<{ account: AccountView }>("POST", "/api/accounts", input);
  return account;
}

/** Changes the details and owners of an account; an omitted field stays as it is. */
export async function updateAccount(
  id: string,
  changes: {
    readonly name?: string;
    readonly institutionId?: string | null;
    readonly isSavings?: boolean;
    readonly owners?: readonly { readonly personId: string; readonly shareBp: number }[];
  },
): Promise<AccountView> {
  const { account } = await sendJson<{ account: AccountView }>(
    "PATCH",
    `/api/accounts/${encodeURIComponent(id)}`,
    changes,
  );
  return account;
}

/** Makes an account private or public; a refusal is an `ApiError` carrying the server's message. */
export async function setAccountPrivacy(id: string, isPrivate: boolean): Promise<AccountView> {
  const { account } = await sendJson<{ account: AccountView }>(
    "POST",
    `/api/accounts/${encodeURIComponent(id)}/privacy`,
    { isPrivate },
  );
  return account;
}

/** The server's balance of a cash account in cents (signed: loans and cards are negative). */
export async function fetchAccountBalance(id: string): Promise<number> {
  const res = await fetch(`/api/accounts/${encodeURIComponent(id)}/balance`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { balanceCents: number }).balanceCents;
}

export const THEMES = [
  "clay-linen",
  "harbour-morning",
  "fern-gully",
  "galah-party",
  "gelato-bar",
  "black-opal",
] as const;

export type ThemeName = (typeof THEMES)[number];

export const MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof MODES)[number];

export interface Preferences {
  readonly theme: ThemeName;
  readonly mode: ThemeMode;
}

export async function fetchPreferences(): Promise<Preferences> {
  const res = await fetch("/api/identity/preferences");
  if (res.status === 401) {
    return { theme: "clay-linen", mode: "system" };
  }
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as Preferences;
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  return await sendJson<Preferences>("PUT", "/api/identity/preferences", patch);
}

/** The statement formats the import route reads (the popover offers all but generic CSV). */
export type ImportFormat =
  | "commbank_ofx"
  | "commbank_csv"
  | "commbank_qif"
  | "qif"
  | "ubank_csv"
  | "up_csv"
  | "fy2025_multibank_csv";

/** What an import reports: counts only, for the account the viewer picked. */
export interface ImportResult {
  readonly batchId: string;
  readonly status: string;
  readonly rowCount: number;
  readonly newCount: number;
  readonly dupCount: number;
  readonly setAsideCount: number;
  /** Review items the batch raised that are still open (items, not transactions). */
  readonly needReviewCount: number;
}

/**
 * Imports statement text into one of the viewer's accounts. Safe to repeat: the same file changes
 * nothing. Throws `ApiError` (`Validation` carries the parser's reason, `NotFound` a hidden account).
 */
export async function importFile(input: {
  readonly accountId: string;
  readonly format: ImportFormat;
  readonly content: string;
}): Promise<ImportResult> {
  return await postJson<ImportResult>("/api/import", input);
}

/**
 * What a PDF upload reports: a batch that passed the deterministic checks is `ready` with its
 * rows staged — never committed — and its file kept encrypted (AD-21).
 */
export interface PdfImportResult {
  readonly batchId: string;
  readonly status: string;
  readonly rowCount: number;
  readonly newCount: number;
  readonly dupCount: number;
  readonly reconcileStatus: string;
  readonly reconcileGapCents: number;
  readonly openingBalanceCents?: number | null | undefined;
  readonly closingBalanceCents?: number | null | undefined;
}

/**
 * Uploads a statement PDF (base64) for LLM extraction plus deterministic verification. A passing
 * batch ends `ready` with rows staged; a failing one throws `ApiError` carrying the exact gap
 * after the batch was staged and its review item raised.
 */
export async function importPdfFile(input: {
  readonly accountId: string;
  readonly content: string;
}): Promise<PdfImportResult> {
  return await postJson<PdfImportResult>("/api/import/pdf", input);
}

/** Hands statement text to the partner, who picks the account. The reply names no account or batch. */
export async function handOffFile(input: {
  readonly recipientId: string;
  readonly filename: string;
  readonly format: ImportFormat;
  readonly content: string;
}): Promise<void> {
  await postJson<{ handedOff: true }>("/api/handoffs", input);
}

// -----------------------------------------------------------------------------
// LLM Providers Settings & Live Preview
// -----------------------------------------------------------------------------

export type LlmProviderKind = "openai" | "anthropic";
export type LlmPurpose = "categorise" | "pdf_extract" | "row_interpret";

export interface LlmProviderSafeView {
  readonly id: string;
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyLast4: string | null;
  readonly isLocal: boolean;
  readonly cloudPdf: boolean;
  readonly cloudRows: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface LlmPurposeAssignmentRow {
  readonly purpose: LlmPurpose;
  readonly providerId: string;
  readonly updatedAt: string;
}

interface LlmSettingsResult {
  readonly providers: readonly LlmProviderSafeView[];
  readonly assignments: readonly LlmPurposeAssignmentRow[];
}

interface CreateLlmProviderInput {
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string | null | undefined;
  readonly cloudPdf?: boolean | undefined;
  readonly cloudRows?: boolean | undefined;
}

interface UpdateLlmProviderInput {
  readonly name?: string | undefined;
  readonly kind?: LlmProviderKind | undefined;
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly apiKey?: string | null | undefined;
  readonly cloudPdf?: boolean | undefined;
  readonly cloudRows?: boolean | undefined;
}

interface TestLlmProviderResult {
  readonly ok: boolean;
  readonly latencyMs?: number | undefined;
  readonly error?: string | undefined;
}

interface LlmRequestPreviewItem {
  readonly index: number;
  readonly description: string;
  readonly amountCents: number;
  readonly postedOn: string;
  readonly isPrivate?: boolean | undefined;
}

interface LlmRequestPreviewResult {
  readonly provider: LlmProviderSafeView | null;
  readonly isLocal: boolean;
  readonly model?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly prompt: string;
  readonly schemaName: string;
  readonly schemaDescription?: string | undefined;
  readonly sampleItems: readonly LlmRequestPreviewItem[];
}

export async function fetchLlmSettings(): Promise<LlmSettingsResult> {
  const res = await fetch("/api/llm/settings");
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as LlmSettingsResult;
}

export async function createLlmProvider(
  input: CreateLlmProviderInput,
): Promise<LlmProviderSafeView> {
  return await sendJson<LlmProviderSafeView>("POST", "/api/llm/providers", input);
}

export async function updateLlmProvider(
  id: string,
  input: UpdateLlmProviderInput,
): Promise<LlmProviderSafeView> {
  return await sendJson<LlmProviderSafeView>(
    "PUT",
    `/api/llm/providers/${encodeURIComponent(id)}`,
    input,
  );
}

export async function deleteLlmProvider(id: string): Promise<{ success: boolean }> {
  return await sendJson<{ success: boolean }>(
    "DELETE",
    `/api/llm/providers/${encodeURIComponent(id)}`,
  );
}

export async function testLlmProvider(id: string): Promise<TestLlmProviderResult> {
  return await sendJson<TestLlmProviderResult>(
    "POST",
    `/api/llm/providers/${encodeURIComponent(id)}/test`,
  );
}

export async function assignLlmPurpose(
  purpose: LlmPurpose,
  providerId: string | null,
): Promise<{ purpose: LlmPurpose; providerId: string | null }> {
  return await sendJson<{ purpose: LlmPurpose; providerId: string | null }>(
    "PUT",
    `/api/llm/purposes/${encodeURIComponent(purpose)}`,
    { providerId },
  );
}

export async function fetchLlmRequestPreview(input?: {
  readonly purpose?: LlmPurpose | undefined;
  readonly providerId?: string | undefined;
}): Promise<LlmRequestPreviewResult> {
  return await sendJson<LlmRequestPreviewResult>("POST", "/api/llm/preview", input ?? {});
}

// -----------------------------------------------------------------------------
// Planning & Pay Anchors
// -----------------------------------------------------------------------------

export interface PayAnchorData {
  readonly id: string;
  readonly personId: string;
  readonly accountId: string;
  readonly cadence: "fortnightly" | "monthly";
  readonly dayOfMonth: number | null;
  readonly anchorDate: string | null;
  readonly alignment: "calendar" | "deposit";
  readonly expectedNetCents: number | null;
  readonly expectedGrossCents: number | null;
}

export async function fetchPayAnchors(): Promise<PayAnchorData[]> {
  const res = await fetch("/api/planning/pay-anchors");
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { payAnchors: PayAnchorData[] };
  return data.payAnchors;
}

export async function fetchPayAnchor(personId?: string): Promise<PayAnchorData | null> {
  const url = personId
    ? `/api/planning/pay-anchors?personId=${encodeURIComponent(personId)}`
    : "/api/planning/pay-anchors";
  const res = await fetch(url);
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { payAnchors: PayAnchorData[] };
  return data.payAnchors[0] ?? null;
}

export async function upsertPayAnchor(input: {
  readonly accountId: string;
  readonly cadence: "fortnightly" | "monthly";
  readonly dayOfMonth?: number | null;
  readonly anchorDate?: string | null;
  readonly alignment?: "calendar" | "deposit";
  readonly expectedNetCents?: number | null;
  readonly expectedGrossCents?: number | null;
  readonly personId?: string;
}): Promise<PayAnchorData> {
  return await sendJson<PayAnchorData>("PUT", "/api/planning/pay-anchors", input);
}

// -----------------------------------------------------------------------------
// Budgets
// -----------------------------------------------------------------------------

export interface BudgetData {
  readonly id: string;
  readonly personId: string | null;
  readonly categoryId: string | null;
  readonly categoryGroupId: string | null;
  /** Forecast funding account; null charges the pay-cycle scope's deposit account. */
  readonly fundingAccountId: string | null;
  readonly cadence: "fortnight" | "month";
  readonly limitCents: number;
  readonly rollover: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BudgetSummaryData {
  readonly budget: BudgetData;
  readonly period: {
    readonly start: string;
    readonly end: string;
  };
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly paceCents: number;
  readonly projectedCents: number;
  readonly rolloverCents: number;
  readonly effectiveLimitCents: number;
  readonly status: "on-track" | "heading-over" | "over-budget";
}

export interface CreateBudgetInput {
  readonly personId?: string | null;
  readonly categoryId?: string | null;
  readonly categoryGroupId?: string | null;
  readonly fundingAccountId?: string | null;
  readonly cadence: "fortnight" | "month";
  readonly limitCents: number;
  readonly rollover?: boolean;
}

export interface UpdateBudgetInput {
  readonly categoryId?: string | null;
  readonly categoryGroupId?: string | null;
  readonly fundingAccountId?: string | null;
  readonly cadence?: "fortnight" | "month";
  readonly limitCents?: number;
  readonly rollover?: boolean;
}

export async function fetchBudgets(): Promise<BudgetData[]> {
  const res = await fetch("/api/planning/budgets");
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { budgets: BudgetData[] };
  return data.budgets;
}

export async function fetchBudgetSummaries(): Promise<BudgetSummaryData[]> {
  const res = await fetch("/api/planning/budgets/summary");
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { summaries: BudgetSummaryData[] };
  return data.summaries;
}

export async function fetchBudget(id: string): Promise<BudgetData> {
  const res = await fetch(`/api/planning/budgets/${encodeURIComponent(id)}`);
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { budget: BudgetData };
  return data.budget;
}

export async function fetchBudgetSummary(id: string): Promise<BudgetSummaryData> {
  const res = await fetch(`/api/planning/budgets/${encodeURIComponent(id)}/summary`);
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { summary: BudgetSummaryData };
  return data.summary;
}

export async function createBudget(input: CreateBudgetInput): Promise<BudgetData> {
  const res = await sendJson<{ budget: BudgetData }>("POST", "/api/planning/budgets", input);
  return res.budget;
}

export async function updateBudget(id: string, input: UpdateBudgetInput): Promise<BudgetData> {
  const res = await sendJson<{ budget: BudgetData }>(
    "PATCH",
    `/api/planning/budgets/${encodeURIComponent(id)}`,
    input,
  );
  return res.budget;
}

export async function deleteBudget(id: string): Promise<void> {
  await sendJson("DELETE", `/api/planning/budgets/${encodeURIComponent(id)}`);
}

export async function fetchSuggestedLimit(params: {
  readonly id?: string;
  readonly personId?: string | null;
  readonly categoryId?: string | null;
  readonly categoryGroupId?: string | null;
  readonly cadence?: "fortnight" | "month";
}): Promise<number | null> {
  const query = new URLSearchParams();
  if (params.id) query.set("id", params.id);
  if (params.personId) query.set("personId", params.personId);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.categoryGroupId) query.set("categoryGroupId", params.categoryGroupId);
  if (params.cadence) query.set("cadence", params.cadence);

  const res = await fetch(`/api/planning/budgets/suggested-limit?${query.toString()}`);
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { suggestedLimitCents: number | null };
  return data.suggestedLimitCents;
}

export interface PayeeData {
  readonly id: string;
  readonly name: string;
  readonly websiteUrl?: string | null;
  readonly logoAttachmentId?: string | null;
  readonly defaultCategoryId?: string | null;
}

export async function fetchPayees(): Promise<PayeeData[]> {
  const res = await fetch("/api/classify/payees");
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { payees: PayeeData[] };
  return data.payees;
}

export interface RecurringSeriesData {
  readonly id: string;
  readonly accountId: string;
  readonly payeeId: string;
  readonly direction: "bill" | "income";
  readonly cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";
  readonly expectedCents: number;
  readonly toleranceBp: number;
  readonly nextDueOn: string;
  readonly status: "candidate" | "confirmed" | "rejected";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRecurringSeriesInput {
  readonly accountId: string;
  readonly payeeId: string;
  readonly direction?: "bill" | "income";
  readonly cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";
  readonly expectedCents: number;
  readonly toleranceBp?: number;
  readonly nextDueOn: string;
}

export async function fetchRecurringSeries(params?: {
  readonly accountId?: string;
  readonly status?: "candidate" | "confirmed" | "rejected";
}): Promise<RecurringSeriesData[]> {
  const query = new URLSearchParams();
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.status) query.set("status", params.status);

  const qs = query.toString();
  const url = qs ? `/api/planning/recurring-bills?${qs}` : "/api/planning/recurring-bills";
  const res = await fetch(url);
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { series: RecurringSeriesData[] };
  return data.series;
}

export async function detectRecurringBills(input?: {
  readonly accountId?: string;
  readonly toleranceBp?: number;
}): Promise<RecurringSeriesData[]> {
  const res = await sendJson<{ candidates: RecurringSeriesData[] }>(
    "POST",
    "/api/planning/recurring-bills/detect",
    input ?? {},
  );
  return res.candidates;
}

export async function confirmRecurringSeries(id: string): Promise<RecurringSeriesData> {
  const res = await sendJson<{ series: RecurringSeriesData }>(
    "POST",
    `/api/planning/recurring-bills/${encodeURIComponent(id)}/confirm`,
    {},
  );
  return res.series;
}

export async function rejectRecurringSeries(id: string): Promise<RecurringSeriesData> {
  const res = await sendJson<{ series: RecurringSeriesData }>(
    "POST",
    `/api/planning/recurring-bills/${encodeURIComponent(id)}/reject`,
    {},
  );
  return res.series;
}

export async function createRecurringSeries(
  input: CreateRecurringSeriesInput,
): Promise<RecurringSeriesData> {
  const res = await sendJson<{ series: RecurringSeriesData }>(
    "POST",
    "/api/planning/recurring-bills",
    input,
  );
  return res.series;
}

export async function deleteRecurringSeries(id: string): Promise<void> {
  await sendJson("DELETE", `/api/planning/recurring-bills/${encodeURIComponent(id)}`);
}

// -----------------------------------------------------------------------------
// Goals & Savings (Epic 7)
// -----------------------------------------------------------------------------

export interface SavingsPoolBalanceData {
  readonly pool: "shared" | string;
  readonly personId?: string | null;
  readonly totalCents: number;
  readonly accounts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly balanceCents: number;
    readonly isPrivate?: boolean;
    readonly institution?: string;
  }>;
}

export interface AllocationStageData {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string;
  readonly sort: number;
  readonly exitGoalId: string | null;
  readonly fallbackThresholdBp: number;
  readonly completedSharePolicy: "rescale" | "buffer";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoalRuleData {
  readonly id: string;
  readonly stageId: string;
  readonly goalId: string;
  readonly shareBp: number;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string | null;
  readonly source?: "rule" | "shortfall_override";
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface GoalProjectionData {
  readonly averagePerPeriodCents: number;
  readonly pace: "weekly" | "fortnightly" | "monthly";
  readonly periodsRemaining: number;
  readonly projectedCompletion: string;
}

export interface GoalData {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string;
  readonly targetCents: number;
  readonly targetDate: string | null;
  readonly priority: number;
  readonly kind: "flexible" | "protected";
  readonly isEmergencyFund: boolean;
  readonly completedAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly archivedAt?: string | null;
  readonly pool: "shared" | string;
  /** Sum of allocations so far; present on the goals list. */
  readonly currentBalance?: number;
  /** Completion projection from the goal's own history; null when not enough history. */
  readonly projection?: GoalProjectionData | null;
}

export interface GoalsSummaryData {
  readonly asOf: string;
  readonly pools: ReadonlyArray<SavingsPoolBalanceData>;
  readonly goals: ReadonlyArray<GoalData>;
  readonly stages: ReadonlyArray<AllocationStageData>;
  readonly activeStage: AllocationStageData | null;
  /** When the active stage's exit goal is projected to arrive; null without a projection. */
  readonly nextStageChangeDate?: string | null;
  readonly rules: ReadonlyArray<GoalRuleData>;
}

export async function fetchGoalsSummary(asOf?: string): Promise<GoalsSummaryData> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  const res = await fetch(`/api/planning/goals/summary${qs}`);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as GoalsSummaryData;
}

export async function fetchGoals(asOf?: string): Promise<{
  readonly asOf: string;
  readonly pools: ReadonlyArray<SavingsPoolBalanceData>;
  readonly goals: ReadonlyArray<GoalData>;
}> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  const res = await fetch(`/api/planning/goals${qs}`);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as {
    readonly asOf: string;
    readonly pools: ReadonlyArray<SavingsPoolBalanceData>;
    readonly goals: ReadonlyArray<GoalData>;
  };
}

export interface CreateGoalInput {
  readonly name: string;
  readonly targetCents: number;
  readonly targetDate?: string | null;
  readonly priority?: number;
  readonly kind?: "flexible" | "protected";
  readonly isEmergencyFund?: boolean;
  readonly pool?: string | null;
}

export interface UpdateGoalInput {
  readonly name?: string;
  readonly targetCents?: number;
  readonly targetDate?: string | null;
  readonly priority?: number;
  readonly kind?: "flexible" | "protected";
  readonly isEmergencyFund?: boolean;
}

export async function createGoal(input: CreateGoalInput): Promise<GoalData> {
  const res = await sendJson<{ goal: GoalData }>("POST", "/api/planning/goals", input);
  return res.goal;
}

export async function updateGoal(id: string, input: UpdateGoalInput): Promise<GoalData> {
  const res = await sendJson<{ goal: GoalData }>(
    "PATCH",
    `/api/planning/goals/${encodeURIComponent(id)}`,
    input,
  );
  return res.goal;
}

export async function deleteGoal(id: string): Promise<void> {
  await sendJson("DELETE", `/api/planning/goals/${encodeURIComponent(id)}`);
}

export async function fetchStages(): Promise<AllocationStageData[]> {
  const res = await fetch("/api/planning/stages");
  if (!res.ok) throw await apiError(res);
  const data = (await res.json()) as { stages: AllocationStageData[] };
  return data.stages;
}

export interface CreateStageInput {
  readonly name: string;
  readonly pool?: string | null;
  readonly sort?: number;
  readonly exitGoalId?: string | null;
  readonly fallbackThresholdBp?: number;
  readonly completedSharePolicy?: "rescale" | "buffer";
}

export interface UpdateStageInput {
  readonly name?: string;
  readonly sort?: number;
  readonly exitGoalId?: string | null;
  readonly fallbackThresholdBp?: number;
  readonly completedSharePolicy?: "rescale" | "buffer";
}

export async function createStage(input: CreateStageInput): Promise<AllocationStageData> {
  const res = await sendJson<{ stage: AllocationStageData }>("POST", "/api/planning/stages", input);
  return res.stage;
}

export async function updateStage(
  id: string,
  input: UpdateStageInput,
): Promise<AllocationStageData> {
  const res = await sendJson<{ stage: AllocationStageData }>(
    "PATCH",
    `/api/planning/stages/${encodeURIComponent(id)}`,
    input,
  );
  return res.stage;
}

export async function deleteStage(id: string): Promise<void> {
  await sendJson("DELETE", `/api/planning/stages/${encodeURIComponent(id)}`);
}

/** Per-goal share of the stage's savings, in basis points (the buffer is the remainder). */
export interface StageRuleInput {
  readonly goalId: string;
  readonly shareBp: number;
}

export async function setStageRules(
  stageId: string,
  rules: ReadonlyArray<StageRuleInput>,
): Promise<GoalRuleData[]> {
  const res = await sendJson<{ rules: GoalRuleData[] }>(
    "PUT",
    `/api/planning/stages/${encodeURIComponent(stageId)}/rules`,
    { rules },
  );
  return res.rules;
}

export type DrawdownReason = "large_purchase" | "shortfall";

export interface GoalProposalSplitData {
  readonly goalId: string;
  readonly goalName: string;
  readonly kind: "flexible" | "protected";
  readonly isEmergencyFund: boolean;
  readonly currentBalanceCents: number;
  readonly proposedAmountCents: number;
}

export interface ProposeDrawdownResultData {
  readonly pool: "shared" | string;
  readonly reason: DrawdownReason;
  readonly amountCents: number;
  readonly coveredCents: number;
  readonly remainingCents: number;
  readonly unlockedProtected: boolean;
  readonly warnings: readonly string[];
  readonly proposals: readonly GoalProposalSplitData[];
}

export interface ProposeDrawdownInput {
  readonly pool?: "shared" | string | null;
  readonly reason: DrawdownReason;
  readonly amountCents: number;
  readonly unlockProtected?: boolean;
}

export interface GoalAdjustmentData {
  readonly id: string;
  readonly goalId: string;
  readonly goalDrawdownId: string | null;
  readonly periodStart: string | null;
  readonly amountCents: number;
  readonly source: "drawdown" | "shortfall_fix" | "manual";
  readonly note: string | null;
  readonly createdAt: string;
}

export interface DrawdownData {
  readonly id: string;
  readonly personId: string | null;
  readonly pool: "shared" | string;
  readonly reason: DrawdownReason;
  readonly label: string | null;
  readonly amountCents: number;
  readonly transactionId: string | null;
  readonly undoneAt: string | null;
  readonly createdAt: string;
  readonly adjustments?: readonly GoalAdjustmentData[];
}

export interface ExecuteDrawdownInput {
  readonly pool?: "shared" | string | null;
  readonly reason: DrawdownReason;
  readonly label?: string | null;
  readonly amountCents: number;
  readonly transactionId?: string | null;
  readonly adjustments: ReadonlyArray<{
    readonly goalId: string;
    readonly amountCents: number;
  }>;
}

export interface ExecuteDrawdownResultData {
  readonly drawdown: DrawdownData;
  readonly adjustments: readonly GoalAdjustmentData[];
}

export async function fetchDrawdowns(pool: string = "shared"): Promise<DrawdownData[]> {
  const res = await fetch(`/api/planning/drawdowns?pool=${encodeURIComponent(pool)}`);
  if (!res.ok) throw new Error(`GET /api/planning/drawdowns failed with ${res.status}`);
  const data = (await res.json()) as { drawdowns: DrawdownData[] };
  return data.drawdowns;
}

export async function proposeDrawdown(
  input: ProposeDrawdownInput,
): Promise<ProposeDrawdownResultData> {
  return await sendJson<ProposeDrawdownResultData>(
    "POST",
    "/api/planning/drawdowns/propose",
    input,
  );
}

export async function executeDrawdown(
  input: ExecuteDrawdownInput,
): Promise<ExecuteDrawdownResultData> {
  return await sendJson<ExecuteDrawdownResultData>("POST", "/api/planning/drawdowns", input);
}

export async function undoDrawdown(drawdownId: string): Promise<{ drawdown: DrawdownData }> {
  return await sendJson<{ drawdown: DrawdownData }>(
    "POST",
    `/api/planning/drawdowns/${encodeURIComponent(drawdownId)}/undo`,
  );
}

export interface ApplyBufferDivertInput {
  readonly pool?: "shared" | string | null;
  readonly stageId?: string;
  readonly goalId?: string;
  readonly shareBp?: number;
  readonly shortfallCents?: number;
  readonly effectiveUntil?: string | null;
}

export interface BufferDivertResultData {
  readonly rule: GoalRuleData;
  readonly activeStageId: string;
  readonly shareBp: number;
  readonly effectiveUntil: string | null;
}

export async function applyBufferDivert(
  input: ApplyBufferDivertInput,
): Promise<BufferDivertResultData> {
  return await sendJson<BufferDivertResultData>("POST", "/api/planning/buffer-divert", input);
}

export async function clearBufferDivert(
  pool: "shared" | string = "shared",
): Promise<{ cleared: boolean }> {
  return await sendJson<{ cleared: boolean }>("POST", "/api/planning/buffer-divert/undo", { pool });
}

// ---------------------------------------------------------------------------
// Planning: cash-flow forecast (read-only projection, per account per day)

export interface ForecastPointData {
  readonly date: string;
  readonly balanceCents: number;
}

export interface ForecastAccountData {
  readonly accountId: string;
  readonly name: string;
  readonly lowBalanceThresholdCents: number;
  /** One point per day from `from` to `through`, after that day's movements. */
  readonly points: ReadonlyArray<ForecastPointData>;
}

export interface ForecastDipData {
  readonly accountId: string;
  readonly accountName: string;
  /** The projected balance on `date`, in signed cents. */
  readonly cents: number;
  /** `YYYY-MM-DD`; the first day below the threshold. */
  readonly date: string;
}

export interface ForecastData {
  readonly from: string;
  readonly through: string;
  readonly horizonMonths: number;
  /** True when no visible pay anchor carries an expected net amount. */
  readonly missingDepositSource: boolean;
  readonly accounts: ReadonlyArray<ForecastAccountData>;
  readonly warnings: ReadonlyArray<ForecastDipData>;
}

/** The projection for the visible transaction accounts over `horizon` (3, 6 or 12) months. */
export async function fetchForecast(horizon: 3 | 6 | 12): Promise<ForecastData> {
  const res = await fetch(`/api/planning/forecast?horizon=${horizon}`);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as ForecastData;
}

// ---------------------------------------------------------------------------
// Planning: net-worth forecast (low/mid/high return lines, monthly points)

export interface ForecastNetWorthPoint {
  /** 0-based month index from `asOf`. */
  readonly month: number;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly netWorthCents: number;
}

export interface ForecastNetWorthLine {
  /** The stored return assumption driving this line, in basis points. */
  readonly returnBps: number;
  /** The same return as a decimal-string percent (`500` bps is `"5"`). */
  readonly annualReturnPercent: string;
  /** `horizonYears × 12 + 1` monthly points; point 0 is today. */
  readonly points: ReadonlyArray<ForecastNetWorthPoint>;
}

export interface ForecastNetWorthReport {
  /** `YYYY-MM-DD`: today by the clock — the date of every line's point 0. */
  readonly asOf: string;
  readonly horizonYears: number;
  readonly lines: {
    readonly low: ForecastNetWorthLine;
    readonly mid: ForecastNetWorthLine;
    readonly high: ForecastNetWorthLine;
  };
}

/** The three monthly net-worth lines over `years` (1, 2, 5 or 10) from today. */
export async function fetchForecastNetWorth(
  years: 1 | 2 | 5 | 10,
): Promise<ForecastNetWorthReport> {
  const res = await fetch(`/api/planning/forecast-net-worth?horizon=${years}`);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as ForecastNetWorthReport;
}
