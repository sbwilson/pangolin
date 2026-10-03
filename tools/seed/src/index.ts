// The synthetic household generator (AD-15). Pure: it emits data; the server's admin entry
// applies it through `app` use cases.
export type { Json, ModuleOutput, SeedModule } from "./module.ts";
export { ACCOUNT_KEYS, accounts } from "./modules/accounts.ts";
export { defaultModules } from "./modules/index.ts";
export { PERSON_KEYS, peopleAndHousehold } from "./modules/people-and-household.ts";
export { createRng, hash128, type Rng, rngFor, sfc32 } from "./rng.ts";
export {
  DEFAULT_SEED,
  DEFAULT_TODAY,
  orderModules,
  type RunOptions,
  runSeed,
  type SeedOutput,
} from "./run.ts";
export { serialize } from "./serialize.ts";
export {
  type AccountCreatedEvent,
  applyEvent,
  type EmittedEvent,
  emptyWorld,
  type HouseholdSettingsEvent,
  type PersonCreatedEvent,
  type SeedEvent,
  type TransactionCreatedEvent,
  type World,
  type WorldAccount,
  type WorldAccountOwner,
  type WorldBill,
  type WorldHousehold,
  type WorldMerchant,
  type WorldPayAnchor,
  type WorldPerson,
} from "./world.ts";
