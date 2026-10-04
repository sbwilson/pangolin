// Every seed module, in any order (the runner sorts by dependencies). Later epics append theirs.
import type { SeedModule } from "../module.ts";
import { accounts } from "./accounts.ts";
import { peopleAndHousehold } from "./people-and-household.ts";

export const defaultModules: readonly SeedModule[] = [peopleAndHousehold, accounts];
