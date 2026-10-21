import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { leaveHousehold } from "../accounts/leave-household.ts";
import { listAccounts } from "../accounts/list-accounts.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { listTransactions } from "../ledger/list-transactions.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { listReviewItems } from "../system/review-items.ts";
import { systemViewer } from "../system-viewer.ts";
import { fakeAttachmentStore } from "../testing/attachment-store.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { fakeTokens } from "../testing/tokens.ts";
import { personViewer } from "../viewer.ts";
import { acceptHandoff, createHandoff, dismissHandoff, listMyHandoffs } from "./handoff.ts";
import { undoImportBatch } from "./undo-batch.ts";

const CSV = `Date,Amount,Description,Balance
01/09/2026,-50.00,"SECRET SUPERMARKET",1000.00
02/09/2026,-12.00,"BOOKSTORE",988.00`;

function setup() {
  registerTransactionNeedsReviewSync();
  const clock = manualClock("2026-10-20T12:00:00Z");
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const attachments = fakeAttachmentStore();
  const at = Temporal.Instant.from("2026-10-20T12:00:00Z");
  const sys = { viewer: systemViewer("cli:test"), clock, newId, uow };
  const a = createPerson(sys, { displayName: "Alex", colour: "#ff0000" });
  const b = createPerson(sys, { displayName: "Sam", colour: "#0000ff" });
  const c = createPerson(sys, { displayName: "Casey", colour: "#00ff00" });
  const as = (id: typeof a) => ({ viewer: personViewer(id, at), clock, newId, uow, attachments });
  const A = as(a);
  const B = as(b);
  const C = as(c);
  const account = (ctx: UseCaseContext, name: string, owner: typeof a, isPrivate: boolean) =>
    createAccount(ctx, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      owners: [{ personId: owner, shareBp: 10000 }],
    });
  const aPrivate = account(A, "Alex private", a, true);
  const bPrivate = account(B, "Sam private", b, true);
  return { clock, uow, attachments, a, b, c, A, B, C, aPrivate, bPrivate };
}

const handoff = (w: ReturnType<typeof setup>, content = CSV) =>
  createHandoff(w.A, {
    recipientId: w.b,
    filename: "september.csv",
    format: "commbank_csv",
    content,
  }).id;

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : `other:${String(error)}`;
  }
  return "ok";
}

describe("partner hand-off", () => {
  it("hands a file off: stored encrypted-side, pending, one item for the recipient only", () => {
    const w = setup();
    const id = handoff(w);
    expect(w.attachments.files.size).toBe(1);
    expect(listMyHandoffs(w.A)).toEqual([
      { id, recipient: w.b, filename: "september.csv", status: "pending" },
    ]);
    expect(listReviewItems(w.B).map((i) => [i.kind, i.entityRef, i.personId])).toEqual([
      ["imports.handoff", `import_handoff:${id}`, w.b],
    ]);
    expect(listReviewItems(w.A)).toEqual([]);
    expect(listReviewItems(w.C)).toEqual([]);
    // No statement text in any stored row.
    expect(JSON.stringify(w.uow.state)).not.toContain("SECRET SUPERMARKET");
  });

  it("rejects a recipient who is the sender or not an active person", () => {
    const w = setup();
    const send = (recipientId: string) =>
      createHandoff(w.A, { recipientId, filename: "x.csv", format: "commbank_csv", content: CSV });
    expect(code(() => send(w.a))).toBe("Validation");
    expect(code(() => send("01JNOBODY"))).toBe("Validation");
    const gone = w.uow.state.people.findIndex((p) => p.id === w.c);
    const person = w.uow.state.people[gone];
    if (person === undefined) throw new Error("no such person");
    w.uow.state.people[gone] = { ...person, deletedAt: "2026-10-01T00:00:00Z" };
    expect(code(() => send(w.c))).toBe("Validation");
    // A failed hand-off leaves no file behind.
    expect(w.attachments.files.size).toBe(0);
  });

  it("shows the sender only id, recipient, filename and status", () => {
    const w = setup();
    handoff(w);
    acceptHandoff(w.B, { handoffId: listMyHandoffs(w.A)[0]?.id ?? "", accountId: w.bPrivate });
    const [view] = listMyHandoffs(w.A);
    expect(Object.keys(view as object).sort()).toEqual(["filename", "id", "recipient", "status"]);
    expect(view?.status).toBe("imported");
  });

  it("attributes the batch to the recipient, who alone can undo it", () => {
    const w = setup();
    const id = handoff(w);
    acceptHandoff(w.B, { handoffId: id, accountId: w.bPrivate });
    const [batch] = w.uow.state.importBatches;
    expect(batch?.importedByPersonId).toBe(w.b);
    expect(code(() => undoImportBatch(w.A, { batchId: batch?.id ?? "" }))).toBe("NotFound");
    expect(code(() => undoImportBatch(w.B, { batchId: batch?.id ?? "" }))).toBe("ok");
    expect(listTransactions(w.B).transactions).toHaveLength(0);
    expect(listMyHandoffs(w.A)[0]?.status).toBe("imported");
  });

  it("accepts into the recipient's private account without touching anything the sender reads", () => {
    const w = setup();
    const id = handoff(w);
    const senderReads = () =>
      JSON.stringify([
        listAccounts(w.A),
        listTransactions(w.A),
        w.uow.read((r) => [
          r.importBatches.listVisible(w.A.viewer, w.aPrivate),
          r.importBatches.listVisible(w.A.viewer, w.bPrivate),
        ]),
        listReviewItems(w.A),
        w.uow.read((r) => r.audit.listVisible(w.A.viewer, "2026-10-20")),
      ]);
    const before = senderReads();

    expect(acceptHandoff(w.B, { handoffId: id, accountId: w.bPrivate })).toEqual({
      status: "imported",
    });

    expect(senderReads()).toBe(before);
    expect(listMyHandoffs(w.A)[0]?.status).toBe("imported");
    expect(listTransactions(w.B).transactions).toHaveLength(2);
    expect(listReviewItems(w.B).filter((i) => i.kind === "imports.handoff")).toEqual([]);
  });

  it("does not accept into an account the recipient cannot see, and stays pending", () => {
    const w = setup();
    const id = handoff(w);
    expect(code(() => acceptHandoff(w.B, { handoffId: id, accountId: w.aPrivate }))).toBe(
      "NotFound",
    );
    expect(listMyHandoffs(w.A)[0]?.status).toBe("pending");
    expect(listReviewItems(w.B)).toHaveLength(1);
  });

  it("rolls the whole accept back when the file does not decrypt", () => {
    const w = setup();
    const id = handoff(w);
    for (const name of w.attachments.files.keys()) w.attachments.tamper(name);
    expect(() => acceptHandoff(w.B, { handoffId: id, accountId: w.bPrivate })).toThrow();
    expect(w.uow.state.importBatches).toHaveLength(0);
    expect(w.uow.state.transactions).toHaveLength(0);
    expect(listMyHandoffs(w.A)[0]?.status).toBe("pending");
  });

  it("rolls the accept back when the import itself fails", () => {
    const w = setup();
    const id = createHandoff(w.A, {
      recipientId: w.b,
      filename: "bad.ofx",
      format: "commbank_ofx",
      content: "this is not an OFX file",
    }).id;
    expect(code(() => acceptHandoff(w.B, { handoffId: id, accountId: w.bPrivate }))).toBe(
      "Validation",
    );
    expect(listMyHandoffs(w.A)[0]?.status).toBe("pending");
    expect(listReviewItems(w.B)).toHaveLength(1);
  });

  it("dismisses: resolves the item and deletes the file", () => {
    const w = setup();
    const id = handoff(w);
    expect(dismissHandoff(w.B, { handoffId: id })).toEqual({ status: "dismissed" });
    expect(listMyHandoffs(w.A)[0]?.status).toBe("dismissed");
    expect(listReviewItems(w.B)).toEqual([]);
    expect(w.attachments.files.size).toBe(0);
    expect(w.uow.state.attachments).toHaveLength(0);
  });

  it("refuses a second accept or dismiss with Conflict", () => {
    const w = setup();
    const accepted = handoff(w);
    acceptHandoff(w.B, { handoffId: accepted, accountId: w.bPrivate });
    const dismissed = handoff(w, `${CSV}\n03/09/2026,-1.00,"OTHER",987.00`);
    dismissHandoff(w.B, { handoffId: dismissed });
    for (const handoffId of [accepted, dismissed]) {
      expect(code(() => dismissHandoff(w.B, { handoffId }))).toBe("Conflict");
      expect(code(() => acceptHandoff(w.B, { handoffId, accountId: w.bPrivate }))).toBe("Conflict");
    }
  });

  it("answers NotFound, writing nothing, to anyone but the recipient", () => {
    const w = setup();
    const id = handoff(w);
    const snapshot = JSON.stringify(w.uow.state);
    for (const who of [w.A, w.C]) {
      expect(code(() => acceptHandoff(who, { handoffId: id, accountId: w.aPrivate }))).toBe(
        "NotFound",
      );
      expect(code(() => dismissHandoff(who, { handoffId: id }))).toBe("NotFound");
    }
    expect(JSON.stringify(w.uow.state)).toBe(snapshot);
    expect(listMyHandoffs(w.C)).toEqual([]);
  });

  it("stores identical content once and keeps the file while another hand-off links it", () => {
    const w = setup();
    const first = handoff(w);
    const second = handoff(w);
    expect(w.attachments.files.size).toBe(1);
    expect(w.uow.state.attachments).toHaveLength(1);
    expect(w.uow.state.importHandoffs).toHaveLength(2);
    dismissHandoff(w.B, { handoffId: first });
    expect(w.attachments.files.size).toBe(1);
    acceptHandoff(w.B, { handoffId: second, accountId: w.bPrivate });
    expect(listTransactions(w.B).transactions).toHaveLength(2);
  });

  it("drops a leaver's hand-offs and the files nobody else links", () => {
    const w = setup();
    handoff(w);
    createHandoff(w.C, {
      recipientId: w.b,
      filename: "c.csv",
      format: "commbank_csv",
      content: `${CSV}\n04/09/2026,-2.00,"MINE",985.00`,
    });
    expect(w.attachments.files.size).toBe(2);
    leaveHousehold({ ...w.B, tokens: fakeTokens() }, { confirm: true });
    expect(w.uow.state.importHandoffs).toHaveLength(0);
    expect(w.uow.state.attachments).toHaveLength(0);
    expect(w.attachments.files.size).toBe(0);
  });

  it("resolves the recipient's item when the sender leaves", () => {
    const w = setup();
    handoff(w);
    expect(listReviewItems(w.B)).toHaveLength(1);
    leaveHousehold({ ...w.A, tokens: fakeTokens() }, { confirm: true });
    expect(listReviewItems(w.B).filter((i) => i.kind === "imports.handoff")).toEqual([]);
    expect(w.uow.state.importHandoffs).toHaveLength(0);
    expect(w.attachments.files.size).toBe(0);
  });

  it("rolls the leave back when files must go but the context has no store", () => {
    const w = setup();
    handoff(w);
    const { attachments: _store, ...bare } = w.A;
    expect(() => leaveHousehold({ ...bare, tokens: fakeTokens() }, { confirm: true })).toThrow(
      /no attachment store/,
    );
    expect(w.uow.state.importHandoffs).toHaveLength(1);
    expect(w.attachments.files.size).toBe(1);
    expect(w.uow.state.people.find((p) => p.id === w.a)?.deletedAt).toBeNull();
  });

  it("does not fail a committed dismiss or leave when the file removal throws", () => {
    const w = setup();
    const id = handoff(w);
    const broken = {
      ...w.attachments,
      remove: () => {
        throw new Error("disk");
      },
    };
    expect(dismissHandoff({ ...w.B, attachments: broken }, { handoffId: id })).toEqual({
      status: "dismissed",
    });
    expect(listMyHandoffs(w.A)[0]?.status).toBe("dismissed");
    handoff(w, `${CSV}\n05/09/2026,-3.00,"AGAIN",982.00`);
    leaveHousehold({ ...w.A, attachments: broken, tokens: fakeTokens() }, { confirm: true });
    expect(w.uow.state.importHandoffs).toHaveLength(0);
  });

  it("keeps the first hand-off's file when a second of the same content fails", () => {
    const w = setup();
    const first = handoff(w);
    const gone = w.uow.state.people.findIndex((p) => p.id === w.c);
    const person = w.uow.state.people[gone];
    if (person === undefined) throw new Error("no such person");
    w.uow.state.people[gone] = { ...person, deletedAt: "2026-10-01T00:00:00Z" };
    expect(
      code(() =>
        createHandoff(w.A, {
          recipientId: w.c,
          filename: "again.csv",
          format: "commbank_csv",
          content: CSV,
        }),
      ),
    ).toBe("Validation");
    expect(w.attachments.files.size).toBe(1);
    expect(w.uow.state.attachments).toHaveLength(1);
    expect(acceptHandoff(w.B, { handoffId: first, accountId: w.bPrivate })).toEqual({
      status: "imported",
    });
  });
});
