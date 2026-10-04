// The one synthetic household every epic extends (AD-15). Modules never mutate the world:
// they emit events, and the runner folds those events into the world the next modules see.
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
  readonly accounts: readonly WorldAccount[];
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

/** Adds an account. Applied through `accounts.createAccount`. */
export interface AccountCreatedEvent extends WorldAccount {
  readonly type: "account.created";
}

/** Adds one posted transaction to the account with key `account`. Applied through `ledger.createTransaction`. */
export interface TransactionCreatedEvent {
  readonly type: "transaction.created";
  /** The key of the account it belongs to. */
  readonly account: string;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed integer minor units. */
  readonly amountCents: number;
  readonly description: string;
}

/** Everything a module may emit. Later epics add events here and to the server's loader. */
export type SeedEvent =
  | PersonCreatedEvent
  | HouseholdSettingsEvent
  | AccountCreatedEvent
  | TransactionCreatedEvent;

/** An event as it appears in the seed output: stamped with the module that emitted it. */
export type EmittedEvent = SeedEvent & { readonly module: string };

export function emptyWorld(seed: string, today: PlainDate): World {
  return {
    seed,
    today,
    people: [],
    household: null,
    accounts: [],
    payAnchors: [],
    merchants: [],
    bills: [],
  };
}

/** The world after `event`. Throws when the event contradicts the world (e.g. a duplicate key). */
export function applyEvent(world: World, event: SeedEvent): World {
  switch (event.type) {
    case "person.created": {
      if (world.people.some((person) => person.key === event.key)) {
        throw new Error(`Seed world already has a person with key "${event.key}"`);
      }
      const { key, displayName, colour } = event;
      return { ...world, people: [...world.people, { key, displayName, colour }] };
    }
    case "household.settings": {
      const { timezone, baseCurrency, sharedAttribution } = event;
      return { ...world, household: { timezone, baseCurrency, sharedAttribution } };
    }
    case "account.created": {
      if (world.accounts.some((account) => account.key === event.key)) {
        throw new Error(`Seed world already has an account with key "${event.key}"`);
      }
      for (const owner of event.owners) {
        if (!world.people.some((person) => person.key === owner.person)) {
          throw new Error(`Account "${event.key}" has unknown owner "${owner.person}"`);
        }
      }
      const { key, name, accountType, currency, isPrivate, owners } = event;
      const account: WorldAccount = { key, name, accountType, currency, isPrivate, owners };
      return { ...world, accounts: [...world.accounts, account] };
    }
    case "transaction.created": {
      if (!world.accounts.some((account) => account.key === event.account)) {
        throw new Error(`Transaction is in unknown account "${event.account}"`);
      }
      return world;
    }
  }
}
