import type { PayAnchorRepo, PayAnchorRow, Viewer } from "@pangolin/app";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { payAnchor } from "../schema/pay-anchor.ts";

type Orm = BetterSQLite3Database;

function isPersonVisible(viewer: Viewer, personId: string): boolean {
  if (viewer.kind === "system") return true;
  return viewer.personId === personId;
}

export function createPayAnchorRepo(orm: Orm, check: () => void): PayAnchorRepo {
  return {
    insert: (row: PayAnchorRow) => {
      check();
      orm.insert(payAnchor).values(row).run();
    },
    update: (row: PayAnchorRow) => {
      check();
      orm
        .update(payAnchor)
        .set({
          accountId: row.accountId,
          cadence: row.cadence,
          dayOfMonth: row.dayOfMonth,
          anchorDate: row.anchorDate,
          alignment: row.alignment,
          expectedNetCents: row.expectedNetCents,
          expectedGrossCents: row.expectedGrossCents,
          updatedAt: row.updatedAt,
        })
        .where(eq(payAnchor.id, row.id))
        .run();
    },
    findByPersonId: (viewer: Viewer, personId: any) => {
      check();
      if (!isPersonVisible(viewer, personId)) return undefined;
      const row = orm.select().from(payAnchor).where(eq(payAnchor.personId, personId)).get();
      return row as PayAnchorRow | undefined;
    },
    listVisible: (viewer: Viewer) => {
      check();
      if (viewer.kind === "system") {
        return orm.select().from(payAnchor).all() as PayAnchorRow[];
      }
      return orm
        .select()
        .from(payAnchor)
        .where(eq(payAnchor.personId, viewer.personId))
        .all() as PayAnchorRow[];
    },
    deleteForPerson: (personId: any) => {
      check();
      orm.delete(payAnchor).where(eq(payAnchor.personId, personId)).run();
    },
  };
}
