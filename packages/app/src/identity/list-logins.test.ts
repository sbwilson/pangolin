import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import type { PersonRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { listLogins } from "./list-logins.ts";

const alex = idSchema("Person").parse("01J0000000000000000000000A");
const sam = idSchema("Person").parse("01J0000000000000000000000B");
const kim = idSchema("Person").parse("01J0000000000000000000000C");
const gone = idSchema("Person").parse("01J0000000000000000000000D");

function person(id: PersonRow["id"], userId: string | null, createdAt: string): PersonRow {
  return {
    id,
    userId,
    displayName: `Name ${id.slice(-1)}`,
    colour: "#123456",
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

describe("identity.listLogins", () => {
  it("lists the active people with a login, oldest first, with their login email", () => {
    const { ctx, uow } = memoryContext(systemViewer("cli:reset-user"));
    uow.state.people = [
      person(sam, "user-sam", "2026-09-27T02:00:00.000Z"),
      person(alex, "user-alex", "2026-09-27T01:00:00.000Z"),
      person(kim, null, "2026-09-27T00:00:00.000Z"),
      { ...person(gone, "user-gone", "2026-09-27T00:00:00.000Z"), deletedAt: "2026-09-27Z" },
    ];
    uow.state.users = ["user-alex", "user-sam", "user-gone"];
    uow.state.emails = { "user-alex": "alex@example.com", "user-sam": "sam@example.com" };
    expect(listLogins(ctx)).toEqual([
      { personId: alex, displayName: "Name A", email: "alex@example.com" },
      { personId: sam, displayName: "Name B", email: "sam@example.com" },
    ]);
  });

  it("is refused to anyone but a system viewer", () => {
    const { ctx } = memoryContext(
      personViewer(alex, Temporal.Instant.from("2026-09-27T00:00:00Z")),
    );
    expect(() => listLogins(ctx)).toThrow(AppError);
    expect(() => listLogins(ctx)).toThrow(/server console/);
  });
});
