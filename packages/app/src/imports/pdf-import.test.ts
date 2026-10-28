import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import type { LlmProvider, StructuredPrompt, StructuredResponse } from "../ports/llm-provider.ts";
import type { TxRepos, UnitOfWork } from "../ports/unit-of-work.ts";
import { type FakeAttachmentStore, fakeAttachmentStore } from "../testing/attachment-store.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import type { PdfExtractPage } from "./pdf-extract-request.ts";
import {
  extractAndImportPdfStatement,
  type PdfImportContext,
  type PdfTextExtractionPayload,
  type PdfTextExtractor,
} from "./pdf-import.ts";

const now = Temporal.Instant.from("2026-10-27T12:00:00.000Z");
const clock = manualClock("2026-10-27T12:00:00.000Z");

function createMockProvider(pageData: Partial<PdfExtractPage>): LlmProvider {
  return {
    generateStructured: async <T>(
      _prompt: StructuredPrompt<T>,
    ): Promise<StructuredResponse<T>> => ({
      data: {
        accountNumberLast4: "1234",
        startDate: "2024-09-01",
        endDate: "2024-09-30",
        openingBalanceCents: 100_000,
        closingBalanceCents: 103_000,
        rows: [
          {
            postedOn: "2024-09-02",
            description: "SALARY",
            amountCents: 5_000,
            runningBalanceCents: 105_000,
            pageNumber: 1,
          },
          {
            postedOn: "2024-09-05",
            description: "COFFEE",
            amountCents: -2_000,
            runningBalanceCents: 103_000,
            pageNumber: 1,
          },
        ],
        ...pageData,
      } as unknown as T,
      raw: "{}",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      model: "test-model",
    }),
  };
}

function setup() {
  const uow = memoryUnitOfWork();
  let idCounter = 1;
  const newId = <T extends string>() => `id_${idCounter++}` as Id<T>;

  const alexPersonId = newId<"Person">();
  const alexViewer = personViewer(alexPersonId, now);

  uow.state.people.push({
    id: alexPersonId,
    userId: null,
    displayName: "Alex",
    colour: "#000000",
    createdAt: now.toString(),
    updatedAt: now.toString(),
    deletedAt: null,
  });

  const accountId = newId<"Account">();
  uow.state.accounts.push({
    id: accountId,
    name: "Everyday Checking",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    institutionId: null,
    openedOn: "2024-01-01",
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.accountOwners.push({
    accountId,
    personId: alexPersonId,
    shareBp: 10000,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const attachments: FakeAttachmentStore = fakeAttachmentStore();

  const ctx: PdfImportContext = {
    viewer: alexViewer,
    clock,
    newId,
    uow,
    attachments,
    providerIsLocal: true,
  };

  const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

  const defaultExtractor = async (): Promise<PdfTextExtractionPayload> => ({
    pages: [
      {
        pageNumber: 1,
        text: "Sample statement page 1 text",
      },
    ],
    hasTextLayer: true,
    pageCount: 1,
  });

  return {
    ctx,
    accountId,
    alexPersonId,
    newId,
    dummyPdf,
    defaultExtractor,
    uow,
    attachments,
  };
}

function seedPdfExtractProvider(
  uow: ReturnType<typeof memoryUnitOfWork>,
  providerId: Id<"LlmProvider">,
  cloudPdf: boolean,
) {
  uow.state.llmProviders.push({
    id: providerId,
    name: "Seed Cloud Provider",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKeyCiphertext: null,
    apiKeyLast4: null,
    isLocal: false,
    cloudPdf,
    cloudRows: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.llmPurposeAssignments.push({
    purpose: "pdf_extract",
    providerId,
    updatedAt: now.toString(),
  });
}

describe("extractAndImportPdfStatement", () => {
  it("successfully extracts and imports a valid statement with matching balances", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      rows: [
        {
          postedOn: "2024-09-02",
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-05",
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
          pageNumber: 1,
        },
      ],
    });

    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");
    expect(result.reconcileGapCents).toBe(0);
    expect(result.rowCount).toBe(2);
    expect(result.newCount).toBe(2);

    // Verify DB batch was staged
    const stagedBatch = uow.state.importBatches.find((b) => b.id === result.batchId);
    expect(stagedBatch).toBeDefined();
    expect(stagedBatch?.status).toBe("ready");
    expect(stagedBatch?.reconcileStatus).toBe("ok");
    expect(stagedBatch?.reconcileGapCents).toBe(0);

    // Verify DB rows were staged with pdf_page
    const stagedRows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
    expect(stagedRows).toHaveLength(2);
    expect(stagedRows[0]?.pdfPage).toBe(1);
    expect(stagedRows[1]?.pdfPage).toBe(1);
    expect(stagedRows[0]?.status).toBe("staged");
    expect(stagedRows[0]?.reason).toBeNull();
  });

  it("stores the file when the extractor detaches the bytes it was handed (pdf.js worker transfer)", async () => {
    const { ctx, accountId, dummyPdf, uow, attachments } = setup();
    // The real pdf.js transfers the buffer into its worker, neutering the caller's view;
    // the encrypted store still needs the file afterwards.
    const detachingExtractor: PdfTextExtractor = async (data) => {
      const buffer = data instanceof ArrayBuffer ? data : (data.buffer as ArrayBuffer);
      structuredClone(buffer, { transfer: [buffer] });
      return { pages: [{ pageNumber: 1, text: "page 1" }], hasTextLayer: true, pageCount: 1 };
    };

    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: createMockProvider({}), extractPdfTextPages: detachingExtractor },
      { accountId, content: dummyPdf },
    );

    expect(result.status).toBe("ready");
    const batch = uow.state.importBatches.find((b) => b.id === result.batchId);
    expect(batch?.attachmentId ?? null).not.toBeNull();
    expect(attachments.files.size).toBe(1);
  });

  it("blocks batch on 1-cent discrepancy with exact gap and throws AppError Validation", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    // Opening 1000.00 + 50.00 - 20.00 = 1030.00, but closing claims 1030.01 (1 cent discrepancy)
    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_001,
      rows: [
        {
          postedOn: "2024-09-02",
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-05",
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
          pageNumber: 1,
        },
      ],
    });

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("Validation");
    expect(appErr.message).toContain("gap of 1 cents");

    // DB batch MUST be blocked with status = "failed", reconcile_status = "gap", reconcile_gap_cents = 1
    expect(uow.state.importBatches).toHaveLength(1);
    const failedBatch = uow.state.importBatches[0];
    expect(failedBatch?.status).toBe("failed");
    expect(failedBatch?.reconcileStatus).toBe("gap");
    expect(failedBatch?.reconcileGapCents).toBe(1);

    // Rows must be staged with failure reason
    expect(uow.state.importRows).toHaveLength(2);
    expect(uow.state.importRows[0]?.reason).toContain("gap of 1 cents");
    expect(uow.state.importRows[0]?.pdfPage).toBe(1);
  });

  it("fails verification on running balance mismatch and identifies row and amounts", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    // Row 2 running balance is $1035.00 instead of $1030.00
    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      rows: [
        {
          postedOn: "2024-09-02",
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-05",
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_500, // mismatch!
          pageNumber: 1,
        },
      ],
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      ),
    ).rejects.toThrowError(/Running balance mismatch at row 2/);

    expect(uow.state.importBatches).toHaveLength(1);
    expect(uow.state.importBatches[0]?.status).toBe("failed");
    expect(uow.state.importBatches[0]?.reconcileStatus).toBe("gap");
    expect(uow.state.importBatches[0]?.reconcileGapCents).toBe(500);
  });

  it("fails verification on transaction date out of statement period", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    const mockProvider = createMockProvider({
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      openingBalanceCents: 100_000,
      closingBalanceCents: 98_000,
      rows: [
        {
          postedOn: "2024-10-15", // out of period!
          description: "OCTOBER ROW",
          amountCents: -2_000,
          runningBalanceCents: 98_000,
          pageNumber: 1,
        },
      ],
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf },
      ),
    ).rejects.toThrowError(/Transaction at row 1 dated 2024-10-15 falls outside statement period/);

    expect(uow.state.importBatches[0]?.status).toBe("failed");
  });

  it("fails verification on account last 4 mismatch", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    const mockProvider = createMockProvider({
      accountNumberLast4: "9876", // statement says 9876
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" }, // expected 1234
      ),
    ).rejects.toThrowError(
      /Statement account last 4 \(9876\) does not match expected account \(1234\)/,
    );
  });

  it("rejects scanned PDFs lacking text layer before LLM call when model lacks vision", async () => {
    const { ctx, accountId, dummyPdf } = setup();

    const scannedExtractor = async (): Promise<PdfTextExtractionPayload> => ({
      pages: [{ pageNumber: 1, text: "" }],
      hasTextLayer: false,
      pageCount: 1,
    });

    const mockProvider: LlmProvider = {
      generateStructured: async () => {
        throw new Error("Should not be called!");
      },
    };

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        {
          ...ctx,
          provider: mockProvider,
          providerModel: "llama3",
          extractPdfTextPages: scannedExtractor,
        },
        { accountId, content: dummyPdf },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("Validation");
    expect(appErr.message).toBe(
      'Scanned PDF statements without a text layer require a vision-capable model. The configured model "llama3" does not support vision.',
    );
  });

  it("rejects scanned PDFs before LLM call even when the default classifier marks the model vision-capable", async () => {
    const { ctx, accountId, dummyPdf } = setup();

    const scannedExtractor = async (): Promise<PdfTextExtractionPayload> => ({
      pages: [{ pageNumber: 1, text: "" }],
      hasTextLayer: false,
      pageCount: 1,
    });

    const mockProvider: LlmProvider = {
      generateStructured: async () => {
        throw new Error("Should not be called!");
      },
    };

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        {
          ...ctx,
          provider: mockProvider,
          providerModel: "gpt-4o",
          extractPdfTextPages: scannedExtractor,
        },
        { accountId, content: dummyPdf },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("Validation");
    expect(appErr.message).toBe("Vision statement extraction is not yet supported in this version");
  });

  it("normalizes extractor failures into a Validation error for unreadable PDFs", async () => {
    const { ctx, accountId, dummyPdf } = setup();

    const brokenExtractor = async (): Promise<PdfTextExtractionPayload> => {
      throw new Error("Invalid PDF structure.");
    };

    const mockProvider = createMockProvider({});

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: brokenExtractor },
        { accountId, content: dummyPdf },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("Validation");
    expect(appErr.message).toContain("Unreadable PDF");
  });

  it("refuses a cloud provider row without cloud_pdf opt-in before building any adapter", async () => {
    const { ctx, accountId, dummyPdf, uow, newId } = setup();

    const providerId = newId<"LlmProvider">();
    seedPdfExtractProvider(uow, providerId, false);

    let factoryCalled = false;
    const mockProvider: LlmProvider = {
      generateStructured: async () => {
        throw new Error("Should not be called!");
      },
    };

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        {
          ...ctx,
          providerIsLocal: undefined,
          extractPdfTextPages: async () => {
            throw new Error("Should not reach extraction");
          },
          createProvider: () => {
            factoryCalled = true;
            return mockProvider;
          },
        },
        { accountId, content: dummyPdf },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("PermissionDenied");
    expect(appErr.message).toBe(
      "Cloud provider not permitted for PDF extraction without cloud_pdf opt-in",
    );
    expect(factoryCalled).toBe(true);
  });

  it("resolves the provider from the assigned provider row when none is injected", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow, newId } = setup();

    const providerId = newId<"LlmProvider">();
    seedPdfExtractProvider(uow, providerId, true);

    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      rows: [
        {
          postedOn: "2024-09-02",
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-05",
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
          pageNumber: 1,
        },
      ],
    });

    let resolvedRowModel: string | null = null;

    const result = await extractAndImportPdfStatement(
      {
        ...ctx,
        providerIsLocal: undefined,
        extractPdfTextPages: defaultExtractor,
        createProvider: (row) => {
          resolvedRowModel = row.model;
          return mockProvider;
        },
      },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(resolvedRowModel).toBe("gpt-4o");
    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");
  });

  it("refuses cloud provider without cloud_pdf opt-in with PermissionDenied", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    const mockProvider = createMockProvider({});

    let thrownError: unknown;
    try {
      await extractAndImportPdfStatement(
        {
          ...ctx,
          provider: mockProvider,
          providerIsLocal: false, // cloud provider!
          providerCloudPdf: false, // no opt-in
          extractPdfTextPages: defaultExtractor,
        },
        { accountId, content: dummyPdf },
      );
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    const appErr = thrownError as AppError;
    expect(appErr.code).toBe("PermissionDenied");
    expect(appErr.message).toBe(
      "Cloud provider not permitted for PDF extraction without cloud_pdf opt-in",
    );
  });

  it("permits cloud provider with explicit cloud_pdf opt-in", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      rows: [
        {
          postedOn: "2024-09-02",
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-05",
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
          pageNumber: 1,
        },
      ],
    });

    const result = await extractAndImportPdfStatement(
      {
        ...ctx,
        provider: mockProvider,
        providerIsLocal: false,
        providerCloudPdf: true, // explicit opt-in
        extractPdfTextPages: defaultExtractor,
      },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");
  });

  it("duplicate PDF import returns existing batch with newCount: 0 and dupCount: rowCount without calling LLM", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    let llmCallCount = 0;
    const mockProvider: LlmProvider = {
      generateStructured: async <T>(
        _prompt: StructuredPrompt<T>,
      ): Promise<StructuredResponse<T>> => {
        llmCallCount++;
        const pageData: PdfExtractPage = {
          accountNumberLast4: "1234",
          startDate: "2024-09-01",
          endDate: "2024-09-30",
          openingBalanceCents: 100_000,
          closingBalanceCents: 103_000,
          rows: [
            {
              postedOn: "2024-09-02",
              description: "DEPOSIT",
              amountCents: 5_000,
              runningBalanceCents: 105_000,
              pageNumber: 1,
            },
            {
              postedOn: "2024-09-05",
              description: "EXPENSE",
              amountCents: -2_000,
              runningBalanceCents: 103_000,
              pageNumber: 1,
            },
          ],
        };
        return {
          data: pageData as unknown as T,
          raw: JSON.stringify(pageData),
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          model: "test-model",
        };
      },
    };

    // First import
    const firstResult = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );
    expect(firstResult.status).toBe("ready");
    expect(firstResult.newCount).toBe(2);
    expect(firstResult.dupCount).toBe(0);
    expect(llmCallCount).toBe(1);

    // Second import with identical content
    const secondResult = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );
    expect(secondResult.batchId).toBe(firstResult.batchId);
    expect(secondResult.newCount).toBe(0);
    expect(secondResult.dupCount).toBe(2);
    expect(secondResult.rowCount).toBe(2);
    // Crucial: LLM call count did NOT increase because dedupe was checked upfront!
    expect(llmCallCount).toBe(1);
  });

  it("multi-page PDF import stages rows with distinct pdfPage (1 and 2)", async () => {
    const { ctx, accountId, dummyPdf, uow } = setup();

    const multiPageExtractor = async (): Promise<PdfTextExtractionPayload> => ({
      pages: [
        { pageNumber: 1, text: "Page 1 Content" },
        { pageNumber: 2, text: "Page 2 Content" },
      ],
      hasTextLayer: true,
      pageCount: 2,
    });

    const mockProvider: LlmProvider = {
      generateStructured: async <T>(
        prompt: StructuredPrompt<T>,
      ): Promise<StructuredResponse<T>> => {
        const isPage1 = prompt.prompt.includes("page 1");
        const pageData: PdfExtractPage = isPage1
          ? {
              accountNumberLast4: "1234",
              startDate: "2024-09-01",
              openingBalanceCents: 100_000,
              rows: [
                {
                  postedOn: "2024-09-02",
                  description: "ROW ON PAGE 1",
                  amountCents: 5_000,
                  runningBalanceCents: 105_000,
                  // omitted pageNumber in row schema to test fallback to page.pageNumber
                },
              ],
            }
          : {
              accountNumberLast4: "1234",
              endDate: "2024-09-30",
              closingBalanceCents: 103_000,
              rows: [
                {
                  postedOn: "2024-09-15",
                  description: "ROW ON PAGE 2",
                  amountCents: -2_000,
                  runningBalanceCents: 103_000,
                  pageNumber: 2,
                },
              ],
            };
        return {
          data: pageData as unknown as T,
          raw: JSON.stringify(pageData),
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          model: "test-model",
        };
      },
    };

    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: multiPageExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(result.rowCount).toBe(2);

    const stagedRows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
    expect(stagedRows).toHaveLength(2);
    expect(stagedRows[0]?.pdfPage).toBe(1);
    expect(stagedRows[1]?.pdfPage).toBe(2);
  });

  it("rejects statement when opening or closing balance is missing", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    const mockProvider = createMockProvider({
      openingBalanceCents: null, // missing opening balance!
      closingBalanceCents: 100_000,
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf },
      ),
    ).rejects.toThrowError(/missing opening balance or closing balance/);
  });

  it("rejects transactions dated after account closedOn date", async () => {
    const { ctx, dummyPdf, defaultExtractor, uow, newId, alexPersonId } = setup();

    const closedAccountId = newId<"Account">();
    uow.state.accounts.push({
      id: closedAccountId,
      name: "Closed Account",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: "2024-09-10", // closed on 10 Sept
      isSavings: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });
    uow.state.accountOwners.push({
      accountId: closedAccountId,
      personId: alexPersonId,
      shareBp: 10000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const mockProvider = createMockProvider({
      openingBalanceCents: 100_000,
      closingBalanceCents: 98_000,
      rows: [
        {
          postedOn: "2024-09-15", // dated AFTER closedOn!
          description: "POST-CLOSURE ROW",
          amountCents: -2_000,
          runningBalanceCents: 98_000,
          pageNumber: 1,
        },
      ],
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId: closedAccountId, content: dummyPdf },
      ),
    ).rejects.toThrowError("Cannot import transactions dated after account closed on 2024-09-10");
  });

  it("verifies running balance chaining on reverse-chronological statements", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor } = setup();

    // Transactions listed descending (newest row 1, oldest row 2)
    // Opening balance: $1000.00
    // Chronological order:
    // 2024-09-02: +50.00 -> balance $1050.00
    // 2024-09-15: -20.00 -> balance $1030.00 (closing balance)
    const mockProvider = createMockProvider({
      accountNumberLast4: "1234",
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      rows: [
        {
          postedOn: "2024-09-15", // Row 1: newest
          description: "EXPENSE",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-02", // Row 2: oldest
          description: "DEPOSIT",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
          pageNumber: 1,
        },
      ],
    });

    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");
    expect(result.reconcileGapCents).toBe(0);
  });

  it("retrying a failed statement replaces the failed batch without crashing on unique constraint", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    // First attempt: induced 1-cent discrepancy fails and creates failed batch
    const failingProvider = createMockProvider({
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_001, // 1 cent discrepancy
    });

    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: failingProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      ),
    ).rejects.toThrowError(AppError);

    expect(uow.state.importBatches).toHaveLength(1);
    expect(uow.state.importBatches[0]?.status).toBe("failed");

    // Second attempt: corrected totals on the same PDF content retries
    const correctedProvider = createMockProvider({
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000, // corrected!
    });

    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: correctedProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");

    // The active (non-undone) batch is now the ready one
    const activeBatches = uow.state.importBatches.filter((b) => b.undoneAt === null);
    expect(activeBatches).toHaveLength(1);
    expect(activeBatches[0]?.status).toBe("ready");
  });

  it("links the stored statement file to the batch and saves the header", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow, attachments } = setup();

    const mockProvider = createMockProvider({});
    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(uow.state.attachments).toHaveLength(1);
    const attachment = uow.state.attachments[0];
    expect(attachment?.mime).toBe("application/pdf");
    expect(attachment?.bytes).toBe(dummyPdf.byteLength);

    const batch = uow.state.importBatches.find((b) => b.id === result.batchId);
    expect(batch?.attachmentId).toBe(attachment?.id);
    expect(JSON.parse(batch?.statementMeta ?? "null")).toEqual({
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      accountNumberLast4: "1234",
    });
    expect(attachments.files.size).toBe(1);
  });

  it("raises an import.pdf_failed item with per-row proposals when verification fails", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow, attachments } = setup();

    const mockProvider = createMockProvider({ closingBalanceCents: 103_001 });
    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      ),
    ).rejects.toThrowError(AppError);

    const batch = uow.state.importBatches[0];
    expect(batch?.status).toBe("failed");
    expect(batch?.attachmentId).not.toBeNull();
    expect(uow.state.attachments).toHaveLength(1);
    expect(attachments.files.size).toBe(1);

    const item = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `import.pdf_failed:${batch?.id}`,
    );
    expect(item).toBeDefined();
    expect(item?.kind).toBe("import.pdf_failed");
    expect(item?.entityRef).toBe(`import_batch:${batch?.id}`);
    expect(item?.accountId).toBe(accountId);
    expect(item?.resolvedAt).toBeNull();

    const rows = uow.state.importRows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const proposal = JSON.parse(row.proposal ?? "null");
      expect(proposal).toMatchObject({
        postedOn: expect.any(String),
        amountCents: expect.any(Number),
        description: expect.any(String),
      });
    }
    expect(JSON.parse(rows[1]?.proposal ?? "null").amountCents).toBe(-2_000);
  });

  it("re-uploading a failed statement resolves the old item and reuses the stored file", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow, attachments } = setup();

    const failingProvider = createMockProvider({ closingBalanceCents: 103_001 });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        extractAndImportPdfStatement(
          { ...ctx, provider: failingProvider, extractPdfTextPages: defaultExtractor },
          { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
        ),
      ).rejects.toThrowError(AppError);
    }

    const oldBatch = uow.state.importBatches.find((b) => b.undoneAt !== null);
    const newBatch = uow.state.importBatches.find((b) => b.undoneAt === null);
    expect(oldBatch).toBeDefined();
    expect(newBatch).toBeDefined();
    expect(newBatch?.id).not.toBe(oldBatch?.id);

    const oldItem = uow.state.reviewItems.find(
      (r) => r.dedupeKey === `import.pdf_failed:${oldBatch?.id}`,
    );
    expect(oldItem?.resolvedAt).not.toBeNull();
    expect(oldItem?.resolution).toBe("replaced by a new upload");

    const openItems = uow.state.reviewItems.filter((r) => r.resolvedAt === null);
    expect(openItems).toHaveLength(1);
    expect(openItems[0]?.dedupeKey).toBe(`import.pdf_failed:${newBatch?.id}`);

    // Same content: one attachment row and one stored file across both attempts
    expect(uow.state.attachments).toHaveLength(1);
    expect(attachments.files.size).toBe(1);
  });

  it("a passing re-upload replaces the failed batch and resolves its review item", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow } = setup();

    const failingProvider = createMockProvider({ closingBalanceCents: 103_001 });
    await expect(
      extractAndImportPdfStatement(
        { ...ctx, provider: failingProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      ),
    ).rejects.toThrowError(AppError);

    const passingProvider = createMockProvider({ closingBalanceCents: 103_000 });
    const result = await extractAndImportPdfStatement(
      { ...ctx, provider: passingProvider, extractPdfTextPages: defaultExtractor },
      { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
    );

    expect(result.status).toBe("ready");
    expect(uow.state.reviewItems.filter((r) => r.resolvedAt === null)).toHaveLength(0);
    expect(uow.state.attachments).toHaveLength(1);
  });

  it("removes the stored file when the staging write fails", async () => {
    const { ctx, accountId, dummyPdf, defaultExtractor, uow, attachments } = setup();

    let failedOnce = false;
    const flakyUow = {
      ...uow,
      transaction<T>(fn: (tx: TxRepos) => T): T {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error("database is locked");
        }
        return uow.transaction(fn);
      },
    } as UnitOfWork;

    const mockProvider = createMockProvider({});
    await expect(
      extractAndImportPdfStatement(
        { ...ctx, uow: flakyUow, provider: mockProvider, extractPdfTextPages: defaultExtractor },
        { accountId, content: dummyPdf, expectedAccountLast4: "1234" },
      ),
    ).rejects.toThrowError("database is locked");

    expect(attachments.files.size).toBe(0);
    expect(uow.state.attachments).toHaveLength(0);
    expect(uow.state.importBatches).toHaveLength(0);
  });

  it("rejects when no LLM provider is configured before running the extractor", async () => {
    const { ctx, accountId, dummyPdf } = setup();

    let extractorCalled = false;
    await expect(
      extractAndImportPdfStatement(
        {
          ...ctx,
          extractPdfTextPages: async () => {
            extractorCalled = true;
            return { pages: [], hasTextLayer: true, pageCount: 0 };
          },
        },
        { accountId, content: dummyPdf },
      ),
    ).rejects.toThrowError("No LLM provider configured for PDF extraction");
    expect(extractorCalled).toBe(false);
  });
});
