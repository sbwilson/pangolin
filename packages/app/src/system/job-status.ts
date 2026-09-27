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
