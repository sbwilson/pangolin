import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmProviderRow, LlmPurpose, UnitOfWork } from "@pangolin/app";
import type { Id } from "@pangolin/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

describe("LlmProviderRepo (SQLite UnitOfWork)", () => {
  let dir: string;
  let db: Db;
  let uow: UnitOfWork;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-llm-repo-"));
    db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
    uow = createUnitOfWork(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a provider with encrypted API key and reads safe view", () => {
    const ciphertext = "123456789012345678901234:abcdefabcdefabcdefabcdefabcdef:aabbccddeeff";
    const last4 = "7Q2a";

    const provider: LlmProviderRow = {
      id: "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">,
      name: "OpenAI Main",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKeyCiphertext: ciphertext,
      apiKeyLast4: last4,
      isLocal: false,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    uow.transaction((tx) => {
      tx.llmProviders.insert(provider);
    });

    // Read through safe view
    const safe = uow.read((repos) => repos.llmProviders.findSafe(provider.id));
    expect(safe).toBeDefined();
    expect(safe?.id).toBe(provider.id);
    expect(safe?.name).toBe("OpenAI Main");
    expect(safe?.apiKeyLast4).toBe("7Q2a");
    // Plaintext or ciphertext is never in the safe view
    expect((safe as unknown as Record<string, unknown>).apiKeyCiphertext).toBeUndefined();

    // List through safe view
    const list = uow.read((repos) => repos.llmProviders.listSafe());
    expect(list).toHaveLength(1);
    expect(list[0]?.apiKeyLast4).toBe("7Q2a");
    expect((list[0] as unknown as Record<string, unknown>).apiKeyCiphertext).toBeUndefined();

    // Full row for outbound call returns ciphertext
    const full = uow.read((repos) => repos.llmProviders.findById(provider.id));
    expect(full?.apiKeyCiphertext).toBe(ciphertext);
  });

  it("updates and deletes a provider", () => {
    const provider: LlmProviderRow = {
      id: "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">,
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://192.168.1.50:11434/v1",
      model: "llama3.1:8b",
      apiKeyCiphertext: null,
      apiKeyLast4: null,
      isLocal: true,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    uow.transaction((tx) => {
      tx.llmProviders.insert(provider);
    });

    const updated = uow.transaction((tx) =>
      tx.llmProviders.update({
        ...provider,
        name: "Ollama GPU",
        model: "llama3.2:3b",
        updatedAt: "2026-10-26T11:00:00Z",
      }),
    );
    expect(updated).toBe(true);

    const safe = uow.read((repos) => repos.llmProviders.findSafe(provider.id));
    expect(safe?.name).toBe("Ollama GPU");
    expect(safe?.model).toBe("llama3.2:3b");

    const deleted = uow.transaction((tx) => tx.llmProviders.delete(provider.id));
    expect(deleted).toBe(true);

    expect(uow.read((repos) => repos.llmProviders.findSafe(provider.id))).toBeUndefined();
  });

  it("assigns, retrieves, and unassigns purpose assignments", () => {
    const providerId = "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">;
    const provider: LlmProviderRow = {
      id: providerId,
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      apiKeyCiphertext: null,
      apiKeyLast4: null,
      isLocal: true,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    uow.transaction((tx) => {
      tx.llmProviders.insert(provider);
      tx.llmProviders.assignPurpose("categorise", providerId, "2026-10-26T10:00:00Z");
      tx.llmProviders.assignPurpose("pdf_extract", providerId, "2026-10-26T10:00:00Z");
    });

    const catAssignment = uow.read((repos) => repos.llmProviders.findAssignment("categorise"));
    expect(catAssignment).toEqual({
      purpose: "categorise",
      providerId,
      updatedAt: "2026-10-26T10:00:00Z",
    });

    const forCat = uow.read((repos) => repos.llmProviders.findForPurpose("categorise"));
    expect(forCat?.id).toBe(providerId);
    expect(forCat?.name).toBe("Ollama Local");

    const safeForCat = uow.read((repos) => repos.llmProviders.findSafeForPurpose("categorise"));
    expect(safeForCat?.id).toBe(providerId);

    const assignments = uow.read((repos) => repos.llmProviders.listAssignments());
    expect(assignments).toHaveLength(2);

    // Unassign purpose
    const unassigned = uow.transaction((tx) => tx.llmProviders.unassignPurpose("pdf_extract"));
    expect(unassigned).toBe(true);
    expect(uow.read((repos) => repos.llmProviders.findAssignment("pdf_extract"))).toBeUndefined();

    // Rejects invalid purpose enum
    expect(() => {
      uow.transaction((tx) => {
        tx.llmProviders.assignPurpose(
          "invalid_purpose" as LlmPurpose,
          providerId,
          "2026-10-26T10:00:00Z",
        );
      });
    }).toThrow();
  });

  it("cascades purpose assignments when provider is deleted", () => {
    const providerId = "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">;
    const provider: LlmProviderRow = {
      id: providerId,
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3:8b",
      apiKeyCiphertext: null,
      apiKeyLast4: null,
      isLocal: true,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    uow.transaction((tx) => {
      tx.llmProviders.insert(provider);
      tx.llmProviders.assignPurpose("categorise", providerId, "2026-10-26T10:00:00Z");
    });

    expect(uow.read((repos) => repos.llmProviders.findAssignment("categorise"))).toBeDefined();

    uow.transaction((tx) => {
      tx.llmProviders.delete(providerId);
    });

    expect(uow.read((repos) => repos.llmProviders.findAssignment("categorise"))).toBeUndefined();
    expect(uow.read((repos) => repos.llmProviders.findForPurpose("categorise"))).toBeUndefined();
  });
});
