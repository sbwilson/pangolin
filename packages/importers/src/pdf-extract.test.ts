import {
  extractAndImportPdfStatement,
  type LlmProvider,
  type PdfExtractPage,
  type PdfImportContext,
  personViewer,
  type StructuredPrompt,
  type StructuredResponse,
} from "@pangolin/app";
import { fakeAttachmentStore } from "@pangolin/app/testing/attachment-store";
import { memoryUnitOfWork } from "@pangolin/app/testing/memory-uow";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { extractPdfTextPages, generateMockPdfStatement, isVisionCapableModel } from "./index.ts";

describe("PDF text extraction and mock statement generator", () => {
  it("extracts text from a single-page synthetic PDF statement", async () => {
    const pdfBuffer = generateMockPdfStatement({
      bankName: "Pangolin Bank",
      accountNumberLast4: "4321",
      openingBalanceCents: 50_000,
      rows: [
        {
          postedOn: "2024-09-10",
          description: "GROCERIES",
          amountCents: -5_400,
          runningBalanceCents: 44_600,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-12",
          description: "INTEREST CREDIT",
          amountCents: 150,
          runningBalanceCents: 44_750,
          pageNumber: 1,
        },
      ],
    });

    const result = await extractPdfTextPages(pdfBuffer);
    expect(result.pageCount).toBe(1);
    expect(result.hasTextLayer).toBe(true);
    expect(result.pages).toHaveLength(1);

    const page1 = result.pages[0];
    expect(page1?.pageNumber).toBe(1);
    expect(page1?.text).toContain("Pangolin Bank Statement");
    expect(page1?.text).toContain("4321");
    expect(page1?.text).toContain("Opening Balance: $500.00");
    expect(page1?.text).toContain("Closing Balance: $447.50");
    expect(page1?.text).toContain("GROCERIES");
    expect(page1?.text).toContain("-$54.00");
    expect(page1?.text).toContain("INTEREST CREDIT");
    expect(page1?.text).toContain("$1.50");
  });

  it("extracts text across multiple pages for multi-page statements", async () => {
    const pdfBuffer = generateMockPdfStatement({
      openingBalanceCents: 100_000,
      rows: [
        {
          postedOn: "2024-09-01",
          description: "PAGE 1 TXN",
          amountCents: -1_000,
          runningBalanceCents: 99_000,
          pageNumber: 1,
        },
        {
          postedOn: "2024-09-15",
          description: "PAGE 2 TXN",
          amountCents: -2_000,
          runningBalanceCents: 97_000,
          pageNumber: 2,
        },
      ],
    });

    const result = await extractPdfTextPages(pdfBuffer);
    expect(result.pageCount).toBe(2);
    expect(result.hasTextLayer).toBe(true);
    expect(result.pages).toHaveLength(2);

    expect(result.pages[0]?.text).toContain("PAGE 1 TXN");
    expect(result.pages[0]?.text).not.toContain("PAGE 2 TXN");

    expect(result.pages[1]?.text).toContain("PAGE 2 TXN");
    expect(result.pages[1]?.text).not.toContain("PAGE 1 TXN");
  });

  it("detects lack of extractable text layer in simulated scanned PDFs", async () => {
    const scannedPdfBuffer = generateMockPdfStatement({
      scannedWithoutText: true,
    });

    const result = await extractPdfTextPages(scannedPdfBuffer);
    expect(result.pageCount).toBe(1);
    expect(result.hasTextLayer).toBe(false);
    expect(result.pages[0]?.text).toBe("");
  });
});

describe("isVisionCapableModel", () => {
  it("identifies vision-capable models correctly", () => {
    expect(isVisionCapableModel("gpt-4o")).toBe(true);
    expect(isVisionCapableModel("gpt-4o-mini")).toBe(true);
    expect(isVisionCapableModel("gpt-4-turbo")).toBe(true);
    expect(isVisionCapableModel("gpt-4-vision-preview")).toBe(true);
    expect(isVisionCapableModel("claude-3-opus-20240229")).toBe(true);
    expect(isVisionCapableModel("claude-3-5-sonnet-20241022")).toBe(true);
    expect(isVisionCapableModel("gemini-1.5-pro")).toBe(true);
    expect(isVisionCapableModel("gemini-2.0-flash-exp")).toBe(true);
    expect(isVisionCapableModel("llava:13b")).toBe(true);
    expect(isVisionCapableModel("pixtral-12b-2409")).toBe(true);
    expect(isVisionCapableModel("qwen2-vl-7b-instruct")).toBe(true);
  });

  it("returns false for non-vision text models", () => {
    expect(isVisionCapableModel("llama3")).toBe(false);
    expect(isVisionCapableModel("llama-3.1-8b-instruct")).toBe(false);
    expect(isVisionCapableModel("gpt-3.5-turbo")).toBe(false);
    expect(isVisionCapableModel("gpt-4")).toBe(false);
    expect(isVisionCapableModel("mistral-7b-instruct")).toBe(false);
    expect(isVisionCapableModel("")).toBe(false);
  });
});

describe("End-to-end integration: extractAndImportPdfStatement with real pdf.js", () => {
  it("imports a real generated PDF buffer through pdfjs extraction and deterministic verification", async () => {
    const uow = memoryUnitOfWork();
    const now = Temporal.Instant.from("2026-10-27T12:00:00.000Z");
    let idCounter = 1;
    const newId = <T extends string>() => `id_${idCounter++}` as Id<T>;

    const alexId = newId<"Person">();
    const viewer = personViewer(alexId, now);
    uow.state.people.push({
      id: alexId,
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
      name: "Smart Access ...1234",
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
      personId: alexId,
      shareBp: 10000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const pdfBuffer = generateMockPdfStatement({
      accountNumberLast4: "1234",
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
    });

    // Mock LLM provider that parses extracted text into structured data
    const mockLlm: LlmProvider = {
      generateStructured: async <T>(
        prompt: StructuredPrompt<T>,
      ): Promise<StructuredResponse<T>> => {
        expect(prompt.prompt).toContain("SALARY");
        expect(prompt.prompt).toContain("COFFEE");
        const pageData: PdfExtractPage = {
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
        };
        return {
          data: pageData as unknown as T,
          raw: JSON.stringify(pageData),
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          model: "test-model",
        };
      },
    };

    const attachments = fakeAttachmentStore();
    const ctx: PdfImportContext = {
      viewer,
      clock: { now: () => now, today: () => Temporal.PlainDate.from("2026-10-27") },
      newId,
      uow,
      attachments,
      provider: mockLlm,
      providerIsLocal: true,
      extractPdfTextPages,
      isVisionCapableModel,
    };

    const result = await extractAndImportPdfStatement(ctx, {
      accountId,
      pdfData: pdfBuffer,
      expectedAccountLast4: "1234",
    });

    expect(result.status).toBe("ready");
    expect(result.reconcileStatus).toBe("ok");
    expect(result.reconcileGapCents).toBe(0);
    expect(result.rowCount).toBe(2);

    const batch = uow.state.importBatches.find((b) => b.id === result.batchId);
    expect(batch).toBeDefined();
    expect(batch?.source).toBe("statement_pdf");

    const rows = uow.state.importRows.filter((r) => r.batchId === result.batchId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.pdfPage).toBe(1);
    expect(rows[0]?.status).toBe("staged");

    // The statement file is stored (AD-21) and reachable only through the batch's link.
    expect(batch?.attachmentId ?? null).not.toBeNull();
    expect(uow.state.attachments.find((a) => a.id === batch?.attachmentId)).toBeDefined();
    expect(attachments.files.size).toBe(1);
  });
});
