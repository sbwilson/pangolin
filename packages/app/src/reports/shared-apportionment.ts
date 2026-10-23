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

/** The input of `reports.sharedShare`: the range of `sharedApportionment`. */
export const sharedShareInput = sharedApportionmentInput;
export type SharedShareInput = z.input<typeof sharedShareInput>;

/** The shared total over a range and the viewer's own share of it. */
export interface SharedShare {
  readonly from: string;
  readonly to: string;
  readonly setting: SharedApportionment["setting"];
  readonly basis: ApportionBasis;
  readonly sharedCents: number;
  /** The viewer's apportioned share; 0 when they are not an active person. */
  readonly shareCents: number;
  /**
   * `shareCents` ÷ `sharedCents` as a whole percent, rounded half away from zero; null when the
   * shared total is zero or less.
   */
  readonly sharePercent: number | null;
}

/** `part` ÷ `whole` as an integer percent, half away from zero; null when `whole ≤ 0`. */
export function wholePercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  const n = BigInt(part) * 100n;
  const d = BigInt(whole);
  const magnitude = ((n < 0n ? -n : n) * 2n + d) / (2n * d);
  return Number(n < 0n ? -magnitude : magnitude) || 0;
}

/** The viewer's own apportioned share in cents (0 for a system viewer or a non-member). */
export function viewerShareCents(ctx: UseCaseContext, apportionment: SharedApportionment): number {
  if (ctx.viewer.kind !== "person") return 0;
  const me: string = ctx.viewer.personId;
  return apportionment.people.find((p) => p.personId === me)?.shareCents ?? 0;
}

/**
 * `reports.sharedShare`: the viewer's share of the shared total over `from`..`to` and its whole
 * percent, both worked out here (the web never sums or rounds money). The shared total and the
 * apportionment are the same for both partners (AD-7); only `shareCents` and `sharePercent` are
 * the viewer's own.
 */
export function sharedShare(ctx: UseCaseContext, input: SharedShareInput): SharedShare {
  const parsed = parseInput(sharedShareInput, input);
  const a = sharedApportionment(ctx, parsed);
  const shareCents = viewerShareCents(ctx, a);
  return {
    from: a.from,
    to: a.to,
    setting: a.setting,
    basis: a.basis,
    sharedCents: a.sharedCents,
    shareCents,
    sharePercent: wholePercent(shareCents, a.sharedCents),
  };
}
