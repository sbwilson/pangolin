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
