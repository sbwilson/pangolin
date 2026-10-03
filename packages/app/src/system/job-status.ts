import { z } from "zod";
import { parseInput } from "../errors.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";

/** The status page reads the job table only through this (AD-9). No viewer: it shows no data. */
export interface JobStatusContext {
  readonly uow: Pick<UnitOfWork, "read">;
}

/** A dead job: its kind and when it failed, never its payload, error text or ID (AD-9). */
export interface DeadJob {
  readonly kind: string;
  readonly failedAt: string;
}

export const DEAD_JOBS_LIMIT = 50;

export const deadJobsInput = z.object({}).strict();
export type DeadJobsInput = z.input<typeof deadJobsInput>;

/** `system.deadJobs`: dead jobs, newest failure first, at most 50. */
export function deadJobs(ctx: JobStatusContext, input: DeadJobsInput = {}): DeadJob[] {
  parseInput(deadJobsInput, input);
  return ctx.uow
    .read((repos) => repos.jobs.listDead(DEAD_JOBS_LIMIT))
    .map((row) => ({ kind: row.kind, failedAt: row.failedAt }));
}

/** A pending job: its kind and when it is due, never its payload or ID (AD-9). */
export interface PendingJob {
  readonly kind: string;
  readonly runAt: string;
}

/** A running job: its kind and when its lease ends, never its payload or ID (AD-9). */
export interface RunningJob {
  readonly kind: string;
  readonly leaseExpiresAt: string;
}

export const QUEUED_JOBS_LIMIT = 10;

export const pendingJobsInput = z.object({}).strict();
export type PendingJobsInput = z.input<typeof pendingJobsInput>;

/** `system.pendingJobs`: pending jobs, soonest due first, at most 10, for `pangolin status`. */
export function pendingJobs(ctx: JobStatusContext, input: PendingJobsInput = {}): PendingJob[] {
  parseInput(pendingJobsInput, input);
  return ctx.uow
    .read((repos) => repos.jobs.listPending(QUEUED_JOBS_LIMIT))
    .map((row) => ({ kind: row.kind, runAt: row.runAt }));
}

export const runningJobsInput = z.object({}).strict();
export type RunningJobsInput = z.input<typeof runningJobsInput>;

/** `system.runningJobs`: running jobs, soonest lease end first, at most 10. */
export function runningJobs(ctx: JobStatusContext, input: RunningJobsInput = {}): RunningJob[] {
  parseInput(runningJobsInput, input);
  return ctx.uow
    .read((repos) => repos.jobs.listRunning(QUEUED_JOBS_LIMIT))
    .map((row) => ({ kind: row.kind, leaseExpiresAt: row.leaseExpiresAt }));
}

/** How many jobs wait, run and have died: counts only, never a kind or payload (AD-9). */
export interface JobCounts {
  readonly pending: number;
  readonly running: number;
  readonly dead: number;
}

export const jobCountsInput = z.object({}).strict();
export type JobCountsInput = z.input<typeof jobCountsInput>;

/** `system.jobCounts`: the number of pending, running and dead jobs, for `pangolin status`. */
export function jobCounts(ctx: JobStatusContext, input: JobCountsInput = {}): JobCounts {
  parseInput(jobCountsInput, input);
  const counts = ctx.uow.read((repos) => repos.jobs.countByStatus());
  return { pending: counts.pending, running: counts.running, dead: counts.dead };
}
