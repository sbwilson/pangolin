import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import type { LlmProvider, StructuredPrompt } from "../ports/llm-provider.ts";
import {
  LLM_PURPOSES,
  type LlmProviderKind,
  type LlmProviderRow,
  type LlmProviderSafeView,
  type LlmPurpose,
  type LlmPurposeAssignmentRow,
} from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import {
  buildCategorisationRequest,
  type CategoriseCategoryOption,
  type CategoriseRequestItem,
} from "./categorise-request.ts";

export interface LlmUseCaseContext extends UseCaseContext {
  readonly authSecret?: string | undefined;
  readonly isLanAddress?: ((url: string) => boolean) | undefined;
  readonly encryptApiKey?: ((key: string, secret: string) => string) | undefined;
  readonly decryptApiKey?: ((ciphertext: string, secret: string) => string) | undefined;
  readonly createProvider?: ((row: LlmProviderRow, apiKey?: string) => LlmProvider) | undefined;
}

export function toSafeView(row: LlmProviderRow): LlmProviderSafeView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKeyLast4: row.apiKeyLast4,
    isLocal: row.isLocal,
    cloudPdf: row.cloudPdf,
    cloudRows: row.cloudRows,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function extractApiKeyLast4(apiKey: string): string {
  if (apiKey.length <= 4) return apiKey;
  return apiKey.slice(-4);
}

/** Fallback LAN/local check if context does not inject isLanAddress. */
function defaultIsLanAddress(urlOrHost: string): boolean {
  try {
    const url = urlOrHost.includes("://") ? new URL(urlOrHost) : new URL(`http://${urlOrHost}`);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "local" ||
      host.endsWith(".local")
    ) {
      return true;
    }
    if (
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }
    if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// getLlmSettings
// -----------------------------------------------------------------------------

export interface LlmSettingsResult {
  readonly providers: readonly LlmProviderSafeView[];
  readonly assignments: readonly LlmPurposeAssignmentRow[];
}

export function getLlmSettings(ctx: UseCaseContext): LlmSettingsResult {
  if (ctx.viewer.kind !== "person" && ctx.viewer.kind !== "system") {
    throw new AppError("Unauthenticated", "Must be signed in to view LLM settings");
  }

  return ctx.uow.read((repos) => ({
    providers: repos.llmProviders.listSafe(),
    assignments: repos.llmProviders.listAssignments(),
  }));
}

// -----------------------------------------------------------------------------
// createLlmProvider
// -----------------------------------------------------------------------------

function isValidHttpUrl(val: string): boolean {
  try {
    const u = new URL(val);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const createLlmProviderInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["openai", "anthropic"]),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Base URL is required")
    .refine(isValidHttpUrl, { message: "Base URL must be an http: or https: URL" }),
  model: z.string().trim().min(1, "Model is required"),
  apiKey: z.string().trim().optional().nullable(),
  cloudPdf: z.boolean().optional(),
  cloudRows: z.boolean().optional(),
});
export type CreateLlmProviderInput = z.input<typeof createLlmProviderInputSchema>;

export function createLlmProvider(
  ctx: LlmUseCaseContext,
  input: CreateLlmProviderInput,
): LlmProviderSafeView {
  requireRecentAuth(ctx);
  const parsed = parseInput(createLlmProviderInputSchema, input);

  const checkLan = ctx.isLanAddress ?? defaultIsLanAddress;
  const isLocal = checkLan(parsed.baseUrl);

  let apiKeyLast4: string | null = null;
  let apiKeyCiphertext: string | null = null;

  if (parsed.apiKey && parsed.apiKey.length > 0) {
    apiKeyLast4 = extractApiKeyLast4(parsed.apiKey);
    if (ctx.encryptApiKey && ctx.authSecret) {
      apiKeyCiphertext = ctx.encryptApiKey(parsed.apiKey, ctx.authSecret);
    } else if (ctx.encryptApiKey && !ctx.authSecret) {
      throw new AppError("Validation", "Encryption secret not configured");
    } else {
      apiKeyCiphertext = parsed.apiKey;
    }
  }

  return write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const row: LlmProviderRow = {
      id: ctx.newId<"LlmProvider">(),
      name: parsed.name,
      kind: parsed.kind,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      apiKeyCiphertext,
      apiKeyLast4,
      isLocal,
      cloudPdf: isLocal ? false : (parsed.cloudPdf ?? false),
      cloudRows: isLocal ? false : (parsed.cloudRows ?? false),
      createdAt: at,
      updatedAt: at,
    };

    tx.llmProviders.insert(row);
    const safe = toSafeView(row);
    audit({
      entity: "llm_provider",
      entityId: row.id,
      action: "create",
      before: null,
      after: safe,
    });
    return safe;
  });
}

// -----------------------------------------------------------------------------
// updateLlmProvider
// -----------------------------------------------------------------------------

export const updateLlmProviderInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  kind: z.enum(["openai", "anthropic"]).optional(),
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .refine(isValidHttpUrl, { message: "Base URL must be an http: or https: URL" })
    .optional(),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().optional().nullable(),
  cloudPdf: z.boolean().optional(),
  cloudRows: z.boolean().optional(),
});
export type UpdateLlmProviderInput = z.input<typeof updateLlmProviderInputSchema>;

export function updateLlmProvider(
  ctx: LlmUseCaseContext,
  input: UpdateLlmProviderInput,
): LlmProviderSafeView {
  requireRecentAuth(ctx);
  const parsed = parseInput(updateLlmProviderInputSchema, input);

  return write(ctx, (tx, audit) => {
    const existing = tx.llmProviders.findById(parsed.id);
    if (!existing) {
      throw new AppError("NotFound", "LLM provider not found");
    }

    const baseUrl = parsed.baseUrl ?? existing.baseUrl;
    const checkLan = ctx.isLanAddress ?? defaultIsLanAddress;
    const isLocal = checkLan(baseUrl);

    let apiKeyLast4 = existing.apiKeyLast4;
    let apiKeyCiphertext = existing.apiKeyCiphertext;

    if (parsed.apiKey !== undefined) {
      if (parsed.apiKey && parsed.apiKey.length > 0) {
        apiKeyLast4 = extractApiKeyLast4(parsed.apiKey);
        if (ctx.encryptApiKey && ctx.authSecret) {
          apiKeyCiphertext = ctx.encryptApiKey(parsed.apiKey, ctx.authSecret);
        } else if (ctx.encryptApiKey && !ctx.authSecret) {
          throw new AppError("Validation", "Encryption secret not configured");
        } else {
          apiKeyCiphertext = parsed.apiKey;
        }
      } else {
        apiKeyLast4 = null;
        apiKeyCiphertext = null;
      }
    }

    const at = formatInstant(ctx.clock.now());
    const updated: LlmProviderRow = {
      ...existing,
      name: parsed.name ?? existing.name,
      kind: (parsed.kind ?? existing.kind) as LlmProviderKind,
      baseUrl,
      model: parsed.model ?? existing.model,
      apiKeyCiphertext,
      apiKeyLast4,
      isLocal,
      cloudPdf: isLocal ? false : (parsed.cloudPdf ?? existing.cloudPdf),
      cloudRows: isLocal ? false : (parsed.cloudRows ?? existing.cloudRows),
      updatedAt: at,
    };

    tx.llmProviders.update(updated);
    const safe = toSafeView(updated);
    audit({
      entity: "llm_provider",
      entityId: updated.id,
      action: "update",
      before: toSafeView(existing),
      after: safe,
    });
    return safe;
  });
}

// -----------------------------------------------------------------------------
// deleteLlmProvider
// -----------------------------------------------------------------------------

export function deleteLlmProvider(
  ctx: LlmUseCaseContext,
  input: { readonly id: string },
): { readonly success: true } {
  requireRecentAuth(ctx);

  return write(ctx, (tx, audit) => {
    const existing = tx.llmProviders.findById(input.id);
    if (!existing) {
      throw new AppError("NotFound", "LLM provider not found");
    }

    const assignments = tx.llmProviders.listAssignments().filter((a) => a.providerId === input.id);
    for (const a of assignments) {
      tx.llmProviders.unassignPurpose(a.purpose);
      audit({
        entity: "llm_purpose_assignment",
        entityId: a.purpose,
        action: "unassign",
        before: { purpose: a.purpose, providerId: a.providerId },
        after: null,
      });
    }

    tx.llmProviders.delete(input.id);
    audit({
      entity: "llm_provider",
      entityId: input.id,
      action: "delete",
      before: toSafeView(existing),
      after: null,
    });
    return { success: true };
  });
}

// -----------------------------------------------------------------------------
// assignLlmPurpose
// -----------------------------------------------------------------------------

export const assignLlmPurposeInputSchema = z.object({
  purpose: z.enum(LLM_PURPOSES),
  providerId: z.string().nullable(),
});
export type AssignLlmPurposeInput = z.input<typeof assignLlmPurposeInputSchema>;

export function assignLlmPurpose(
  ctx: LlmUseCaseContext,
  input: AssignLlmPurposeInput,
): { readonly purpose: LlmPurpose; readonly providerId: string | null } {
  requireRecentAuth(ctx);
  const parsed = parseInput(assignLlmPurposeInputSchema, input);

  return write(ctx, (tx, audit) => {
    const existing = tx.llmProviders.findAssignment(parsed.purpose);
    const at = formatInstant(ctx.clock.now());
    if (parsed.providerId === null) {
      tx.llmProviders.unassignPurpose(parsed.purpose);
      audit({
        entity: "llm_purpose_assignment",
        entityId: parsed.purpose,
        action: "unassign",
        before: existing ? { purpose: existing.purpose, providerId: existing.providerId } : null,
        after: null,
      });
      return { purpose: parsed.purpose, providerId: null };
    }

    const provider = tx.llmProviders.findById(parsed.providerId);
    if (!provider) {
      throw new AppError("NotFound", "LLM provider not found");
    }

    tx.llmProviders.assignPurpose(parsed.purpose, parsed.providerId, at);
    audit({
      entity: "llm_purpose_assignment",
      entityId: parsed.purpose,
      action: "assign",
      before: existing ? { purpose: existing.purpose, providerId: existing.providerId } : null,
      after: { purpose: parsed.purpose, providerId: parsed.providerId },
    });
    return { purpose: parsed.purpose, providerId: parsed.providerId };
  });
}

// -----------------------------------------------------------------------------
// testLlmProvider
// -----------------------------------------------------------------------------

export interface TestLlmProviderInput {
  readonly id: string;
}

export interface TestLlmProviderResult {
  readonly ok: boolean;
  readonly latencyMs?: number | undefined;
  readonly error?: string | undefined;
}

export async function testLlmProvider(
  ctx: LlmUseCaseContext,
  input: TestLlmProviderInput,
): Promise<TestLlmProviderResult> {
  if (ctx.viewer.kind !== "person" && ctx.viewer.kind !== "system") {
    throw new AppError("Unauthenticated", "Must be signed in to test LLM provider");
  }

  const row = ctx.uow.read((repos) => repos.llmProviders.findById(input.id));
  if (!row) {
    throw new AppError("NotFound", "LLM provider not found");
  }

  let apiKey: string | undefined;
  if (row.apiKeyCiphertext) {
    if (ctx.decryptApiKey && ctx.authSecret) {
      try {
        apiKey = ctx.decryptApiKey(row.apiKeyCiphertext, ctx.authSecret);
      } catch (err: unknown) {
        return {
          ok: false,
          error: "Failed to decrypt API key for testing",
        };
      }
    } else if (ctx.decryptApiKey && !ctx.authSecret) {
      return {
        ok: false,
        error: "Encryption secret not configured",
      };
    } else {
      apiKey = row.apiKeyCiphertext;
    }
  }

  if (!ctx.createProvider) {
    throw new AppError("Validation", "Provider adapter factory not configured");
  }

  const provider = ctx.createProvider(row, apiKey);

  const pingPrompt: StructuredPrompt<{ ok: boolean }> = {
    schemaName: "ping",
    schemaDescription: "Connectivity test ping",
    schema: z.object({ ok: z.boolean() }),
    prompt: 'Respond with JSON matching schema: {"ok": true}',
    timeoutMs: 15_000,
  };

  const startMs = Date.now();
  try {
    await provider.generateStructured(pingPrompt);
    const latencyMs = Math.max(1, Date.now() - startMs);
    return { ok: true, latencyMs };
  } catch (err: unknown) {
    let msg = err instanceof Error ? err.message : String(err);
    if (apiKey) {
      const masked = apiKey.length > 4 ? `***${apiKey.slice(-4)}` : "***";
      msg = msg.replaceAll(apiKey, masked);
    }
    return { ok: false, error: msg };
  }
}

// -----------------------------------------------------------------------------
// getLlmRequestPreview
// -----------------------------------------------------------------------------

export const getLlmRequestPreviewInputSchema = z.object({
  purpose: z.enum(LLM_PURPOSES).optional(),
  providerId: z.string().optional(),
});
export type GetLlmRequestPreviewInput = z.infer<typeof getLlmRequestPreviewInputSchema>;

export interface LlmRequestPreviewResult {
  readonly provider: LlmProviderSafeView | null;
  readonly isLocal: boolean;
  readonly model?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly prompt: string;
  readonly schemaName: string;
  readonly schemaDescription?: string | undefined;
  readonly sampleItems: readonly CategoriseRequestItem[];
}

export function getLlmRequestPreview(
  ctx: UseCaseContext,
  input?: GetLlmRequestPreviewInput,
): LlmRequestPreviewResult {
  if (ctx.viewer.kind !== "person" && ctx.viewer.kind !== "system") {
    throw new AppError("Unauthenticated", "Must be signed in to preview LLM request");
  }
  const parsed = parseInput(getLlmRequestPreviewInputSchema, input ?? {});

  return ctx.uow.read((repos) => {
    let provider: LlmProviderSafeView | null = null;
    if (parsed.providerId) {
      provider = repos.llmProviders.findSafe(parsed.providerId) ?? null;
    } else {
      provider = repos.llmProviders.findSafeForPurpose(parsed.purpose ?? "categorise") ?? null;
    }

    const isLocal = provider?.isLocal ?? false;
    const model = provider?.model;

    // Categories
    const categoriesList = repos.categories.list(ctx.viewer);
    const groupsList = repos.categoryGroups.list(ctx.viewer);
    const groupMap = new Map(groupsList.map((g) => [g.id, g.name]));

    const categories: CategoriseCategoryOption[] =
      categoriesList.length > 0
        ? categoriesList.map((c) => ({
            id: c.id,
            name: c.name,
            groupName: groupMap.get(c.groupId),
          }))
        : [
            { id: "groceries", name: "Groceries", groupName: "Food" },
            { id: "utilities", name: "Utilities", groupName: "Bills" },
            { id: "transport", name: "Transport", groupName: "Living" },
          ];

    // Public transactions sample (never private accounts)
    const publicAccounts = repos.accounts.list(ctx.viewer).filter((a) => !a.isPrivate);
    const publicAccountIds = new Set(publicAccounts.map((a) => a.id));

    const today = ctx.clock.today().toString();
    const allTxns = repos.transactions.listVisible(ctx.viewer, today);
    const publicTxns = allTxns.filter(
      (t) => publicAccountIds.has(t.accountId) && !t.nameHidden && t.descriptionRaw !== null,
    );

    let sampleItems: CategoriseRequestItem[];
    if (publicTxns.length > 0) {
      sampleItems = publicTxns.slice(0, 3).map((t, idx) => ({
        index: idx,
        description: t.descriptionRaw ?? "Sample Transaction",
        amountCents: t.amountCents,
        postedOn: t.postedOn,
        isPrivate: false,
      }));
    } else {
      sampleItems = [
        {
          index: 0,
          description: "WOOLWORTHS 3125 SYDNEY",
          amountCents: -5420,
          postedOn: today,
          isPrivate: false,
        },
        {
          index: 1,
          description: "ORIGIN ENERGY ELECTRICITY",
          amountCents: -18550,
          postedOn: today,
          isPrivate: false,
        },
      ];
    }

    const structuredPrompt = buildCategorisationRequest({
      items: sampleItems,
      categories,
      fewShotExamples: [],
      isLocal,
      model,
    });

    return {
      provider,
      isLocal,
      model,
      systemPrompt: structuredPrompt.systemPrompt,
      prompt: structuredPrompt.prompt,
      schemaName: structuredPrompt.schemaName,
      schemaDescription: structuredPrompt.schemaDescription,
      sampleItems,
    };
  });
}
