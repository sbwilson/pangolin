// The seed's accounts: one shared account and one private account per person, each with a few
// transactions. The private ones prove the privacy path: a partner never sees the other's.

import type { SeedModule } from "../module.ts";
import type { Rng } from "../rng.ts";
import type { AccountCreatedEvent, TransactionCreatedEvent } from "../world.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

/** Stable keys for the seed's accounts. */
export const ACCOUNT_KEYS = {
  shared: "joint-everyday",
  privateA: "person-a-private",
  privateB: "person-b-private",
} as const;

const SHARED_DESCRIPTIONS = [
  "Joint: Woolworths groceries",
  "Joint: Energy bill",
  "Joint: Internet",
  "Joint: Council rates",
] as const;
const PRIVATE_DESCRIPTIONS = {
  [ACCOUNT_KEYS.privateA]: ["Person A private: Book shop", "Person A private: Gift"],
  [ACCOUNT_KEYS.privateB]: ["Person B private: Gym", "Person B private: Record shop"],
} as const;

function transactions(
  account: string,
  descriptions: readonly string[],
  rng: Rng,
  firstMonth: number,
): TransactionCreatedEvent[] {
  return descriptions.map((description, i) => ({
    type: "transaction.created",
    account,
    postedOn: `2026-${String(firstMonth + i).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
    amountCents: -rng.int(1_000, 25_000),
    description,
  }));
}

export const accounts: SeedModule = {
  name: "accounts",
  dependsOn: ["people-and-household"],
  generate(_world, rng) {
    const [a, b] = PERSON_KEYS;
    const account = (
      key: string,
      name: string,
      accountType: string,
      isPrivate: boolean,
      owners: AccountCreatedEvent["owners"],
    ): AccountCreatedEvent => ({
      type: "account.created",
      key,
      name,
      accountType,
      currency: "AUD",
      isPrivate,
      owners,
    });
    const events = [
      account(ACCOUNT_KEYS.shared, "Joint everyday", "transaction", false, [
        { person: a, shareBp: 5000 },
        { person: b, shareBp: 5000 },
      ]),
      account(ACCOUNT_KEYS.privateA, "Person A private", "savings", true, [
        { person: a, shareBp: 10000 },
      ]),
      account(ACCOUNT_KEYS.privateB, "Person B private", "savings", true, [
        { person: b, shareBp: 10000 },
      ]),
      ...transactions(ACCOUNT_KEYS.shared, SHARED_DESCRIPTIONS, rng, 1),
      ...transactions(ACCOUNT_KEYS.privateA, PRIVATE_DESCRIPTIONS[ACCOUNT_KEYS.privateA], rng, 1),
      ...transactions(ACCOUNT_KEYS.privateB, PRIVATE_DESCRIPTIONS[ACCOUNT_KEYS.privateB], rng, 1),
    ];
    return {
      events,
      expectations: {
        accountKeys: [ACCOUNT_KEYS.shared, ACCOUNT_KEYS.privateA, ACCOUNT_KEYS.privateB],
        sharedDescriptions: [...SHARED_DESCRIPTIONS],
        privateDescriptionsA: [...PRIVATE_DESCRIPTIONS[ACCOUNT_KEYS.privateA]],
        privateDescriptionsB: [...PRIVATE_DESCRIPTIONS[ACCOUNT_KEYS.privateB]],
      },
    };
  },
};
