import { describe, expect, it } from "vitest";
import type { JobRow } from "../ports/unit-of-work.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { deadJobs, jobCounts, pendingJobs, runningJobs } from "./job-status.ts";

function job(id: string, status: JobRow["status"], finishedAt: string | null): JobRow {
  return {
    id: id as JobRow["id"],
    kind: `kind-${id}`,
    lane: "local",
    payload: '{"secret":"payload"}',
    dedupeKey: null,
    status,
    attempts: 1,
    maxAttempts: 1,
    runAt: "2026-09-27T00:00:00.000Z",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: status === "dead" ? "secret error text" : null,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    finishedAt,
  };
}

describe("system.deadJobs", () => {
  it("lists dead jobs by kind and failure time only, newest first", () => {
    const uow = memoryUnitOfWork();
    uow.state.jobs = [
      job("1", "dead", "2026-09-27T01:00:00.000Z"),
      job("2", "done", "2026-09-27T03:00:00.000Z"),
      job("3", "dead", "2026-09-27T02:00:00.000Z"),
      job("4", "pending", null),
    ];
    expect(deadJobs({ uow })).toEqual([
      { kind: "kind-3", failedAt: "2026-09-27T02:00:00.000Z" },
      { kind: "kind-1", failedAt: "2026-09-27T01:00:00.000Z" },
    ]);
  });

  it("returns at most 50", () => {
    const uow = memoryUnitOfWork();
    uow.state.jobs = Array.from({ length: 60 }, (_, i) =>
      job(
        String(i).padStart(2, "0"),
        "dead",
        `2026-09-27T00:00:${String(i).padStart(2, "0")}.000Z`,
      ),
    );
    const dead = deadJobs({ uow }, {});
    expect(dead).toHaveLength(50);
    expect(dead[0]?.failedAt).toBe("2026-09-27T00:00:59.000Z");
  });
});

describe("system.pendingJobs", () => {
  it("lists pending jobs by kind and due time only, soonest first, then by ID", () => {
    const uow = memoryUnitOfWork();
    uow.state.jobs = [
      { ...job("3", "pending", null), runAt: "2026-09-27T03:00:00.000Z" },
      { ...job("2", "pending", null), runAt: "2026-09-27T01:00:00.000Z" },
      { ...job("1", "pending", null), runAt: "2026-09-27T03:00:00.000Z" },
      job("4", "dead", "2026-09-27T02:00:00.000Z"),
      { ...job("5", "running", null), leaseOwner: "r", leaseExpiresAt: "2026-09-27T00:01:00.000Z" },
    ];
    const pending = pendingJobs({ uow });
    expect(pending).toEqual([
      { kind: "kind-2", runAt: "2026-09-27T01:00:00.000Z" },
      { kind: "kind-1", runAt: "2026-09-27T03:00:00.000Z" },
      { kind: "kind-3", runAt: "2026-09-27T03:00:00.000Z" },
    ]);
    expect(JSON.stringify(pending)).not.toMatch(/secret|payload|lastError/);
  });

  it("returns at most 10", () => {
    const uow = memoryUnitOfWork();
    uow.state.jobs = Array.from({ length: 12 }, (_, i) => ({
      ...job(String(i).padStart(2, "0"), "pending", null),
      runAt: `2026-09-27T00:00:${String(i).padStart(2, "0")}.000Z`,
    }));
    const pending = pendingJobs({ uow }, {});
    expect(pending).toHaveLength(10);
    expect(pending[0]?.runAt).toBe("2026-09-27T00:00:00.000Z");
    expect(pending[9]?.runAt).toBe("2026-09-27T00:00:09.000Z");
  });

  it("rejects unknown input", () => {
    expect(() => pendingJobs({ uow: memoryUnitOfWork() }, { kind: "x" } as never)).toThrow(
      /Invalid input/,
    );
  });
});

describe("system.runningJobs", () => {
  it("lists running jobs by kind and lease end only, soonest first, at most 10", () => {
    const uow = memoryUnitOfWork();
    uow.state.jobs = [
      job("p", "pending", null),
      ...Array.from({ length: 12 }, (_, i) => ({
        ...job(String(i).padStart(2, "0"), "running", null),
        leaseOwner: "r",
        leaseExpiresAt: `2026-09-27T00:01:${String(11 - i).padStart(2, "0")}.000Z`,
      })),
    ];
    const running = runningJobs({ uow });
    expect(running).toHaveLength(10);
    expect(running[0]).toEqual({ kind: "kind-11", leaseExpiresAt: "2026-09-27T00:01:00.000Z" });
    expect(running[9]).toEqual({ kind: "kind-02", leaseExpiresAt: "2026-09-27T00:01:09.000Z" });
    expect(JSON.stringify(running)).not.toMatch(/secret|payload|leaseOwner/);
  });

  it("rejects unknown input", () => {
    expect(() => runningJobs({ uow: memoryUnitOfWork() }, { kind: "x" } as never)).toThrow(
      /Invalid input/,
    );
  });
});

describe("system.jobCounts", () => {
  it("counts pending, running and dead jobs, and leaves out done ones", () => {
    const uow = memoryUnitOfWork();
    expect(jobCounts({ uow })).toEqual({ pending: 0, running: 0, dead: 0 });
    uow.state.jobs = [
      job("1", "dead", "2026-09-27T01:00:00.000Z"),
      job("2", "done", "2026-09-27T03:00:00.000Z"),
      job("3", "dead", "2026-09-27T02:00:00.000Z"),
      job("4", "pending", null),
      { ...job("5", "running", null), leaseOwner: "r", leaseExpiresAt: "2026-09-27T00:01:00.000Z" },
    ];
    expect(jobCounts({ uow }, {})).toEqual({ pending: 1, running: 1, dead: 2 });
  });

  it("rejects unknown input", () => {
    expect(() => jobCounts({ uow: memoryUnitOfWork() }, { kind: "x" } as never)).toThrow(
      /Invalid input/,
    );
  });
});
