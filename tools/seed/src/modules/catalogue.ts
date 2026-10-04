// The merchants, bills, tags and opening balances the ledger modules share. Payees and tags are
// created by the `classification` module; `ledger-transactions` and `transfers-and-privacy` use
// them by key. All amounts are cents; draws are always whole multiples of 5 cents.
import type { CategoryRef } from "../world.ts";

/** Stable keys for the seed's institutions. */
export const INSTITUTION_KEYS = {
  harbour: "harbour-bank",
  ridge: "ridge-credit-union",
  lantern: "lantern-bank",
} as const;

/** Stable keys for the seed's accounts. */
export const ACCOUNT_KEYS = {
  everyday: "joint-everyday",
  offset: "joint-offset",
  homeLoan: "joint-home-loan",
  savings: "joint-savings",
  card: "joint-credit-card",
  privateA: "person-a-private",
  privateB: "person-b-private",
} as const;

/** Each account's balance on the day before the window opens (AD-12: loans and cards negative). */
export const OPENING_CENTS: Readonly<Record<string, number>> = {
  [ACCOUNT_KEYS.everyday]: 420_000,
  [ACCOUNT_KEYS.offset]: 1_850_000,
  [ACCOUNT_KEYS.homeLoan]: -52_000_000,
  [ACCOUNT_KEYS.savings]: 2_200_000,
  [ACCOUNT_KEYS.card]: -120_000,
  [ACCOUNT_KEYS.privateA]: 380_000,
  [ACCOUNT_KEYS.privateB]: 900_000,
};

export const cat = (group: string, name: string): CategoryRef => ({ group, name });

export interface TagSpec {
  readonly key: string;
  readonly name: string;
  /** The person whose private account it comes from; `null`: a shared tag. */
  readonly owner: "person-a" | "person-b" | null;
}

export const TAGS: readonly TagSpec[] = [
  { key: "holiday", name: "Holiday", owner: null },
  { key: "gift", name: "Gift", owner: null },
  { key: "reimbursable", name: "Reimbursable", owner: null },
  { key: "home-improvement", name: "Home improvement", owner: null },
  { key: "surprise", name: "Surprise", owner: "person-a" },
  { key: "side-project", name: "Side project", owner: "person-b" },
];

export interface PayeeSpec {
  readonly key: string;
  readonly name: string;
  readonly websiteUrl: string | null;
  readonly category: CategoryRef | null;
  /** The person whose private account it comes from; `null`: a shared payee. */
  readonly owner: "person-a" | "person-b" | null;
}

const payee = (
  key: string,
  name: string,
  category: CategoryRef | null,
  websiteUrl: string | null = null,
  owner: PayeeSpec["owner"] = null,
): PayeeSpec => ({ key, name, websiteUrl, category, owner });

export const PAYEES: readonly PayeeSpec[] = [
  payee("woolworths", "Woolworths", cat("Food", "Groceries"), "https://www.woolworths.com.au"),
  payee("coles", "Coles", cat("Food", "Groceries"), "https://www.coles.com.au"),
  payee("aldi", "Aldi", cat("Food", "Groceries"), "https://www.aldi.com.au"),
  payee("harris-farm", "Harris Farm Markets", cat("Food", "Groceries")),
  payee("local-cafe", "Corner Cafe", cat("Food", "Coffee")),
  payee("bistro", "The Wattle Bistro", cat("Food", "Dining out")),
  payee("thai-house", "Thai House", cat("Food", "Dining out")),
  payee("pizza-place", "Napoli Pizza", cat("Food", "Takeaway and delivery")),
  payee("bottle-shop", "Dan Murphy's", cat("Food", "Alcohol")),
  payee("shell", "Shell Coles Express", cat("Transport", "Fuel")),
  payee("ampol", "Ampol", cat("Transport", "Fuel")),
  payee("uber", "Uber", cat("Transport", "Rideshare")),
  payee("opal", "Opal Transport", cat("Transport", "Public transport")),
  payee("chemist", "Chemist Warehouse", cat("Health", "Pharmacy")),
  payee("kmart", "Kmart", cat("Personal", "Clothing")),
  payee("bunnings", "Bunnings Warehouse", cat("Housing", "Home maintenance")),
  payee("cinema", "Event Cinemas", cat("Lifestyle", "Entertainment")),
  payee("netflix", "Netflix", cat("Lifestyle", "Subscriptions")),
  payee("spotify", "Spotify", cat("Lifestyle", "Subscriptions")),
  payee("origin", "Origin Energy", cat("Utilities", "Electricity")),
  payee("agl", "AGL Gas", cat("Utilities", "Gas")),
  payee("sydney-water", "Sydney Water", cat("Utilities", "Water")),
  payee("aussie-bb", "Aussie Broadband", cat("Utilities", "Internet")),
  payee("telstra", "Telstra", cat("Utilities", "Mobile")),
  payee("council", "Inner West Council", cat("Housing", "Rates and strata")),
  payee("nrma-home", "NRMA Home Insurance", cat("Housing", "Home and contents insurance")),
  payee("nrma-car", "NRMA Car Insurance", cat("Transport", "Car insurance")),
  payee("medibank", "Medibank", cat("Health", "Private health insurance")),
  payee("harbour-loan", "Harbour Bank Home Loans", cat("Housing", "Mortgage repayments")),
  payee("brightwave", "Brightwave Pty Ltd", cat("Income", "Salary")),
  payee("northside", "Northside Health Service", cat("Income", "Salary")),
  payee("qantas", "Qantas", cat("Travel", "Flights")),
  payee("stay-co", "Stay Co Apartments", cat("Travel", "Accommodation")),
  payee("reef-tours", "Reef Tours", cat("Travel", "Activities")),
  payee("dymocks", "Dymocks", cat("Lifestyle", "Books and media"), null, "person-a"),
  payee("art-supplies", "Eckersley's Art", cat("Lifestyle", "Hobbies"), null, "person-a"),
  payee("design-client", "Fernwood Design Client", cat("Income", "Other income"), null, "person-a"),
  payee("fitness-hub", "Fitness Hub", cat("Health", "Fitness"), null, "person-b"),
  payee("vinyl-vault", "Vinyl Vault", cat("Lifestyle", "Books and media"), null, "person-b"),
];

export const payeeByKey = (key: string): PayeeSpec => {
  const found = PAYEES.find((p) => p.key === key);
  if (found === undefined) throw new Error(`Unknown payee "${key}"`);
  return found;
};
