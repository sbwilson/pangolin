import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import type { LlmProvider, StructuredPrompt, StructuredResponse } from "../ports/llm-provider.ts";
import type { LlmProviderRow } from "../ports/unit-of-work.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import {
  assignLlmPurpose,
  createLlmProvider,
  deleteLlmProvider,
  getLlmRequestPreview,
  getLlmSettings,
  type LlmUseCaseContext,
  testLlmProvider,
  updateLlmProvider,
} from "./llm-provider-use-cases.ts";

const now = Temporal.Instant.from("2026-10-26T12:00:00.000Z");
const clock = manualClock("2026-10-26T12:00:00.000Z");

function setup() {
  let ms = 1793000000000;
  const newId = createIdGenerator({
    now: () => ++ms,
    random: () => 0.5,
  });
  const uow = memoryUnitOfWork();

  const personId = newId<"Person">();
  const viewer: Viewer = {
    kind: "person",
    personId,
    authAt: now,
  };

  const staleViewer: Viewer = {
    kind: "person",
    personId,
    authAt: Temporal.Instant.from("2026-10-26T11:50:00.000Z"), // 10 minutes ago (> 5m)
  };

  const fakeSecret = "test-auth-secret";
  const fakeEncrypt = (key: string, _secret: string) => `enc:${key}`;
  const fakeDecrypt = (ciphertext: string, _secret: string) => ciphertext.replace(/^enc:/, "");

  const ctx: LlmUseCaseContext = {
    viewer,
    clock,
    newId,
    uow,
    authSecret: fakeSecret,
    encryptApiKey: fakeEncrypt,
    decryptApiKey: fakeDecrypt,
    createProvider: (row: LlmProviderRow, apiKey?: string): LlmProvider => ({
      generateStructured: async <T>(
        _prompt: StructuredPrompt<T>,
      ): Promise<StructuredResponse<T>> => {
        if (row.baseUrl.includes("error")) {
          throw new Error(`Connection refused to ${row.baseUrl} with key ${apiKey}`);
        }
        return {
          data: { ok: true } as T,
          raw: '{"ok": true}',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: row.model,
        };
      },
    }),
  };

  return { ctx, staleViewer, uow, newId, personId };
}

describe("llm-provider-use-cases", () => {
  it("getLlmSettings returns configured providers and assignments", () => {
    const { ctx } = setup();

    const initial = getLlmSettings(ctx);
    expect(initial.providers).toEqual([]);
    expect(initial.assignments).toEqual([]);

    const created = createLlmProvider(ctx, {
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://192.168.1.100:11434/v1",
      model: "llama3.2",
    });

    assignLlmPurpose(ctx, {
      purpose: "categorise",
      providerId: created.id,
    });

    const settings = getLlmSettings(ctx);
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0]).toMatchObject({
      id: created.id,
      name: "Ollama Local",
      isLocal: true,
      apiKeyLast4: null,
    });
    expect(settings.assignments).toHaveLength(1);
    expect(settings.assignments[0]).toMatchObject({
      purpose: "categorise",
      providerId: created.id,
    });
  });

  it("createLlmProvider derives locality and encrypts API key", () => {
    const { ctx } = setup();

    // Local provider
    const local = createLlmProvider(ctx, {
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      cloudPdf: true, // should be forced false for local
    });
    expect(local.isLocal).toBe(true);
    expect(local.cloudPdf).toBe(false);
    expect(local.apiKeyLast4).toBeNull();

    // Cloud provider with key
    const cloud = createLlmProvider(ctx, {
      name: "OpenAI Cloud",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-proj-1234567890abcdef7Q2a",
      cloudPdf: true,
      cloudRows: false,
    });
    expect(cloud.isLocal).toBe(false);
    expect(cloud.cloudPdf).toBe(true);
    expect(cloud.cloudRows).toBe(false);
    expect(cloud.apiKeyLast4).toBe("7Q2a");
    // Verify ciphertext is not returned in safe view
    expect((cloud as unknown as Record<string, unknown>).apiKeyCiphertext).toBeUndefined();

    // Full row in repo has ciphertext
    const stored = ctx.uow.read((r) => r.llmProviders.findById(cloud.id));
    expect(stored?.apiKeyCiphertext).toBe("enc:sk-proj-1234567890abcdef7Q2a");
  });

  it("createLlmProvider rejects stale session with ReauthRequired", () => {
    const { ctx, staleViewer } = setup();
    const staleCtx = { ...ctx, viewer: staleViewer };

    expect(() =>
      createLlmProvider(staleCtx, {
        name: "Test",
        kind: "openai",
        baseUrl: "http://localhost:11434",
        model: "m",
      }),
    ).toThrowError(AppError);

    try {
      createLlmProvider(staleCtx, {
        name: "Test",
        kind: "openai",
        baseUrl: "http://localhost:11434",
        model: "m",
      });
    } catch (err) {
      expect((err as AppError).code).toBe("ReauthRequired");
    }
  });

  it("updateLlmProvider updates properties, re-evaluates locality, and updates key", () => {
    const { ctx } = setup();

    const created = createLlmProvider(ctx, {
      name: "Provider",
      kind: "openai",
      baseUrl: "http://192.168.1.10:11434/v1",
      model: "llama3",
    });
    expect(created.isLocal).toBe(true);

    // Update to cloud URL and add key
    const updated = updateLlmProvider(ctx, {
      id: created.id,
      name: "Renamed Provider",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key-XYZ9",
      cloudPdf: true,
    });

    expect(updated.name).toBe("Renamed Provider");
    expect(updated.isLocal).toBe(false);
    expect(updated.apiKeyLast4).toBe("XYZ9");
    expect(updated.cloudPdf).toBe(true);
  });

  it("deleteLlmProvider removes provider and unassigns purpose", () => {
    const { ctx } = setup();

    const created = createLlmProvider(ctx, {
      name: "To Delete",
      kind: "openai",
      baseUrl: "http://localhost:11434",
      model: "m",
    });

    assignLlmPurpose(ctx, {
      purpose: "categorise",
      providerId: created.id,
    });

    deleteLlmProvider(ctx, { id: created.id });

    const settings = getLlmSettings(ctx);
    expect(settings.providers).toHaveLength(0);
    expect(settings.assignments).toHaveLength(0);
  });

  it("assignLlmPurpose assigns and unassigns purposes", () => {
    const { ctx } = setup();

    const p1 = createLlmProvider(ctx, {
      name: "P1",
      kind: "openai",
      baseUrl: "http://localhost:11434",
      model: "m",
    });

    const assigned = assignLlmPurpose(ctx, {
      purpose: "pdf_extract",
      providerId: p1.id,
    });
    expect(assigned).toEqual({ purpose: "pdf_extract", providerId: p1.id });

    let settings = getLlmSettings(ctx);
    expect(settings.assignments).toEqual([
      expect.objectContaining({ purpose: "pdf_extract", providerId: p1.id }),
    ]);

    // Unassign
    assignLlmPurpose(ctx, {
      purpose: "pdf_extract",
      providerId: null,
    });

    settings = getLlmSettings(ctx);
    expect(settings.assignments).toHaveLength(0);
  });

  it("testLlmProvider returns latency on success and sanitizes errors on failure", async () => {
    const { ctx } = setup();

    const okProvider = createLlmProvider(ctx, {
      name: "Good Provider",
      kind: "openai",
      baseUrl: "http://localhost:11434",
      model: "test-model",
    });

    const goodRes = await testLlmProvider(ctx, { id: okProvider.id });
    expect(goodRes.ok).toBe(true);
    expect(goodRes.latencyMs).toBeGreaterThanOrEqual(1);

    const badProvider = createLlmProvider(ctx, {
      name: "Bad Provider",
      kind: "openai",
      baseUrl: "https://error-endpoint.example.com",
      model: "test-model",
      apiKey: "sk-super-secret-key-1234",
    });

    const badRes = await testLlmProvider(ctx, { id: badProvider.id });
    expect(badRes.ok).toBe(false);
    expect(badRes.error).toBeDefined();
    // Raw key must NOT be leaked
    expect(badRes.error).not.toContain("sk-super-secret-key-1234");
    expect(badRes.error).toContain("***1234");
  });

  it("getLlmRequestPreview generates preview with public transactions and categories", () => {
    const { ctx, newId, personId } = setup();

    let pubAcc: Id<"Account">;
    let privAcc: Id<"Account">;

    ctx.uow.transaction((tx) => {
      tx.person.insert({
        id: personId,
        userId: null,
        displayName: "Alex",
        colour: "#123456",
        deletedAt: null,
        createdAt: "2026-10-26T12:00:00Z",
        updatedAt: "2026-10-26T12:00:00Z",
      });

      pubAcc = newId<"Account">();
      privAcc = newId<"Account">();

      tx.accounts.insert(
        {
          id: pubAcc,
          name: "Joint Checking",
          type: "transaction",
          currency: "AUD",
          institutionId: null,
          openedOn: "2026-01-01",
          closedOn: null,
          isSavings: false,
          isPrivate: false,
          createdAt: "2026-10-26T12:00:00Z",
          updatedAt: "2026-10-26T12:00:00Z",
        },
        [
          {
            accountId: pubAcc,
            personId,
            shareBp: 10000,
            createdAt: "2026-10-26T12:00:00Z",
            updatedAt: "2026-10-26T12:00:00Z",
          },
        ],
      );

      tx.accounts.insert(
        {
          id: privAcc,
          name: "Private Stash",
          type: "savings",
          currency: "AUD",
          institutionId: null,
          openedOn: "2026-01-01",
          closedOn: null,
          isSavings: true,
          isPrivate: true,
          createdAt: "2026-10-26T12:00:00Z",
          updatedAt: "2026-10-26T12:00:00Z",
        },
        [
          {
            accountId: privAcc,
            personId,
            shareBp: 10000,
            createdAt: "2026-10-26T12:00:00Z",
            updatedAt: "2026-10-26T12:00:00Z",
          },
        ],
      );
    });

    createTransaction(ctx, {
      accountId: pubAcc!,
      postedOn: "2026-10-20",
      amountCents: -3200,
      description: "PUBLIC COFFEE SHOP",
    });

    createTransaction(ctx, {
      accountId: privAcc!,
      postedOn: "2026-10-21",
      amountCents: -99999,
      description: "PRIVATE SECRET ITEM",
    });

    const preview = getLlmRequestPreview(ctx);
    expect(preview.schemaName).toBe("categorise");
    expect(preview.prompt).toContain("PUBLIC COFFEE SHOP");
    expect(preview.prompt).not.toContain("PRIVATE SECRET ITEM");
    expect(preview.sampleItems.every((item) => item.isPrivate === false)).toBe(true);
  });
});
