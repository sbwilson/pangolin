import type { AccountType, AccountView, Me } from "../api.ts";

/** The types whose balance the server works out (a snapshot plus the transactions after it). */
export const CASH_TYPES: readonly AccountType[] = [
  "transaction",
  "savings",
  "offset",
  "credit_card",
  "home_loan",
];

/** Whether the server has a balance for this type; the rest show none. */
export const hasBalance = (type: AccountType): boolean => CASH_TYPES.includes(type);

/** The groups of the Accounts page, in order, and the types each holds. */
export const ACCOUNT_GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly types: readonly AccountType[];
}[] = [
  { id: "cash", label: "Cash", types: ["transaction", "offset"] },
  { id: "savings", label: "Savings", types: ["savings"] },
  { id: "cards", label: "Cards", types: ["credit_card"] },
  { id: "loans", label: "Loans", types: ["home_loan"] },
  { id: "investments", label: "Investments", types: ["brokerage", "super"] },
  { id: "other", label: "Other", types: ["vehicle", "other"] },
];

export const TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  transaction: "Transaction account",
  savings: "Savings account",
  offset: "Offset account",
  credit_card: "Credit card",
  home_loan: "Home loan",
  brokerage: "Brokerage",
  super: "Super",
  property: "Property",
  vehicle: "Vehicle",
  other: "Other",
};

/** The types a person can create here (a property has its own screen). */
export const CREATABLE_TYPES: readonly AccountType[] = ACCOUNT_GROUPS.flatMap((g) => g.types);

/** "Shared", or the name of the sole owner (the person's own or their partner's). */
export function ownerLabel(account: Pick<AccountView, "pool">, me: Me): string {
  if (account.pool === "shared") return "Shared";
  if (account.pool === me.personId) return me.displayName;
  if (me.partner !== null && account.pool === me.partner.personId) return me.partner.displayName;
  return "Another owner";
}

/** The lock shows for a private account to its owner only. */
export const showsLock = (account: Pick<AccountView, "isPrivate" | "owners">, me: Me): boolean =>
  account.isPrivate && account.owners.some((owner) => owner.personId === me.personId);
