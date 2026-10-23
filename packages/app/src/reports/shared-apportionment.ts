import { type ApportionBasis, apportion } from "@pangolin/domain";
import type { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import { rangeInput } from "./breakdown.ts";

/** The input of `reports.sharedApportionment`: an inclusive range of posting days, `from ≤ to`. */
export const sharedApportionmentInput = rangeInput({});
export type SharedApportionmentInput = z.input<typeof sharedApportionmentInput>;

/** The shared total over a range and each active person's share of it. */
export interface SharedApportionment {
  readonly from: string;
  readonly to: string;
  /** The household setting the shares followed. */
  readonly setting: "contribution" | "even";
  /** What the weights actually were; `even-fallback` is `contribution` with nothing contributed. */
  readonly basis: ApportionBasis;
  /** Minus the sum of shared `expense` splits on public accounts. */
  readonly sharedCents: number;
  /** One per active person, oldest first; `shareCents` sums exactly to `sharedCents`. */
  readonly people: readonly {
    readonly personId: string;
    readonly contributionCents: number;
    readonly shareCents: number;
  }[];
}

/**
 * `reports.sharedApportionment`: the shared total over `from`..`to` (inclusive) split across the
 * active people by contribution or evenly, per the household setting. Every input is summed in
 * SQL from public accounts only (AD-7), so both partners get byte-identical output whatever
 * private data either holds; the one rounding is `allocate` inside `domain.apportion` (AD-13).
 */
export function sharedApportionment(
  ctx: UseCaseContext,
  input: SharedApportionmentInput,
): SharedApportionment {
  const range = parseInput(sharedApportionmentInput, input);
  const today = ctx.clock.today().toString();
  const { setting, people, figures } = ctx.uow.read((repos) => ({
    setting: repos.householdSettings.get().sharedAttribution,
    people: repos.person.listActive().map((p) => p.id as string),
    figures: repos.transactions.sharedFigures(ctx.viewer, today, range),
  }));
  const contributionOf = (personId: string) =>
    figures.contributions.find((c) => c.personId === personId)?.cents ?? 0;
  const result =
    people.length === 0
      ? {
          basis: (setting === "even" ? "even" : "even-fallback") as ApportionBasis,
          shares: [],
        }
      : apportion({
          sharedCents: figures.sharedExpenseCents,
          contributions: figures.contributions,
          people,
          setting,
        });
  return {
    from: range.from,
    to: range.to,
    setting,
    basis: result.basis,
    sharedCents: figures.sharedExpenseCents,
    people: result.shares.map((s) => ({
      personId: s.personId,
      contributionCents: contributionOf(s.personId),
      shareCents: s.cents,
    })),
  };
}
