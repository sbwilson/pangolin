import { sql } from "drizzle-orm";
import { check, index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { activity } from "./activity.ts";
import { split } from "./split.ts";
import { taxCategory } from "./tax-category.ts";
import { transaction } from "./transaction.ts";

export const SUGGESTION_SOURCES = ["llm", "activity", "rule_offer"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export const SUGGESTION_OUTCOMES = ["open", "accepted", "superseded", "rejected"] as const;
export type SuggestionOutcome = (typeof SUGGESTION_OUTCOMES)[number];

/**
 * Suggestions proposed by LLMs or deterministic heuristics (AD-10).
 * Open suggestions can be accepted or superseded when split fields change.
 */
export const suggestion = sqliteTable(
  "suggestion",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transaction.id),
    splitId: text("split_id")
      .notNull()
      .references(() => split.id),
    source: text("source").notNull(),
    field: text("field").notNull(),
    suggestedValue: text("suggested_value").notNull(),
    payeeName: text("payee_name"),
    websiteDomain: text("website_domain"),
    taxCategoryId: text("tax_category_id").references(() => taxCategory.id),
    activityId: text("activity_id").references(() => activity.id),
    confidence: real("confidence"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    outcome: text("outcome").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    index("suggestion_account_idx").on(t.accountId),
    index("suggestion_transaction_idx").on(t.transactionId),
    index("suggestion_split_idx").on(t.splitId),
    uniqueIndex("suggestion_split_field_open_idx")
      .on(t.splitId, t.field)
      .where(sql`${t.resolvedAt} IS NULL`),
    check("suggestion_source", sql`${t.source} IN ('llm', 'activity', 'rule_offer')`),
    check(
      "suggestion_outcome",
      sql`${t.outcome} IN ('open', 'accepted', 'superseded', 'rejected')`,
    ),
    check(
      "suggestion_confidence",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
  ],
);
