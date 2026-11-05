import type {
  AllocationStagePolicy,
  AllocationStageRepo,
  AllocationStageRow,
  GoalAllocationRepo,
  GoalAllocationRow,
  GoalKind,
  GoalRepo,
  GoalRow,
  GoalRuleRepo,
  GoalRuleRow,
  GoalRuleSource,
  Id,
  PlanningSettingRepo,
  PlanningSettingRow,
  Viewer,
} from "@pangolin/app";
import { and, asc, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  allocationStage,
  goal,
  goalAllocation,
  goalRule,
  planningSetting,
} from "../schema/goal.ts";

type Orm = BetterSQLite3Database;

function isPersonVisible(viewer: Viewer, personId: string | null): boolean {
  if (viewer.kind === "system") return true;
  if (personId === null) return true;
  return viewer.personId === personId;
}

function goalVisibilityPredicate(viewer: Viewer): SQL | undefined {
  if (viewer.kind === "system") return undefined;
  if (viewer.personId) {
    return or(isNull(goal.personId), eq(goal.personId, viewer.personId));
  }
  return isNull(goal.personId);
}

export function createGoalRepo(orm: Orm, check: () => void): GoalRepo {
  return {
    insert: (row: GoalRow) => {
      check();
      orm
        .insert(goal)
        .values({
          id: row.id,
          personId: row.personId,
          name: row.name,
          targetCents: row.targetCents,
          targetDate: row.targetDate,
          priority: row.priority,
          kind: row.kind,
          isEmergencyFund: row.isEmergencyFund,
          completedAt: row.completedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },

    update: (row: GoalRow) => {
      check();
      const res = orm
        .update(goal)
        .set({
          personId: row.personId,
          name: row.name,
          targetCents: row.targetCents,
          targetDate: row.targetDate,
          priority: row.priority,
          kind: row.kind,
          isEmergencyFund: row.isEmergencyFund,
          completedAt: row.completedAt,
          updatedAt: row.updatedAt,
        })
        .where(eq(goal.id, row.id))
        .run();
      return res.changes > 0;
    },

    delete: (id: Id<"Goal">) => {
      check();
      const res = orm.delete(goal).where(eq(goal.id, id)).run();
      return res.changes > 0;
    },

    findById: (viewer: Viewer, id: Id<"Goal">) => {
      check();
      const row = orm.select().from(goal).where(eq(goal.id, id)).get();
      if (!row) return undefined;
      if (!isPersonVisible(viewer, row.personId)) return undefined;
      return {
        ...row,
        kind: row.kind as GoalKind,
      } as GoalRow;
    },

    listVisible: (viewer: Viewer) => {
      check();
      if (viewer.kind === "system") {
        return orm
          .select()
          .from(goal)
          .orderBy(asc(goal.priority), asc(goal.createdAt))
          .all() as GoalRow[];
      }
      return orm
        .select()
        .from(goal)
        .where(sql`${goal.personId} IS NULL OR ${goal.personId} = ${viewer.personId}`)
        .orderBy(asc(goal.priority), asc(goal.createdAt))
        .all() as GoalRow[];
    },

    deleteForPerson: (personId: Id<"Person">) => {
      check();
      orm.delete(goal).where(eq(goal.personId, personId)).run();
    },
  };
}

export function createAllocationStageRepo(orm: Orm, check: () => void): AllocationStageRepo {
  return {
    insert: (row: AllocationStageRow) => {
      check();
      orm
        .insert(allocationStage)
        .values({
          id: row.id,
          personId: row.personId,
          name: row.name,
          sort: row.sort,
          exitGoalId: row.exitGoalId,
          fallbackThresholdBp: row.fallbackThresholdBp,
          completedSharePolicy: row.completedSharePolicy,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },

    update: (row: AllocationStageRow) => {
      check();
      const res = orm
        .update(allocationStage)
        .set({
          personId: row.personId,
          name: row.name,
          sort: row.sort,
          exitGoalId: row.exitGoalId,
          fallbackThresholdBp: row.fallbackThresholdBp,
          completedSharePolicy: row.completedSharePolicy,
          updatedAt: row.updatedAt,
        })
        .where(eq(allocationStage.id, row.id))
        .run();
      return res.changes > 0;
    },

    delete: (id: Id<"AllocationStage">) => {
      check();
      const res = orm.delete(allocationStage).where(eq(allocationStage.id, id)).run();
      return res.changes > 0;
    },

    findById: (viewer: Viewer, id: Id<"AllocationStage">) => {
      check();
      const row = orm.select().from(allocationStage).where(eq(allocationStage.id, id)).get();
      if (!row) return undefined;
      if (!isPersonVisible(viewer, row.personId)) return undefined;
      return {
        ...row,
        completedSharePolicy: row.completedSharePolicy as AllocationStagePolicy,
      } as AllocationStageRow;
    },

    listVisible: (viewer: Viewer) => {
      check();
      if (viewer.kind === "system") {
        return orm
          .select()
          .from(allocationStage)
          .orderBy(asc(allocationStage.sort))
          .all() as AllocationStageRow[];
      }
      return orm
        .select()
        .from(allocationStage)
        .where(
          sql`${allocationStage.personId} IS NULL OR ${allocationStage.personId} = ${viewer.personId}`,
        )
        .orderBy(asc(allocationStage.sort))
        .all() as AllocationStageRow[];
    },

    deleteForPerson: (personId: Id<"Person">) => {
      check();
      orm.delete(allocationStage).where(eq(allocationStage.personId, personId)).run();
    },
  };
}

export function createGoalRuleRepo(orm: Orm, check: () => void): GoalRuleRepo {
  return {
    insert: (row: GoalRuleRow) => {
      check();
      orm
        .insert(goalRule)
        .values({
          id: row.id,
          goalId: row.goalId,
          stageId: row.stageId,
          shareBp: row.shareBp,
          effectiveFrom: row.effectiveFrom,
          effectiveUntil: row.effectiveUntil,
          source: row.source,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },

    update: (row: GoalRuleRow) => {
      check();
      const res = orm
        .update(goalRule)
        .set({
          goalId: row.goalId,
          stageId: row.stageId,
          shareBp: row.shareBp,
          effectiveFrom: row.effectiveFrom,
          effectiveUntil: row.effectiveUntil,
          source: row.source,
          updatedAt: row.updatedAt,
        })
        .where(eq(goalRule.id, row.id))
        .run();
      return res.changes > 0;
    },

    delete: (id: Id<"GoalRule">) => {
      check();
      const res = orm.delete(goalRule).where(eq(goalRule.id, id)).run();
      return res.changes > 0;
    },

    findById: (viewer: Viewer, id: Id<"GoalRule">) => {
      check();
      const row = orm
        .select({
          rule: goalRule,
          goalPersonId: goal.personId,
        })
        .from(goalRule)
        .innerJoin(goal, eq(goal.id, goalRule.goalId))
        .where(eq(goalRule.id, id))
        .get();
      if (!row) return undefined;
      if (!isPersonVisible(viewer, row.goalPersonId)) return undefined;
      return {
        ...row.rule,
        source: row.rule.source as GoalRuleSource,
      } as GoalRuleRow;
    },

    listForStage: (viewer: Viewer, stageId: Id<"AllocationStage">) => {
      check();
      const rows = orm
        .select({
          rule: goalRule,
          goalPersonId: goal.personId,
        })
        .from(goalRule)
        .innerJoin(goal, eq(goal.id, goalRule.goalId))
        .where(eq(goalRule.stageId, stageId))
        .all();
      return rows
        .filter((r) => isPersonVisible(viewer, r.goalPersonId))
        .map((r) => ({
          ...r.rule,
          source: r.rule.source as GoalRuleSource,
        })) as GoalRuleRow[];
    },

    listVisible: (viewer: Viewer) => {
      check();
      const rows = orm
        .select({
          rule: goalRule,
          goalPersonId: goal.personId,
        })
        .from(goalRule)
        .innerJoin(goal, eq(goal.id, goalRule.goalId))
        .all();
      return rows
        .filter((r) => isPersonVisible(viewer, r.goalPersonId))
        .map((r) => ({
          ...r.rule,
          source: r.rule.source as GoalRuleSource,
        })) as GoalRuleRow[];
    },

    deleteForGoal: (goalId: Id<"Goal">) => {
      check();
      orm.delete(goalRule).where(eq(goalRule.goalId, goalId)).run();
    },

    deleteForStage: (stageId: Id<"AllocationStage">) => {
      check();
      orm.delete(goalRule).where(eq(goalRule.stageId, stageId)).run();
    },
  };
}

export function createPlanningSettingRepo(orm: Orm, check: () => void): PlanningSettingRepo {
  return {
    get: (viewer: Viewer, personId: Id<"Person"> | null) => {
      check();
      if (!isPersonVisible(viewer, personId)) return undefined;
      const whereClause =
        personId === null
          ? isNull(planningSetting.personId)
          : eq(planningSetting.personId, personId);
      const row = orm.select().from(planningSetting).where(whereClause).get();
      return row ? (row as PlanningSettingRow) : undefined;
    },

    upsert: (row: PlanningSettingRow) => {
      check();
      const whereClause =
        row.personId === null
          ? isNull(planningSetting.personId)
          : eq(planningSetting.personId, row.personId);
      const existing = orm.select().from(planningSetting).where(whereClause).get();
      if (existing) {
        orm
          .update(planningSetting)
          .set({
            largeWithdrawalThresholdCents: row.largeWithdrawalThresholdCents,
            updatedAt: row.updatedAt,
          })
          .where(eq(planningSetting.id, existing.id))
          .run();
      } else {
        orm.insert(planningSetting).values(row).run();
      }
    },

    deleteForPerson: (personId: Id<"Person">) => {
      check();
      orm.delete(planningSetting).where(eq(planningSetting.personId, personId)).run();
    },
  };
}

export function createGoalAllocationRepo(orm: Orm, check: () => void): GoalAllocationRepo {
  return {
    insert: (row: GoalAllocationRow) => {
      check();
      orm
        .insert(goalAllocation)
        .values({
          id: row.id,
          goalId: row.goalId,
          periodStart: row.periodStart,
          allocatedCents: row.allocatedCents,
          createdAt: row.createdAt,
        })
        .run();
    },

    insertMany: (rows: readonly GoalAllocationRow[]) => {
      check();
      if (rows.length === 0) return;
      orm
        .insert(goalAllocation)
        .values(
          rows.map((row) => ({
            id: row.id,
            goalId: row.goalId,
            periodStart: row.periodStart,
            allocatedCents: row.allocatedCents,
            createdAt: row.createdAt,
          })),
        )
        .run();
    },

    listForGoal: (viewer: Viewer, goalId: Id<"Goal">) => {
      check();
      const visibility = goalVisibilityPredicate(viewer);
      const rows = orm
        .select({
          allocation: goalAllocation,
        })
        .from(goalAllocation)
        .innerJoin(goal, eq(goal.id, goalAllocation.goalId))
        .where(
          visibility
            ? and(eq(goalAllocation.goalId, goalId), visibility)
            : eq(goalAllocation.goalId, goalId),
        )
        .orderBy(asc(goalAllocation.periodStart), asc(goalAllocation.createdAt))
        .all();
      return rows.map((r) => r.allocation) as GoalAllocationRow[];
    },

    listForPeriod: (viewer: Viewer, periodStart: string) => {
      check();
      const visibility = goalVisibilityPredicate(viewer);
      const rows = orm
        .select({
          allocation: goalAllocation,
        })
        .from(goalAllocation)
        .innerJoin(goal, eq(goal.id, goalAllocation.goalId))
        .where(
          visibility
            ? and(eq(goalAllocation.periodStart, periodStart), visibility)
            : eq(goalAllocation.periodStart, periodStart),
        )
        .orderBy(asc(goalAllocation.createdAt))
        .all();
      return rows.map((r) => r.allocation) as GoalAllocationRow[];
    },

    sumForGoal: (viewer: Viewer, goalId: Id<"Goal">) => {
      check();
      const visibility = goalVisibilityPredicate(viewer);
      const res = orm
        .select({
          total: sql<number>`coalesce(sum(${goalAllocation.allocatedCents}), 0)`,
        })
        .from(goalAllocation)
        .innerJoin(goal, eq(goal.id, goalAllocation.goalId))
        .where(
          visibility
            ? and(eq(goalAllocation.goalId, goalId), visibility)
            : eq(goalAllocation.goalId, goalId),
        )
        .get();
      return res?.total ?? 0;
    },

    deleteForGoal: (goalId: Id<"Goal">) => {
      check();
      orm.delete(goalAllocation).where(eq(goalAllocation.goalId, goalId)).run();
    },
  };
}
