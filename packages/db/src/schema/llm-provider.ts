import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Configured LLM provider (Ollama, OpenAI, Anthropic, etc.).
 * API keys are encrypted at rest under a key derived from authSecret.
 * is_local is derived from the base_url resolving into LAN/RFC 1918 ranges (AD-6).
 */
export const llmProvider = sqliteTable(
  "llm_provider",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyLast4: text("api_key_last4"),
    isLocal: integer("is_local", { mode: "boolean" }).notNull().default(false),
    cloudPdf: integer("cloud_pdf", { mode: "boolean" }).notNull().default(false),
    cloudRows: integer("cloud_rows", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("llm_provider_kind", sql`${t.kind} IN ('openai', 'anthropic')`),
    check("llm_provider_is_local", sql`${t.isLocal} IN (0, 1)`),
    check("llm_provider_cloud_pdf", sql`${t.cloudPdf} IN (0, 1)`),
    check("llm_provider_cloud_rows", sql`${t.cloudRows} IN (0, 1)`),
  ],
);

/**
 * Per-purpose assignment linking a specific capability (categorisation, PDF extraction,
 * row interpretation) to a configured LLM provider.
 */
export const llmPurposeAssignment = sqliteTable(
  "llm_purpose_assignment",
  {
    purpose: text("purpose").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => llmProvider.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "llm_purpose_assignment_purpose",
      sql`${t.purpose} IN ('categorise', 'pdf_extract', 'row_interpret')`,
    ),
    index("llm_purpose_assignment_provider_idx").on(t.providerId),
  ],
);
