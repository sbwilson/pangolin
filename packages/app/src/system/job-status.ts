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
