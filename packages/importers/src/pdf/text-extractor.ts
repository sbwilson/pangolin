import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ExtractedPdfPage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface PdfTextExtractionResult {
  readonly pages: readonly ExtractedPdfPage[];
  readonly hasTextLayer: boolean;
  readonly pageCount: number;
}

/**
 * Extracts text page-by-page from a PDF document using pdfjs-dist.
 * Detects whether the PDF possesses an extractable text layer or is a scanned document.
 */
export async function extractPdfTextPages(
  data: Uint8Array | Buffer | ArrayBuffer,
): Promise<PdfTextExtractionResult> {
  const uint8 =
    Buffer.isBuffer(data) || data instanceof Uint8Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8,
    verbosity: 0,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const pages: ExtractedPdfPage[] = [];
  let totalTextLength = 0;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();

    let pageText = "";
    for (const item of textContent.items) {
      if ("str" in item && typeof item.str === "string") {
        pageText += item.str;
        if (item.hasEOL) {
          pageText += "\n";
        } else {
          pageText += " ";
        }
      }
    }

    const cleanText = pageText.trim();
    totalTextLength += cleanText.length;
    pages.push({
      pageNumber: pageNum,
      text: cleanText,
    });
  }

  const hasTextLayer = totalTextLength > 0;

  return {
    pages,
    hasTextLayer,
    pageCount,
  };
}
