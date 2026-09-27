// Entity IDs (AD-5): ULID strings branded per entity. Only the types and parsers live here;
// IDs are minted on the server only, by `newId` in `@pangolin/app`.
import { z } from "zod";

declare const idBrand: unique symbol;

/** A ULID string branded with its entity, e.g. `Id<"Account">`. Brands do not mix. */
export type Id<B extends string> = string & { readonly [idBrand]: B };

/** 26 uppercase Crockford base32 characters; the first is at most 7 (a 48-bit timestamp). */
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** True when `value` is a canonical ULID string. */
export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/**
 * Zod schema that parses a string into an `Id<B>`. Only canonical ULIDs pass; lowercase or
 * ambiguous characters (I, L, O, U) are rejected, not normalised. `brand` names the entity.
 */
export function idSchema<B extends string>(brand: B) {
  return z
    .string()
    .regex(ULID_RE, { message: `Expected a ${brand} ID (ULID)` })
    .transform((value) => value as Id<B>);
}
