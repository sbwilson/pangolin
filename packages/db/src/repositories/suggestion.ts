import {
  type FewShotExample,
  type SuggestionOutcome,
  type SuggestionRepo,
  type SuggestionRow,
  type Viewer,
  parseSearch,
} from "@pangolin/app";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccountId, visibleScope } from "../privacy.ts";
import { account } from "../schema/account.ts";
import { category } from "../schema/category.ts";
import { payee } from "../schema/payee.ts";
import { split } from "../schema/split.ts";
import { suggestion } from "../schema/suggestion.ts";
import { transaction } from "../schema/transaction.ts";

type Orm = BetterSQLite3Database;

export function createSuggestionRepo(orm: Orm, check: () => void): SuggestionRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(suggestion).values(row).run();
    },

    insertMany: (rows) => {
      check();
      if (rows.length === 0) return;
      orm.insert(suggestion).values(rows as SuggestionRow[]).run();
    },

    findOpenForSplit: (splitId, field) => {
      check();
      const row = orm
        .select()
        .from(suggestion)
        .where(
          and(
            eq(suggestion.splitId, splitId),
            eq(suggestion.field, field),
            isNull(suggestion.resolvedAt),
          ),
        )
        .get();
      return row as SuggestionRow | undefined;
    },

    listOpenForSplit: (viewer, splitId) => {
      check();
      const visible = visibleAccountId(suggestion.accountId, viewer);
      const rows = orm
        .select()
        .from(suggestion)
        .where(
          and(
            eq(suggestion.splitId, splitId),
            isNull(suggestion.resolvedAt),
            visible,
          ),
        )
        .all();
      return rows as SuggestionRow[];
    },

    listForTransaction: (viewer, transactionId) => {
      check();
      const visible = visibleAccountId(suggestion.accountId, viewer);
      const rows = orm
        .select()
        .from(suggestion)
        .where(
          and(
            eq(suggestion.transactionId, transactionId),
            visible,
          ),
        )
        .orderBy(desc(suggestion.createdAt))
        .all();
      return rows as SuggestionRow[];
    },

    listOpenForAccount: (viewer, accountId) => {
      check();
      const visible = visibleAccountId(suggestion.accountId, viewer);
      const rows = orm
        .select()
        .from(suggestion)
        .where(
          and(
            eq(suggestion.accountId, accountId),
            isNull(suggestion.resolvedAt),
            visible,
          ),
        )
        .orderBy(desc(suggestion.createdAt))
        .all();
      return rows as SuggestionRow[];
    },

    resolveOpen: (splitId, field, outcome, at) => {
      check();
      const result = orm
        .update(suggestion)
        .set({
          outcome,
          resolvedAt: at,
        })
        .where(
          and(
            eq(suggestion.splitId, splitId),
            eq(suggestion.field, field),
            isNull(suggestion.resolvedAt),
          ),
        )
        .run();
      return result.changes > 0;
    },

    findFewShot: (viewer, today, query, limit = 10) => {
      check();
      if (!viewer) throw new TypeError("findFewShot: a viewer is required");
      const parsed = parseSearch(query);
      if (!parsed || parsed.terms.length === 0) return [];
      const match = parsed.terms.map((tokens) => `"${tokens.join(" ")}"*`).join(" ");
      const viewerPersonId = viewer.kind === "person" ? viewer.personId : "";
      const payeeScope = visibleScope(payee.scopePersonId, viewer);

      const rows = orm
        .select({
          transactionId: transaction.id,
          description: transaction.descriptionRaw,
          amountCents: transaction.amountCents,
          postedOn: transaction.postedOn,
          categoryId: sql<string>`${split.categoryId}`,
          categoryName: category.name,
          payeeName: payee.name,
        })
        .from(transaction)
        .innerJoin(split, eq(split.transactionId, transaction.id))
        .innerJoin(account, eq(account.id, transaction.accountId))
        .leftJoin(category, eq(category.id, split.categoryId))
        .leftJoin(
          payee,
          payeeScope
            ? and(eq(payee.id, transaction.payeeId), payeeScope)
            : eq(payee.id, transaction.payeeId),
        )
        .where(
          and(
            sql`${transaction.searchId} IN (SELECT rowid FROM txn_fts WHERE txn_fts MATCH ${match})`,
            eq(account.isPrivate, false),
            isNull(account.deletedAt),
            isNotNull(split.categoryId),
            isNull(category.deletedAt),
            isNull(transaction.deletedAt),
            sql`(${transaction.nameHiddenUntil} IS NULL OR ${transaction.nameHiddenUntil} <= ${today} OR ${transaction.nameHiddenBy} = ${viewerPersonId})`,
          ),
        )
        .groupBy(transaction.id)
        .orderBy(desc(transaction.postedOn), desc(transaction.id))
        .limit(limit)
        .all();
      return rows as FewShotExample[];
    },
  };
}
