// Demo mode: a throwaway in-memory database loaded from the seed, then made read-only.
// It never opens anything under PANGOLIN_DATA_DIR.
import { readFileSync } from "node:fs";
import { AppError, type Clock, fixedClockAt, newId, type UnitOfWork } from "@pangolin/app";
import { createUnitOfWork, type Db, loadMigrations, migrate, openDatabase } from "@pangolin/db";
import { type AppliedSeed, applySeed, parseSeed } from "./admin/seed.ts";

/** Wraps a unit of work so every write transaction throws `Conflict`; reads pass through. */
export function readOnlyUnitOfWork(uow: UnitOfWork): UnitOfWork {
  return {
    transaction: () => {
      throw new AppError("Conflict", "Demo mode is read-only");
    },
    read: (fn) => uow.read(fn),
  };
}

export interface DemoDatabase {
  readonly db: Db;
  /** Read-only: every write throws `AppError("Conflict")`. */
  readonly uow: UnitOfWork;
  /** Stopped at midnight UTC on the seed's fixed today (AD-15); demo use cases run on it. */
  readonly clock: Clock;
  readonly schemaVersion: number;
  readonly seed: AppliedSeed;
}

/**
 * Migrates a `:memory:` database, applies the seed file through the use cases, and returns it
 * with a read-only unit of work. Throws (after closing the database) when the seed file is
 * missing or invalid.
 */
export function openDemoDatabase(options: {
  readonly migrationsDir: string;
  readonly seedFile: string;
}): DemoDatabase {
  const db = openDatabase(":memory:");
  try {
    const { schemaVersion } = migrate(db, loadMigrations(options.migrationsDir));
    const seedJson = readFileSync(options.seedFile, "utf8");
    const clock = fixedClockAt(parseSeed(seedJson).today);
    const seed = applySeed(createUnitOfWork(db), { clock, newId }, seedJson);
    return { db, uow: readOnlyUnitOfWork(createUnitOfWork(db)), clock, schemaVersion, seed };
  } catch (error) {
    db.close();
    throw error;
  }
}
