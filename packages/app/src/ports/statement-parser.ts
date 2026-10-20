/**
 * Statement parser port (AD-1, AD-12). Implemented in `packages/importers`.
 */
export interface ParsedStatementRow {
  readonly rowNumber: number;
  readonly rawLine: string;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed amount in cents (positive = money in, negative = money out). */
  readonly amountCents: number;
  readonly rawDescription: string;
  /** FITID or source-provided transaction ID, if any. */
  readonly externalId: string | null;
  /** Running or closing balance in cents, if available. */
  readonly balanceCents?: number | null;
}

export interface StatementParser {
  readonly format: string;
  parse(content: string): readonly ParsedStatementRow[];
}

export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD-MM-YYYY";

export type SignConvention = "normal" | "inverted";

export interface CsvColumnMapping {
  readonly date: number | string;
  readonly dateFormat?: DateFormat | undefined;
  readonly description: number | string;
  readonly amount?: number | string | undefined;
  readonly debit?: number | string | undefined;
  readonly credit?: number | string | undefined;
  readonly balance?: number | string | undefined;
  readonly externalId?: number | string | undefined;
  readonly memo?: number | string | undefined;
  readonly signConvention?: SignConvention | undefined;
  readonly hasHeader?: boolean | undefined;
  readonly delimiter?: string | undefined;
}
