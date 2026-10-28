// Core: branded types, Zod schemas and money helpers.
// `period` and `temporal` are separate entry points: `@pangolin/shared/period`, `@pangolin/shared/temporal`.
export { type Id, idSchema, isUlid, ULID_RE } from "./ids.ts";
export { allocate, type Cents, cents, centsSchema, toCents } from "./money.ts";
export { isVisionCapableModel } from "./vision-models.ts";

/** The longest query a transaction search takes. */
export const SEARCH_QUERY_MAX = 200;
