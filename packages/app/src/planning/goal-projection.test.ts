import { describe, expect, it } from "vitest";
import { projectGoalCompletion } from "./goal-projection.ts";

const row = (periodStart: string, amountCents: number) => ({ periodStart, amountCents });

describe("planning/goal-projection", () => {
  it("projects a fortnightly arrival from six periods of history", () => {
    // The Design Notes example: avg 250¢/fortnight against 1,190,000¢ remaining.
    const rows = [
      row("2026-09-04", 240),
      row("2026-09-18", 260),
      row("2026-10-02", 250),
      row("2026-10-16", 240),
      row("2026-10-30", 255),
      row("2026-11-13", 255),
    ];
    const projection = projectGoalCompletion(rows, 1_190_000, "2026-11-20");
    expect(projection).not.toBeNull();
    expect(projection?.averagePerPeriodCents).toBe(250);
    expect(projection?.pace).toBe("fortnightly");
    expect(projection?.periodsRemaining).toBe(4760);
    // 2026-11-13 + 4760 × 14 days.
    expect(projection?.projectedCompletion).toBe("2209-04-28");
  });

  it("derives a weekly pace from ~7-day gaps", () => {
    const rows = [row("2026-06-01", 1000), row("2026-06-08", 1000), row("2026-06-15", 1000)];
    const projection = projectGoalCompletion(rows, 5000, "2026-06-16");
    expect(projection?.pace).toBe("weekly");
    expect(projection?.averagePerPeriodCents).toBe(1000);
    expect(projection?.periodsRemaining).toBe(5);
    expect(projection?.projectedCompletion).toBe("2026-07-20");
  });

  it("derives a monthly pace and adds whole months from the latest period", () => {
    const rows = [
      row("2026-04-01", 2000),
      row("2026-05-01", 2000),
      row("2026-06-01", 4000),
      row("2026-07-01", 2000),
    ];
    const projection = projectGoalCompletion(rows, 8000, "2026-07-15");
    expect(projection?.pace).toBe("monthly");
    expect(projection?.averagePerPeriodCents).toBe(2500);
    expect(projection?.periodsRemaining).toBe(4);
    expect(projection?.projectedCompletion).toBe("2026-11-01");
  });

  it("only averages the most recent six periods", () => {
    const rows = [
      row("2026-01-01", 9000),
      row("2026-02-01", 9000),
      row("2026-03-01", 9000),
      row("2026-04-01", 1000),
      row("2026-05-01", 1000),
      row("2026-06-01", 1000),
      row("2026-07-01", 1000),
      row("2026-08-01", 1000),
      row("2026-09-01", 1000),
    ];
    const projection = projectGoalCompletion(rows, 6000, "2026-09-02");
    expect(projection?.averagePerPeriodCents).toBe(1000);
    expect(projection?.projectedCompletion).toBe("2027-03-01");
  });

  it("answers null with fewer than two periods", () => {
    expect(projectGoalCompletion([], 1000, "2026-07-15")).toBeNull();
    expect(projectGoalCompletion([row("2026-07-01", 500)], 1000, "2026-07-15")).toBeNull();
  });

  it("answers null once the goal has nothing remaining", () => {
    const rows = [row("2026-06-01", 500), row("2026-07-01", 500)];
    expect(projectGoalCompletion(rows, 0, "2026-07-15")).toBeNull();
    expect(projectGoalCompletion(rows, -250, "2026-07-15")).toBeNull();
  });

  it("answers null when the average is zero or negative", () => {
    const zeros = [row("2026-06-01", 0), row("2026-07-01", 0)];
    expect(projectGoalCompletion(zeros, 1000, "2026-07-15")).toBeNull();
    const nettedToZero = [row("2026-06-01", 500), row("2026-07-01", -500)];
    expect(projectGoalCompletion(nettedToZero, 1000, "2026-07-15")).toBeNull();
  });

  it("ignores future-dated rows", () => {
    const rows = [
      row("2026-05-01", 1000),
      row("2026-06-01", 1000),
      row("2026-08-01", 9999), // beyond asOf
    ];
    const projection = projectGoalCompletion(rows, 2000, "2026-06-15");
    expect(projection?.averagePerPeriodCents).toBe(1000);
    expect(projection?.projectedCompletion).toBe("2026-08-01");
  });

  it("nets contributions and withdrawals within one period", () => {
    const rows = [
      row("2026-05-01", 1000),
      row("2026-06-01", 1500),
      row("2026-06-01", -500),
      row("2026-07-01", 1600),
    ];
    const projection = projectGoalCompletion(rows, 4000, "2026-07-15");
    // Per-period nets: 1000, 1000, 1600 → avg 1200.
    expect(projection?.averagePerPeriodCents).toBe(1200);
    expect(projection?.periodsRemaining).toBe(4);
  });

  it("rounds the remaining periods up", () => {
    const rows = [row("2026-06-01", 300), row("2026-07-01", 300)];
    const projection = projectGoalCompletion(rows, 1000, "2026-07-15");
    expect(projection?.periodsRemaining).toBe(4); // 3.34 → 4
  });
});
