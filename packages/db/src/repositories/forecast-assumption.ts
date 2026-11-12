import type {
  ForecastAssumptionMortgageRow,
  ForecastAssumptionRepo,
  ForecastAssumptionRow,
  Viewer,
} from "@pangolin/app";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { forecastAssumption, forecastAssumptionMortgage } from "../schema/forecast-assumption.ts";

type Orm = BetterSQLite3Database;

function isPersonVisible(viewer: Viewer, personId: string): boolean {
  if (viewer.kind === "system") return true;
  return viewer.personId === personId;
}

export function createForecastAssumptionRepo(orm: Orm, check: () => void): ForecastAssumptionRepo {
  return {
    get: (viewer, personId) => {
      check();
      if (!isPersonVisible(viewer, personId)) return undefined;
      const row = orm
        .select()
        .from(forecastAssumption)
        .where(eq(forecastAssumption.personId, personId))
        .get();
      return row as ForecastAssumptionRow | undefined;
    },
    upsert: (row) => {
      check();
      orm
        .insert(forecastAssumption)
        .values(row)
        .onConflictDoUpdate({
          target: forecastAssumption.personId,
          set: {
            savingsRateBps: row.savingsRateBps,
            returnLowBps: row.returnLowBps,
            returnMidBps: row.returnMidBps,
            returnHighBps: row.returnHighBps,
            superRateBps: row.superRateBps,
            updatedAt: row.updatedAt,
          },
        })
        .run();
    },
    listMortgages: (viewer, personId) => {
      check();
      if (!isPersonVisible(viewer, personId)) return [];
      return orm
        .select()
        .from(forecastAssumptionMortgage)
        .where(eq(forecastAssumptionMortgage.personId, personId))
        .all() as ForecastAssumptionMortgageRow[];
    },
    replaceMortgages: (personId, rows) => {
      check();
      orm
        .delete(forecastAssumptionMortgage)
        .where(eq(forecastAssumptionMortgage.personId, personId))
        .run();
      if (rows.length === 0) return;
      orm
        .insert(forecastAssumptionMortgage)
        .values([...rows])
        .run();
    },
  };
}
