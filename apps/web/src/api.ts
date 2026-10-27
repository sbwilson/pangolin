import type { AppType } from "@pangolin/server";
import { hc, type InferResponseType } from "hono/client";
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
export type SpendingReport = InferResponseType<(typeof api.api.reports)["spending"]["$get"], 200>;

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
export type MerchantRow = MerchantsReport["rows"][number];

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
export type NetWorthSubtotals = NetWorthReport["subtotals"];

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
  readonly updatedAt: string;
}

export async function fetchHouseholdSettings(): Promise<HouseholdSettingsData> {
  const res = await fetch("/api/system/household");
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as HouseholdSettingsData;
}

/** Changes the shared attribution (the one setting the screen edits); throws `ApiError`. */
export async function updateSharedAttribution(
  sharedAttribution: SharedAttribution,
): Promise<HouseholdSettingsData> {
  return await sendJson<HouseholdSettingsData>("PATCH", "/api/system/household", {
    sharedAttribution,
  });
}

/** The Needs review list: one card per open item the signed-in person may see, oldest first. */
type ReviewListResponse = InferResponseType<typeof api.api.review.$get, 200>;
export type ReviewCard = ReviewListResponse["items"][number];
export type ReviewDetail = ReviewCard["detail"];
export type ReviewTransaction = Extract<
  ReviewDetail,
  { type: "transaction" }
>["candidates"][number];
export type ReviewSuggestion = NonNullable<
  Extract<ReviewDetail, { type: "transaction" }>["suggestion"]
>;
export type ReviewSetAsideRow = Extract<ReviewDetail, { type: "batch" }>["rows"][number];

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
export type ReviewAction =
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
  | "dismiss-notice"
  | "revoke-links";

export interface BulkAcceptSuggestionsResult {
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
) {
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

export interface AccountWarning {
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
export interface NewAccount {
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

export interface LlmPurposeAssignmentRow {
  readonly purpose: LlmPurpose;
  readonly providerId: string;
  readonly updatedAt: string;
}

export interface LlmSettingsResult {
  readonly providers: readonly LlmProviderSafeView[];
  readonly assignments: readonly LlmPurposeAssignmentRow[];
}

export interface CreateLlmProviderInput {
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string | null | undefined;
  readonly cloudPdf?: boolean | undefined;
  readonly cloudRows?: boolean | undefined;
}

export interface UpdateLlmProviderInput {
  readonly name?: string | undefined;
  readonly kind?: LlmProviderKind | undefined;
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly apiKey?: string | null | undefined;
  readonly cloudPdf?: boolean | undefined;
  readonly cloudRows?: boolean | undefined;
}

export interface TestLlmProviderResult {
  readonly ok: boolean;
  readonly latencyMs?: number | undefined;
  readonly error?: string | undefined;
}

export interface LlmRequestPreviewItem {
  readonly index: number;
  readonly description: string;
  readonly amountCents: number;
  readonly postedOn: string;
  readonly isPrivate?: boolean | undefined;
}

export interface LlmRequestPreviewResult {
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

export async function deleteLlmProvider(
  id: string,
): Promise<{ success: boolean }> {
  return await sendJson<{ success: boolean }>(
    "DELETE",
    `/api/llm/providers/${encodeURIComponent(id)}`,
  );
}

export async function testLlmProvider(
  id: string,
): Promise<TestLlmProviderResult> {
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
