import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import {
  calculatePriceRisePercentage,
  getCadenceGraceDays,
  getPaymentMatchingWindow,
  isPaymentPastDueWindow,
  isPriceRise,
} from "./bill-alerts.ts";

describe("bill-alerts domain logic", () => {
  describe("grace periods and due windows", () => {
    it("returns correct grace days per cadence", () => {
      expect(getCadenceGraceDays("weekly")).toBe(3);
      expect(getCadenceGraceDays("fortnightly")).toBe(5);
      expect(getCadenceGraceDays("monthly")).toBe(7);
      expect(getCadenceGraceDays("quarterly")).toBe(7);
      expect(getCadenceGraceDays("annual")).toBe(7);
    });

    it("evaluates whether payment is past due window", () => {
      const due = Temporal.PlainDate.from("2026-04-10");
      // Monthly grace is 7 days => cutoff is 2026-04-17
      // On 2026-04-17: not past due window (today <= cutoff)
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-17"), "monthly")).toBe(
        false,
      );
      // On 2026-04-18: past due window (today > cutoff)
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-18"), "monthly")).toBe(
        true,
      );
      // On due date: not past due window
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-10"), "monthly")).toBe(
        false,
      );
      // Before due date: not past due window
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-05"), "monthly")).toBe(
        false,
      );
    });

    it("evaluates weekly grace period correctly", () => {
      const due = Temporal.PlainDate.from("2026-04-10");
      // Weekly grace is 3 days => cutoff is 2026-04-13
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-13"), "weekly")).toBe(
        false,
      );
      expect(isPaymentPastDueWindow(due, Temporal.PlainDate.from("2026-04-14"), "weekly")).toBe(
        true,
      );
    });

    it("computes matching window interval", () => {
      const due = Temporal.PlainDate.from("2026-04-10");
      const today = Temporal.PlainDate.from("2026-04-18");
      const window = getPaymentMatchingWindow(due, today, "monthly");
      // windowStart: due - 7 days = 2026-04-03
      expect(window.windowStart.toString()).toBe("2026-04-03");
      expect(window.windowEnd.toString()).toBe("2026-04-18");
    });
  });

  describe("price rise detection", () => {
    it("flags increase strictly greater than 10%", () => {
      // Expected $100 (10,000 cents), actual $114 (11,400 cents) -> +14% -> price rise
      expect(isPriceRise(11400, 10000)).toBe(true);
      expect(isPriceRise(-11400, -10000)).toBe(true);

      // Expected $100, actual $111 -> +11% -> price rise
      expect(isPriceRise(11100, 10000)).toBe(true);

      // Expected $100, actual $110 -> exactly +10% -> not strictly >10%
      expect(isPriceRise(11000, 10000)).toBe(false);

      // Expected $100, actual $108 -> +8% -> not price rise
      expect(isPriceRise(10800, 10000)).toBe(false);

      // Lower amount or zero
      expect(isPriceRise(9000, 10000)).toBe(false);
      expect(isPriceRise(10000, 0)).toBe(false);
    });

    it("calculates price rise percentage correctly", () => {
      expect(calculatePriceRisePercentage(11400, 10000)).toBe(14);
      expect(calculatePriceRisePercentage(-11400, -10000)).toBe(14);
      expect(calculatePriceRisePercentage(10800, 10000)).toBe(8);
      expect(calculatePriceRisePercentage(9000, 10000)).toBe(0);
      expect(calculatePriceRisePercentage(10000, 0)).toBe(0);
    });
  });
});
