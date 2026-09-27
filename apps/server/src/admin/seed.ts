// The seed loader (AD-15 bootstrap): applies a `seed.json` written by `tools/seed` through the
// `app` use cases, as `cli:seed`. The whole file is validated before the first write.
import {
  AppError,
  type Clock,
  createPerson,
  createPersonInput,
  type IdGenerator,
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
 * an event a use case would reject, or a person key used twice.
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
    events.push(parsed.data);
  });
  if (problems.length > 0) throw invalid(problems);
  return { seed: file.data.seed, today: file.data.today, events };
}

/**
 * Applies a seed file to a migrated database: validates all of it first, then runs each event
 * through its use case as `systemViewer("cli:seed")`, so every write is audited. Each event is
 * its own transaction.
 */
export function applySeed(uow: UnitOfWork, deps: SeedDeps, seedJson: string): AppliedSeed {
  const parsed = parseSeed(seedJson);
  const ctx: UseCaseContext = {
    viewer: systemViewer("cli:seed"),
    clock: deps.clock,
    newId: deps.newId,
    uow,
  };
  const people: Record<string, string> = {};
  for (const event of parsed.events) {
    switch (event.type) {
      case "person.created":
        people[event.key] = createPerson(ctx, {
          displayName: event.displayName,
          colour: event.colour,
        });
        break;
      case "household.settings":
        updateHouseholdSettings(ctx, {
          timezone: event.timezone,
          baseCurrency: event.baseCurrency,
          sharedAttribution: event.sharedAttribution,
        });
        break;
    }
  }
  return { seed: parsed.seed, today: parsed.today, events: parsed.events.length, people };
}
