// The one synthetic household every epic extends (AD-15). Modules never mutate the world:
// they emit events, and the runner folds those events into the world the next modules see.
import { checkSeedReferences, emptySeedKnown, type SeedKnown } from "@pangolin/shared/seed";
import type { PlainDate } from "@pangolin/shared/temporal";

/** A person in the household. `key` is the stable handle other modules refer to them by. */
export interface WorldPerson {
  readonly key: string;
  readonly displayName: string;
  /** `#RRGGBB`. */
  readonly colour: string;
}

/** Household-wide settings, as `system.updateHouseholdSettings` takes them. */
export interface WorldHousehold {
  /** IANA time zone. */
  readonly timezone: string;
  /** ISO 4217 code. */
  readonly baseCurrency: string;
  readonly sharedAttribution: "contribution" | "even";
}

/** An account owner: a person's key and their share in basis points (5000 = 50%). */
export interface WorldAccountOwner {
  readonly person: string;
  readonly shareBp: number;
}

/** A bank, broker or super fund, as `accounts.createInstitution` takes it. */
export interface WorldInstitution {
  readonly key: string;
  readonly name: string;
  /** One of `app`'s institution kinds, e.g. `bank`. */
  readonly kind: string;
}

/** An account. A private account has one owner and is seen only by them (AD-3). */
export interface WorldAccount {
  readonly key: string;
  readonly name: string;
  /** One of `app`'s account types, e.g. `transaction`. */
  readonly accountType: string;
  /** ISO 4217 code. */
  readonly currency: string;
  readonly isPrivate: boolean;
  readonly owners: readonly WorldAccountOwner[];
  /** The key of the institution it is held at, or `null`. */
  readonly institution: string | null;
  /** Counts toward savings. */
  readonly isSavings: boolean;
}

/** A default category named by its group and its own name, e.g. `Food` / `Groceries`. */
export interface CategoryRef {
  readonly group: string;
  readonly name: string;
}

/**
 * A tag. With `origin` (the key of a private account) it is owner-only (AD-18); without, shared.
 */
export interface WorldTag {
  readonly key: string;
  readonly name: string;
  readonly origin: string | null;
}

/** A payee, scoped like a tag. `defaultCategory` is what the payee's transactions take later. */
export interface WorldPayee {
  readonly key: string;
  readonly name: string;
  readonly websiteUrl: string | null;
  readonly defaultCategory: CategoryRef | null;
  readonly origin: string | null;
}

/** One split of a seeded transaction. The splits of a transaction sum to its amount. */
export interface SeedSplit {
  readonly amountCents: number;
  readonly category?: CategoryRef;
  /** `shared` or a person key; omitted means the account's default (the owner, or `shared`). */
  readonly beneficiary?: string;
  /** Keys of tags. */
  readonly tags?: readonly string[];
}

/** A posted transaction as the world records it (the `transaction.created` events so far). */
export interface WorldTransaction {
  readonly key: string;
  readonly account: string;
  readonly postedOn: string;
  readonly amountCents: number;
  readonly description: string;
  readonly payee: string | null;
}

// Placeholders: epics 3 and 6 give these their fields and the events that fill them.
export interface WorldPayAnchor {
  readonly key: string;
}
export interface WorldMerchant {
  readonly key: string;
}
export interface WorldBill {
  readonly key: string;
}

export interface World {
  readonly seed: string;
  /** The fixed "today" of this run; nothing in the seed reads the real clock. */
  readonly today: PlainDate;
  readonly people: readonly WorldPerson[];
  /** `null` until a module sets the household settings. */
  readonly household: WorldHousehold | null;
  readonly institutions: readonly WorldInstitution[];
  readonly accounts: readonly WorldAccount[];
  readonly tags: readonly WorldTag[];
  readonly payees: readonly WorldPayee[];
  readonly transactions: readonly WorldTransaction[];
  readonly payAnchors: readonly WorldPayAnchor[];
  readonly merchants: readonly WorldMerchant[];
  readonly bills: readonly WorldBill[];
}

/** Adds a person. Applied through `identity.createPerson`. */
export interface PersonCreatedEvent extends WorldPerson {
  readonly type: "person.created";
}

/** Sets the household settings. Applied through `system.updateHouseholdSettings`. */
export interface HouseholdSettingsEvent extends WorldHousehold {
  readonly type: "household.settings";
}

/** Adds an institution. Applied through `accounts.createInstitution`. */
export interface InstitutionCreatedEvent extends WorldInstitution {
  readonly type: "institution.created";
}

/** Adds an account. Applied through `accounts.createAccount`. */
export interface AccountCreatedEvent extends WorldAccount {
  readonly type: "account.created";
}

/** Adds a tag. Applied through `classify.createTag`. */
export interface TagCreatedEvent extends WorldTag {
  readonly type: "tag.created";
}

/** Adds a payee. Applied through `classify.createPayee`. */
export interface PayeeCreatedEvent extends WorldPayee {
  readonly type: "payee.created";
}

/** Records an account's balance on one day. Applied through `accounts.recordBalanceSnapshot`. */
export interface BalanceRecordedEvent {
  readonly type: "balance.recorded";
  /** The key of the account. */
  readonly account: string;
  /** `YYYY-MM-DD`; the snapshot covers that whole day. */
  readonly asOf: string;
  /** Signed: loans and credit cards are negative (AD-12). */
  readonly balanceCents: number;
  readonly source: "statement" | "manual";
}

/**
 * Adds one posted transaction to the account with key `account`. Applied through
 * `ledger.createTransaction`, then `setSplits`, `setSplitField` and `setSplitTags` for its
 * classification. Without `splits` it has one split for the whole amount, which takes
 * `category` and `tags`; with `splits` those two are not used and each split carries its own.
 */
export interface TransactionCreatedEvent {
  readonly type: "transaction.created";
  /** Unique across the seed; later events (hide, transfer) refer to the transaction by it. */
  readonly key: string;
  /** The key of the account it belongs to. */
  readonly account: string;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed integer minor units. */
  readonly amountCents: number;
  readonly description: string;
  /** The key of a payee. */
  readonly payee?: string;
  readonly notes?: string;
  readonly category?: CategoryRef;
  /** Keys of tags. */
  readonly tags?: readonly string[];
  readonly splits?: readonly SeedSplit[];
}

/**
 * Hides a shared-account transaction's name from the other owner. Applied through
 * `ledger.hideTransactionName` as the person `by`, until the use case's maximum from today.
 */
export interface NameHiddenEvent {
  readonly type: "transaction.name-hidden";
  /** The key of the transaction. */
  readonly transaction: string;
  /** The key of the person who hides it; an owner of its account. */
  readonly by: string;
}

/**
 * Links two transactions as both sides of a transfer. Applied through
 * `ledger.createTransferGroup` as the person `by`, who must see both accounts.
 */
export interface TransferGroupedEvent {
  readonly type: "transfer.grouped";
  /** The keys of the two transactions, of opposite amounts in different accounts. */
  readonly transactions: readonly [string, string];
  /** The key of the person it is applied as: an owner of every private account involved. */
  readonly by: string;
}

/** Everything a module may emit. Later epics add events here and to the server's loader. */
export type SeedEvent =
  | PersonCreatedEvent
  | HouseholdSettingsEvent
  | InstitutionCreatedEvent
  | AccountCreatedEvent
  | TagCreatedEvent
  | PayeeCreatedEvent
  | BalanceRecordedEvent
  | TransactionCreatedEvent
  | NameHiddenEvent
  | TransferGroupedEvent;

/** An event as it appears in the seed output: stamped with the module that emitted it. */
export type EmittedEvent = SeedEvent & { readonly module: string };

export function emptyWorld(seed: string, today: PlainDate): World {
  return {
    seed,
    today,
    people: [],
    household: null,
    institutions: [],
    accounts: [],
    tags: [],
    payees: [],
    transactions: [],
    payAnchors: [],
    merchants: [],
    bills: [],
  };
}

/**
 * What `world` has created, by key, as the shared reference rules read it. A tag's or payee's
 * owner is the owner of its private origin account.
 */
function knownOf(world: World): SeedKnown {
  const known = emptySeedKnown();
  for (const person of world.people) known.people.add(person.key);
  for (const institution of world.institutions) known.institutions.add(institution.key);
  for (const account of world.accounts) {
    known.accounts.set(account.key, {
      isPrivate: account.isPrivate,
      owners: account.owners.map((owner) => owner.person),
    });
  }
  const ownerOf = (origin: string | null): string | null =>
    origin === null ? null : (known.accounts.get(origin)?.owners[0] ?? null);
  for (const tag of world.tags) known.tags.set(tag.key, ownerOf(tag.origin));
  for (const payee of world.payees) known.payees.set(payee.key, ownerOf(payee.origin));
  for (const txn of world.transactions) {
    known.transactions.set(txn.key, {
      account: txn.account,
      amountCents: txn.amountCents,
      grouped: false,
      hidden: false,
    });
  }
  return known;
}

/** The world after `event`. Throws when the event contradicts the world (e.g. a duplicate key). */
export function applyEvent(world: World, event: SeedEvent): World {
  const problems = checkSeedReferences(event, knownOf(world));
  if (problems.length > 0) {
    throw new Error(`Seed event ${event.type} contradicts the world: ${problems.join("; ")}`);
  }
  switch (event.type) {
    case "person.created": {
      const { key, displayName, colour } = event;
      return { ...world, people: [...world.people, { key, displayName, colour }] };
    }
    case "household.settings": {
      const { timezone, baseCurrency, sharedAttribution } = event;
      return { ...world, household: { timezone, baseCurrency, sharedAttribution } };
    }
    case "institution.created": {
      const { key, name, kind } = event;
      return { ...world, institutions: [...world.institutions, { key, name, kind }] };
    }
    case "account.created": {
      const { key, name, accountType, currency, isPrivate, owners, institution, isSavings } = event;
      const account: WorldAccount = {
        key,
        name,
        accountType,
        currency,
        isPrivate,
        owners,
        institution,
        isSavings,
      };
      return { ...world, accounts: [...world.accounts, account] };
    }
    case "tag.created": {
      const { key, name, origin } = event;
      return { ...world, tags: [...world.tags, { key, name, origin }] };
    }
    case "payee.created": {
      const { key, name, websiteUrl, defaultCategory, origin } = event;
      return {
        ...world,
        payees: [...world.payees, { key, name, websiteUrl, defaultCategory, origin }],
      };
    }
    case "transaction.created": {
      const { key, account, postedOn, amountCents, description } = event;
      const txn: WorldTransaction = {
        key,
        account,
        postedOn,
        amountCents,
        description,
        payee: event.payee ?? null,
      };
      return { ...world, transactions: [...world.transactions, txn] };
    }
    case "balance.recorded":
    case "transaction.name-hidden":
    case "transfer.grouped":
      return world;
  }
}
