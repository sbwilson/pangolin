// The seed loader (AD-15 bootstrap): applies a `seed.json` written by `tools/seed` through the
// `app` use cases, as `cli:seed`. The whole file is validated before the first write.
import {
  ACCOUNT_TYPES,
  AppError,
  type Clock,
  checkSeedReferences,
  createAccount,
  createInstitution,
  createPayee,
  createPerson,
  createPersonInput,
  createTag,
  createTransaction,
  createTransferGroup,
  DEFAULT_CATEGORIES,
  emptySeedKnown,
  getTransaction,
  hideTransactionName,
  type IdGenerator,
  INSTITUTION_KINDS,
  listCategories,
  listCategoryGroups,
  listLogins,
  listTransactions,
  type PersonViewer,
  personViewer,
  recordBalanceSnapshot,
  type SeedKnown,
  seedDefaults,
  setSplitField,
  setSplits,
  setSplitTags,
  type UnitOfWork,
  type UseCaseContext,
  updateHouseholdSettings,
  updateHouseholdSettingsInput,
  updateTransaction,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { z } from "zod";

export interface SeedDeps {
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/**
 * Seeds the default categories and tax categories as `job:seed-defaults` (AD-6), only when the
 * household has no category groups, so it is safe to run on every start. Returns whether it seeded.
 */
export function seedClassifyDefaults(uow: UnitOfWork, deps: SeedDeps): boolean {
  return seedDefaults({
    viewer: systemViewer("job:seed-defaults"),
    clock: deps.clock,
    newId: deps.newId,
    uow,
  });
}

export interface AppliedSeed {
  readonly seed: string;
  readonly today: string;
  /** Number of events applied. */
  readonly events: number;
  /** Number of accounts created. */
  readonly accounts: number;
  /** Number of transactions created. */
  readonly transactions: number;
  /** The server-minted person ID for each seed person key. */
  readonly people: Readonly<Record<string, PersonId>>;
}

/** A person's ID as `personViewer` takes it. */
type PersonId = PersonViewer["personId"];

const moduleName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: "Expected a seed module name",
});

const key = z.string().min(1);

/** True when a `YYYY-MM-DD` string names a day that exists (`2026-02-30` does not). */
function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  // setUTCFullYear, unlike Date.UTC, does not map years 0–99 to 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Expected YYYY-MM-DD" })
  .refine(isCalendarDate, { message: "Expected a real calendar date" });

/** A default category by group and name; `parseSeed` checks it against the defaults. */
const categoryRef = z.strictObject({ group: key, name: key });
type CategoryRef = z.output<typeof categoryRef>;

const splitSchema = z.strictObject({
  amountCents: z.int(),
  category: categoryRef.optional(),
  beneficiary: key.optional(),
  tags: z.array(key).optional(),
});

const EVENT_SCHEMAS = {
  "person.created": z.strictObject({
    type: z.literal("person.created"),
    module: moduleName,
    key,
    ...createPersonInput.shape,
  }),
  "household.settings": z.strictObject({
    type: z.literal("household.settings"),
    module: moduleName,
    ...updateHouseholdSettingsInput.required().shape,
  }),
  "institution.created": z.strictObject({
    type: z.literal("institution.created"),
    module: moduleName,
    key,
    name: key,
    kind: z.enum(INSTITUTION_KINDS),
  }),
  "account.created": z.strictObject({
    type: z.literal("account.created"),
    module: moduleName,
    key,
    name: key,
    accountType: z.enum(ACCOUNT_TYPES),
    currency: key,
    isPrivate: z.boolean(),
    owners: z.array(z.strictObject({ person: key, shareBp: z.int() })).min(1),
    institution: key.nullable(),
    isSavings: z.boolean(),
  }),
  "tag.created": z.strictObject({
    type: z.literal("tag.created"),
    module: moduleName,
    key,
    name: key,
    origin: key.nullable(),
  }),
  "payee.created": z.strictObject({
    type: z.literal("payee.created"),
    module: moduleName,
    key,
    name: key,
    websiteUrl: z.string().min(1).nullable(),
    defaultCategory: categoryRef.nullable(),
    origin: key.nullable(),
  }),
  "balance.recorded": z.strictObject({
    type: z.literal("balance.recorded"),
    module: moduleName,
    account: key,
    asOf: dateString,
    balanceCents: z.int(),
    source: z.enum(["statement", "manual"]),
  }),
  "transaction.created": z.strictObject({
    type: z.literal("transaction.created"),
    module: moduleName,
    key,
    account: key,
    postedOn: dateString,
    amountCents: z.int(),
    description: z.string().min(1).max(500),
    payee: key.optional(),
    notes: z.string().min(1).max(1000).optional(),
    category: categoryRef.optional(),
    tags: z.array(key).optional(),
    splits: z.array(splitSchema).min(1).max(50).optional(),
  }),
  "transaction.name-hidden": z.strictObject({
    type: z.literal("transaction.name-hidden"),
    module: moduleName,
    transaction: key,
    by: key,
  }),
  "transfer.grouped": z.strictObject({
    type: z.literal("transfer.grouped"),
    module: moduleName,
    transactions: z.tuple([key, key]),
    by: key,
  }),
} as const;

type EventType = keyof typeof EVENT_SCHEMAS;
type SeedEvent = z.output<(typeof EVENT_SCHEMAS)[EventType]>;
type TransactionEvent = Extract<SeedEvent, { type: "transaction.created" }>;

const seedFileSchema = z.strictObject({
  seed: z.string().min(1),
  today: dateString,
  events: z.array(z.unknown()),
  expectations: z.record(z.string(), z.unknown()),
});

function isEventType(type: unknown): type is EventType {
  return typeof type === "string" && Object.hasOwn(EVENT_SCHEMAS, type);
}

function invalid(problems: readonly string[]): AppError {
  return new AppError("Validation", `Invalid seed file: ${problems.join("; ")}`, problems);
}

function issuesAt(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });
}

const categoryKey = (ref: CategoryRef): string => `${ref.group}\u0000${ref.name}`;
const DEFAULT_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_CATEGORIES.flatMap((group) =>
    group.categories.map((category) => categoryKey({ group: group.name, name: category.name })),
  ),
);

/**
 * Checks one event against the events before it, naming each problem. Everything a use case
 * would refuse for a bad reference is caught here, so nothing is written for a seed that cannot
 * apply.
 */
function checkReferences(event: SeedEvent, known: SeedKnown, at: string): string[] {
  // Keys, existence and origin rules are the generator's too (`checkSeedReferences`); what
  // follows is what only applying through the use cases needs.
  const problems = checkSeedReferences(event, known).map((message) => `${at}: ${message}`);
  const bad = (message: string) => problems.push(`${at}: ${message}`);
  const requireCategory = (ref: CategoryRef | null | undefined, where: string) => {
    if (ref != null && !DEFAULT_CATEGORY_KEYS.has(categoryKey(ref))) {
      bad(`${where}: unknown category "${ref.group} / ${ref.name}"`);
    }
  };
  /** An owner-only row (`scopeOwner` is the person it belongs to) goes only on their own private account. */
  const requireUsable = (
    what: string,
    scopeOwner: string | null | undefined,
    account: string,
  ): void => {
    if (scopeOwner === undefined || scopeOwner === null) return;
    const target = known.accounts.get(account);
    if (target === undefined || !target.isPrivate || target.owners[0] !== scopeOwner) {
      bad(`${what} is owner-only and cannot be used in account "${account}"`);
    }
  };

  switch (event.type) {
    case "payee.created":
      requireCategory(event.defaultCategory, "defaultCategory");
      break;
    case "transaction.created": {
      if (event.payee !== undefined && known.payees.has(event.payee)) {
        requireUsable(`payee "${event.payee}"`, known.payees.get(event.payee), event.account);
      }
      if (
        event.splits !== undefined &&
        (event.category !== undefined || event.tags !== undefined)
      ) {
        bad("a transaction with splits classifies in its splits, not on itself");
      }
      requireCategory(event.category, "category");
      const splits = event.splits ?? [
        {
          amountCents: event.amountCents,
          ...(event.tags === undefined ? {} : { tags: event.tags }),
        },
      ];
      if (event.amountCents !== 0 && splits.some((split) => split.amountCents === 0)) {
        bad("a split cannot be zero unless the transaction is");
      }
      for (const [i, split] of splits.entries()) {
        requireCategory(split.category, `splits.${i}.category`);
        for (const tag of split.tags ?? []) {
          if (known.tags.has(tag))
            requireUsable(`tag "${tag}"`, known.tags.get(tag), event.account);
        }
      }
      break;
    }
    case "transaction.name-hidden": {
      const txn = known.transactions.get(event.transaction);
      const account = txn === undefined ? undefined : known.accounts.get(txn.account);
      if (account?.isPrivate) bad("a name in a private account cannot be hidden");
      else if (account !== undefined && !account.owners.includes(event.by)) {
        bad(`"${event.by}" does not own the account of "${event.transaction}"`);
      }
      if (txn !== undefined) {
        if (txn.hidden) bad(`transaction "${event.transaction}" is hidden twice`);
        txn.hidden = true;
      }
      break;
    }
    case "transfer.grouped": {
      const [first, second] = event.transactions;
      const a = known.transactions.get(first);
      const b = known.transactions.get(second);
      if (first === second) bad("a transfer links two different transactions");
      if (a !== undefined && b !== undefined && first !== second) {
        if (a.account === b.account) bad("a transfer links two different accounts");
        if (a.amountCents === 0 || a.amountCents + b.amountCents !== 0) {
          bad("a transfer's two sides must have opposite amounts");
        }
        if (a.grouped || b.grouped) bad("a transaction is already in a transfer group");
        for (const side of [a, b]) {
          const account = known.accounts.get(side.account);
          if (account?.isPrivate && account.owners[0] !== event.by) {
            bad(`"${event.by}" cannot see the private account of a transfer's side`);
          }
        }
        a.grouped = true;
        b.grouped = true;
      }
      break;
    }
    case "institution.created":
    case "account.created":
    case "tag.created":
    case "balance.recorded":
    case "person.created":
    case "household.settings":
      // Only the shared reference rules apply to these.
      break;
    default: {
      const unchecked: never = event;
      throw new Error(`Seed event not checked: ${JSON.stringify(unchecked)}`);
    }
  }
  return problems;
}

/**
 * Parses and validates a whole seed file without writing anything. Throws `AppError`
 * `Validation`, naming every problem: malformed JSON, a missing field, an unknown event type,
 * an event a use case would reject, a key used twice, a default category that does not exist,
 * or an event naming a person, institution, account, payee, tag or transaction no earlier event
 * created.
 */
export function parseSeed(seedJson: string): {
  seed: string;
  today: string;
  events: SeedEvent[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(seedJson);
  } catch (error) {
    throw invalid([`not valid JSON (${error instanceof Error ? error.message : String(error)})`]);
  }
  const file = seedFileSchema.safeParse(raw);
  if (!file.success) throw invalid(issuesAt("", file.error));

  const problems: string[] = [];
  const events: SeedEvent[] = [];
  const known = emptySeedKnown();
  file.data.events.forEach((event, i) => {
    const type = (event as { type?: unknown } | null)?.type;
    if (!isEventType(type)) {
      problems.push(`events.${i}: unknown event type ${JSON.stringify(type)}`);
      return;
    }
    const parsed = EVENT_SCHEMAS[type].safeParse(event);
    if (!parsed.success) {
      problems.push(...issuesAt(`events.${i}`, parsed.error));
      return;
    }
    const data = parsed.data;
    problems.push(...checkReferences(data, known, `events.${i}`));
    events.push(data);
  });
  if (problems.length > 0) throw invalid(problems);
  return { seed: file.data.seed, today: file.data.today, events };
}

export interface ApplySeedOptions {
  /**
   * Existing people to use for the seed's person keys, instead of creating them. Keys are the
   * seed's `person.created` keys; a seed person with no entry here is created. When set, the
   * household settings event is skipped: the household keeps its own.
   */
  readonly people?: Readonly<Record<string, PersonId>>;
}

/**
 * Applies a seed file to a migrated database: validates all of it first, then runs each event
 * through its use cases as `systemViewer("cli:seed")`, so every write is audited. A hidden name
 * and a transfer group are applied as the person who owns the account, since the use cases take
 * a person. The whole seed is one transaction: it loads fully or not at all.
 */
export function applySeed(
  uow: UnitOfWork,
  deps: SeedDeps,
  seedJson: string,
  options: ApplySeedOptions = {},
): AppliedSeed {
  return applyParsed(uow, deps, parseSeed(seedJson), options);
}

function applyParsed(
  uow: UnitOfWork,
  deps: SeedDeps,
  parsed: ReturnType<typeof parseSeed>,
  options: ApplySeedOptions,
): AppliedSeed {
  // Every use case below opens its own write transaction; inside this one they are savepoints,
  // so a failure anywhere rolls the whole seed back.
  return uow.transaction(() => applyEvents(uow, deps, parsed, options));
}

function applyEvents(
  uow: UnitOfWork,
  deps: SeedDeps,
  parsed: ReturnType<typeof parseSeed>,
  options: ApplySeedOptions,
): AppliedSeed {
  const ctx: UseCaseContext = {
    viewer: systemViewer("cli:seed"),
    clock: deps.clock,
    newId: deps.newId,
    uow,
  };
  seedClassifyDefaults(uow, deps);
  const linked = options.people;
  const people: Record<string, PersonId> = {};
  const institutions: Record<string, string> = {};
  const accounts: Record<string, string> = {};
  const tags: Record<string, string> = {};
  const payees: Record<string, string> = {};
  const transactions: Record<string, string> = {};
  let categoryIds: Map<string, string> | undefined;

  const asPerson = (personKey: string): UseCaseContext => ({
    ...ctx,
    viewer: personViewer(people[personKey] as PersonId, deps.clock.now()),
  });
  /** The ID of a default category, looked up once the defaults exist. */
  const categoryId = (ref: CategoryRef): string => {
    if (categoryIds === undefined) {
      const groups = new Map(listCategoryGroups(ctx).map((group) => [group.id as string, group]));
      categoryIds = new Map(
        listCategories(ctx).flatMap((category) => {
          const group = groups.get(category.groupId);
          return group === undefined
            ? []
            : [[categoryKey({ group: group.name, name: category.name }), category.id as string]];
        }),
      );
    }
    const id = categoryIds.get(categoryKey(ref));
    if (id === undefined) {
      throw new AppError(
        "Validation",
        `The household has no category "${ref.group} / ${ref.name}"`,
      );
    }
    return id;
  };

  const classify = (event: TransactionEvent, id: string): void => {
    const wanted = event.splits ?? [
      {
        amountCents: event.amountCents,
        ...(event.category === undefined ? {} : { category: event.category }),
        ...(event.tags === undefined ? {} : { tags: event.tags }),
      },
    ];
    if (wanted.length === 1 && !wanted.some((s) => s.category || s.beneficiary || s.tags?.length)) {
      return;
    }
    let view = getTransaction(ctx, { id });
    if (wanted.length > 1) {
      view = setSplits(ctx, {
        transactionId: id,
        splits: wanted.map((split) => ({ amountCents: split.amountCents })),
      });
    }
    // Splits come back in the order they were minted, which is the order they were given.
    wanted.forEach((split, i) => {
      const row = view.splits[i];
      if (row === undefined || row.amountCents !== split.amountCents) {
        throw new Error(`Transaction "${event.key}" did not come back with its splits in order`);
      }
      if (split.category !== undefined) {
        setSplitField(ctx, {
          transactionId: id,
          splitId: row.id,
          field: "category",
          value: categoryId(split.category),
        });
      }
      if (split.beneficiary !== undefined) {
        setSplitField(ctx, {
          transactionId: id,
          splitId: row.id,
          field: "beneficiary",
          value: split.beneficiary === "shared" ? "shared" : (people[split.beneficiary] as string),
        });
      }
      if (split.tags !== undefined && split.tags.length > 0) {
        setSplitTags(ctx, {
          transactionId: id,
          splitId: row.id,
          tagIds: split.tags.map((tag) => tags[tag] as string),
        });
      }
    });
  };

  let accountCount = 0;
  let transactionCount = 0;
  for (const event of parsed.events) {
    switch (event.type) {
      case "person.created": {
        const existing = linked?.[event.key];
        people[event.key] =
          existing ??
          createPerson(ctx, {
            displayName: event.displayName,
            colour: event.colour,
          });
        break;
      }
      case "household.settings":
        if (linked !== undefined) break;
        updateHouseholdSettings(ctx, {
          timezone: event.timezone,
          baseCurrency: event.baseCurrency,
          sharedAttribution: event.sharedAttribution,
        });
        break;
      case "institution.created":
        institutions[event.key] = createInstitution(ctx, {
          name: event.name,
          kind: event.kind,
        }).id;
        break;
      case "account.created":
        accounts[event.key] = createAccount(ctx, {
          name: event.name,
          type: event.accountType,
          currency: event.currency,
          isPrivate: event.isPrivate,
          owners: event.owners.map((owner) => ({
            personId: people[owner.person] as string,
            shareBp: owner.shareBp,
          })),
          ...(event.institution === null
            ? {}
            : { institutionId: institutions[event.institution] as string }),
          isSavings: event.isSavings,
        });
        accountCount += 1;
        break;
      case "tag.created":
        tags[event.key] = createTag(ctx, {
          name: event.name,
          ...(event.origin === null ? {} : { originAccountId: accounts[event.origin] as string }),
        }).id;
        break;
      case "payee.created":
        payees[event.key] = createPayee(ctx, {
          name: event.name,
          websiteUrl: event.websiteUrl,
          ...(event.defaultCategory === null
            ? {}
            : { defaultCategoryId: categoryId(event.defaultCategory) }),
          ...(event.origin === null ? {} : { originAccountId: accounts[event.origin] as string }),
        }).id;
        break;
      case "balance.recorded":
        recordBalanceSnapshot(ctx, {
          accountId: accounts[event.account] as string,
          asOf: event.asOf,
          balanceCents: event.balanceCents,
          source: event.source,
        });
        break;
      case "transaction.created": {
        const id = createTransaction(ctx, {
          accountId: accounts[event.account] as string,
          postedOn: event.postedOn,
          amountCents: event.amountCents,
          description: event.description,
          ...(event.payee === undefined ? {} : { payeeId: payees[event.payee] as string }),
        });
        transactions[event.key] = id;
        transactionCount += 1;
        if (event.notes !== undefined) updateTransaction(ctx, { id, notes: event.notes });
        classify(event, id);
        break;
      }
      case "transaction.name-hidden":
        hideTransactionName(asPerson(event.by), { id: transactions[event.transaction] as string });
        break;
      case "transfer.grouped":
        createTransferGroup(asPerson(event.by), {
          transactionIds: [
            transactions[event.transactions[0]] as string,
            transactions[event.transactions[1]] as string,
          ],
        });
        break;
    }
  }
  return {
    seed: parsed.seed,
    today: parsed.today,
    events: parsed.events.length,
    accounts: accountCount,
    transactions: transactionCount,
    people,
  };
}

/**
 * The `seed` admin command's work: reads the seed file, maps its people (in `person.created`
 * order) onto the signed-up people with a login (oldest first), and applies its institutions,
 * accounts, classification, transactions and balances to them, in one transaction. The household
 * is unchanged. `Validation` when fewer people have a login than the seed has people; `Conflict`
 * when the ledger already holds accounts or transactions, with nothing written.
 */
export function linkSeed(uow: UnitOfWork, deps: SeedDeps, seedJson: string): AppliedSeed {
  const parsed = parseSeed(seedJson);
  const keys = parsed.events.flatMap((event) =>
    event.type === "person.created" ? [event.key] : [],
  );
  const ctx: UseCaseContext = {
    viewer: systemViewer("cli:seed"),
    clock: deps.clock,
    newId: deps.newId,
    uow,
  };
  return uow.transaction(() => {
    const logins = listLogins(ctx);
    if (uow.read((repos) => repos.accounts.any()) || listTransactions(ctx).page.total > 0) {
      throw new AppError(
        "Conflict",
        "The ledger already has accounts or transactions: seed an empty ledger",
      );
    }
    if (logins.length < keys.length) {
      throw new AppError(
        "Validation",
        `The seed has ${keys.length} people and ${logins.length} ${logins.length === 1 ? "has" : "have"} signed up: sign up both partners first`,
      );
    }
    const people = Object.fromEntries(
      keys.map((key, i) => [key, (logins[i] as { personId: PersonId }).personId]),
    );
    return applyEvents(uow, deps, parsed, { people });
  });
}
