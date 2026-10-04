// The seed's institutions and accounts: a joint household account of every cash type (one with
// unequal ownership) and one private account per person. Only the five cash types appear
// (transaction, savings, offset, credit_card, home_loan): their balance is a snapshot plus the
// transactions after it (AD-19).
import type { SeedModule } from "../module.ts";
import type { AccountCreatedEvent, InstitutionCreatedEvent } from "../world.ts";
import { ACCOUNT_KEYS, INSTITUTION_KEYS } from "./catalogue.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

export { ACCOUNT_KEYS, INSTITUTION_KEYS } from "./catalogue.ts";

const INSTITUTIONS: readonly InstitutionCreatedEvent[] = [
  {
    type: "institution.created",
    key: INSTITUTION_KEYS.harbour,
    name: "Harbour Bank",
    kind: "bank",
  },
  {
    type: "institution.created",
    key: INSTITUTION_KEYS.ridge,
    name: "Ridge Credit Union",
    kind: "bank",
  },
  {
    type: "institution.created",
    key: INSTITUTION_KEYS.lantern,
    name: "Lantern Bank",
    kind: "bank",
  },
];

export const institutionsAndAccounts: SeedModule = {
  name: "institutions-and-accounts",
  dependsOn: ["people-and-household"],
  generate() {
    const [a, b] = PERSON_KEYS;
    const account = (
      key: string,
      name: string,
      accountType: string,
      institution: string,
      owners: AccountCreatedEvent["owners"],
      options: { isPrivate?: boolean; isSavings?: boolean } = {},
    ): AccountCreatedEvent => ({
      type: "account.created",
      key,
      name,
      accountType,
      currency: "AUD",
      isPrivate: options.isPrivate ?? false,
      owners,
      institution,
      isSavings: options.isSavings ?? false,
    });
    const even = [
      { person: a, shareBp: 5000 },
      { person: b, shareBp: 5000 },
    ];
    const events = [
      ...INSTITUTIONS,
      account(
        ACCOUNT_KEYS.everyday,
        "Joint everyday",
        "transaction",
        INSTITUTION_KEYS.harbour,
        even,
      ),
      account(ACCOUNT_KEYS.offset, "Joint offset", "offset", INSTITUTION_KEYS.harbour, even),
      account(
        ACCOUNT_KEYS.homeLoan,
        "Joint home loan",
        "home_loan",
        INSTITUTION_KEYS.harbour,
        even,
      ),
      account(
        ACCOUNT_KEYS.card,
        "Joint credit card",
        "credit_card",
        INSTITUTION_KEYS.harbour,
        even,
      ),
      // Unequal ownership: 60% / 40%.
      account(
        ACCOUNT_KEYS.savings,
        "Joint savings",
        "savings",
        INSTITUTION_KEYS.ridge,
        [
          { person: a, shareBp: 6000 },
          { person: b, shareBp: 4000 },
        ],
        { isSavings: true },
      ),
      account(
        ACCOUNT_KEYS.privateA,
        "Person A private",
        "transaction",
        INSTITUTION_KEYS.ridge,
        [{ person: a, shareBp: 10000 }],
        { isPrivate: true },
      ),
      account(
        ACCOUNT_KEYS.privateB,
        "Person B private",
        "savings",
        INSTITUTION_KEYS.lantern,
        [{ person: b, shareBp: 10000 }],
        { isPrivate: true, isSavings: true },
      ),
    ];
    const accounts = events.filter((e): e is AccountCreatedEvent => e.type === "account.created");
    return {
      events,
      expectations: {
        institutionCount: INSTITUTIONS.length,
        accountKeys: accounts.map((x) => x.key),
        sharedAccountKeys: accounts.filter((x) => !x.isPrivate).map((x) => x.key),
        privateAccountKeys: { [a]: ACCOUNT_KEYS.privateA, [b]: ACCOUNT_KEYS.privateB },
        accountTypes: Object.fromEntries(accounts.map((x) => [x.key, x.accountType])),
        unequalAccount: ACCOUNT_KEYS.savings,
        unequalSharesBp: { [a]: 6000, [b]: 4000 },
      },
    };
  },
};
