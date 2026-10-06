// The closed-account lock (decision of 2026-10-06): a closed account is a historical record. An
// entry dated after `closedOn` is locked until the account is opened again; anything on or before
// stays editable by either owner.
import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { recordBalanceSnapshot } from "../accounts/balance.ts";
import { closeAccount } from "../accounts/close-account.ts";
import { createAccount } from "../accounts/create-account.ts";
import { updateAccount } from "../accounts/update-account.ts";
import { createTag } from "../classify/tags.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import type { TransactionRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createTransaction } from "./create-transaction.ts";
import { deleteTransaction } from "./delete-transaction.ts";
import { hideTransactionName, unhideTransactionName } from "./hide-name.ts";
import { setSplitField } from "./set-split-field.ts";
import { setSplits } from "./set-splits.ts";
import { setSplitTags } from "./split-tags.ts";
import { createTransferGroup, deleteTransferGroup } from "./transfer-groups.ts";
import { updateTransaction } from "./update-transaction.ts";

const clock = manualClock("2026-09-27T00:00:00Z");

function setup() {
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const as = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = as(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "Ann", colour: "#000000" });
  const b = createPerson(sys, { displayName: "Bob", colour: "#ffffff" });
  const person = (id: Id<"Person">) => as(personViewer(id, clock.now()));
  const account = (name: string) =>
    createAccount(sys, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: a, shareBp: 5000 },
        { personId: b, shareBp: 5000 },
      ],
    });
  const joint = account("Joint");
  const other = account("Other");
  const line = (ctx: UseCaseContext, accountId: string, postedOn: string, amountCents = -1000) =>
    createTransaction(ctx, { accountId, postedOn, amountCents, description: "Coffee" });
  return { uow, sys, a, b, as: person, joint, other, line };
}

/** The lock's `Conflict`, with its details. */
function conflict(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("Conflict");
    return error as AppError;
  }
  throw new Error("expected a Conflict");
}

/** Marks a stored row as imported, as an importer would have left it. */
function markImported(uow: ReturnType<typeof setup>["uow"], id: string, externalId: string) {
  const index = uow.state.transactions.findIndex((t) => t.id === id);
  const row = uow.state.transactions[index] as TransactionRow;
  uow.state.transactions[index] = { ...row, externalId };
}

describe("a closed account locks after its closed date", () => {
  it("allows every write on or before closedOn and refuses after, with the details", () => {
    const { as, a, b, joint, line, uow, sys } = setup();
    const early = line(as(a), joint, "2026-08-10");
    const lateLegacy = line(as(a), joint, "2026-09-05");
    markImported(uow, lateLegacy, "bank-1");
    const manualLate = line(as(a), joint, "2026-09-02");
    closeAccount(sys, { id: joint, closedOn: "2026-09-10" });
    // closeAccount ran as system: the entries are all before 09-10, so move the closed date back.
    updateAccount(sys, { id: joint, closedOn: "2026-08-31" });

    // Before: add, amend, split, tag, hide, delete are all allowed (either owner).
    const ok = line(as(b), joint, "2026-08-31");
    updateTransaction(as(a), { id: ok, notes: "fine" });
    updateTransaction(as(b), { id: early, amountCents: -2000 });
    const tag = createTag(as(a), { name: "Trip", originAccountId: joint }).id;
    const view = setSplits(as(a), {
      transactionId: early,
      splits: [{ amountCents: -1500 }, { amountCents: -500 }],
    });
    setSplitTags(as(b), {
      transactionId: early,
      splitId: view.splits[0]?.id as string,
      tagIds: [tag],
    });
    setSplitField(as(a), {
      transactionId: early,
      splitId: view.splits[1]?.id as string,
      field: "deductible_bp",
      value: 5000,
      source: "user",
    });
    hideTransactionName(as(a), { id: early });
    unhideTransactionName(as(a), { id: early });
    deleteTransaction(as(a), { id: ok });

    // After: every write is refused with the same details.
    const details = {
      accountId: joint,
      closedOn: "2026-08-31",
      latestEntryDate: "2026-09-05",
      latestSnapshotAsOf: null,
      manualEntries: [{ id: manualLate, postedOn: "2026-09-02" }],
      importedCount: 1,
    };
    const refused = (fn: () => unknown) => expect(conflict(fn).details).toEqual(details);
    refused(() => line(as(a), joint, "2026-09-01"));
    refused(() => updateTransaction(as(a), { id: manualLate, notes: "no" }));
    refused(() => updateTransaction(as(a), { id: manualLate, amountCents: -1 }));
    refused(() => deleteTransaction(as(a), { id: manualLate }));
    refused(() => deleteTransaction(as(a), { id: lateLegacy }));
    refused(() =>
      setSplits(as(a), { transactionId: manualLate, splits: [{ amountCents: -1000 }] }),
    );
    refused(() =>
      setSplitTags(as(a), {
        transactionId: manualLate,
        splitId: uow.state.splits.find((s) => s.transactionId === manualLate)?.id as string,
        tagIds: [tag],
      }),
    );
    refused(() =>
      setSplitField(as(a), {
        transactionId: manualLate,
        splitId: uow.state.splits.find((s) => s.transactionId === manualLate)?.id as string,
        field: "deductible_bp",
        value: 100,
        source: "user",
      }),
    );
    refused(() => hideTransactionName(as(b), { id: manualLate }));
    refused(() =>
      recordBalanceSnapshot(as(a), { accountId: joint, asOf: "2026-09-05", balanceCents: 1 }),
    );
    // The lock follows the date, not the person, and nothing was written by the refusals.
    expect(uow.state.transactions.find((t) => t.id === manualLate)?.postedOn).toBe("2026-09-02");
    expect(uow.state.deleted.has(manualLate)).toBe(false);
  });

  it("refuses a date change across closedOn, and allows one back", () => {
    const { as, a, joint, line, uow, sys } = setup();
    const early = line(as(a), joint, "2026-08-10");
    const late = line(as(a), joint, "2026-09-20");
    // The system viewer builds the legacy state: a later entry on a closed account.
    closeAccount(sys, { id: joint, closedOn: "2026-08-31" });
    // Across: before to after.
    const across = conflict(() => updateTransaction(as(a), { id: early, postedOn: "2026-09-01" }));
    expect(across.details).toMatchObject({ accountId: joint, closedOn: "2026-08-31" });
    // Back: the legacy entry after closedOn moves to on or before it.
    updateTransaction(as(a), { id: late, postedOn: "2026-08-31" });
    expect(uow.state.transactions.find((t) => t.id === late)?.postedOn).toBe("2026-08-31");
    // On the date itself is not after it.
    updateTransaction(as(a), { id: early, postedOn: "2026-08-31" });
  });

  it("refuses moving a locked entry earlier while it stays after closedOn", () => {
    const { as, a, joint, line, uow, sys } = setup();
    line(as(a), joint, "2026-08-10");
    const late = line(as(a), joint, "2026-09-20");
    closeAccount(sys, { id: joint, closedOn: "2026-08-31" });
    const refused = conflict(() => updateTransaction(as(a), { id: late, postedOn: "2026-09-10" }));
    expect(refused.details).toMatchObject({ closedOn: "2026-08-31" });
    expect(uow.state.transactions.find((t) => t.id === late)?.postedOn).toBe("2026-09-20");
    expect(refused.message).toContain("dated 2026-09-10");
  });

  it("answers a no-op setSplits on a locked entry unchanged, like the other no-ops", () => {
    const { as, a, joint, line, sys, uow } = setup();
    const late = line(as(a), joint, "2026-09-20");
    closeAccount(sys, { id: joint, closedOn: "2026-08-31" });
    const [only] = uow.state.splits.filter((x) => x.transactionId === late);
    const same = setSplits(as(a), {
      transactionId: late,
      splits: [{ id: only?.id as string, amountCents: -1000 }],
    });
    expect(same.splits).toHaveLength(1);
    // A real change is still refused.
    conflict(() =>
      setSplits(as(a), {
        transactionId: late,
        splits: [{ amountCents: -400 }, { amountCents: -600 }],
      }),
    );
  });

  it("refuses to unhide a name on an entry that is locked after it was hidden", () => {
    const { as, a, joint, line, sys, uow } = setup();
    const id = line(as(a), joint, "2026-09-20");
    hideTransactionName(as(a), { id });
    // The account closes earlier, as the system viewer, leaving the entry after closedOn.
    closeAccount(sys, { id: joint, closedOn: "2026-08-31" });
    const refused = conflict(() => unhideTransactionName(as(a), { id }));
    expect(refused.details).toEqual({
      accountId: joint,
      closedOn: "2026-08-31",
      latestEntryDate: "2026-09-20",
      latestSnapshotAsOf: null,
      manualEntries: [{ id, postedOn: "2026-09-20" }],
      importedCount: 0,
    });
    // Still hidden.
    expect(uow.state.transactions.find((t) => t.id === id)?.nameHiddenBy).toBe(a);
  });

  it("lifts the lock when the account is opened again", () => {
    const { as, a, joint, line, sys } = setup();
    line(as(a), joint, "2026-08-10");
    closeAccount(as(a), { id: joint, closedOn: "2026-08-31" });
    conflict(() => line(as(a), joint, "2026-09-01"));
    updateAccount(as(a), { id: joint, closedOn: null });
    line(as(a), joint, "2026-09-01");
    // Closing again before that entry is refused, until its date is moved.
    conflict(() => closeAccount(as(a), { id: joint, closedOn: "2026-08-31" }));
    closeAccount(sys, { id: joint, closedOn: "2026-09-30" });
  });

  it("refuses closing before the latest entry, listing manual entries and counting imported", () => {
    const { as, a, joint, line, uow } = setup();
    line(as(a), joint, "2026-08-10");
    const m1 = line(as(a), joint, "2026-09-02");
    const imported = line(as(a), joint, "2026-09-03");
    markImported(uow, imported, "bank-9");
    const m2 = line(as(a), joint, "2026-09-04");
    const error = conflict(() => closeAccount(as(a), { id: joint, closedOn: "2026-08-31" }));
    expect(error.details).toEqual({
      accountId: joint,
      closedOn: "2026-08-31",
      latestEntryDate: "2026-09-04",
      latestSnapshotAsOf: null,
      manualEntries: [
        { id: m1, postedOn: "2026-09-02" },
        { id: m2, postedOn: "2026-09-04" },
      ],
      importedCount: 1,
    });
    expect(uow.state.accounts.find((x) => x.id === joint)?.closedOn).toBeNull();
    // updateAccount refuses the same close, and accepts the later date.
    const viaUpdate = conflict(() => updateAccount(as(a), { id: joint, closedOn: "2026-08-31" }));
    expect(viaUpdate.details).toEqual(error.details);
    expect(closeAccount(as(a), { id: joint, closedOn: "2026-09-04" }).closedOn).toBe("2026-09-04");
  });

  it("counts a snapshot as the latest date, and lists at most 20 manual entries", () => {
    const { as, a, joint, line } = setup();
    recordBalanceSnapshot(as(a), { accountId: joint, asOf: "2026-09-15", balanceCents: 5 });
    const snapshotOnly = conflict(() => closeAccount(as(a), { id: joint, closedOn: "2026-09-01" }));
    expect(snapshotOnly.details).toMatchObject({
      latestEntryDate: "2026-09-15",
      latestSnapshotAsOf: "2026-09-15",
      manualEntries: [],
      importedCount: 0,
    });
    // The message names the snapshot as what blocks, and all three ways out.
    expect(snapshotOnly.message).toContain("balance snapshot dated 2026-09-15");
    expect(snapshotOnly.message).not.toContain("a later transaction");
    expect(snapshotOnly.message).toContain("Close it on 2026-09-15 or later");
    expect(snapshotOnly.message).toContain("manually entered transactions");
    expect(snapshotOnly.message).toContain("leave the account open");
    for (let i = 0; i < 25; i += 1) line(as(a), joint, "2026-09-20");
    const many = conflict(() => closeAccount(as(a), { id: joint, closedOn: "2026-09-16" }));
    const details = many.details as { manualEntries: unknown[] };
    expect(details.manualEntries).toHaveLength(20);
  });

  it("rejects a snapshot after closedOn and accepts one on it", () => {
    const { as, a, joint, line } = setup();
    line(as(a), joint, "2026-08-10");
    closeAccount(as(a), { id: joint, closedOn: "2026-08-31" });
    recordBalanceSnapshot(as(a), { accountId: joint, asOf: "2026-08-31", balanceCents: 1 });
    conflict(() =>
      recordBalanceSnapshot(as(a), { accountId: joint, asOf: "2026-09-01", balanceCents: 1 }),
    );
  });

  it("locks both sides of a transfer by their own dates, and unlinks a survivor in a closed account", () => {
    const { as, a, b, joint, other, line, uow, sys } = setup();
    const x = line(as(a), joint, "2026-09-10", -500);
    const y = line(as(a), other, "2026-09-10", 500);
    const pair = createTransferGroup(as(a), { transactionIds: [x, y] });
    const groupId = pair[0].transferGroupId as string;
    // Close `other` before the transfer (system viewer is exempt from the early-close check).
    closeAccount(sys, { id: other, closedOn: "2026-08-31" });
    conflict(() => deleteTransferGroup(as(a), { id: groupId }));
    // Deleting the open side unlinks the survivor in the closed account: upkeep, not locked.
    deleteTransaction(as(b), { id: x });
    expect(uow.state.transactions.find((t) => t.id === y)?.transferGroupId).toBeNull();
    expect(uow.state.transferGroups).toHaveLength(0);
    // A new group over a locked side is refused.
    const z = line(as(a), joint, "2026-09-11", -500);
    conflict(() => createTransferGroup(as(a), { transactionIds: [z, y] }));
  });

  it("exempts the system viewer", () => {
    const { as, a, joint, line, sys, uow } = setup();
    line(as(a), joint, "2026-08-10");
    closeAccount(as(a), { id: joint, closedOn: "2026-08-31" });
    const id = line(sys, joint, "2026-09-20");
    recordBalanceSnapshot(sys, { accountId: joint, asOf: "2026-09-20", balanceCents: 1 });
    updateTransaction(sys, { id, notes: "job" });
    deleteTransaction(sys, { id });
    expect(uow.state.deleted.has(id)).toBe(true);
    // Closing earlier is exempt too.
    updateAccount(sys, { id: joint, closedOn: "2026-08-15" });
    expect(uow.state.accounts.find((x) => x.id === joint)?.closedOn).toBe("2026-08-15");
  });

  it("does not refuse an unrelated account edit on a closed account with legacy entries", () => {
    const { as, a, joint, line, sys } = setup();
    line(as(a), joint, "2026-09-20");
    closeAccount(sys, { id: joint, closedOn: "2026-08-31" });
    expect(updateAccount(as(a), { id: joint, name: "Renamed" }).name).toBe("Renamed");
    expect(updateAccount(as(a), { id: joint, closedOn: "2026-08-31" }).closedOn).toBe("2026-08-31");
  });
});
