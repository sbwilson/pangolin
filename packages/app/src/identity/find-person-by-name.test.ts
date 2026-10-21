import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import type { PersonRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { findActivePersonByName } from "./find-person-by-name.ts";

const alex = idSchema("Person").parse("01J0000000000000000000000A");
const sam = idSchema("Person").parse("01J0000000000000000000000B");
const sam2 = idSchema("Person").parse("01J0000000000000000000000C");
const gone = idSchema("Person").parse("01J0000000000000000000000D");

function person(id: PersonRow["id"], displayName: string, deletedAt: string | null = null) {
  return {
    id,
    userId: null,
    displayName,
    colour: "#123456",
    createdAt: "2026-09-27T01:00:00.000Z",
    updatedAt: "2026-09-27T01:00:00.000Z",
    deletedAt,
  } satisfies PersonRow;
}

describe("identity.findActivePersonByName", () => {
  it("finds the active person by display name, ignoring case and outer spaces", () => {
    const { ctx, uow } = memoryContext(systemViewer("cli:m1-report"));
    uow.state.people = [person(alex, "Alex"), person(sam, "Sam")];
    expect(findActivePersonByName(ctx, { name: "alex" })).toBe(alex);
    expect(findActivePersonByName(ctx, { name: "  SAM " })).toBe(sam);
  });

  it("is NotFound for an unknown name or a person who has left", () => {
    const { ctx, uow } = memoryContext(systemViewer("cli:m1-report"));
    uow.state.people = [person(alex, "Alex"), person(gone, "Kim", "2026-09-28T00:00:00.000Z")];
    expect(() => findActivePersonByName(ctx, { name: "Nobody" })).toThrow(
      /No active person named Nobody/,
    );
    expect(() => findActivePersonByName(ctx, { name: "Kim" })).toThrow(AppError);
  });

  it("is a Conflict when two active people share the name", () => {
    const { ctx, uow } = memoryContext(systemViewer("cli:m1-report"));
    uow.state.people = [person(sam, "Sam"), person(sam2, "sam")];
    expect(() => findActivePersonByName(ctx, { name: "Sam" })).toThrow(/exact display name/);
  });

  it("is refused to anyone but a system viewer", () => {
    const { ctx } = memoryContext(
      personViewer(alex, Temporal.Instant.from("2026-09-27T00:00:00Z")),
    );
    expect(() => findActivePersonByName(ctx, { name: "Alex" })).toThrow(/server console/);
  });
});
