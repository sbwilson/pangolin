// Money (AD-13). `toCents` and `allocate` are the only two functions that round money.
import { Decimal } from "decimal.js";
import { z } from "zod";

declare const centsBrand: unique symbol;

/** An integer number of cents, always a safe integer. Serialised as a JSON number. */
export type Cents = number & { readonly [centsBrand]: "Cents" };

/** Brands a safe integer as `Cents`; throws `RangeError` for anything else. Never rounds. */
export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Cents must be a safe integer, got ${value}`);
  }
  // Normalise -0 so it never leaks into JSON or equality checks.
  return (value === 0 ? 0 : value) as Cents;
}

/** Zod schema for a `Cents` value on the wire: a safe integer. */
export const centsSchema = z.int().transform((value) => cents(value));

/**
 * Splits `total` into parts proportional to `weights` with the largest-remainder method.
 * The parts always sum exactly to `total`. Remainder ties go to the earlier index.
 * A negative total is allocated as its magnitude, then each part is negated.
 *
 * Weights must be non-negative safe integers (shares, basis points), at least one positive;
 * otherwise this throws `RangeError`.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`allocate: total must be a safe integer, got ${total}`);
  }
  if (weights.length === 0) {
    throw new RangeError("allocate: weights must not be empty");
  }
  let weightSum = 0n;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`allocate: weights must be non-negative safe integers, got ${weight}`);
    }
    weightSum += BigInt(weight);
  }
  if (weightSum === 0n) {
    throw new RangeError("allocate: at least one weight must be positive");
  }

  const negative = total < 0;
  const magnitude = BigInt(negative ? -total : total);

  const parts: bigint[] = [];
  const remainders: bigint[] = [];
  let assigned = 0n;
  for (const weight of weights) {
    const product = magnitude * BigInt(weight);
    const part = product / weightSum;
    parts.push(part);
    remainders.push(product % weightSum);
    assigned += part;
  }

  // Fewer leftover cents than parts, so each part gets at most one.
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  let leftover = Number(magnitude - assigned);
  for (const { index } of order) {
    if (leftover === 0) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    leftover--;
  }

  return parts.map((part) => cents(Number(negative ? -part : part)));
}

/** Private decimal context: enough precision for any money maths, rounding half-even. */
const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

const DECIMAL_STRING_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const MAX_SAFE = new MoneyDecimal(Number.MAX_SAFE_INTEGER);

/**
 * Converts an amount in currency units (dollars) to `Cents`, rounding half-even.
 * Takes a `decimal.js` value or a plain decimal string such as `"12.345"`; never a float.
 * Throws `RangeError` for a malformed or non-finite amount, or one beyond safe-integer cents.
 */
export function toCents(amount: Decimal | string): Cents {
  if (typeof amount === "string" && !DECIMAL_STRING_RE.test(amount)) {
    throw new RangeError(`toCents: not a decimal string: ${JSON.stringify(amount)}`);
  }
  const value = new MoneyDecimal(amount);
  if (!value.isFinite()) {
    throw new RangeError(`toCents: amount must be finite, got ${value.toString()}`);
  }
  // Round to whole cents first: toDecimalPlaces is exact at any input length, whereas a
  // multiply first would round to `precision` significant digits and could round twice.
  // Scaling a two-decimal value by 100 is then exact within the safe-integer range.
  const rounded = value.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN).times(100);
  if (rounded.abs().greaterThan(MAX_SAFE)) {
    throw new RangeError(`toCents: ${value.toString()} is beyond safe-integer cents`);
  }
  return cents(rounded.toNumber());
}
