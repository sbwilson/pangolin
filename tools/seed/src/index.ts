// The synthetic household generator (AD-15). Pure: it emits data; the server's admin entry
// applies it through `app` use cases.
export type { Json, ModuleOutput, SeedModule } from "./module.ts";
export { balanceSnapshots } from "./modules/balance-snapshots.ts";
export { ACCOUNT_KEYS, INSTITUTION_KEYS } from "./modules/catalogue.ts";
export { classification } from "./modules/classification.ts";
export { defaultModules } from "./modules/index.ts";
export { institutionsAndAccounts } from "./modules/institutions-and-accounts.ts";
export { ledgerTransactions } from "./modules/ledger-transactions.ts";
export { PERSON_KEYS, peopleAndHousehold } from "./modules/people-and-household.ts";
export { transfersAndPrivacy } from "./modules/transfers-and-privacy.ts";
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
  type BalanceRecordedEvent,
  type CategoryRef,
  type EmittedEvent,
  emptyWorld,
  type HouseholdSettingsEvent,
  type InstitutionCreatedEvent,
  type NameHiddenEvent,
  type PayeeCreatedEvent,
  type PersonCreatedEvent,
  type SeedEvent,
  type SeedSplit,
  type TagCreatedEvent,
  type TransactionCreatedEvent,
  type TransferGroupedEvent,
  type World,
  type WorldAccount,
  type WorldAccountOwner,
  type WorldBill,
  type WorldHousehold,
  type WorldInstitution,
  type WorldMerchant,
  type WorldPayAnchor,
  type WorldPayee,
  type WorldPerson,
  type WorldTag,
  type WorldTransaction,
} from "./world.ts";
