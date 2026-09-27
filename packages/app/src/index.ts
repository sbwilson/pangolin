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
export { type EnqueueOptions, enqueueJob } from "./jobs/enqueue.ts";
export {
  type ClaimInput,
  type CompleteInput,
  claimJob,
  completeJob,
  ensureSchedules,
  type FailInput,
  type FailOutcome,
  failJob,
  renewJobLease,
} from "./jobs/lifecycle.ts";
export {
  backoffMs,
  DEFAULT_RETRY,
  defineJobKind,
  defineSchedule,
  JOB_LANES,
  type JobContext,
  type JobHandler,
  type JobKind,
  type JobKindSpec,
  type JobRegistration,
  jobHandler,
  type RetryPolicy,
  type Schedule,
  scheduleKey,
} from "./jobs/registry.ts";
export type { Clock } from "./ports/clock.ts";
export type { SystemHealthPort } from "./ports/system-health.ts";
export type {
  AuditRepo,
  AuditRow,
  DeadJobRow,
  HouseholdSettingsRepo,
  HouseholdSettingsRow,
  JobLane,
  JobRepo,
  JobRow,
  JobStatus,
  PersonRepo,
  PersonRow,
  ReadRepos,
  ReviewItemRepo,
  ReviewItemRow,
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
  DEAD_JOBS_LIMIT,
  type DeadJob,
  type DeadJobsInput,
  deadJobs,
  deadJobsInput,
  type JobStatusContext,
} from "./system/job-status.ts";
export {
  defineReviewKind,
  JOB_DEAD_REVIEW,
  type ListReviewItemsInput,
  listReviewItems,
  listReviewItemsInput,
  type RaiseReviewItemInput,
  type ResolveReviewItemInput,
  type ReviewItem,
  type ReviewKind,
  type ReviewScope,
  raiseReviewItem,
  resolveReviewItem,
} from "./system/review-items.ts";
export {
  actorOf,
  type PersonViewer,
  personViewer,
  type SystemActor,
  type SystemViewer,
  type Viewer,
} from "./viewer.ts";
export { type Audit, type AuditEntry, write } from "./write.ts";
