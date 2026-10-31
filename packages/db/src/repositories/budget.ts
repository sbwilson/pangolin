import type { BudgetPeriodSpent, BudgetRepository, BudgetRow, Id, Viewer } from "@pangolin/app";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { flowKindSql, visibleTxn } from "../privacy.ts";
import { budget } from "../schema/budget.ts";
import { category } from "../schema/category.ts";
import { split } from "../schema/split.ts";
import { transaction } from "../schema/transaction.ts";

type Orm = BetterSQLite3Database;

function isBudgetVisible(viewer: Viewer, personId: string | null): boolean {
  if (viewer.kind === "system") return true;
  // Shared budgets have personId = null (visible to both partners)
  if (personId === null) return true;
  // Personal budgets are only visible to the owner (AD-22)
  return viewer.personId === personId;
}

export function createBudgetRepo(orm: Orm, check: () => void): BudgetRepository {
  return {
    insert: (row: BudgetRow) => {
      check();
      orm
        .insert(budget)
        .values({
          id: row.id,
          personId: row.personId,
          categoryId: row.categoryId,
          categoryGroupId: row.categoryGroupId,
          cadence: row.cadence,
          limitCents: row.limitCents,
          rollover: row.rollover,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },

    update: (row: BudgetRow) => {
      check();
      orm
        .update(budget)
        .set({
          personId: row.personId,
          categoryId: row.categoryId,
          categoryGroupId: row.categoryGroupId,
          cadence: row.cadence,
          limitCents: row.limitCents,
          rollover: row.rollover,
          updatedAt: row.updatedAt,
        })
        .where(eq(budget.id, row.id))
        .run();
    },

    delete: (id: Id<"Budget">) => {
      check();
      const res = orm.delete(budget).where(eq(budget.id, id)).run();
      return res.changes > 0;
    },

    findById: (viewer: Viewer, id: Id<"Budget">) => {
      check();
      const row = orm.select().from(budget).where(eq(budget.id, id)).get();
      if (!row) return undefined;
      if (!isBudgetVisible(viewer, row.personId)) return undefined;
      return row as BudgetRow;
    },

    listVisible: (viewer: Viewer) => {
      check();
      if (viewer.kind === "system") {
        return orm.select().from(budget).all() as BudgetRow[];
      }
      return orm
        .select()
        .from(budget)
        .where(sql`${budget.personId} IS NULL OR ${budget.personId} = ${viewer.personId}`)
        .all() as BudgetRow[];
    },

    calculateSpent: (
      viewer: Viewer,
      budgetRow: BudgetRow,
      today: string,
      period: { readonly start: string; readonly end: string },
    ) => {
      check();
      if (!isBudgetVisible(viewer, budgetRow.personId)) {
        return 0;
      }

      // Projection for visibleTxn
      const projection = visibleTxn(viewer, today);
      const kind = flowKindSql(viewer);

      // Target filter: category or categoryGroup
      let targetFilter = sql`1=1`;
      if (budgetRow.categoryId) {
        targetFilter = sql`${split.categoryId} = ${budgetRow.categoryId}`;
      } else if (budgetRow.categoryGroupId) {
        targetFilter = sql`${split.categoryId} IN (SELECT ${category.id} FROM ${category} WHERE ${category.groupId} = ${budgetRow.categoryGroupId})`;
      }

      // Beneficiary filter (AD-7, AD-22, AD-23):
      // Shared budgets count splits where beneficiary = 'shared'
      // Personal budgets count splits where beneficiary = budgetRow.personId
      let beneficiaryFilter = sql`1=1`;
      if (budgetRow.personId === null) {
        beneficiaryFilter = sql`${split.beneficiary} = 'shared'`;
      } else {
        beneficiaryFilter = sql`${split.beneficiary} = ${budgetRow.personId}`;
      }

      // Sum spent: only expenses count toward budget spent (flowKind = 'expense', AD-23).
      // splits amount is negative for expense in transaction.
      // spent is positive cents sum: -sum(amountCents)
      const res = orm
        .select({
          spent: sql<number>`coalesce(-sum(${split.amountCents}), 0)`,
        })
        .from(split)
        .innerJoin(transaction, eq(transaction.id, split.transactionId))
        .where(
          and(
            projection.where,
            gte(transaction.postedOn, period.start),
            lt(transaction.postedOn, period.end),
            sql`${kind} = 'expense'`,
            targetFilter,
            beneficiaryFilter,
          ),
        )
        .get();

      return res?.spent ?? 0;
    },

    calculateHistoricalSpent: (
      viewer: Viewer,
      budgetRow: BudgetRow,
      today: string,
      periods: readonly { readonly start: string; readonly end: string }[],
    ) => {
      check();
      if (periods.length === 0) return [];
      if (!isBudgetVisible(viewer, budgetRow.personId)) {
        return periods.map((p) => ({ start: p.start, end: p.end, spentCents: 0 }));
      }

      // For each period, calculate spent.
      // Periods are typically 6-12 periods, so a direct query or loop per period.
      // Doing per period ensures clean half-open [start, end) semantics for each period cleanly.
      const repo = createBudgetRepo(orm, check);
      const results: BudgetPeriodSpent[] = [];
      for (const p of periods) {
        const spent = repo.calculateSpent(viewer, budgetRow, today, p);
        results.push({
          start: p.start,
          end: p.end,
          spentCents: spent,
        });
      }
      return results;
    },

    deleteForPerson: (personId: Id<"Person">) => {
      check();
      orm.delete(budget).where(eq(budget.personId, personId)).run();
    },
  };
}
