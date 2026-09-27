import type { JobLane, JobRepo, JobRow } from "@pangolin/app";
import type { Id } from "@pangolin/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { job } from "./schema/job.ts";

type Orm = BetterSQLite3Database;

/** A job that still holds its dedupe key (the WHERE of `job_dedupe_key_live_idx`). */
const LIVE = sql`status IN ('pending', 'running')`;

function held(id: Id<"Job">, owner: string) {
  return and(eq(job.id, id), eq(job.status, "running"), eq(job.leaseOwner, owner));
}

/** The `job` repository (AD-8). `check` throws once the owning transaction has ended. */
export function createJobRepo(orm: Orm, check: () => void): JobRepo {
  return {
    insertOrGetPending: (row) => {
      check();
      // Runs inside a BEGIN IMMEDIATE transaction, so no other writer can slip in between the
      // lookup and the insert; the partial unique index is the backstop. (drizzle 0.45 renders
      // a partial-index ON CONFLICT target with its WHERE in the wrong place for SQLite.)
      if (row.dedupeKey !== null) {
        const existing = orm
          .select({ id: job.id })
          .from(job)
          .where(and(eq(job.dedupeKey, row.dedupeKey), LIVE))
          .get();
        if (existing !== undefined) return { id: existing.id as Id<"Job">, inserted: false };
      }
      orm.insert(job).values(row).run();
      return { id: row.id, inserted: true };
    },

    claimNext: (lane: JobLane, owner, now, leaseUntil) => {
      check();
      const next = orm
        .select({ id: job.id })
        .from(job)
        .where(
          sql`${job.lane} = ${lane} AND ((${job.status} = 'pending' AND ${job.runAt} <= ${now}) OR (${job.status} = 'running' AND ${job.leaseExpiresAt} <= ${now}))`,
        )
        .orderBy(job.runAt, job.id)
        .limit(1);
      const row = orm
        .update(job)
        .set({
          status: "running",
          leaseOwner: owner,
          leaseExpiresAt: leaseUntil,
          attempts: sql`${job.attempts} + 1`,
          updatedAt: now,
        })
        .where(sql`${job.id} = (${next})`)
        .returning()
        .get();
      return row as JobRow | undefined;
    },

    renewLease: (id, owner, now, leaseUntil) => {
      check();
      return (
        orm
          .update(job)
          .set({ leaseExpiresAt: leaseUntil, updatedAt: now })
          .where(held(id, owner))
          .run().changes === 1
      );
    },

    complete: (id, owner, now) => {
      check();
      return (
        orm
          .update(job)
          .set({
            status: "done",
            leaseOwner: null,
            leaseExpiresAt: null,
            finishedAt: now,
            updatedAt: now,
          })
          .where(held(id, owner))
          .run().changes === 1
      );
    },

    retry: (id, owner, now, runAt, error) => {
      check();
      return (
        orm
          .update(job)
          .set({
            status: "pending",
            runAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: error,
            updatedAt: now,
          })
          .where(held(id, owner))
          .run().changes === 1
      );
    },

    markDead: (id, owner, now, error) => {
      check();
      return (
        orm
          .update(job)
          .set({
            status: "dead",
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: error,
            finishedAt: now,
            updatedAt: now,
          })
          .where(held(id, owner))
          .run().changes === 1
      );
    },

    listDead: (limit) => {
      check();
      const rows = orm
        .select({ kind: job.kind, failedAt: job.finishedAt })
        .from(job)
        .where(eq(job.status, "dead"))
        .orderBy(desc(job.finishedAt), desc(job.id))
        .limit(limit)
        .all();
      // The job_finished CHECK guarantees a dead job has finished_at.
      return rows.map((row) => ({ kind: row.kind, failedAt: row.failedAt ?? "" }));
    },
  };
}
