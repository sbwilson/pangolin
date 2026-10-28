import type { ImportFormat } from "../api.ts";

/** The most a file may hold; the server enforces the same limit. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** The banks a CSV can come from; OFX and QIF need no bank. */
export const BANKS = [
  { id: "commbank_csv", label: "CommBank" },
  { id: "ubank_csv", label: "ubank" },
  { id: "up_csv", label: "Up" },
  { id: "fy2025_multibank_csv", label: "FY2025 multi-bank" },
] as const;

export type BankId = (typeof BANKS)[number]["id"];

/** The file's extension, lower case with its dot; empty when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot).toLowerCase();
}

/** The marker a `.pdf` file gets: it goes to the PDF route, not the text `format` of `/api/import`. */
export const PDF_FORMAT = "statement_pdf";

export type FormatChoice =
  | {
      readonly ok: true;
      readonly format: ImportFormat | typeof PDF_FORMAT;
      readonly ext: string;
    }
  | { readonly ok: false; readonly message: string };

/** The format for a file name: OFX, QIF and PDF from the extension, CSV from the chosen bank. */
export function chooseFormat(filename: string, bank: BankId): FormatChoice {
  const ext = fileExtension(filename);
  if (ext === ".ofx") return { ok: true, format: "commbank_ofx", ext };
  if (ext === ".qif") return { ok: true, format: "qif", ext };
  if (ext === ".csv") return { ok: true, format: bank, ext };
  if (ext === ".pdf") return { ok: true, format: PDF_FORMAT, ext };
  return {
    ok: false,
    message:
      ext === ""
        ? "We can't read that file. Try CSV, OFX, QIF or PDF."
        : `We can't read ${ext} files. Try CSV, OFX, QIF or PDF.`,
  };
}

/** Why a file cannot be imported (unsupported type or over the limit), or null when it can. */
export function fileProblem(file: { name: string; size: number }): string | null {
  const choice = chooseFormat(file.name, "commbank_csv");
  if (!choice.ok) return choice.message;
  if (file.size > MAX_IMPORT_BYTES) return "That file is over 10 MiB. Try a shorter date range.";
  return null;
}

/** Whether a file needs a bank choice (only CSV does). */
export const needsBank = (filename: string): boolean => fileExtension(filename) === ".csv";

/** A size for people: "23 KB", "1.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
