// Budget evaluation job and schedule definitions (AD-8, AD-17, CAP-4).
import { z } from "zod";
import { defineJobKind, defineSchedule, type Schedule } from "../jobs/registry.ts";
import { dailyAt } from "../system/backups.ts";

/**
 * Daily evaluation of all budgets: raises or resolves over-budget review items. Local lane.
 */
export const BUDGET_EVALUATION_JOB = defineJobKind({
  kind: "budget-evaluation",
  schema: z.object({}).strict(),
  lane: "local",
  retry: { maxAttempts: 3, baseDelayMs: 60_000, maxDelayMs: 15 * 60_000 },
  externalEffects: false,
  needsPersonWhenDead: true,
  timeoutMs: 5 * 60_000,
});

export const BUDGET_EVALUATION_SCHEDULE_NAME = "budget-evaluation-daily";

/** Evaluation time of day in household time zone: 00:05 (beside closing balance sync). */
export const BUDGET_EVALUATION_TIME = { hour: 0, minute: 5 } as const;

/**
 * Creates the daily schedule for budget evaluation at 00:05 in household timezone.
 */
export function budgetEvaluationSchedule(timeZone: string): Schedule {
  return defineSchedule({
    name: BUDGET_EVALUATION_SCHEDULE_NAME,
    kind: BUDGET_EVALUATION_JOB,
    payload: {},
    next: dailyAt(timeZone, BUDGET_EVALUATION_TIME.hour, BUDGET_EVALUATION_TIME.minute),
  });
}
