// The seed loader (AD-15 bootstrap): applies a `seed.json` written by `tools/seed` through the
// `app` use cases, as `cli:seed`. The whole file is validated before the first write.
import {
  ACCOUNT_TYPES,
  AppError,
  type Clock,
  createAccount,
  createPerson,
  createPersonInput,
  createTransaction,
  type IdGenerator,
  listLogins,
  listTransactions,
  type UnitOfWork,
  type UseCaseContext,
  updateHouseholdSettings,
  updateHouseholdSettingsInput,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { z } from "zod";

export interface SeedDeps {
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

export interface AppliedSeed {
  readonly seed: string;
  readonly today: string;
  /** Number of events applied. */
  readonly events: number;
  /** The server-minted person ID for each seed person key. */
  readonly people: Readonly<Record<string, string>>;
}

const moduleName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: "Expected a seed module name",
});

const EVENT_SCHEMAS = {
  "person.created": z.strictObject({
    type: z.literal("person.created"),
    module: moduleName,
    key: z.string().min(1),
    ...createPersonInput.shape,
  }),
  "household.settings": z.strictObject({
    type: z.literal("household.settings"),
    module: moduleName,
    ...updateHouseholdSettingsInput.required().shape,
  }),
  "account.created": z.strictObject({
    type: z.literal("account.created"),
    module: moduleName,
    key: z.string().min(1),
    name: z.string().min(1),
    accountType: z.enum(ACCOUNT_TYPES),
    currency: z.string().min(1),
    isPrivate: z.boolean(),
    owners: z.array(z.strictObject({ person: z.string().min(1), shareBp: z.int() })).min(1),
  }),
  "transaction.created": z.strictObject({
    type: z.literal("transaction.created"),
    module: moduleName,
    account: z.string().min(1),
    postedOn: z.string(),
    amountCents: z.int(),
    description: z.string().min(1),
  }),
} as const;

type EventType = keyof typeof EVENT_SCHEMAS;
type SeedEvent = z.output<(typeof EVENT_SCHEMAS)[EventType]>;

/** True when a `YYYY-MM-DD` string names a day that exists (`2026-02-30` does not). */
function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  // setUTCFullYear, unlike Date.UTC, does not map years 0–99 to 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const seedFileSchema = z.strictObject({
  seed: z.string().min(1),
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Expected YYYY-MM-DD" })
    .refine(isCalendarDate, { message: "Expected a real calendar date" }),
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

/**
 * Parses and validates a whole seed file without writing anything. Throws `AppError`
 * `Validation`, naming every problem: malformed JSON, a missing field, an unknown event type,
 * an event a use case would reject, a person or account key used twice, or an event naming a
 * person or account no earlier event created.
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
  const keys = new Set<string>();
  const accountKeys = new Set<string>();
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
    if (parsed.data.type === "person.created") {
      if (keys.has(parsed.data.key)) {
        problems.push(`events.${i}: person key "${parsed.data.key}" is used twice`);
      }
      keys.add(parsed.data.key);
    }
    if (parsed.data.type === "account.created") {
      if (accountKeys.has(parsed.data.key)) {
        problems.push(`events.${i}: account key "${parsed.data.key}" is used twice`);
      }
      accountKeys.add(parsed.data.key);
      for (const owner of parsed.data.owners) {
        if (!keys.has(owner.person)) {
          problems.push(`events.${i}: unknown owner "${owner.person}"`);
        }
      }
    }
    if (parsed.data.type === "transaction.created" && !accountKeys.has(parsed.data.account)) {
      problems.push(`events.${i}: unknown account "${parsed.data.account}"`);
    }
    events.push(parsed.data);
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
  readonly people?: Readonly<Record<string, string>>;
}

/**
 * Applies a seed file to a migrated database: validates all of it first, then runs each event
 * through its use case as `systemViewer("cli:seed")`, so every write is audited. Each event is
 * its own transaction.
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
  const ctx: UseCaseContext = {
    viewer: systemViewer("cli:seed"),
    clock: deps.clock,
    newId: deps.newId,
    uow,
  };
  const linked = options.people;
  const people: Record<string, string> = {};
  const accounts: Record<string, string> = {};
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
        });
        break;
      case "transaction.created":
        createTransaction(ctx, {
          accountId: accounts[event.account] as string,
          postedOn: event.postedOn,
          amountCents: event.amountCents,
          description: event.description,
        });
        break;
    }
  }
  return { seed: parsed.seed, today: parsed.today, events: parsed.events.length, people };
}

/**
 * The `seed` admin command's work: reads the seed file, maps its people (in `person.created`
 * order) onto the signed-up people with a login (oldest first), and applies its accounts and
 * transactions to them. The household is unchanged. `Validation` when fewer people have a login
 * than the seed has people; `Conflict` when the ledger already holds transactions.
 */
export function linkSeed(
  uow: UnitOfWork,
  deps: SeedDeps,
  seedJson: string,
): AppliedSeed & { readonly accounts: number } {
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
  const logins = listLogins(ctx);
  if (uow.read((repos) => repos.accounts.any()) || listTransactions(ctx).length > 0) {
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
    keys.map((key, i) => [key, (logins[i] as { personId: string }).personId]),
  );
  const applied = applyParsed(uow, deps, parsed, { people });
  return {
    ...applied,
    accounts: parsed.events.filter((event) => event.type === "account.created").length,
  };
}
