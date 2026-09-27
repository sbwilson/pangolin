import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { write } from "../write.ts";
import { enqueueJob } from "./enqueue.ts";
import { defineJobKind } from "./registry.ts";

const echo = defineJobKind({
  kind: "test-echo",
  schema: z.object({ text: z.string().min(1) }).strict(),
  lane: "local",
  retry: { maxAttempts: 3 },
  externalEffects: false,
  needsPersonWhenDead: false,
});

function setup() {
  const clock = manualClock("2026-09-27T01:02:03Z");
  return { clock, ...memoryContext(systemViewer("cli:test"), clock) };
}

describe("enqueueJob", () => {
  it("inserts a pending job due now, inside the caller's transaction", () => {
    const { ctx, uow } = setup();
    const id = write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "hi" }));
    expect(uow.state.jobs).toEqual([
      {
        id,
        kind: "test-echo",
        lane: "local",
        payload: '{"text":"hi"}',
        dedupeKey: null,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        runAt: "2026-09-27T01:02:03.000Z",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        createdAt: "2026-09-27T01:02:03.000Z",
        updatedAt: "2026-09-27T01:02:03.000Z",
        finishedAt: null,
      },
    ]);
  });

  it("honours runAt", () => {
    const { ctx, uow } = setup();
    const runAt = Temporal.Instant.from("2026-10-01T00:00:00Z");
    write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "later" }, { runAt }));
    expect(uow.state.jobs[0]?.runAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("leaves neither the row nor the job when the use case throws after enqueueing", () => {
    const { ctx, uow } = setup();
    expect(() =>
      write(ctx, (tx, audit) => {
        tx.householdSettings.update({ ...tx.householdSettings.get(), timezone: "UTC" });
        enqueueJob(tx, ctx, echo, { text: "hi" });
        audit({ entity: "x", entityId: "1", action: "update", before: null, after: null });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(uow.state.jobs).toEqual([]);
    expect(uow.state.settings.timezone).toBe("Australia/Sydney");
    expect(uow.state.audit).toEqual([]);
  });

  it("returns the live job's ID for a second enqueue with the same dedupe key", () => {
    const { ctx, uow } = setup();
    const first = write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "a" }, { dedupeKey: "k" }));
    const second = write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "b" }, { dedupeKey: "k" }));
    expect(second).toBe(first);
    expect(uow.state.jobs).toHaveLength(1);
  });

  it("dedupes against a running job too, but not a finished one", () => {
    const { ctx, uow } = setup();
    const first = write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "a" }, { dedupeKey: "k" }));
    uow.state.jobs = uow.state.jobs.map((job) => ({
      ...job,
      status: "running",
      leaseOwner: "r",
      leaseExpiresAt: "2026-09-27T02:00:00.000Z",
    }));
    expect(write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "b" }, { dedupeKey: "k" }))).toBe(
      first,
    );
    uow.state.jobs = uow.state.jobs.map((job) => ({
      ...job,
      status: "done",
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: "2026-09-27T01:02:03.000Z",
    }));
    const third = write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "c" }, { dedupeKey: "k" }));
    expect(third).not.toBe(first);
    expect(uow.state.jobs).toHaveLength(2);
  });

  it("rejects a payload that fails the schema as Validation, enqueueing nothing", () => {
    const { ctx, uow } = setup();
    let error: unknown;
    try {
      write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "" }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("Validation");
    expect(() =>
      write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "x", extra: 1 } as never)),
    ).toThrow(AppError);
    expect(uow.state.jobs).toEqual([]);
  });

  it("stores the parsed payload: unknown keys dropped, defaults applied", () => {
    const { ctx, uow } = setup();
    const loose = defineJobKind({
      kind: "test-loose",
      schema: z.object({ text: z.string(), count: z.number().default(1) }),
      lane: "local",
      externalEffects: false,
      needsPersonWhenDead: false,
    });
    write(ctx, (tx) => enqueueJob(tx, ctx, loose, { text: "hi", extra: true } as never));
    expect(uow.state.jobs[0]?.payload).toBe('{"text":"hi","count":1}');
  });

  it.each([
    ["a Date", { text: "x", at: new Date(0) }],
    ["NaN", { text: "x", n: Number.NaN }],
    ["a BigInt", { text: "x", n: 1n }],
  ])("rejects a payload holding %s as Validation", (_label, bad) => {
    const { ctx, uow } = setup();
    const withNumber = defineJobKind({
      kind: "test-number",
      schema: z
        .object({ text: z.string(), n: z.number().optional(), at: z.date().optional() })
        .strict(),
      lane: "local",
      externalEffects: false,
      needsPersonWhenDead: false,
    });
    let error: unknown;
    try {
      write(ctx, (tx) => enqueueJob(tx, ctx, withNumber, bad as never));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("Validation");
    expect(uow.state.jobs).toEqual([]);
  });

  it("rejects an empty dedupe key", () => {
    const { ctx } = setup();
    expect(() =>
      write(ctx, (tx) => enqueueJob(tx, ctx, echo, { text: "x" }, { dedupeKey: "" })),
    ).toThrow(AppError);
  });
});
