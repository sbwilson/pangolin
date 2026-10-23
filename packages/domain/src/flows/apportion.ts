// The one apportioner of shared spending (AD-7, AD-13): splits the shared total across the people
// by contribution, or evenly. The only rounding is `allocate`, so the shares sum exactly.
import { allocate, type Cents } from "@pangolin/shared";

/** How the shared total is split: by what each person put in, or evenly. */
export type ApportionSetting = "contribution" | "even";

/** What the shares were actually based on. `even-fallback`: `contribution` with nothing put in. */
export type ApportionBasis = "contribution" | "even" | "even-fallback";

export interface ApportionInput {
  /** The shared total, in cents (may be negative or zero). */
  readonly sharedCents: number;
  /** Each person's contribution in cents; anyone not in `people` is ignored. */
  readonly contributions: readonly { readonly personId: string; readonly cents: number }[];
  /** The people to apportion across, in a stable order (remainder ties go to the earlier). */
  readonly people: readonly string[];
  readonly setting: ApportionSetting;
}

export interface Apportionment {
  readonly basis: ApportionBasis;
  /** One entry per person in `people`, in order; the cents sum exactly to `sharedCents`. */
  readonly shares: readonly { readonly personId: string; readonly cents: number }[];
}

/**
 * Shares of `sharedCents` per person. Under `contribution` the weights are each person's
 * contribution (a negative one counts as zero); when they total zero the weights are equal.
 * Under `even` they are equal. Throws `RangeError` without any people.
 */
export function apportion(input: ApportionInput): Apportionment {
  const { people } = input;
  if (people.length === 0) throw new RangeError("apportion: people must not be empty");
  const contributed = people.map((personId) =>
    Math.max(
      0,
      input.contributions
        .filter((c) => c.personId === personId)
        .reduce((sum, c) => sum + c.cents, 0),
    ),
  );
  const total = contributed.reduce((sum, c) => sum + c, 0);
  const byContribution = input.setting === "contribution" && total > 0;
  const weights = byContribution ? contributed : people.map(() => 1);
  const parts = allocate(input.sharedCents as Cents, weights);
  return {
    basis: byContribution ? "contribution" : input.setting === "even" ? "even" : "even-fallback",
    shares: people.map((personId, i) => ({ personId, cents: parts[i] as number })),
  };
}
