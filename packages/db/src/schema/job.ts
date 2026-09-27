import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The job outbox (AD-8), owned by `system`. Use cases insert rows inside their business
 * transaction; the runner claims them per lane with a lease. Times are `formatInstant` text, so
 * text comparison matches time order. `payload` is JSON text; `last_error` never leaves the
 * server.
 */
export const job = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lane: text("lane", { enum: ["llm", "net", "local"] }).notNull(),
    payload: text("payload").notNull(),
    dedupeKey: text("dedupe_key"),
    status: text("status", { enum: ["pending", "running", "done", "dead"] }).notNull(),
    attempts: integer("attempts").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    runAt: text("run_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [
    // One live job per dedupe key; a finished job frees its key.
    uniqueIndex("job_dedupe_key_live_idx")
      .on(t.dedupeKey)
      .where(sql`status IN ('pending', 'running')`),
    index("job_claim_idx").on(t.lane, t.status, t.runAt),
    index("job_finished_idx").on(t.status, t.finishedAt),
    check("job_lane", sql`${t.lane} IN ('llm', 'net', 'local')`),
    check("job_status", sql`${t.status} IN ('pending', 'running', 'done', 'dead')`),
    check("job_payload_json", sql`json_valid(${t.payload})`),
    check("job_attempts", sql`${t.attempts} >= 0 AND ${t.maxAttempts} >= 1`),
    check(
      "job_lease",
      sql`${t.status} <> 'running' OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
    ),
    check("job_finished", sql`(${t.status} IN ('done', 'dead')) = (${t.finishedAt} IS NOT NULL)`),
  ],
);
