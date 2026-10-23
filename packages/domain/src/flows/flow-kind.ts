// AD-23: the one classifier that decides what a split counts as. Every aggregate uses it, either
// directly (in-memory) or through its SQL twin `flowKindSql` in `packages/db/src/privacy.ts`; the
// parity test in `packages/app/src/testing/flow-kind-parity.test.ts` holds the two together.

/** What a split counts as in cash flow, spending and every other aggregate. */
export type FlowKind = "income" | "expense" | "transfer" | "investing";

export const FLOW_KINDS = ["income", "expense", "transfer", "investing"] as const;

/** The account types a transfer counterpart can have (`account.type`). */
export type FlowAccountType =
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

/** The kind of a category group (`category_group.kind`). */
export type FlowGroupKind = "income" | "expense" | "transfer";

export interface FlowKindInput {
  /** The split's signed amount (positive is money in). */
  readonly amountCents: number;
  /**
   * The linked transfer's counterpart as the viewer sees it: `null` when the transaction is not
   * linked, or the other live row (or its account) is deleted; `"hidden"` when its account is one
   * the viewer cannot see (the partner's private account); else that account's type.
   */
  readonly counterpart: null | "hidden" | FlowAccountType;
  /** The kind of the split's category group, or `null` when the split has no category. */
  readonly groupKind: FlowGroupKind | null;
}

const CASH: ReadonlySet<string> = new Set(["transaction", "savings", "offset", "credit_card"]);
const INVESTING: ReadonlySet<string> = new Set(["brokerage", "super"]);

/**
 * The split's `flowKind` (AD-23), rules in order:
 * 1. a counterpart the viewer cannot see, or one of our cash, savings, offset or credit-card
 *    accounts → `transfer`;
 * 2. a home-loan counterpart → `expense` when the split is money out (a repayment), else
 *    `transfer` (a redraw adds nothing to money in or out);
 * 3. a brokerage or super counterpart → `investing`;
 * 4. a category in a group of kind `transfer` → `transfer`;
 * 5. `income` when the amount is positive, else `expense` (zero is `expense` and adds nothing).
 * A counterpart of any other type falls through to rules 4 and 5.
 */
export function flowKind(input: FlowKindInput): FlowKind {
  const { counterpart } = input;
  if (counterpart === "hidden") return "transfer";
  if (counterpart !== null) {
    if (CASH.has(counterpart)) return "transfer";
    if (counterpart === "home_loan") return input.amountCents < 0 ? "expense" : "transfer";
    if (INVESTING.has(counterpart)) return "investing";
  }
  if (input.groupKind === "transfer") return "transfer";
  return input.amountCents > 0 ? "income" : "expense";
}
