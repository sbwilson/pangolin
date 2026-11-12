// Forecast assumption use cases (AD-22): the per-person editable rates behind the net-worth
// projection (8.5) and the assumption chips (8.7). Rates are integer basis points; nothing
// stored reads as neutral zeros, so an unedited projection stays flat until the person opts in.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";

/** One mortgage selection: a listed `home_loan` is paid down; `countOffset` nets its offsets. */
export interface ForecastAssumptionMortgage {
  readonly accountId: string;
  readonly countOffset: boolean;
}

/** The stored-or-default assumptions of one person, as the API and the chips read them. */
export interface ForecastAssumptions {
  readonly savingsRateBps: number;
  readonly returnLowBps: number;
  readonly returnMidBps: number;
  readonly returnHighBps: number;
  readonly superRateBps: number;
  readonly mortgages: readonly ForecastAssumptionMortgage[];
}

/** What nothing-stored means: neutral zeros and no mortgage rows (8.7 computes "changed" from this). */
export const FORECAST_ASSUMPTION_DEFAULTS: ForecastAssumptions = {
  savingsRateBps: 0,
  returnLowBps: 0,
  returnMidBps: 0,
  returnHighBps: 0,
  superRateBps: 0,
  mortgages: [],
};

/** A rate in basis points: integer, 0..10000 — the same bounds as the table's CHECKs. */
const bps = z.number().int().min(0).max(10_000);

export const getForecastAssumptionsInput = z.object({}).strict();
export type GetForecastAssumptionsInput = z.input<typeof getForecastAssumptionsInput>;

export const upsertForecastAssumptionsInput = z
  .object({
    personId: z.string().optional(),
    savingsRateBps: bps.optional(),
    returnLowBps: bps.optional(),
    returnMidBps: bps.optional(),
    returnHighBps: bps.optional(),
    superRateBps: bps.optional(),
    mortgages: z
      .array(z.object({ accountId: z.string().min(1), countOffset: z.boolean() }).strict())
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.mortgages === undefined ||
      new Set(data.mortgages.map((m) => m.accountId)).size === data.mortgages.length,
    { message: "mortgages must not list the same accountId twice", path: ["mortgages"] },
  );
export type UpsertForecastAssumptionsInput = z.input<typeof upsertForecastAssumptionsInput>;

/**
 * `planning.getForecastAssumptions`: the signed-in person's stored assumptions, defaulting to
 * zeros and an empty mortgage list when nothing is stored. Writes nothing.
 * Per AD-22 only the person ever reads their own row.
 */
export function getForecastAssumptions(
  ctx: UseCaseContext,
  input: GetForecastAssumptionsInput = {},
): ForecastAssumptions {
  parseInput(getForecastAssumptionsInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");

  return ctx.uow.read((repos) => {
    const row = repos.forecastAssumptions.get(viewer, viewer.personId);
    if (row === undefined) return { ...FORECAST_ASSUMPTION_DEFAULTS, mortgages: [] };
    const mortgages = repos.forecastAssumptions
      .listMortgages(viewer, viewer.personId)
      .map((m) => ({ accountId: m.accountId, countOffset: m.countOffset }));
    return {
      savingsRateBps: row.savingsRateBps,
      returnLowBps: row.returnLowBps,
      returnMidBps: row.returnMidBps,
      returnHighBps: row.returnHighBps,
      superRateBps: row.superRateBps,
      mortgages,
    };
  });
}

/**
 * `planning.upsertForecastAssumptions`: partial-merges the scalar rates (omitted keeps the
 * existing value) and replaces the mortgage list wholesale when present, auditing one row in
 * the same transaction. Per AD-22 a person writes only their own; `personId` names someone
 * else only for the system viewer (the seed), and every listed account must be a `home_loan`
 * the viewer can see.
 */
export function upsertForecastAssumptions(
  ctx: UseCaseContext,
  input: UpsertForecastAssumptionsInput,
): ForecastAssumptions {
  const parsed = parseInput(upsertForecastAssumptionsInput, input);
  const targetPersonId =
    parsed.personId ?? (ctx.viewer.kind === "person" ? ctx.viewer.personId : undefined);

  if (!targetPersonId) {
    throw new AppError("Validation", "personId is required for system viewer");
  }

  if (ctx.viewer.kind === "person" && ctx.viewer.personId !== targetPersonId) {
    throw new AppError("NotFound", "Forecast assumptions not found");
  }

  return write(ctx, (tx, audit) => {
    // Verify target person exists
    const persons = tx.person.listActive();
    const personExists = persons.some((p) => p.id === targetPersonId);
    if (!personExists) {
      throw new AppError("Validation", "Person does not exist");
    }

    // Every listed loan must be a visible `home_loan`, checked before anything is written.
    if (parsed.mortgages !== undefined) {
      for (const mortgage of parsed.mortgages) {
        const account = tx.accounts.findVisible(ctx.viewer, mortgage.accountId);
        if (account === undefined || account.type !== "home_loan") {
          throw new AppError("NotFound", "Mortgage account not found");
        }
      }
    }

    const personId = targetPersonId as Id<"Person">;
    const existing = tx.forecastAssumptions.get(ctx.viewer, personId);
    const before: ForecastAssumptions | null =
      existing === undefined
        ? null
        : {
            savingsRateBps: existing.savingsRateBps,
            returnLowBps: existing.returnLowBps,
            returnMidBps: existing.returnMidBps,
            returnHighBps: existing.returnHighBps,
            superRateBps: existing.superRateBps,
            mortgages: tx.forecastAssumptions
              .listMortgages(ctx.viewer, personId)
              .map((m) => ({ accountId: m.accountId, countOffset: m.countOffset })),
          };

    const after: ForecastAssumptions = {
      savingsRateBps: parsed.savingsRateBps ?? existing?.savingsRateBps ?? 0,
      returnLowBps: parsed.returnLowBps ?? existing?.returnLowBps ?? 0,
      returnMidBps: parsed.returnMidBps ?? existing?.returnMidBps ?? 0,
      returnHighBps: parsed.returnHighBps ?? existing?.returnHighBps ?? 0,
      superRateBps: parsed.superRateBps ?? existing?.superRateBps ?? 0,
      mortgages: parsed.mortgages ?? before?.mortgages ?? [],
    };

    const now = formatInstant(ctx.clock.now());
    tx.forecastAssumptions.upsert({
      personId,
      savingsRateBps: after.savingsRateBps,
      returnLowBps: after.returnLowBps,
      returnMidBps: after.returnMidBps,
      returnHighBps: after.returnHighBps,
      superRateBps: after.superRateBps,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (parsed.mortgages !== undefined) {
      tx.forecastAssumptions.replaceMortgages(
        personId,
        parsed.mortgages.map((m) => ({
          personId,
          accountId: m.accountId as Id<"Account">,
          countOffset: m.countOffset,
        })),
      );
    }

    audit({
      entity: "forecast_assumption",
      entityId: personId,
      personId,
      action: "update",
      before,
      after,
    });

    return after;
  });
}
