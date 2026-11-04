// Goals and savings allocation schemas (AD-10, AD-22, CAP-6, CAP-7).
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { person } from "./person.ts";
import { transaction } from "./transaction.ts";

/**
 * Allocation stages (CAP-6): ordered stages of goal rules.
 * person_id is null for shared pool, person ID for personal pool (AD-22).
 */
export const allocationStage = sqliteTable(
  "allocation_stage",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").references(() => person.id),
    name: text("name").notNull(),
    sort: integer("sort").notNull(),
    exitGoalId: text("exit_goal_id"), // FK to goal.id added logically / circular reference
    fallbackThresholdBp: integer("fallback_threshold_bp").notNull().default(8000),
    completedSharePolicy: text("completed_share_policy", {
      enum: ["rescale", "buffer"],
    })
      .notNull()
      .default("rescale"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("allocation_stage_person_idx").on(t.personId),
    index("allocation_stage_sort_idx").on(t.sort),
    check(
      "allocation_stage_fallback_threshold_bp",
      sql`${t.fallbackThresholdBp} >= 0 AND ${t.fallbackThresholdBp} <= 10000`,
    ),
    check(
      "allocation_stage_completed_share_policy",
      sql`${t.completedSharePolicy} IN ('rescale', 'buffer')`,
    ),
  ],
);

/**
 * Goal table (CAP-6): savings targets per pool.
 * person_id = null for shared pool, person ID for personal pool (AD-22).
 * At most one emergency fund per pool: UNIQUE(person_id) WHERE is_emergency_fund = 1.
 */
export const goal = sqliteTable(
  "goal",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").references(() => person.id),
    name: text("name").notNull(),
    targetCents: integer("target_cents").notNull(),
    targetDate: text("target_date"), // YYYY-MM-DD
    priority: integer("priority").notNull().default(0),
    kind: text("kind", { enum: ["flexible", "protected"] })
      .notNull()
      .default("flexible"),
    isEmergencyFund: integer("is_emergency_fund", { mode: "boolean" }).notNull().default(false),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("goal_person_idx").on(t.personId),
    check("goal_target_cents", sql`${t.targetCents} > 0`),
    check("goal_kind", sql`${t.kind} IN ('flexible', 'protected')`),
    check("goal_is_emergency_fund", sql`${t.isEmergencyFund} IN (0, 1)`),
    // Partial unique index enforcing at most one emergency fund per person (and shared pool where person_id is null)
    uniqueIndex("goal_emergency_fund_idx")
      .on(sql`coalesce(${t.personId}, '__shared__')`)
      .where(sql`${t.isEmergencyFund} = 1`),
  ],
);

/**
 * Goal rule (CAP-6): % share of period positive savings allocated to a goal.
 * share_bp in 0..10000.
 */
export const goalRule = sqliteTable(
  "goal_rule",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id")
      .notNull()
      .references(() => goal.id),
    stageId: text("stage_id")
      .notNull()
      .references(() => allocationStage.id),
    shareBp: integer("share_bp").notNull(),
    effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD
    effectiveUntil: text("effective_until"), // YYYY-MM-DD nullable
    source: text("source", { enum: ["rule", "shortfall_override"] })
      .notNull()
      .default("rule"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("goal_rule_goal_idx").on(t.goalId),
    index("goal_rule_stage_idx").on(t.stageId),
    check("goal_rule_share_bp", sql`${t.shareBp} >= 0 AND ${t.shareBp} <= 10000`),
    check("goal_rule_source", sql`${t.source} IN ('rule', 'shortfall_override')`),
  ],
);

/**
 * Goal allocation (CAP-6): Virtual money assigned per closed period.
 */
export const goalAllocation = sqliteTable(
  "goal_allocation",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id")
      .notNull()
      .references(() => goal.id),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD
    allocatedCents: integer("allocated_cents").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("goal_allocation_goal_idx").on(t.goalId),
    index("goal_allocation_period_idx").on(t.periodStart),
  ],
);

/**
 * Goal drawdown (CAP-7, AD-24): One confirmed cover across goals.
 */
export const goalDrawdown = sqliteTable(
  "goal_drawdown",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").references(() => person.id),
    reason: text("reason", { enum: ["large_purchase", "shortfall"] }).notNull(),
    label: text("label").notNull(),
    amountCents: integer("amount_cents").notNull(),
    transactionId: text("transaction_id").references(() => transaction.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => person.id),
    createdAt: text("created_at").notNull(),
    undoneAt: text("undone_at"),
  },
  (t) => [
    index("goal_drawdown_person_idx").on(t.personId),
    index("goal_drawdown_transaction_idx").on(t.transactionId),
    check("goal_drawdown_reason", sql`${t.reason} IN ('large_purchase', 'shortfall')`),
    check("goal_drawdown_amount_cents", sql`${t.amountCents} > 0`),
  ],
);

/**
 * Goal adjustment (CAP-7): One goal's debit within a drawdown.
 */
export const goalAdjustment = sqliteTable(
  "goal_adjustment",
  {
    id: text("id").primaryKey(),
    drawdownId: text("drawdown_id")
      .notNull()
      .references(() => goalDrawdown.id),
    goalId: text("goal_id")
      .notNull()
      .references(() => goal.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [
    index("goal_adjustment_drawdown_idx").on(t.drawdownId),
    index("goal_adjustment_goal_idx").on(t.goalId),
    check("goal_adjustment_amount_cents", sql`${t.amountCents} > 0`),
  ],
);

/**
 * Planning setting (CAP-7): Per-pool planning settings (threshold for large withdrawals).
 */
export const planningSetting = sqliteTable(
  "planning_setting",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").references(() => person.id),
    largeWithdrawalThresholdCents: integer("large_withdrawal_threshold_cents")
      .notNull()
      .default(200000), // $2,000 default
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("planning_setting_person_idx").on(t.personId),
    check("planning_setting_threshold_cents", sql`${t.largeWithdrawalThresholdCents} > 0`),
  ],
);
