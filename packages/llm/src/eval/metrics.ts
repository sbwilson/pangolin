/**
 * Evaluation metrics: accuracy, Brier calibration score, and latency distribution statistics.
 */

export interface LatencyStats {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly p95: number;
}

/**
 * Calculates accuracy as the fraction of predictions where isCorrect is true.
 * Returns a number between 0 and 1.
 */
export function calculateAccuracy(results: ReadonlyArray<{ readonly isCorrect: boolean }>): number {
  if (results.length === 0) {
    return 0;
  }
  const correct = results.filter((r) => r.isCorrect).length;
  return correct / results.length;
}

/**
 * Calculates the Brier score for probability calibration:
 * (1 / N) * sum((confidence - outcome)^2)
 * where outcome = 1 when isCorrect is true, and 0 otherwise.
 * Lower score represents better probability calibration (0 = perfect calibration and accuracy).
 * Returns a number between 0 and 1.
 */
export function calculateBrierScore(
  results: ReadonlyArray<{
    readonly confidence: number;
    readonly isCorrect: boolean;
    readonly error?: string | undefined;
  }>,
): number {
  const valid = results.filter((r) => r.error === undefined);
  if (valid.length === 0) {
    return 0;
  }
  const sumSquaredDiff = valid.reduce((acc, curr) => {
    const outcome = curr.isCorrect ? 1 : 0;
    // Clamp confidence to [0, 1] for safety
    const conf = Math.max(0, Math.min(1, curr.confidence));
    const diff = conf - outcome;
    return acc + diff * diff;
  }, 0);

  return sumSquaredDiff / valid.length;
}

/**
 * Calculates latency distribution statistics (mean, min, max, p95).
 */
export function calculateLatencyStats(latencies: ReadonlyArray<number>): LatencyStats {
  if (latencies.length === 0) {
    return { mean: 0, min: 0, max: 0, p95: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  // Nearest-rank 95th percentile
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  const p95 = sorted[p95Index] ?? 0;

  return {
    mean: Math.round(mean * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
  };
}
