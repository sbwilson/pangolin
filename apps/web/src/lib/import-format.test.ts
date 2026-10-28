import { describe, expect, it } from "vitest";
import {
  chooseFormat,
  fileExtension,
  fileProblem,
  formatSize,
  MAX_IMPORT_BYTES,
  needsBank,
  PDF_FORMAT,
} from "./import-format.ts";

describe("fileExtension", () => {
  it("lower-cases the last extension", () => {
    expect(fileExtension("Statement.OFX")).toBe(".ofx");
    expect(fileExtension("a.b.csv")).toBe(".csv");
  });
  it("is empty without an extension", () => {
    expect(fileExtension("statement")).toBe("");
    expect(fileExtension(".csv")).toBe("");
    expect(fileExtension("statement.")).toBe("");
  });
});

describe("chooseFormat", () => {
  it("reads OFX and QIF from the extension, whatever the bank", () => {
    expect(chooseFormat("a.ofx", "up_csv")).toEqual({
      ok: true,
      format: "commbank_ofx",
      ext: ".ofx",
    });
    expect(chooseFormat("a.QIF", "ubank_csv")).toEqual({ ok: true, format: "qif", ext: ".qif" });
  });
  it("reads CSV from the bank", () => {
    for (const bank of ["commbank_csv", "ubank_csv", "up_csv", "fy2025_multibank_csv"] as const) {
      expect(chooseFormat("a.csv", bank)).toEqual({ ok: true, format: bank, ext: ".csv" });
    }
  });
  it("reads PDF as the statement-PDF marker", () => {
    expect(chooseFormat("a.pdf", "up_csv")).toEqual({
      ok: true,
      format: PDF_FORMAT,
      ext: ".pdf",
    });
    expect(chooseFormat("Statement.PDF", "commbank_csv")).toMatchObject({ ok: true });
  });
  it("refuses anything else by name", () => {
    expect(chooseFormat("a.xlsx", "commbank_csv")).toEqual({
      ok: false,
      message: "We can't read .xlsx files. Try CSV, OFX, QIF or PDF.",
    });
    expect(chooseFormat("noext", "commbank_csv")).toMatchObject({ ok: false });
  });
});

describe("fileProblem", () => {
  it("accepts a file at the limit and refuses one byte over", () => {
    expect(fileProblem({ name: "a.csv", size: MAX_IMPORT_BYTES })).toBeNull();
    expect(fileProblem({ name: "a.csv", size: MAX_IMPORT_BYTES + 1 })).toMatch(/over 10 MiB/);
  });
  it("accepts a PDF and sizes it like the rest", () => {
    expect(fileProblem({ name: "a.pdf", size: MAX_IMPORT_BYTES })).toBeNull();
    expect(fileProblem({ name: "a.pdf", size: MAX_IMPORT_BYTES + 1 })).toMatch(/over 10 MiB/);
  });
  it("names an unsupported type first", () => {
    expect(fileProblem({ name: "a.xlsx", size: MAX_IMPORT_BYTES + 1 })).toMatch(/\.xlsx/);
  });
});

describe("needsBank and formatSize", () => {
  it("asks for a bank for CSV only", () => {
    expect(needsBank("a.csv")).toBe(true);
    expect(needsBank("a.ofx")).toBe(false);
    expect(needsBank("a.pdf")).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(23 * 1024)).toBe("23 KB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
