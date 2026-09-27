import { describe, expect, expectTypeOf, it } from "vitest";
import { type Id, idSchema, isUlid } from "./ids.ts";

const accountId = idSchema("Account");
const splitId = idSchema("Split");

describe("ids", () => {
  it("parses a canonical ULID under its brand", () => {
    const id = accountId.parse("01HNZX8JGFACFA36RBXDHEQN6E");
    expect(id).toBe("01HNZX8JGFACFA36RBXDHEQN6E");
    expectTypeOf(id).toEqualTypeOf<Id<"Account">>();
    expectTypeOf(splitId.parse(id)).not.toEqualTypeOf<Id<"Account">>();
  });

  it.each([
    "",
    "garbage",
    "01hnzx8jgfacfa36rbxdheqn6e", // lowercase
    "01HNZX8JGFACFA36RBXDHEQN6", // 25 chars
    "01HNZX8JGFACFA36RBXDHEQN6EE", // 27 chars
    "01HNZX8JGFACFA36RBXDHEQNIU", // I and U are not Crockford
    "81HNZX8JGFACFA36RBXDHEQN6E", // timestamp overflow
    "0e6f3c2b-7a9d-4e8c-9f1a-2b3c4d5e6f70", // UUID
  ])("rejects %j", (value) => {
    expect(accountId.safeParse(value).success).toBe(false);
    expect(isUlid(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(accountId.safeParse(42).success).toBe(false);
  });

  it("brands are not interchangeable at the type level", () => {
    expectTypeOf<Id<"Account">>().not.toEqualTypeOf<Id<"Split">>();
    // @ts-expect-error a Split ID is not an Account ID
    const wrong: Id<"Account"> = splitId.parse("01HNZX8JGFACFA36RBXDHEQN6E");
    expect(wrong).toBeDefined();
    // @ts-expect-error a plain string is not an ID
    const plain: Id<"Account"> = "01HNZX8JGFACFA36RBXDHEQN6E";
    expect(plain).toBeDefined();
  });
});
