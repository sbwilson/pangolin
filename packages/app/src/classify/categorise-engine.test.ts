import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import type { LlmProvider, StructuredPrompt, StructuredResponse } from "../ports/llm-provider.ts";
import type { SuggestionRow } from "../ports/unit-of-work.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { categoriseTransactions } from "./categorise-engine.ts";
import {
  CATEGORISE_PROMPT_VERSION,
  buildCategorisationRequest,
} from "./categorise-request.ts";
import { findFewShotExamples } from "./few-shot-search.ts";

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
      const data = fn ? (fn(prompt as StructuredPrompt<unknown>) as T) : ({ suggestions: [] } as T);
      return {
        data,
        raw: JSON.stringify(data),
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        model: prompt.model ?? "mock-model",
      };
    },
  };
}

function setupTestEnvironment() {
  let ms = 1793000000000;
  const newId = createIdGenerator({
    now: () => ++ms,
    random: () => 0.5,
  });
  const uow = memoryUnitOfWork();

  const alexPersonId = newId<"Person">();
  const samPersonId = newId<"Person">();

  const alexViewer: Viewer = {
    kind: "person",
    personId: alexPersonId,
    authAt: now,
  };

  const publicAccountId = newId<"Account">();
  const privateAccountId = newId<"Account">();

  // Seed people
  uow.state.people.push(
    {
      id: alexPersonId,
      userId: "user-alex",
      displayName: "Alex",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: samPersonId,
      userId: "user-sam",
      displayName: "Sam",
      colour: "#0000ff",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  // Seed accounts (one public, one private to Alex)
  uow.state.accounts.push(
    {
      id: publicAccountId,
      name: "Everyday Joint",
      type: "cash",
      currency: "AUD",
      isPrivate: false,
      savingsPool: "shared",
      institutionId: null,
      accountNumberLast4: "1234",
      closedOn: null,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: privateAccountId,
      name: "Alex Secret",
      type: "cash",
      currency: "AUD",
      isPrivate: true,
      savingsPool: alexPersonId,
      institutionId: null,
      accountNumberLast4: "5678",
      closedOn: null,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  uow.state.accountOwners.push(
    {
      id: newId<"AccountOwner">(),
      accountId: publicAccountId,
      personId: alexPersonId,
      createdAt: now.toString(),
    },
    {
      id: newId<"AccountOwner">(),
      accountId: publicAccountId,
      personId: samPersonId,
      createdAt: now.toString(),
    },
    {
      id: newId<"AccountOwner">(),
      accountId: privateAccountId,
      personId: alexPersonId,
      createdAt: now.toString(),
    },
  );

  // Seed categories
  const catGroceries = newId<"Category">();
  const catDining = newId<"Category">();
  const catFuel = newId<"Category">();

  const groupFood = newId<"CategoryGroup">();
  const groupTransport = newId<"CategoryGroup">();

  uow.state.categoryGroups.push(
    {
      id: groupFood,
      name: "Food",
      kind: "expense",
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: groupTransport,
      name: "Transport",
      kind: "expense",
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  uow.state.categories.push(
    {
      id: catGroceries,
      groupId: groupFood,
      name: "Groceries",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: catDining,
      groupId: groupFood,
      name: "Dining out",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: catFuel,
      groupId: groupTransport,
      name: "Fuel",
      isFixedCost: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  return {
    uow,
    newId,
    alexViewer,
    alexPersonId,
    publicAccountId,
    privateAccountId,
    categories: {
      groceries: catGroceries,
      dining: catDining,
      fuel: catFuel,
    },
  };
}

describe("Few-shot FTS5 search", () => {
  it("returns up to 10 past categorised transactions matching description from public accounts", () => {
    const env = setupTestEnvironment();

    // Add past categorised transactions to public account
    for (let i = 1; i <= 15; i++) {
      const txnId = env.newId<"Transaction">();
      const splitId = env.newId<"Split">();
      env.uow.state.transactions.push({
        id: txnId,
        accountId: env.publicAccountId,
        postedOn: `2026-10-${String(i).padStart(2, "0")}`,
        amountCents: -5000,
        descriptionRaw: i % 2 === 0 ? "Woolworths Metro Sydney" : "Woolworths Supermarket",
        fingerprint: `fp-${i}`,
        fingerprintVersion: 1,
        status: "posted",
        performedBy: null,
        payeeId: null,
        notes: null,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        needsReview: false,
        searchId: i,
        createdAt: now.toString(),
        updatedAt: now.toString(),
        deletedAt: null,
      });
      env.uow.state.splits.push({
        id: splitId,
        transactionId: txnId,
        amountCents: -5000,
        categoryId: env.categories.groceries,
        activityId: null,
        beneficiary: "shared",
        propertyId: null,
        taxCategoryId: null,
        deductibleBp: null,
        memo: null,
        categorySource: "user",
        activitySource: null,
        taxCategorySource: null,
        beneficiarySource: "user",
        deductibleBpSource: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });
    }

    const results = env.uow.read((repos) =>
      findFewShotExamples(
        repos,
        env.alexViewer,
        clock.today().toString(),
        "Woolworths Metro",
      ),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0]?.categoryId).toBe(env.categories.groceries);
  });

  it("never includes few-shot examples from private accounts", () => {
    const env = setupTestEnvironment();

    // Past categorised transaction in private account
    const privTxnId = env.newId<"Transaction">();
    const privSplitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: privTxnId,
      accountId: env.privateAccountId,
      postedOn: "2026-10-15",
      amountCents: -12000,
      descriptionRaw: "Woolworths Private Special",
      fingerprint: "fp-priv",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: false,
      searchId: 99,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: privSplitId,
      transactionId: privTxnId,
      amountCents: -12000,
      categoryId: env.categories.groceries,
      activityId: null,
      beneficiary: env.alexPersonId,
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: "user",
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: "user",
      deductibleBpSource: null,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const results = env.uow.read((repos) =>
      findFewShotExamples(
        repos,
        env.alexViewer,
        clock.today().toString(),
        "Woolworths Private",
      ),
    );

    // Private account must not be used as few-shot example
    expect(results).toHaveLength(0);
  });

  it("returns empty array when no transactions match query", () => {
    const env = setupTestEnvironment();
    const results = env.uow.read((repos) =>
      findFewShotExamples(
        repos,
        env.alexViewer,
        clock.today().toString(),
        "UnmatchedQuery12345",
      ),
    );
    expect(results).toEqual([]);
  });
});

describe("Categorisation request builder & AD-6 privacy sanitiser", () => {
  it("rejects private account items when dispatched to cloud provider", () => {
    const env = setupTestEnvironment();

    expect(() =>
      buildCategorisationRequest({
        items: [
          {
            index: 0,
            description: "Secret Purchase",
            amountCents: -5000,
            postedOn: "2026-10-25",
            isPrivate: true,
          },
        ],
        categories: [{ id: env.categories.groceries, name: "Groceries" }],
        isLocal: false,
      }),
    ).toThrow(AppError);

    try {
      buildCategorisationRequest({
        items: [
          {
            index: 0,
            description: "Secret Purchase",
            amountCents: -5000,
            postedOn: "2026-10-25",
            isPrivate: true,
          },
        ],
        categories: [{ id: env.categories.groceries, name: "Groceries" }],
        isLocal: false,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("PermissionDenied");
    }
  });

  it("strictly sanitises cloud payloads to description, amount, date, and categories", () => {
    const env = setupTestEnvironment();

    const prompt = buildCategorisationRequest({
      items: [
        {
          index: 0,
          description: "Woolworths Metro",
          amountCents: -4520,
          postedOn: "2026-10-25",
          isPrivate: false,
        },
      ],
      categories: [
        { id: env.categories.groceries, name: "Groceries", groupName: "Food" },
      ],
      isLocal: false,
    });

    expect(prompt.prompt).toContain("Woolworths Metro");
    expect(prompt.prompt).toContain("45.20 AUD");
    expect(prompt.prompt).toContain("2026-10-25");
    expect(prompt.prompt).toContain("Groceries");

    // Must never leak account names, person names, or arbitrary account metadata
    expect(prompt.prompt).not.toContain("Everyday Joint");
    expect(prompt.prompt).not.toContain("Alex");
    expect(prompt.prompt).not.toContain("Sam");
  });
});

describe("Categorisation Engine", () => {
  it("categorises a batch of public transactions on cloud provider", async () => {
    const env = setupTestEnvironment();

    // Create 15 unclassified transactions in public account
    const txnIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const txnId = env.newId<"Transaction">();
      const splitId = env.newId<"Split">();
      txnIds.push(txnId);

      env.uow.state.transactions.push({
        id: txnId,
        accountId: env.publicAccountId,
        postedOn: "2026-10-26",
        amountCents: -(1000 + i * 100),
        descriptionRaw: `Merchant ${i}`,
        fingerprint: `fp-test-${i}`,
        fingerprintVersion: 1,
        status: "posted",
        performedBy: null,
        payeeId: null,
        notes: null,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        needsReview: true,
        searchId: 100 + i,
        createdAt: now.toString(),
        updatedAt: now.toString(),
        deletedAt: null,
      });

      env.uow.state.splits.push({
        id: splitId,
        transactionId: txnId,
        amountCents: -(1000 + i * 100),
        categoryId: null,
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
    }

    const mockLlm = createMockLlm((prompt) => {
      // Return suggestions for all 15 items
      return {
        suggestions: Array.from({ length: 15 }, (_, idx) => ({
          index: idx,
          payee_name: `Clean Merchant ${idx}`,
          website_domain: `merchant${idx}.com.au`,
          category_id: env.categories.groceries,
          confidence: 0.95,
        })),
      };
    });

    const result = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: false,
        providerModel: "cloud-gpt-4o",
      },
      { transactionIds: txnIds },
    );

    expect(result.recordedCount).toBe(15);
    expect(result.discardedCount).toBe(0);
    expect(result.suggestions).toHaveLength(15);

    // Verify recorded suggestion rows in uow.state.suggestions
    expect(env.uow.state.suggestions).toHaveLength(15);
    const first = env.uow.state.suggestions[0]!;
    expect(first.source).toBe("llm");
    expect(first.field).toBe("category");
    expect(first.suggestedValue).toBe(env.categories.groceries);
    expect(first.confidence).toBe(0.95);
    expect(first.model).toBe("cloud-gpt-4o");
    expect(first.promptVersion).toBe(CATEGORISE_PROMPT_VERSION);
    expect(first.outcome).toBe("open");
    expect(first.resolvedAt).toBeNull();
  });

  it("refuses private account transactions before calling cloud provider", async () => {
    const env = setupTestEnvironment();

    const privTxnId = env.newId<"Transaction">();
    const privSplitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: privTxnId,
      accountId: env.privateAccountId,
      postedOn: "2026-10-26",
      amountCents: -5000,
      descriptionRaw: "Private pharmacy bill",
      fingerprint: "fp-priv-bill",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 200,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: privSplitId,
      transactionId: privTxnId,
      amountCents: -5000,
      categoryId: null,
      activityId: null,
      beneficiary: env.alexPersonId,
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

    const mockLlm = createMockLlm();

    await expect(
      categoriseTransactions(
        {
          viewer: env.alexViewer,
          clock,
          uow: env.uow,
          newId: env.newId,
          provider: mockLlm,
          providerIsLocal: false,
        },
        { transactionIds: [privTxnId] },
      ),
    ).rejects.toThrow(AppError);

    // Verify provider was never called
    expect(mockLlm.prompts).toHaveLength(0);
  });

  it("allows private account transactions on local provider (is_local = 1)", async () => {
    const env = setupTestEnvironment();

    const privTxnId = env.newId<"Transaction">();
    const privSplitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: privTxnId,
      accountId: env.privateAccountId,
      postedOn: "2026-10-26",
      amountCents: -5000,
      descriptionRaw: "Local Pharmacy",
      fingerprint: "fp-local-pharmacy",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 201,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: privSplitId,
      transactionId: privTxnId,
      amountCents: -5000,
      categoryId: null,
      activityId: null,
      beneficiary: env.alexPersonId,
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

    const mockLlm = createMockLlm(() => ({
      suggestions: [
        {
          index: 0,
          category_id: env.categories.groceries,
          confidence: 0.9,
        },
      ],
    }));

    const result = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      { transactionIds: [privTxnId] },
    );

    expect(result.recordedCount).toBe(1);
    expect(mockLlm.prompts).toHaveLength(1);
    expect(env.uow.state.suggestions[0]?.accountId).toBe(env.privateAccountId);
  });

  it("discards hallucinated category IDs and does not record them in suggestion table", async () => {
    const env = setupTestEnvironment();

    const txnId = env.newId<"Transaction">();
    const splitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: txnId,
      accountId: env.publicAccountId,
      postedOn: "2026-10-26",
      amountCents: -3000,
      descriptionRaw: "Unknown Store",
      fingerprint: "fp-unknown-store",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 300,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -3000,
      categoryId: null,
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

    const mockLlm = createMockLlm(() => ({
      suggestions: [
        {
          index: 0,
          category_id: "nonexistent-hallucinated-category",
          confidence: 0.99,
        },
      ],
    }));

    const result = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      { transactionIds: [txnId] },
    );

    expect(result.recordedCount).toBe(0);
    expect(result.discardedCount).toBe(1);
    expect(env.uow.state.suggestions).toHaveLength(0);
  });

  it("batches large transaction lists into chunks of at most 20 items", async () => {
    const env = setupTestEnvironment();

    // 45 transactions -> 3 batches (20, 20, 5)
    const txnIds: string[] = [];
    for (let i = 0; i < 45; i++) {
      const txnId = env.newId<"Transaction">();
      const splitId = env.newId<"Split">();
      txnIds.push(txnId);

      env.uow.state.transactions.push({
        id: txnId,
        accountId: env.publicAccountId,
        postedOn: "2026-10-26",
        amountCents: -1500,
        descriptionRaw: `Batch Txn ${i}`,
        fingerprint: `fp-batch-${i}`,
        fingerprintVersion: 1,
        status: "posted",
        performedBy: null,
        payeeId: null,
        notes: null,
        nameHiddenUntil: null,
        nameHiddenBy: null,
        transferGroupId: null,
        needsReview: true,
        searchId: 400 + i,
        createdAt: now.toString(),
        updatedAt: now.toString(),
        deletedAt: null,
      });

      env.uow.state.splits.push({
        id: splitId,
        transactionId: txnId,
        amountCents: -1500,
        categoryId: null,
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
    }

    const mockLlm = createMockLlm((prompt) => {
      // Find how many items were requested in this batch prompt
      const matches = prompt.prompt.match(/\[\d+\] Description:/g) ?? [];
      return {
        suggestions: matches.map((_, idx) => ({
          index: idx,
          category_id: env.categories.fuel,
          confidence: 0.88,
        })),
      };
    });

    const result = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: mockLlm,
        providerIsLocal: true,
      },
      { transactionIds: txnIds },
    );

    expect(mockLlm.prompts).toHaveLength(3);
    expect(result.recordedCount).toBe(45);
    expect(env.uow.state.suggestions).toHaveLength(45);
  });

  it("closes open suggestion as accepted when setSplitField matches or source is llm", () => {
    const env = setupTestEnvironment();

    const txnId = env.newId<"Transaction">();
    const splitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: txnId,
      accountId: env.publicAccountId,
      postedOn: "2026-10-26",
      amountCents: -8000,
      descriptionRaw: "Bunnings Hardware",
      fingerprint: "fp-bunnings",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 500,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -8000,
      categoryId: null,
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

    const suggestionId = env.newId<"Suggestion">();
    const suggestionRow: SuggestionRow = {
      id: suggestionId,
      accountId: env.publicAccountId,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: env.categories.groceries,
      payeeName: "Bunnings",
      websiteDomain: "bunnings.com.au",
      taxCategoryId: null,
      activityId: null,
      confidence: 0.85,
      model: "test-model",
      promptVersion: CATEGORISE_PROMPT_VERSION,
      outcome: "open",
      createdAt: now.toString(),
      resolvedAt: null,
    };
    env.uow.state.suggestions.push(suggestionRow);

    // Call setSplitField with matching category
    setSplitField(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
      },
      {
        transactionId: txnId,
        splitId,
        field: "category",
        value: env.categories.groceries,
        source: "user",
      },
    );

    const updated = env.uow.state.suggestions.find((s) => s.id === suggestionId);
    expect(updated?.outcome).toBe("accepted");
    expect(updated?.resolvedAt).not.toBeNull();
  });

  it("closes open suggestion as superseded when setSplitField chooses a different category", () => {
    const env = setupTestEnvironment();

    const txnId = env.newId<"Transaction">();
    const splitId = env.newId<"Split">();
    env.uow.state.transactions.push({
      id: txnId,
      accountId: env.publicAccountId,
      postedOn: "2026-10-26",
      amountCents: -8000,
      descriptionRaw: "Ampol Service",
      fingerprint: "fp-ampol",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 501,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -8000,
      categoryId: null,
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

    const suggestionId = env.newId<"Suggestion">();
    const suggestionRow: SuggestionRow = {
      id: suggestionId,
      accountId: env.publicAccountId,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: env.categories.groceries,
      payeeName: "Ampol",
      websiteDomain: null,
      taxCategoryId: null,
      activityId: null,
      confidence: 0.6,
      model: "test-model",
      promptVersion: CATEGORISE_PROMPT_VERSION,
      outcome: "open",
      createdAt: now.toString(),
      resolvedAt: null,
    };
    env.uow.state.suggestions.push(suggestionRow);

    // User chooses Fuel instead of Groceries
    setSplitField(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
      },
      {
        transactionId: txnId,
        splitId,
        field: "category",
        value: env.categories.fuel,
        source: "user",
      },
    );

    const updated = env.uow.state.suggestions.find((s) => s.id === suggestionId);
    expect(updated?.outcome).toBe("superseded");
    expect(updated?.resolvedAt).not.toBeNull();
  });

  it("re-categorising a transaction with an existing open suggestion supersedes previous open suggestion and inserts new open suggestion", async () => {
    const env = setupTestEnvironment();
    const txnId = env.newId<"Transaction">();
    const splitId = env.newId<"Split">();

    env.uow.state.transactions.push({
      id: txnId,
      accountId: env.publicAccountId,
      postedOn: "2026-10-26",
      amountCents: -5000,
      descriptionRaw: "Unknown Merchant",
      fingerprint: "fp-re-cat",
      fingerprintVersion: 1,
      status: "posted",
      performedBy: null,
      payeeId: null,
      notes: null,
      nameHiddenUntil: null,
      nameHiddenBy: null,
      transferGroupId: null,
      needsReview: true,
      searchId: 601,
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    });
    env.uow.state.splits.push({
      id: splitId,
      transactionId: txnId,
      amountCents: -5000,
      categoryId: null,
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

    // 1. First categorisation run suggests Groceries
    const llm1 = createMockLlm(() => ({
      suggestions: [
        {
          index: 0,
          category_id: env.categories.groceries,
          confidence: 0.7,
        },
      ],
    }));

    const result1 = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: llm1,
        providerIsLocal: true,
      },
      { transactionIds: [txnId] },
    );

    expect(result1.recordedCount).toBe(1);
    const firstSuggestion = result1.suggestions[0]!;
    expect(firstSuggestion.outcome).toBe("open");
    expect(firstSuggestion.resolvedAt).toBeNull();

    const openBefore = env.uow.read((r) =>
      r.suggestions.findOpenForSplit(splitId, "category"),
    );
    expect(openBefore?.id).toBe(firstSuggestion.id);

    // 2. Second categorisation run suggests Fuel
    const llm2 = createMockLlm(() => ({
      suggestions: [
        {
          index: 0,
          category_id: env.categories.fuel,
          confidence: 0.9,
        },
      ],
    }));

    const result2 = await categoriseTransactions(
      {
        viewer: env.alexViewer,
        clock,
        uow: env.uow,
        newId: env.newId,
        provider: llm2,
        providerIsLocal: true,
      },
      { transactionIds: [txnId] },
    );

    expect(result2.recordedCount).toBe(1);
    const secondSuggestion = result2.suggestions[0]!;
    expect(secondSuggestion.id).not.toBe(firstSuggestion.id);
    expect(secondSuggestion.outcome).toBe("open");
    expect(secondSuggestion.resolvedAt).toBeNull();
    expect(secondSuggestion.suggestedValue).toBe(env.categories.fuel);

    // Previous suggestion is now superseded
    const firstUpdated = env.uow.state.suggestions.find(
      (s) => s.id === firstSuggestion.id,
    );
    expect(firstUpdated?.outcome).toBe("superseded");
    expect(firstUpdated?.resolvedAt).not.toBeNull();

    // Active open suggestion is the second one
    const openAfter = env.uow.read((r) =>
      r.suggestions.findOpenForSplit(splitId, "category"),
    );
    expect(openAfter?.id).toBe(secondSuggestion.id);
    expect(openAfter?.suggestedValue).toBe(env.categories.fuel);
  });
});
