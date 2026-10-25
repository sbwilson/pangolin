import {
  LLM_PURPOSES,
  type LlmProviderRepo,
  type LlmProviderRow,
  type LlmProviderSafeView,
  type LlmPurposeAssignmentRow,
} from "@pangolin/app";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { llmProvider, llmPurposeAssignment } from "../schema/llm-provider.ts";

type Orm = BetterSQLite3Database;

export function createLlmProviderRepo(orm: Orm, check: () => void): LlmProviderRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(llmProvider).values(row).run();
    },

    update: (row) => {
      check();
      const result = orm
        .update(llmProvider)
        .set({
          name: row.name,
          kind: row.kind,
          baseUrl: row.baseUrl,
          model: row.model,
          apiKeyCiphertext: row.apiKeyCiphertext,
          apiKeyLast4: row.apiKeyLast4,
          isLocal: row.isLocal,
          cloudPdf: row.cloudPdf,
          cloudRows: row.cloudRows,
          updatedAt: row.updatedAt,
        })
        .where(eq(llmProvider.id, row.id))
        .run();
      return result.changes > 0;
    },

    delete: (id) => {
      check();
      const result = orm.delete(llmProvider).where(eq(llmProvider.id, id)).run();
      return result.changes > 0;
    },

    findById: (id) => {
      check();
      const row = orm.select().from(llmProvider).where(eq(llmProvider.id, id)).get();
      return row as LlmProviderRow | undefined;
    },

    findSafe: (id) => {
      check();
      const row = orm
        .select({
          id: llmProvider.id,
          name: llmProvider.name,
          kind: llmProvider.kind,
          baseUrl: llmProvider.baseUrl,
          model: llmProvider.model,
          apiKeyLast4: llmProvider.apiKeyLast4,
          isLocal: llmProvider.isLocal,
          cloudPdf: llmProvider.cloudPdf,
          cloudRows: llmProvider.cloudRows,
          createdAt: llmProvider.createdAt,
          updatedAt: llmProvider.updatedAt,
        })
        .from(llmProvider)
        .where(eq(llmProvider.id, id))
        .get();
      return row as LlmProviderSafeView | undefined;
    },

    listSafe: () => {
      check();
      const rows = orm
        .select({
          id: llmProvider.id,
          name: llmProvider.name,
          kind: llmProvider.kind,
          baseUrl: llmProvider.baseUrl,
          model: llmProvider.model,
          apiKeyLast4: llmProvider.apiKeyLast4,
          isLocal: llmProvider.isLocal,
          cloudPdf: llmProvider.cloudPdf,
          cloudRows: llmProvider.cloudRows,
          createdAt: llmProvider.createdAt,
          updatedAt: llmProvider.updatedAt,
        })
        .from(llmProvider)
        .all();
      return rows as LlmProviderSafeView[];
    },

    assignPurpose: (purpose, providerId, updatedAt) => {
      check();
      if (!LLM_PURPOSES.includes(purpose)) {
        throw new Error(`Invalid LLM purpose: ${purpose}`);
      }
      orm
        .insert(llmPurposeAssignment)
        .values({ purpose, providerId, updatedAt })
        .onConflictDoUpdate({
          target: llmPurposeAssignment.purpose,
          set: { providerId, updatedAt },
        })
        .run();
    },

    findAssignment: (purpose) => {
      check();
      const row = orm
        .select()
        .from(llmPurposeAssignment)
        .where(eq(llmPurposeAssignment.purpose, purpose))
        .get();
      return row as LlmPurposeAssignmentRow | undefined;
    },

    listAssignments: () => {
      check();
      const rows = orm.select().from(llmPurposeAssignment).all();
      return rows as LlmPurposeAssignmentRow[];
    },

    unassignPurpose: (purpose) => {
      check();
      const result = orm
        .delete(llmPurposeAssignment)
        .where(eq(llmPurposeAssignment.purpose, purpose))
        .run();
      return result.changes > 0;
    },

    findForPurpose: (purpose) => {
      check();
      const assignment = orm
        .select()
        .from(llmPurposeAssignment)
        .where(eq(llmPurposeAssignment.purpose, purpose))
        .get();
      if (!assignment) {
        return undefined;
      }
      const provider = orm
        .select()
        .from(llmProvider)
        .where(eq(llmProvider.id, assignment.providerId))
        .get();
      return provider as LlmProviderRow | undefined;
    },

    findSafeForPurpose: (purpose) => {
      check();
      const assignment = orm
        .select()
        .from(llmPurposeAssignment)
        .where(eq(llmPurposeAssignment.purpose, purpose))
        .get();
      if (!assignment) {
        return undefined;
      }
      const provider = orm
        .select({
          id: llmProvider.id,
          name: llmProvider.name,
          kind: llmProvider.kind,
          baseUrl: llmProvider.baseUrl,
          model: llmProvider.model,
          apiKeyLast4: llmProvider.apiKeyLast4,
          isLocal: llmProvider.isLocal,
          cloudPdf: llmProvider.cloudPdf,
          cloudRows: llmProvider.cloudRows,
          createdAt: llmProvider.createdAt,
          updatedAt: llmProvider.updatedAt,
        })
        .from(llmProvider)
        .where(eq(llmProvider.id, assignment.providerId))
        .get();
      return provider as LlmProviderSafeView | undefined;
    },
  };
}
