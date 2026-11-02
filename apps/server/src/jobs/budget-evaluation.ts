// The budget-evaluation server job: runs daily evaluation of all budgets and bill alerts (AD-8, AD-17, CAP-4, CAP-5).
import {
  BUDGET_EVALUATION_JOB,
  type JobRegistration,
  jobHandler,
  syncAllBillAlertReviewItems,
  syncAllBudgetReviewItems,
} from "@pangolin/app";

export function budgetEvaluationJobs(): JobRegistration[] {
  return [
    jobHandler(BUDGET_EVALUATION_JOB, async (ctx) => {
      syncAllBudgetReviewItems(ctx);
      syncAllBillAlertReviewItems(ctx);
    }),
  ];
}
