import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { createIdGenerator } from "../ids.ts";
import type { LlmProvider, StructuredPrompt, StructuredResponse } from "../ports/llm-provider.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { categorisePendingTransactions } from "./categorise-pending.ts";

const now = Temporal.Instant.from("2026-10-26T12:00:00.000Z");
const clock = manualClock("2026-10-26T12:00:00.000Z");

function createMockLlm(
  fn?: (prompt: StructuredPrompt<unknown>) => unknown,
): LlmProvider & { prompts: StructuredPrompt<unknown>[] } {
  const prompts: StructuredPrompt<unknown>[] = [];
  return {
    prompts,
    generateStructured: async <T>(prompt: StructuredPrompt<T>): Promise<StructuredResponse<T>> => {
      prompts.push(prompt as StructuredPrompt<unknown>);
      const data = fn ? (fn(prompt as StructuredPrompt<unknown>) as T) : { suggestions: [] };
      return {
        data: data as T,
        raw: JSON.stringify(data),
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        model: prompt.model ?? "mock-model",
      };
    },
  };
}

function setupTestEnvironment() {
  let ms = 1793000000000;
  const newId = createIdGenerator({ now: () => ++ms, random: () => 0.5 });
  const uow = memoryUnitOfWork();

  const viewer = systemViewer("cli:categorise");

  const accountId = newId<"Account">();
  uow.state.accounts.push({
    id: accountId,
    name: "Everyday Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const privateAccountId = newId<"Account">();
  uow.state.accounts.push({
    id: privateAccountId,
    name: "Alex Secret",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const groupId = newId<"CategoryGroup">();
  uow.state.categoryGroups.push({
    id: groupId,
    name: "Food",
    kind: "expense",
    sort: 0,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const groceriesId = newId<"Category">();
  const diningId = newId<"Category">();
  uow.state.categories.push(
    {
      id: groceriesId,
      groupId,
      name: "Groceries",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: diningId,
      groupId,
      name: "Dining out",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  return { uow, newId, viewer, accountId, privateAccountId, groceriesId, diningId };
}

/** Insert a posted transaction; `categorised` decides whether its only split has a category. */
function insertTransaction(
  env: ReturnType<typeof setupTestEnvironment>,
  options: {
    description: string;
    postedOn: string;
    categorised: boolean;
    accountId?: Id<"Account">;
  },
): string {
  const txnId = env.newId<"Transaction">();
  const splitId = env.newId<"Split">();
  env.uow.state.transactions.push({
    id: txnId,
    accountId: options.accountId ?? env.accountId,
    postedOn: options.postedOn,
    amountCents: -1500,
    descriptionRaw: options.description,
    fingerprint: `fp-${txnId}`,
    fingerprintVersion: 1,
    status: "posted",
    externalId: null,
    importId: null,
    isHidden: false,
    performedBy: null,
    payeeId: null,
    notes: null,
    nameHiddenUntil: null,
    nameHiddenBy: null,
    transferGroupId: null,
    needsReview: !options.categorised,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  env.uow.state.splits.push({
    id: splitId,
    transactionId: txnId,
    amountCents: -1500,
    categoryId: options.categorised ? env.groceriesId : null,
    activityId: null,
    beneficiary: "shared",
    propertyId: null,
    taxCategoryId: null,
    deductibleBp: null,
    memo: null,
    categorySource: null,
    activitySource: null,
    taxCategorySource: null,
    beneficiarySource: "user",
    deductibleBpSource: null,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  return txnId;
}

function assignCategoriseProvider(
  env: ReturnType<typeof setupTestEnvironment>,
  overrides: { apiKeyCiphertext?: string | null; isLocal?: boolean; baseUrl?: string } = {},
): string {
  const providerId = env.newId<"LlmProvider">();
  env.uow.state.llmProviders.push({
    id: providerId,
    name: "Mock",
    kind: "openai",
    baseUrl: overrides.baseUrl ?? "http://127.0.0.1:4111",
    model: "mock-model",
    apiKeyCiphertext: overrides.apiKeyCiphertext ?? null,
    apiKeyLast4: null,
    isLocal: overrides.isLocal ?? true,
    cloudPdf: false,
    cloudRows: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  env.uow.state.llmPurposeAssignments.push({
    purpose: "categorise",
    providerId,
    updatedAt: now.toString(),
  });
  return providerId;
}

describe("categorisePendingTransactions", () => {
  it("selects transactions with unclassified splits and records the engine's suggestions", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env);
    insertTransaction(env, {
      description: "Woolworths Metro",
      postedOn: "2026-10-20",
      categorised: false,
    });
    insertTransaction(env, {
      description: "Coffee Bureau",
      postedOn: "2026-10-21",
      categorised: false,
    });
    insertTransaction(env, {
      description: "Already Filed",
      postedOn: "2026-10-22",
      categorised: true,
    });

    const mockLlm = createMockLlm(() => ({
      suggestions: [
        { index: 0, category_id: env.groceriesId, confidence: 0.92 },
        { index: 1, category_id: env.groceriesId, confidence: 0.92 },
      ],
    }));

    const result = await categorisePendingTransactions(
      {
        viewer: env.viewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      {},
    );

    expect(result).toEqual({ candidates: 2, recordedCount: 2, discardedCount: 0 });
    // Only the categorised-free transactions were submitted, newest first.
    const promptText = String(mockLlm.prompts[0]?.prompt ?? "");
    expect(promptText).toContain("Coffee Bureau");
    expect(promptText).toContain("Woolworths Metro");
    expect(promptText).not.toContain("Already Filed");
    expect(promptText.indexOf("Coffee Bureau")).toBeLessThan(
      promptText.indexOf("Woolworths Metro"),
    );
    const open = env.uow.state.suggestions.filter((s) => s.outcome === "open");
    expect(open).toHaveLength(2);
  });

  it("a run with no unclassified transactions is a clean no-op even with no provider wired", async () => {
    const env = setupTestEnvironment();
    insertTransaction(env, {
      description: "Already Filed",
      postedOn: "2026-10-20",
      categorised: true,
    });

    const result = await categorisePendingTransactions(
      { viewer: env.viewer, clock, uow: env.uow, newId: env.newId },
      {},
    );

    expect(result).toEqual({ candidates: 0, recordedCount: 0, discardedCount: 0 });
  });

  it("candidates with no provider configured raise the engine's provider error", async () => {
    const env = setupTestEnvironment();
    insertTransaction(env, {
      description: "Unknown Merchant",
      postedOn: "2026-10-20",
      categorised: false,
    });

    await expect(
      categorisePendingTransactions(
        { viewer: env.viewer, clock, uow: env.uow, newId: env.newId },
        {},
      ),
    ).rejects.toThrow(/No LLM provider configured for categorisation/);
  });

  it("counts suggestions the engine discards for unknown category ids", async () => {
    const env = setupTestEnvironment();
    const unknownCategoryId = env.newId<"Category">(); // generated but never registered
    assignCategoriseProvider(env);
    insertTransaction(env, {
      description: "Mystery Shop",
      postedOn: "2026-10-20",
      categorised: false,
    });

    const mockLlm = createMockLlm(() => ({
      suggestions: [{ index: 0, category_id: unknownCategoryId, confidence: 0.95 }],
    }));

    const result = await categorisePendingTransactions(
      {
        viewer: env.viewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      {},
    );

    expect(result).toEqual({ candidates: 1, recordedCount: 0, discardedCount: 1 });
  });

  it("submits at most `limit` candidates, newest first", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env);
    for (const day of ["2026-10-19", "2026-10-20", "2026-10-21"]) {
      insertTransaction(env, { description: `Shop ${day}`, postedOn: day, categorised: false });
    }

    const mockLlm = createMockLlm(() => ({ suggestions: [] }));
    const result = await categorisePendingTransactions(
      {
        viewer: env.viewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      { limit: 2 },
    );

    expect(result.candidates).toBe(2);
    const promptText = String(mockLlm.prompts[0]?.prompt ?? "");
    expect(promptText).toContain("Shop 2026-10-21");
    expect(promptText).toContain("Shop 2026-10-20");
    expect(promptText).not.toContain("Shop 2026-10-19");
  });

  it("decrypts the purpose provider's key through the createProvider factory", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env, { apiKeyCiphertext: "enc-key" });
    insertTransaction(env, {
      description: "Corner Store",
      postedOn: "2026-10-20",
      categorised: false,
    });

    const mockLlm = createMockLlm(() => ({
      suggestions: [{ index: 0, category_id: env.diningId, confidence: 0.88 }],
    }));
    let decryptCall: { ciphertext: string; secret: string } | undefined;
    let createdWithApiKey: string | undefined;

    const result = await categorisePendingTransactions(
      {
        viewer: env.viewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        authSecret: "app-secret",
        decryptApiKey: (ciphertext, secret) => {
          decryptCall = { ciphertext, secret };
          return "plain-key";
        },
        createProvider: (_row, apiKey) => {
          createdWithApiKey = apiKey;
          return mockLlm;
        },
      },
      {},
    );

    expect(result).toEqual({ candidates: 1, recordedCount: 1, discardedCount: 0 });
    expect(decryptCall).toEqual({ ciphertext: "enc-key", secret: "app-secret" });
    expect(createdWithApiKey).toBe("plain-key");
  });

  it("skips a private account's rows for a cloud provider instead of aborting (AD-6)", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env, { isLocal: false, baseUrl: "https://api.openai.com" });
    insertTransaction(env, {
      description: "Private Pharmacy",
      postedOn: "2026-10-21",
      categorised: false,
      accountId: env.privateAccountId,
    });
    insertTransaction(env, {
      description: "Joint Hardware",
      postedOn: "2026-10-20",
      categorised: false,
    });

    const mockLlm = createMockLlm(() => ({
      suggestions: [{ index: 0, category_id: env.groceriesId, confidence: 0.92 }],
    }));

    const result = await categorisePendingTransactions(
      {
        viewer: env.viewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        createProvider: () => mockLlm,
      },
      {},
    );

    // The cloud run categorises the shared row; the private row stays uncategorised.
    expect(result).toEqual({ candidates: 1, recordedCount: 1, discardedCount: 0 });
    const promptText = String(mockLlm.prompts[0]?.prompt ?? "");
    expect(promptText).toContain("Joint Hardware");
    expect(promptText).not.toContain("Private Pharmacy");
    expect(env.uow.state.suggestions.filter((s) => s.outcome === "open")).toHaveLength(1);
  });

  it("a cloud provider with only private candidates is a clean no-op, never a call (AD-6)", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env, { isLocal: false, baseUrl: "https://api.openai.com" });
    insertTransaction(env, {
      description: "Private Pharmacy",
      postedOn: "2026-10-20",
      categorised: false,
      accountId: env.privateAccountId,
    });

    const mockLlm = createMockLlm();
    const result = await categorisePendingTransactions(
      { viewer: env.viewer, clock, uow: env.uow, newId: env.newId, createProvider: () => mockLlm },
      {},
    );

    expect(result).toEqual({ candidates: 0, recordedCount: 0, discardedCount: 0 });
    expect(mockLlm.prompts).toHaveLength(0);
  });

  it("a local provider still categorises a private account's rows", async () => {
    const env = setupTestEnvironment();
    assignCategoriseProvider(env);
    insertTransaction(env, {
      description: "Private Pharmacy",
      postedOn: "2026-10-20",
      categorised: false,
      accountId: env.privateAccountId,
    });

    const mockLlm = createMockLlm(() => ({
      suggestions: [{ index: 0, category_id: env.diningId, confidence: 0.92 }],
    }));

    const result = await categorisePendingTransactions(
      { viewer: env.viewer, clock, uow: env.uow, newId: env.newId, createProvider: () => mockLlm },
      {},
    );

    expect(result).toEqual({ candidates: 1, recordedCount: 1, discardedCount: 0 });
    const promptText = String(mockLlm.prompts[0]?.prompt ?? "");
    expect(promptText).toContain("Private Pharmacy");
  });
});
