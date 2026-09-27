import type { SystemHealthPort } from "@pangolin/app";
import { schemaVersion } from "./migrate.ts";
import type { Db } from "./open.ts";

function isReadonlyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_READONLY");
}

export function createSystemHealthRepo(db: Db): SystemHealthPort {
  return {
    schemaVersion: () => schemaVersion(db),
    probeWrite: () => {
      try {
        db.exec("BEGIN IMMEDIATE");
        // SQLite grants BEGIN IMMEDIATE on a read-only database (opened read-only, or silently
        // fallen back to read-only because the file is not writable); only the first page write
        // fails. Rewriting user_version with its own value dirties page 1, then we roll back.
        const version = db.pragma("user_version", { simple: true }) as number;
        db.pragma(`user_version = ${version}`);
        return true;
      } catch (error) {
        if (isReadonlyError(error)) return false;
        throw error;
      } finally {
        if (db.inTransaction) db.exec("ROLLBACK");
      }
    },
  };
}
