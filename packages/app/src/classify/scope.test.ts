import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { scopeFor } from "./scope.ts";

describe("scopeFor", () => {
  it("answers Conflict, not a plain Error, for a private account with no owner", () => {
    const uow = memoryUnitOfWork();
    const id = "acct" as Id<"Account">;
    const at = "2026-09-01T00:00:00.000Z";
    uow.transaction((tx) =>
      tx.accounts.insert(
        {
          id,
          name: "Orphan",
          type: "transaction",
          currency: "AUD",
          isPrivate: true,
          institutionId: null,
          openedOn: null,
          closedOn: null,
          isSavings: false,
          createdAt: at,
          updatedAt: at,
        },
        [],
      ),
    );
    expect(() => uow.transaction((tx) => scopeFor(tx, systemViewer("cli:test"), id))).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
  });
});
