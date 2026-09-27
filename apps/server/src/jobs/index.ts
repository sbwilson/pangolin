// The jobs entry (AD-8): the runner and the production registry of kinds and schedules.
import type { JobRegistration, Schedule } from "@pangolin/app";

export {
  createRunner,
  DEFAULT_CONCURRENCY,
  DEFAULT_LEASE_MS,
  type LaneConcurrency,
  type Runner,
  type RunnerLog,
  type RunnerOptions,
} from "./runner.ts";

/** Every job kind this build can run, each with its handler. Later stories add theirs here. */
export const jobKinds: readonly JobRegistration[] = [];

/** Every recurring schedule. Empty until story 1.10 and later add schedules. */
export const schedules: readonly Schedule[] = [];
