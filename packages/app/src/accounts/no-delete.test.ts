import { describe, expect, it } from "vitest";
import * as app from "../index.ts";

// A closed account is archived, never deleted: no account delete use case is exported.
const verb = /delete|remove|purge|destroy|drop|erase/i;
const deletesAccount = (name: string) => verb.test(name) && /account/i.test(name);

describe("the app's exports", () => {
  it("hold no use case that deletes an account", () => {
    const names = Object.keys(app);
    expect(names.filter(deletesAccount)).toEqual([]);
  });

  it("scan something: the guard matches a delete verb and account in either order", () => {
    expect(Object.keys(app)).toContain("closeAccount");
    expect(Object.keys(app).some((name) => verb.test(name))).toBe(true);
    for (const name of ["deleteAccount", "accountDelete", "removeAccounts", "purgeClosedAccount"]) {
      expect(deletesAccount(name), name).toBe(true);
    }
    expect(deletesAccount("closeAccount")).toBe(false);
  });
});
