import type { Id, RecurringSeriesRepo, RecurringSeriesRow, Viewer } from "@pangolin/app";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccountId } from "../privacy.ts";
import { recurringSeries } from "../schema/recurring-series.ts";

type Orm = BetterSQLite3Database;

export function createRecurringSeriesRepo(orm: Orm, check: () => void): RecurringSeriesRepo {
  return {
    insert: (row: RecurringSeriesRow) => {
      check();
      orm
        .insert(recurringSeries)
        .values({
          id: row.id,
          accountId: row.accountId,
          payeeId: row.payeeId,
          direction: row.direction,
          cadence: row.cadence,
          expectedCents: row.expectedCents,
          toleranceBp: row.toleranceBp,
          nextDueOn: row.nextDueOn,
          status: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
    },

    update: (row: RecurringSeriesRow) => {
      check();
      orm
        .update(recurringSeries)
        .set({
          accountId: row.accountId,
          payeeId: row.payeeId,
          direction: row.direction,
          cadence: row.cadence,
          expectedCents: row.expectedCents,
          toleranceBp: row.toleranceBp,
          nextDueOn: row.nextDueOn,
          status: row.status,
          updatedAt: row.updatedAt,
        })
        .where(eq(recurringSeries.id, row.id))
        .run();
    },

    delete: (id: Id<"RecurringSeries">) => {
      check();
      const result = orm.delete(recurringSeries).where(eq(recurringSeries.id, id)).run();
      return result.changes > 0;
    },

    findById: (viewer: Viewer, id: Id<"RecurringSeries">) => {
      check();
      const visible = visibleAccountId(recurringSeries.accountId, viewer);
      const row = orm
        .select()
        .from(recurringSeries)
        .where(and(eq(recurringSeries.id, id), visible))
        .get();
      return (row as RecurringSeriesRow | undefined) ?? undefined;
    },

    listVisible: (
      viewer: Viewer,
      filter?: {
        readonly accountId?: Id<"Account">;
        readonly status?: "candidate" | "confirmed" | "rejected";
      },
    ) => {
      check();
      const visible = visibleAccountId(recurringSeries.accountId, viewer);
      const conditions = [visible];

      if (filter?.accountId !== undefined) {
        conditions.push(eq(recurringSeries.accountId, filter.accountId));
      }
      if (filter?.status !== undefined) {
        conditions.push(eq(recurringSeries.status, filter.status));
      }

      return orm
        .select()
        .from(recurringSeries)
        .where(and(...conditions))
        .all() as RecurringSeriesRow[];
    },

    deleteForAccount: (accountId: Id<"Account">) => {
      check();
      orm.delete(recurringSeries).where(eq(recurringSeries.accountId, accountId)).run();
    },
  };
}
