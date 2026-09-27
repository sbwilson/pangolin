// The package root. `systemViewer` is deliberately absent: it is exported only from
// `@pangolin/app/system-viewer`, which lint bans outside `apps/server/src/{jobs,admin}` (AD-6).
export { fixedClock, fixedClockAt, systemClock } from "./clock.ts";
export type { UseCaseContext } from "./context.ts";
export {
  AppError,
  ERROR_CODES,
  type ErrorBody,
  type ErrorCode,
  errorBody,
  parseInput,
  validationError,
} from "./errors.ts";
export {
  type CreatePersonInput,
  createPerson,
  createPersonInput,
} from "./identity/create-person.ts";
export { createIdGenerator, type IdGenerator, type IdSources, newId } from "./ids.ts";
export type { Clock } from "./ports/clock.ts";
export type { SystemHealthPort } from "./ports/system-health.ts";
export type {
  AuditRepo,
  AuditRow,
  HouseholdSettingsRepo,
  HouseholdSettingsRow,
  PersonRepo,
  PersonRow,
  ReadRepos,
  TxRepos,
  UnitOfWork,
} from "./ports/unit-of-work.ts";
export {
  type HealthContext,
  type HealthInput,
  type HealthOutput,
  health,
  healthInput,
} from "./system/health.ts";
export {
  type GetHouseholdSettingsInput,
  getHouseholdSettings,
  getHouseholdSettingsInput,
  type HouseholdSettings,
  type UpdateHouseholdSettingsInput,
  updateHouseholdSettings,
  updateHouseholdSettingsInput,
} from "./system/household-settings.ts";
export {
  actorOf,
  type PersonViewer,
  personViewer,
  type SystemActor,
  type SystemViewer,
  type Viewer,
} from "./viewer.ts";
export { type Audit, type AuditEntry, write } from "./write.ts";
