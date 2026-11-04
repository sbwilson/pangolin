// The reference rules of a seed (AD-15) that its generator (`tools/seed`, which folds events into
// a world) and its loader (the server's `seed` command, which validates a whole file before the
// first write) both enforce, in one place. Neither can import the other, so they share this.

/** An event as the reference rules read it: only the fields that name other events' keys. */
export type SeedReferenceEvent =
  | { readonly type: "person.created"; readonly key: string }
  | {
      readonly type: "household.settings";
      readonly householdPayAnchorPersonId?: string | null | undefined;
    }
  | { readonly type: "institution.created"; readonly key: string }
  | {
      readonly type: "account.created";
      readonly key: string;
      readonly institution: string | null;
      readonly isPrivate: boolean;
      readonly owners: readonly { readonly person: string }[];
    }
  | { readonly type: "tag.created"; readonly key: string; readonly origin: string | null }
  | { readonly type: "payee.created"; readonly key: string; readonly origin: string | null }
  | { readonly type: "balance.recorded"; readonly account: string }
  | {
      readonly type: "transaction.created";
      readonly key: string;
      readonly account: string;
      readonly amountCents: number;
      readonly payee?: string | undefined;
      readonly performedBy?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly splits?:
        | readonly {
            readonly amountCents: number;
            readonly beneficiary?: string | undefined;
            readonly tags?: readonly string[] | undefined;
          }[]
        | undefined;
    }
  | {
      readonly type: "transaction.name-hidden";
      readonly transaction: string;
      readonly by: string;
    }
  | {
      readonly type: "transfer.grouped";
      readonly transactions: readonly [string, string];
      readonly by: string;
    }
  | {
      readonly type: "pay-anchor.created";
      readonly key: string;
      readonly person?: string | null | undefined;
      readonly account: string;
      readonly cadence: "fortnightly" | "monthly";
      readonly anchorDate?: string | null | undefined;
      readonly dayOfMonth?: number | null | undefined;
    }
  | {
      readonly type: "budget.created";
      readonly key: string;
      readonly person?: string | null | undefined;
      readonly category?: { readonly group: string; readonly name: string } | null | undefined;
      readonly categoryGroup?: string | null | undefined;
      readonly cadence: "fortnight" | "month";
      readonly limitCents: number;
      readonly rollover: boolean;
    }
  | {
      readonly type: "recurring-series.created";
      readonly key: string;
      readonly account: string;
      readonly payee: string;
      readonly direction?: "bill" | "income" | undefined;
      readonly cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual";
      readonly expectedCents: number;
      readonly toleranceBp?: number | undefined;
      readonly nextDueOn: string;
      readonly status?: "candidate" | "confirmed" | "rejected" | undefined;
    }
  | {
      readonly type: "stage.created";
      readonly key: string;
      readonly person?: string | null | undefined;
      readonly name: string;
      readonly sort: number;
      readonly exitGoal?: string | null | undefined;
      readonly fallbackThresholdBp?: number | undefined;
      readonly completedSharePolicy?: "rescale" | "buffer" | undefined;
    }
  | {
      readonly type: "goal.created";
      readonly key: string;
      readonly person?: string | null | undefined;
      readonly name: string;
      readonly targetCents: number;
      readonly targetDate?: string | null | undefined;
      readonly priority?: number | undefined;
      readonly kind?: "flexible" | "protected" | undefined;
      readonly isEmergencyFund?: boolean | undefined;
    }
  | {
      readonly type: "goal-rule.created";
      readonly key: string;
      readonly goal: string;
      readonly stage: string;
      readonly shareBp: number;
      readonly effectiveFrom: string;
      readonly effectiveUntil?: string | null | undefined;
      readonly source?: "rule" | "shortfall_override" | undefined;
    };

/** What the events checked so far created, by key. */
export interface SeedKnown {
  readonly people: Set<string>;
  readonly institutions: Set<string>;
  readonly accounts: Map<string, { isPrivate: boolean; owners: string[] }>;
  /** The person an owner-only tag belongs to, or null for a shared one. */
  readonly tags: Map<string, string | null>;
  /** The person an owner-only payee belongs to, or null for a shared one. */
  readonly payees: Map<string, string | null>;
  readonly transactions: Map<
    string,
    { account: string; amountCents: number; grouped: boolean; hidden: boolean }
  >;
  readonly payAnchors: Set<string>;
  readonly budgets: Set<string>;
  readonly recurringSeries: Set<string>;
  readonly goals: Set<string>;
  readonly stages: Set<string>;
  readonly goalRules: Set<string>;
}

export function emptySeedKnown(): SeedKnown {
  return {
    people: new Set(),
    institutions: new Set(),
    accounts: new Map(),
    tags: new Map(),
    payees: new Map(),
    transactions: new Map(),
    payAnchors: new Set(),
    budgets: new Set(),
    recurringSeries: new Set(),
    goals: new Set(),
    stages: new Set(),
    goalRules: new Set(),
  };
}

/**
 * Checks one event against `known` (what the events before it created), naming each problem, and
 * records what it creates in `known`. The rules: keys are unique per kind, and every key an
 * event names (owner, institution, origin account, account, payee, tag, beneficiary, person,
 * transaction) was created earlier; an origin account is private; splits add up to the amount.
 */
export function checkSeedReferences(event: SeedReferenceEvent, known: SeedKnown): string[] {
  const problems: string[] = [];
  const bad = (message: string) => problems.push(message);
  /** The person who owns the private account `origin`, or null when it is not a private account. */
  const originOwner = (origin: string, what: string): string | null => {
    const account = known.accounts.get(origin);
    if (account === undefined) bad(`${what} has unknown origin account "${origin}"`);
    else if (!account.isPrivate)
      bad(`${what} has origin account "${origin}", which is not private`);
    return account?.isPrivate ? (account.owners[0] ?? null) : null;
  };

  switch (event.type) {
    case "person.created":
      if (known.people.has(event.key)) bad(`person key "${event.key}" is used twice`);
      known.people.add(event.key);
      break;
    case "institution.created":
      if (known.institutions.has(event.key)) bad(`institution key "${event.key}" is used twice`);
      known.institutions.add(event.key);
      break;
    case "account.created":
      if (known.accounts.has(event.key)) bad(`account key "${event.key}" is used twice`);
      for (const owner of event.owners) {
        if (!known.people.has(owner.person)) bad(`unknown owner "${owner.person}"`);
      }
      known.accounts.set(event.key, {
        isPrivate: event.isPrivate,
        owners: event.owners.map((owner) => owner.person),
      });
      if (event.institution !== null && !known.institutions.has(event.institution)) {
        bad(`unknown institution "${event.institution}"`);
      }
      break;
    case "tag.created":
      if (known.tags.has(event.key)) bad(`tag key "${event.key}" is used twice`);
      known.tags.set(
        event.key,
        event.origin === null ? null : originOwner(event.origin, `tag "${event.key}"`),
      );
      break;
    case "payee.created":
      if (known.payees.has(event.key)) bad(`payee key "${event.key}" is used twice`);
      known.payees.set(
        event.key,
        event.origin === null ? null : originOwner(event.origin, `payee "${event.key}"`),
      );
      break;
    case "balance.recorded":
      if (!known.accounts.has(event.account)) bad(`unknown account "${event.account}"`);
      break;
    case "transaction.created": {
      const account = known.accounts.get(event.account);
      if (known.transactions.has(event.key)) bad(`transaction key "${event.key}" is used twice`);
      if (account === undefined) bad(`unknown account "${event.account}"`);
      if (event.payee !== undefined && !known.payees.has(event.payee)) {
        bad(`unknown payee "${event.payee}"`);
      }
      if (event.performedBy !== undefined && !known.people.has(event.performedBy)) {
        bad(`unknown person "${event.performedBy}"`);
      }
      if (event.splits !== undefined) {
        const sum = event.splits.reduce((total, split) => total + split.amountCents, 0);
        if (sum !== event.amountCents) bad("splits must add up to the transaction amount");
      }
      const splitTags = (event.splits ?? []).flatMap((split) => split.tags ?? []);
      for (const tag of [...(event.tags ?? []), ...splitTags]) {
        if (!known.tags.has(tag)) bad(`unknown tag "${tag}"`);
      }
      for (const split of event.splits ?? []) {
        const { beneficiary } = split;
        if (beneficiary !== undefined && beneficiary !== "shared") {
          if (!known.people.has(beneficiary)) bad(`unknown beneficiary "${beneficiary}"`);
          else if (account?.isPrivate && account.owners[0] !== beneficiary) {
            bad(`a private account's splits belong to its owner, not "${beneficiary}"`);
          }
        }
      }
      known.transactions.set(event.key, {
        account: event.account,
        amountCents: event.amountCents,
        grouped: false,
        hidden: false,
      });
      break;
    }
    case "transaction.name-hidden":
      if (!known.transactions.has(event.transaction)) {
        bad(`unknown transaction "${event.transaction}"`);
      }
      if (!known.people.has(event.by)) bad(`unknown person "${event.by}"`);
      break;
    case "transfer.grouped":
      for (const key of event.transactions) {
        if (!known.transactions.has(key)) bad(`unknown transaction "${key}"`);
      }
      if (!known.people.has(event.by)) bad(`unknown person "${event.by}"`);
      break;
    case "pay-anchor.created":
      if (known.payAnchors.has(event.key)) bad(`pay anchor key "${event.key}" is used twice`);
      if (event.person != null && !known.people.has(event.person)) {
        bad(`unknown person "${event.person}"`);
      }
      if (!known.accounts.has(event.account)) {
        bad(`unknown account "${event.account}"`);
      }
      known.payAnchors.add(event.key);
      break;
    case "budget.created":
      if (known.budgets.has(event.key)) bad(`budget key "${event.key}" is used twice`);
      if (event.person != null && !known.people.has(event.person)) {
        bad(`unknown person "${event.person}"`);
      }
      if (
        (event.category != null && event.categoryGroup != null) ||
        (event.category == null && event.categoryGroup == null)
      ) {
        bad("budget must target either category or categoryGroup, but not both");
      }
      known.budgets.add(event.key);
      break;
    case "recurring-series.created":
      if (known.recurringSeries.has(event.key)) {
        bad(`recurring series key "${event.key}" is used twice`);
      }
      if (!known.accounts.has(event.account)) {
        bad(`unknown account "${event.account}"`);
      }
      if (!known.payees.has(event.payee)) {
        bad(`unknown payee "${event.payee}"`);
      }
      known.recurringSeries.add(event.key);
      break;
    case "stage.created":
      if (known.stages.has(event.key)) bad(`stage key "${event.key}" is used twice`);
      if (event.person != null && !known.people.has(event.person)) {
        bad(`unknown person "${event.person}"`);
      }
      if (event.exitGoal != null && !known.goals.has(event.exitGoal)) {
        bad(`unknown exit goal "${event.exitGoal}"`);
      }
      known.stages.add(event.key);
      break;
    case "goal.created":
      if (known.goals.has(event.key)) bad(`goal key "${event.key}" is used twice`);
      if (event.person != null && !known.people.has(event.person)) {
        bad(`unknown person "${event.person}"`);
      }
      if (event.targetCents <= 0) bad("targetCents must be greater than 0");
      known.goals.add(event.key);
      break;
    case "goal-rule.created":
      if (known.goalRules.has(event.key)) bad(`goal rule key "${event.key}" is used twice`);
      if (!known.goals.has(event.goal)) bad(`unknown goal "${event.goal}"`);
      if (!known.stages.has(event.stage)) bad(`unknown stage "${event.stage}"`);
      if (event.shareBp < 0 || event.shareBp > 10000) bad("shareBp must be in 0..10000");
      known.goalRules.add(event.key);
      break;
    case "household.settings":
      if (
        event.householdPayAnchorPersonId != null &&
        !known.people.has(event.householdPayAnchorPersonId)
      ) {
        bad(`unknown person "${event.householdPayAnchorPersonId}"`);
      }
      break;
  }
  return problems;
}
