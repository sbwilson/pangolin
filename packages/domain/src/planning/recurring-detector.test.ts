import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import {
  calculateMedian,
  classifyCadence,
  detectRecurringSeries,
  predictNextDueOn,
  type RecurringOccurrence,
} from "./recurring-detector.ts";

describe("recurring-detector", () => {
  describe("calculateMedian", () => {
    it("returns 0 for empty array", () => {
      expect(calculateMedian([])).toBe(0);
    });

    it("returns single element", () => {
      expect(calculateMedian([42])).toBe(42);
    });

    it("computes median for odd length", () => {
      expect(calculateMedian([10, 30, 20])).toBe(20);
    });

    it("computes median for even length (rounded average)", () => {
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
    });

    it("uses half-even rounding for even length averages", () => {
      // (1 + 2) / 2 = 1.5 -> rounds to 2 (nearest even)
      expect(calculateMedian([1, 2])).toBe(2);
      // (2 + 3) / 2 = 2.5 -> rounds to 2 (nearest even)
      expect(calculateMedian([2, 3])).toBe(2);
      // (3 + 4) / 2 = 3.5 -> rounds to 4 (nearest even)
      expect(calculateMedian([3, 4])).toBe(4);
      // (4 + 5) / 2 = 4.5 -> rounds to 4 (nearest even)
      expect(calculateMedian([4, 5])).toBe(4);
    });
  });

  describe("classifyCadence", () => {
    it("classifies weekly (6-8 days)", () => {
      expect(classifyCadence(7)).toBe("weekly");
      expect(classifyCadence(6)).toBe("weekly");
      expect(classifyCadence(8)).toBe("weekly");
    });

    it("classifies fortnightly (13-15 days)", () => {
      expect(classifyCadence(14)).toBe("fortnightly");
      expect(classifyCadence(13)).toBe("fortnightly");
      expect(classifyCadence(15)).toBe("fortnightly");
    });

    it("classifies monthly (27-32 days)", () => {
      expect(classifyCadence(30)).toBe("monthly");
      expect(classifyCadence(31)).toBe("monthly");
      expect(classifyCadence(28)).toBe("monthly");
    });

    it("classifies quarterly (85-95 days)", () => {
      expect(classifyCadence(91)).toBe("quarterly");
      expect(classifyCadence(90)).toBe("quarterly");
    });

    it("classifies annual (350-375 days)", () => {
      expect(classifyCadence(365)).toBe("annual");
      expect(classifyCadence(366)).toBe("annual");
    });

    it("returns undefined for unclassifiable intervals", () => {
      expect(classifyCadence(3)).toBeUndefined();
      expect(classifyCadence(10)).toBeUndefined();
      expect(classifyCadence(50)).toBeUndefined();
    });
  });

  describe("predictNextDueOn", () => {
    it("predicts weekly", () => {
      const next = predictNextDueOn(parseDate("2026-03-01"), "weekly");
      expect(next.toString()).toBe("2026-03-08");
    });

    it("predicts fortnightly", () => {
      const next = predictNextDueOn(parseDate("2026-03-01"), "fortnightly");
      expect(next.toString()).toBe("2026-03-15");
    });

    it("predicts monthly preserving day of month", () => {
      const next = predictNextDueOn(parseDate("2026-01-15"), "monthly");
      expect(next.toString()).toBe("2026-02-15");
    });

    it("predicts quarterly", () => {
      const next = predictNextDueOn(parseDate("2026-01-15"), "quarterly");
      expect(next.toString()).toBe("2026-04-15");
    });

    it("predicts annual", () => {
      const next = predictNextDueOn(parseDate("2026-01-15"), "annual");
      expect(next.toString()).toBe("2027-01-15");
    });
  });

  describe("detectRecurringSeries", () => {
    it("returns undefined for fewer than 3 occurrences", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-15"), amountCents: -1999 },
        { postedOn: parseDate("2026-02-15"), amountCents: -1999 },
      ];
      expect(detectRecurringSeries(occurrences)).toBeUndefined();
    });

    it("detects stable monthly subscription (e.g. Netflix 19.99 on 15th)", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-15"), amountCents: -1999 },
        { postedOn: parseDate("2026-02-15"), amountCents: -1999 },
        { postedOn: parseDate("2026-03-15"), amountCents: -1999 },
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.cadence).toBe("monthly");
      expect(result?.expectedCents).toBe(1999);
      expect(result?.nextDueOn.toString()).toBe("2026-04-15");
      expect(result?.toleranceBp).toBe(1500);
    });

    it("detects stable fortnightly bill (e.g. gym $45 every 14 days)", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-01"), amountCents: -4500 },
        { postedOn: parseDate("2026-01-15"), amountCents: -4500 },
        { postedOn: parseDate("2026-01-29"), amountCents: -4500 },
        { postedOn: parseDate("2026-02-12"), amountCents: -4500 },
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.cadence).toBe("fortnightly");
      expect(result?.expectedCents).toBe(4500);
      expect(result?.nextDueOn.toString()).toBe("2026-02-26");
    });

    it("detects weekly occurrences with minor day jitter within +/- 3 days", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-01"), amountCents: -1500 },
        { postedOn: parseDate("2026-01-08"), amountCents: -1500 }, // +7d
        { postedOn: parseDate("2026-01-16"), amountCents: -1500 }, // +8d
        { postedOn: parseDate("2026-01-22"), amountCents: -1500 }, // +6d
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.cadence).toBe("weekly");
      expect(result?.expectedCents).toBe(1500);
      expect(result?.nextDueOn.toString()).toBe("2026-01-29");
    });

    it("rejects series if interval jitter exceeds tolerance (+/- 3 days)", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-01"), amountCents: -1500 },
        { postedOn: parseDate("2026-01-08"), amountCents: -1500 }, // +7d
        { postedOn: parseDate("2026-01-20"), amountCents: -1500 }, // +12d (diff = 5 > 3)
      ];
      expect(detectRecurringSeries(occurrences)).toBeUndefined();
    });

    it("rejects series if amount variance exceeds 15%", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-15"), amountCents: -5000 },
        { postedOn: parseDate("2026-02-15"), amountCents: -25000 },
        { postedOn: parseDate("2026-03-15"), amountCents: -90000 },
      ];
      expect(detectRecurringSeries(occurrences)).toBeUndefined();
    });

    it("accepts series if amount variance is within 15%", () => {
      // Median = 10000. 15% is 1500. 9000 (-10%), 10000 (0%), 11000 (+10%)
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-15"), amountCents: -9000 },
        { postedOn: parseDate("2026-02-15"), amountCents: -10000 },
        { postedOn: parseDate("2026-03-15"), amountCents: -11000 },
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.expectedCents).toBe(10000);
      expect(result?.cadence).toBe("monthly");
    });

    it("detects quarterly bills", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2026-01-10"), amountCents: -12000 },
        { postedOn: parseDate("2026-04-10"), amountCents: -12000 },
        { postedOn: parseDate("2026-07-10"), amountCents: -12000 },
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.cadence).toBe("quarterly");
      expect(result?.expectedCents).toBe(12000);
      expect(result?.nextDueOn.toString()).toBe("2026-10-10");
    });

    it("detects annual bills", () => {
      const occurrences: RecurringOccurrence[] = [
        { postedOn: parseDate("2024-06-01"), amountCents: -50000 },
        { postedOn: parseDate("2025-06-01"), amountCents: -50000 },
        { postedOn: parseDate("2026-06-01"), amountCents: -50000 },
      ];
      const result = detectRecurringSeries(occurrences);
      expect(result).toBeDefined();
      expect(result?.cadence).toBe("annual");
      expect(result?.expectedCents).toBe(50000);
      expect(result?.nextDueOn.toString()).toBe("2027-06-01");
    });
  });
});
