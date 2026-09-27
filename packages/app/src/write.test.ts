import { type Id, idSchema } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock.ts";
import type { UseCaseContext } from "./context.ts";
import type { IdGenerator } from "./ids.ts";
import { systemViewer } from "./system-viewer.ts";
import { memoryUnitOfWork } from "./testing/memory-uow.ts";
import { personViewer, type Viewer } from "./viewer.ts";
import { type Audit, write } from "./write.ts";

const personId = idSchema("Person").parse("01J0000000000000000000000A");
const now = Temporal.Instant.from("2026-09-27T01:02:03Z");

function sequentialIds(): IdGenerator {
  let n = 0;
  return <B extends string>() => `01J00000000000000000000${String(++n).padStart(3, "0")}` as Id<B>;
}

function context(viewer: Viewer = personViewer(personId, now)) {
  const uow = memoryUnitOfWork();
  const ctx: UseCaseContext = {
    viewer,
    clock: fixedClock(parseDate("2026-09-27"), now),
    newId: sequentialIds(),
    uow,
  };
  return { ctx, uow };
}

describe("write", () => {
  it("stamps id, time and person actor, and serialises before/after", () => {
    const { ctx, uow } = context();
    const result = write(ctx, (_tx, audit) => {
      audit({ entity: "thing", entityId: "t1", action: "create", before: null, after: { a: 1 } });
      audit({
        entity: "thing",
        entityId: "t1",
        action: "update",
        before: { a: 1 },
        after: undefined,
        accountId: "acc",
        personId: "per",
      });
      return 42;
    });
    expect(result).toBe(42);
    expect(uow.state.audit).toEqual([
      {
        id: "01J00000000000000000000001",
        at: "2026-09-27T01:02:03.000Z",
        actor: `person:${personId}`,
        entity: "thing",
        entityId: "t1",
        accountId: null,
        personId: null,
        action: "create",
        before: null,
        after: '{"a":1}',
      },
      {
        id: "01J00000000000000000000002",
        at: "2026-09-27T01:02:03.000Z",
        actor: `person:${personId}`,
        entity: "thing",
        entityId: "t1",
        accountId: "acc",
        personId: "per",
        action: "update",
        before: '{"a":1}',
        after: null,
      },
    ]);
  });

  it("audits a system viewer by its actor", () => {
    const { ctx, uow } = context(systemViewer("cli:reset-user"));
    write(ctx, (_tx, audit) =>
      audit({ entity: "x", entityId: "1", action: "delete", before: {}, after: null }),
    );
    expect(uow.state.audit.map((row) => row.actor)).toEqual(["cli:reset-user"]);
  });

  it("writes nothing when the callback throws", () => {
    const { ctx, uow } = context();
    const before = uow.state.settings;
    expect(() =>
      write(ctx, (tx, audit) => {
        tx.householdSettings.update({ ...before, timezone: "UTC" });
        audit({ entity: "x", entityId: "1", action: "update", before: null, after: null });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(uow.state.settings).toBe(before);
    expect(uow.state.audit).toEqual([]);
  });

  it("rolls back and throws when the callback returns a promise", async () => {
    const { ctx, uow } = context();
    const before = uow.state.settings;
    const run = () =>
      write(ctx, async (tx) => {
        tx.householdSettings.update({ ...before, timezone: "UTC" });
      });
    expect(run).toThrow(/returned a promise/);
    expect(uow.state.settings).toBe(before);
    expect(uow.state.audit).toEqual([]);
  });

  it("rolls back a rejected promise without an unhandled rejection", async () => {
    const { ctx } = context();
    expect(() => write(ctx, () => Promise.reject(new Error("late")))).toThrow(/promise/);
    // An unhandled rejection would fail the run; let the microtask queue drain.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  it("rejects any thenable, not only native promises", () => {
    const { ctx } = context();
    // biome-ignore lint/suspicious/noThenProperty: a hand-rolled thenable is the case under test.
    const thenable = { then: () => undefined };
    expect(() => write(ctx, () => thenable)).toThrow(/promise/);
  });

  it("refuses audit calls after the transaction has ended", () => {
    const { ctx, uow } = context();
    let leaked: Audit | undefined;
    write(ctx, (_tx, audit) => {
      leaked = audit;
    });
    expect(() =>
      leaked?.({ entity: "x", entityId: "1", action: "update", before: null, after: null }),
    ).toThrow(/after its write transaction ended/);
    expect(uow.state.audit).toEqual([]);
  });

  it("rejects before/after that JSON cannot represent", () => {
    const { ctx, uow } = context();
    expect(() =>
      write(ctx, (_tx, audit) =>
        audit({ entity: "x", entityId: "1", action: "update", before: () => 1, after: null }),
      ),
    ).toThrow(/JSON-serialisable/);
    expect(uow.state.audit).toEqual([]);
  });
});
