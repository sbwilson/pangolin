// Every seed module, in any order (the runner sorts by dependencies). Later epics append theirs.
import type { SeedModule } from "../module.ts";
import { balanceSnapshots } from "./balance-snapshots.ts";
import { classification } from "./classification.ts";
import { institutionsAndAccounts } from "./institutions-and-accounts.ts";
import { ledgerTransactions } from "./ledger-transactions.ts";
import { peopleAndHousehold } from "./people-and-household.ts";
import { transfersAndPrivacy } from "./transfers-and-privacy.ts";

export const defaultModules: readonly SeedModule[] = [
  peopleAndHousehold,
  institutionsAndAccounts,
  classification,
  ledgerTransactions,
  transfersAndPrivacy,
  balanceSnapshots,
];
