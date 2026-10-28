/**
 * Deterministic balance and header verification for PDF bank statements (AD-6, AD-19).
 *
 * Verifies four strict rules before trusting LLM extracted statements:
 * 1. openingBalanceCents + sum(amountCents) === closingBalanceCents to the cent.
 * 2. Each printed running balance matches cumulative sum to the cent.
 * 3. All transaction dates fall within [startDate, endDate].
 * 4. Statement account last 4 matches expected account last 4.
 */

export interface VerifiableStatementRow {
  readonly rowNumber: number;
  readonly postedOn: string;
  readonly amountCents: number;
  readonly runningBalanceCents?: number | null | undefined;
}

export interface StatementVerificationInput {
  readonly openingBalanceCents?: number | null | undefined;
  readonly closingBalanceCents?: number | null | undefined;
  readonly accountNumberLast4?: string | null | undefined;
  readonly expectedAccountLast4?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly rows: readonly VerifiableStatementRow[];
}

export interface StatementVerificationSuccess {
  readonly ok: true;
  readonly openingBalanceCents: number;
  readonly closingBalanceCents: number;
  readonly sumAmountsCents: number;
  readonly gapCents: 0;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly accountNumberLast4?: string | null | undefined;
}

export interface StatementVerificationFailure {
  readonly ok: false;
  readonly error: string;
  readonly gapCents: number;
  readonly reasonCode:
    | "balance_gap"
    | "running_balance_mismatch"
    | "date_out_of_period"
    | "account_mismatch"
    | "missing_balances";
  readonly rowNumber?: number | undefined;
  readonly expectedAmountCents?: number | undefined;
  readonly actualAmountCents?: number | undefined;
}

export type StatementVerificationResult =
  | StatementVerificationSuccess
  | StatementVerificationFailure;

function centsToDollars(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `${dollars}.${remainder.toString().padStart(2, "0")}`;
  return isNegative ? `-$${formatted}` : `$${formatted}`;
}

function normalizeLast4(val: string): string {
  const digits = val.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

export function verifyStatementBalances(
  input: StatementVerificationInput,
): StatementVerificationResult {
  // 1. Validate opening and closing balances are present
  if (
    input.openingBalanceCents === null ||
    input.openingBalanceCents === undefined ||
    input.closingBalanceCents === null ||
    input.closingBalanceCents === undefined
  ) {
    return {
      ok: false,
      gapCents: 0,
      reasonCode: "missing_balances",
      error: "Statement extraction missing opening balance or closing balance",
    };
  }

  // 2. Check account last 4 matches expected (normalized to trailing 4 digits)
  if (input.expectedAccountLast4 && input.accountNumberLast4) {
    const normExpected = normalizeLast4(input.expectedAccountLast4);
    const normActual = normalizeLast4(input.accountNumberLast4);
    if (normExpected && normActual && normActual !== normExpected) {
      return {
        ok: false,
        gapCents: 0,
        reasonCode: "account_mismatch",
        error: `Statement account last 4 (${input.accountNumberLast4}) does not match expected account (${input.expectedAccountLast4})`,
      };
    }
  }

  // 3. Check dates within statement period [startDate, endDate]
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    return {
      ok: false,
      gapCents: 0,
      reasonCode: "date_out_of_period",
      error: `Invalid statement period: start date (${input.startDate}) is after end date (${input.endDate})`,
    };
  }

  for (const row of input.rows) {
    if (input.startDate && input.endDate) {
      if (row.postedOn < input.startDate || row.postedOn > input.endDate) {
        return {
          ok: false,
          gapCents: 0,
          reasonCode: "date_out_of_period",
          rowNumber: row.rowNumber,
          error: `Transaction at row ${row.rowNumber} dated ${row.postedOn} falls outside statement period [${input.startDate}, ${input.endDate}]`,
        };
      }
    } else if (input.startDate && row.postedOn < input.startDate) {
      return {
        ok: false,
        gapCents: 0,
        reasonCode: "date_out_of_period",
        rowNumber: row.rowNumber,
        error: `Transaction at row ${row.rowNumber} dated ${row.postedOn} falls before statement start date ${input.startDate}`,
      };
    } else if (input.endDate && row.postedOn > input.endDate) {
      return {
        ok: false,
        gapCents: 0,
        reasonCode: "date_out_of_period",
        rowNumber: row.rowNumber,
        error: `Transaction at row ${row.rowNumber} dated ${row.postedOn} falls after statement end date ${input.endDate}`,
      };
    }
  }

  // 4. Check opening balance + sum of amounts = closing balance to the cent
  const sumAmounts = input.rows.reduce((acc, r) => acc + r.amountCents, 0);
  const computedClosing = input.openingBalanceCents + sumAmounts;
  if (computedClosing !== input.closingBalanceCents) {
    const gapCents = Math.abs(computedClosing - input.closingBalanceCents);
    return {
      ok: false,
      gapCents,
      reasonCode: "balance_gap",
      error: `Statement balance reconciliation failed: opening balance (${centsToDollars(input.openingBalanceCents)}) + sum of transactions (${centsToDollars(sumAmounts)}) = ${centsToDollars(computedClosing)}, differing from closing balance (${centsToDollars(input.closingBalanceCents)}) by exact gap of ${gapCents} cents (${centsToDollars(gapCents)})`,
    };
  }

  // 5. Check each printed running balance matches cumulative balance
  // Handle both chronological and reverse-chronological ordering
  const firstRow = input.rows.at(0);
  const lastRow = input.rows.at(-1);
  const isDescending =
    firstRow !== undefined && lastRow !== undefined && firstRow.postedOn > lastRow.postedOn;

  // Narrowed above by the missing-balances check; captured so the closure sees `number`.
  const openingBalanceCents = input.openingBalanceCents;

  function checkChaining(rowsToVerify: readonly VerifiableStatementRow[]) {
    let cumulative = openingBalanceCents;
    for (const row of rowsToVerify) {
      cumulative += row.amountCents;
      if (row.runningBalanceCents !== null && row.runningBalanceCents !== undefined) {
        if (cumulative !== row.runningBalanceCents) {
          const gapCents = Math.abs(cumulative - row.runningBalanceCents);
          return {
            ok: false as const,
            gapCents,
            reasonCode: "running_balance_mismatch" as const,
            rowNumber: row.rowNumber,
            expectedAmountCents: cumulative,
            actualAmountCents: row.runningBalanceCents,
            error: `Running balance mismatch at row ${row.rowNumber}: cumulative balance is ${centsToDollars(cumulative)} (${cumulative} cents), but printed running balance is ${centsToDollars(row.runningBalanceCents)} (${row.runningBalanceCents} cents)`,
          };
        }
      }
    }
    return null;
  }

  const preferredRows = isDescending ? [...input.rows].reverse() : input.rows;
  const primaryMismatch = checkChaining(preferredRows);

  if (primaryMismatch) {
    const fallbackRows = isDescending ? input.rows : [...input.rows].reverse();
    const fallbackMismatch = checkChaining(fallbackRows);
    if (fallbackMismatch) {
      return primaryMismatch;
    }
  }

  return {
    ok: true,
    gapCents: 0,
    openingBalanceCents: input.openingBalanceCents,
    closingBalanceCents: input.closingBalanceCents,
    sumAmountsCents: sumAmounts,
    startDate: input.startDate,
    endDate: input.endDate,
    accountNumberLast4: input.accountNumberLast4,
  };
}
