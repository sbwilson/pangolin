import { type Id, idSchema } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { IdGenerator } from "../ids.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createPerson } from "./create-person.ts";

const personId = idSchema("Person").parse("01J0000000000000000000000A");
const now = Temporal.Instant.from("2026-09-27T01:02:03Z");

function sequentialIds(): IdGenerator {
  let n = 0;
  return <B extends string>() => `01J00000000000000000000${String(++n).padStart(3, "0")}` as Id<B>;
}

function context(viewer: Viewer = systemViewer("cli:seed")) {
  const uow = memoryUnitOfWork();
  const ctx: UseCaseContext = {
    viewer,
    clock: fixedClock(parseDate("2026-09-27"), now),
    newId: sequentialIds(),
    uow,
  };
  return { ctx, uow };
}

describe("identity.createPerson", () => {
  it("inserts the person and audits the create", () => {
    const { ctx, uow } = context();
    const id = createPerson(ctx, { displayName: "  Alex ", colour: "#2563EB" });
    const row = {
      id,
      userId: null,
      displayName: "Alex",
      colour: "#2563EB",
      createdAt: "2026-09-27T01:02:03.000Z",
      updatedAt: "2026-09-27T01:02:03.000Z",
      deletedAt: null,
    };
    expect(id).toBe("01J00000000000000000000001");
    expect(uow.state.people).toEqual([row]);
    expect(uow.state.audit).toHaveLength(1);
    const [audit] = uow.state.audit;
    expect(audit).toMatchObject({
      actor: "cli:seed",
      entity: "person",
      entityId: id,
      action: "create",
      before: null,
      accountId: null,
      personId: null,
    });
    expect(JSON.parse(audit?.after ?? "")).toEqual(row);
  });

  it("audits a person viewer by their id", () => {
    const { ctx, uow } = context(personViewer(personId, now));
    createPerson(ctx, { displayName: "Sam", colour: "#abcdef" });
    expect(uow.state.audit.map((row) => row.actor)).toEqual([`person:${personId}`]);
  });

  it("writes nothing when the audit append fails", () => {
    const { ctx, uow } = context();
    uow.failAudit = true;
    expect(() => createPerson(ctx, { displayName: "Alex", colour: "#000000" })).toThrow(
      "audit append failed",
    );
    expect(uow.state.people).toEqual([]);
  });

  it.each([
    [{ displayName: "", colour: "#000000" }, ["displayName"]],
    [{ displayName: "   ", colour: "#000000" }, ["displayName"]],
    [{ displayName: "x".repeat(101), colour: "#000000" }, ["displayName"]],
    [{ displayName: "Alex", colour: "red" }, ["colour"]],
    [{ displayName: "Alex", colour: "#12345" }, ["colour"]],
    [{ displayName: "Alex", colour: "#1234567" }, ["colour"]],
    [{ displayName: "Alex", colour: "#00000g" }, ["colour"]],
    [{ displayName: "Alex", colour: "#000000", userId: "u1" }, []],
  ])("rejects %j as Validation, writing nothing", (input, path) => {
    const { ctx, uow } = context();
    let error: unknown;
    try {
      createPerson(ctx, input as never);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("Validation");
    expect((error as AppError).details).toEqual([expect.objectContaining({ path })]);
    expect(uow.state.people).toEqual([]);
    expect(uow.state.audit).toEqual([]);
  });
});
