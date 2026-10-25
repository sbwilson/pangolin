import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import type { Id } from "@pangolin/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmProviderRow, UnitOfWork } from "../ports/unit-of-work.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

describe("LLM provider repository parity (SQLite vs Memory)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-llm-parity-"));
    db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function runScenario(uow: UnitOfWork) {
    const provider1: LlmProviderRow = {
      id: "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">,
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3:8b",
      apiKeyCiphertext: "iv1:tag1:cipher1",
      apiKeyLast4: "abc1",
      isLocal: true,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    const provider2: LlmProviderRow = {
      id: "02HNZX8JGFACFA36RBXDHEQN6F" as Id<"LlmProvider">,
      name: "Anthropic Claude",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-5-sonnet",
      apiKeyCiphertext: "iv2:tag2:cipher2",
      apiKeyLast4: "xyz2",
      isLocal: false,
      cloudPdf: true,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    uow.transaction((tx) => {
      tx.llmProviders.insert(provider1);
      tx.llmProviders.insert(provider2);
      tx.llmProviders.assignPurpose("categorise", provider1.id, "2026-10-26T10:00:00Z");
      tx.llmProviders.assignPurpose("pdf_extract", provider2.id, "2026-10-26T10:00:00Z");
    });

    const safeList = uow.read((r) => r.llmProviders.listSafe());
    const safe1 = uow.read((r) => r.llmProviders.findSafe(provider1.id));
    const full2 = uow.read((r) => r.llmProviders.findById(provider2.id));
    const assignments = uow.read((r) => r.llmProviders.listAssignments());
    const catProvider = uow.read((r) => r.llmProviders.findSafeForPurpose("categorise"));
    const pdfProvider = uow.read((r) => r.llmProviders.findForPurpose("pdf_extract"));

    // Update provider1
    uow.transaction((tx) => {
      tx.llmProviders.update({
        ...provider1,
        model: "llama3.2:3b",
        updatedAt: "2026-10-26T11:00:00Z",
      });
    });
    const updatedSafe1 = uow.read((r) => r.llmProviders.findSafe(provider1.id));

    // Delete provider2
    uow.transaction((tx) => {
      tx.llmProviders.delete(provider2.id);
    });
    const remainingSafe = uow.read((r) => r.llmProviders.listSafe());
    const remainingAssignments = uow.read((r) => r.llmProviders.listAssignments());

    return {
      safeList,
      safe1,
      full2,
      assignments,
      catProvider,
      pdfProvider,
      updatedSafe1,
      remainingSafe,
      remainingAssignments,
    };
  }

  it("produces identical results in SQLite and in-memory unit of work", () => {
    const sqliteResults = runScenario(createUnitOfWork(db));
    const memoryResults = runScenario(memoryUnitOfWork());

    expect(memoryResults).toEqual(sqliteResults);
  });

  it("preserves createdAt when updating a provider in memory and SQLite", () => {
    const provider: LlmProviderRow = {
      id: "01HNZX8JGFACFA36RBXDHEQN6E" as Id<"LlmProvider">,
      name: "Ollama Local",
      kind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3:8b",
      apiKeyCiphertext: null,
      apiKeyLast4: null,
      isLocal: true,
      cloudPdf: false,
      cloudRows: false,
      createdAt: "2026-10-26T10:00:00Z",
      updatedAt: "2026-10-26T10:00:00Z",
    };

    const testUow = (uow: UnitOfWork) => {
      uow.transaction((tx) => {
        tx.llmProviders.insert(provider);
        tx.llmProviders.update({
          ...provider,
          name: "Updated",
          createdAt: "2099-01-01T00:00:00Z", // Attempt to mutate createdAt
          updatedAt: "2026-10-26T12:00:00Z",
        });
      });
      return uow.read((r) => r.llmProviders.findSafe(provider.id)?.createdAt);
    };

    expect(testUow(createUnitOfWork(db))).toBe("2026-10-26T10:00:00Z");
    expect(testUow(memoryUnitOfWork())).toBe("2026-10-26T10:00:00Z");
  });

  it("throws foreign key constraint error when assigning purpose to non-existent providerId", () => {
    const nonExistentId = "09HNZX8JGFACFA36RBXDHEQN99" as Id<"LlmProvider">;

    const testFk = (uow: UnitOfWork) => {
      expect(() => {
        uow.transaction((tx) => {
          tx.llmProviders.assignPurpose("categorise", nonExistentId, "2026-10-26T10:00:00Z");
        });
      }).toThrow(/FOREIGN KEY constraint failed/);
    };

    testFk(createUnitOfWork(db));
    testFk(memoryUnitOfWork());
  });
});
