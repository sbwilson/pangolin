import type { ReviewItemRepo, ReviewItemRow, Viewer } from "@pangolin/app";
import { and, asc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccountId } from "./privacy.ts";
import { reviewItem } from "./schema/review-item.ts";

type Orm = BetterSQLite3Database;

/** An open item (the WHERE of `review_item_dedupe_key_open_idx`). */
const OPEN = sql`resolved_at IS NULL`;

/**
 * The SQL visibility filter for review items (AD-3, AD-17). Throws without a viewer.
 * A system viewer sees everything. A person sees items with no scope, items of an account they
 * can see (`visibleAccounts`) and their own `person_id` items.
 */
export function visibleReviewItems(viewer: Viewer | undefined): SQL | undefined {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("visibleReviewItems: a viewer is required");
  }
  if (viewer.kind === "system") return undefined;
  return and(
    or(isNull(reviewItem.accountId), visibleAccountId(reviewItem.accountId, viewer)),
    or(isNull(reviewItem.personId), eq(reviewItem.personId, viewer.personId)),
  );
}

function openByKey(orm: Orm, dedupeKey: string): ReviewItemRow | undefined {
  return orm
    .select()
    .from(reviewItem)
    .where(and(eq(reviewItem.dedupeKey, dedupeKey), OPEN))
    .get() as ReviewItemRow | undefined;
}

/** The `review_item` repository (AD-17). `check` throws once the transaction has ended. */
export function createReviewItemRepo(orm: Orm, check: () => void): ReviewItemRepo {
  return {
    raise: (row) => {
      check();
      // Lookup then insert inside the BEGIN IMMEDIATE transaction; the partial unique index is
      // the backstop (see job-repo.ts on drizzle's partial-index ON CONFLICT).
      const existing = openByKey(orm, row.dedupeKey);
      if (existing !== undefined) return { item: existing, inserted: false };
      orm.insert(reviewItem).values(row).run();
      return { item: row, inserted: true };
    },

    resolve: (dedupeKey, resolvedAt, resolution) => {
      check();
      const before = openByKey(orm, dedupeKey);
      if (before === undefined) return undefined;
      const after = orm
        .update(reviewItem)
        .set({ resolvedAt, resolution })
        .where(eq(reviewItem.id, before.id))
        .returning()
        .get() as ReviewItemRow;
      return { before, after };
    },

    listOpenFor: (viewer) => {
      const visible = visibleReviewItems(viewer);
      check();
      return orm
        .select()
        .from(reviewItem)
        .where(and(OPEN, visible))
        .orderBy(asc(reviewItem.createdAt), asc(reviewItem.id))
        .all() as ReviewItemRow[];
    },
  };
}
