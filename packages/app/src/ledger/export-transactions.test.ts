import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { createCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import { createPayee } from "../classify/payees.ts";
import { createTag } from "../classify/tags.ts";
import type { UseCaseContext } from "../context.ts";
import { createPerson } from "../identity/create-person.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createTransaction } from "./create-transaction.ts";
import { exportTransactionsCsv, neutralizeFormula } from "./export-transactions.ts";
import { hideTransactionName } from "./hide-name.ts";
import { setSplits } from "./set-splits.ts";
import { setSplitTags } from "./split-tags.ts";

const clock = manualClock("2026-09-27T00:00:00Z");

function setup() {
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const as = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = as(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "A", colour: "#000000" });
  const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });

  const of = (id: Id<"Person">, authAgoMs = 0) =>
    as(personViewer(id, clock.now().subtract({ milliseconds: authAgoMs })));

  const shared = createAccount(sys, {
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [
      { personId: a, shareBp: 5000 },
      { personId: b, shareBp: 5000 },
    ],
  });

  const privateA = createAccount(sys, {
    name: "A private",
    type: "savings",
    currency: "AUD",
    isPrivate: true,
    owners: [{ personId: a, shareBp: 10000 }],
  });

  const group = createCategoryGroup(of(a), { name: "Living", kind: "expense" });
  const catGroceries = createCategory(of(a), { groupId: group.id, name: "Groceries" }).id;
  const catHousehold = createCategory(of(a), { groupId: group.id, name: "Household" }).id;
  const tagWeekly = createTag(of(a), { name: "weekly" }).id;
  const payeeColes = createPayee(of(a), { name: "Coles" }).id;

  return {
    sys,
    a,
    b,
    of,
    shared,
    privateA,
    catGroceries,
    catHousehold,
    tagWeekly,
    payeeColes,
  };
}

describe("exportTransactionsCsv", () => {
  it("exports CSV for a person viewer with recent authentication", () => {
    const s = setup();
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-20",
      amountCents: -5000,
      description: "Supermarket",
      payeeId: s.payeeColes,
    });

    const csv = exportTransactionsCsv(s.of(s.a, 60_000)); // 1 min ago
    expect(csv).toContain("Date,Account,Payee,Description,Category,Memo,Tags,Amount\r\n");
    expect(csv).toContain("2026-09-20,Joint,Coles,Supermarket,,,,'-50.00\r\n");
  });

  it("rejects export with ReauthRequired when session is older than 5 minutes", () => {
    const s = setup();
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-20",
      amountCents: -5000,
      description: "Supermarket",
    });

    const staleCtx = s.of(s.a, 6 * 60_000); // 6 min ago
    expect(() => exportTransactionsCsv(staleCtx)).toThrowError(
      expect.objectContaining({
        code: "ReauthRequired",
        message: "Sign in again to do this",
      }),
    );
  });

  it("allows system viewer regardless of authentication window", () => {
    const s = setup();
    createTransaction(s.sys, {
      accountId: s.shared,
      postedOn: "2026-09-20",
      amountCents: -5000,
      description: "Supermarket",
    });

    const csv = exportTransactionsCsv(s.sys);
    expect(csv).toContain("2026-09-20,Joint,,Supermarket,,,,'-50.00\r\n");
  });

  it("filters exported transactions matching query parameters", () => {
    const s = setup();
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-07-01",
      amountCents: -1000,
      description: "July txn",
    });
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-08-01",
      amountCents: -2000,
      description: "August txn",
    });
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-01",
      amountCents: 5000,
      description: "September salary",
    });

    const julyCsv = exportTransactionsCsv(s.of(s.a), {
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(julyCsv).toContain("July txn");
    expect(julyCsv).not.toContain("August txn");
    expect(julyCsv).not.toContain("September salary");

    const inCsv = exportTransactionsCsv(s.of(s.a), { type: "in" });
    expect(inCsv).toContain("September salary");
    expect(inCsv).not.toContain("July txn");
    expect(inCsv).not.toContain("August txn");
  });

  it("excludes partner's private accounts and redacts hidden-name transactions", () => {
    const s = setup();
    // Transaction in A's private account
    createTransaction(s.of(s.a), {
      accountId: s.privateA,
      postedOn: "2026-09-10",
      amountCents: -1200,
      description: "Private secret",
    });

    // Transaction in shared account hidden by A
    const tHidden = createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-15",
      amountCents: -9900,
      description: "Surprise gift",
      payeeId: s.payeeColes,
    });
    hideTransactionName(s.of(s.a), {
      id: tHidden,
      until: "2027-03-12",
    });

    // Partner A's export shows private account and real name
    const csvA = exportTransactionsCsv(s.of(s.a));
    expect(csvA).toContain("Private secret");
    expect(csvA).toContain("Surprise gift");
    expect(csvA).toContain("Coles");

    // Partner B's export never sees private account and sees redacted description with empty payee
    const csvB = exportTransactionsCsv(s.of(s.b));
    expect(csvB).not.toContain("Private secret");
    expect(csvB).not.toContain("A private");
    expect(csvB).not.toContain("Surprise gift");
    expect(csvB).toContain("Hidden until 12 Mar 2027");
    // Row should have empty payee cell: "2026-09-15,Joint,,Hidden until 12 Mar 2027,,,,'-99.00\r\n"
    expect(csvB).toContain("2026-09-15,Joint,,Hidden until 12 Mar 2027,,,,'-99.00\r\n");
  });

  it("neutralizes formula injection characters (=, +, -, @) by prefixing with '", () => {
    const s = setup();
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-20",
      amountCents: 1000,
      description: "=SUM(A1:A10)",
    });
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-21",
      amountCents: 2000,
      description: "-14.50",
    });
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-22",
      amountCents: 3000,
      description: "@payee",
    });
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-23",
      amountCents: 4000,
      description: "+100 bonus",
    });

    const csv = exportTransactionsCsv(s.of(s.a));
    expect(csv).toContain("'=SUM(A1:A10)");
    expect(csv).toContain("'-14.50");
    expect(csv).toContain("'@payee");
    expect(csv).toContain("'+100 bonus");
  });

  it("neutralizes formula injection with leading whitespace or tabs", () => {
    expect(neutralizeFormula(" =1+1")).toBe("' =1+1");
    expect(neutralizeFormula("\t+2")).toBe("'\t+2");
    expect(neutralizeFormula("  -5")).toBe("'  -5");
    expect(neutralizeFormula("   @target")).toBe("'   @target");
    expect(neutralizeFormula("normal text")).toBe("normal text");
  });

  it("formats multi-split transaction as multiple CSV rows matching split amounts and categories", () => {
    const s = setup();
    const txnId = createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-25",
      amountCents: -10000,
      description: "Supermarket haul",
    });

    setSplits(s.of(s.a), {
      transactionId: txnId,
      splits: [
        {
          amountCents: -6000,
          categoryId: s.catGroceries,
          memo: "Groceries split",
        },
        {
          amountCents: -4000,
          categoryId: s.catHousehold,
          memo: "Household cleaning",
        },
      ],
    });

    // Tag the first split
    const txn = s.sys.uow.read((r) =>
      r.transactions.findVisible(s.sys.viewer, txnId, "2026-09-27"),
    );
    const firstSplitId = txn?.splits[0]?.id;
    if (!firstSplitId) throw new Error("expected split");
    setSplitTags(s.of(s.a), {
      transactionId: txnId,
      splitId: firstSplitId,
      tagIds: [s.tagWeekly],
    });

    const csv = exportTransactionsCsv(s.of(s.a));
    const lines = csv.split("\r\n").filter((l) => l.includes("Supermarket haul"));
    expect(lines).toHaveLength(2);

    expect(lines[0]).toBe(
      "2026-09-25,Joint,,Supermarket haul,Groceries,Groceries split,weekly,'-60.00",
    );
    expect(lines[1]).toBe(
      "2026-09-25,Joint,,Supermarket haul,Household,Household cleaning,,'-40.00",
    );
  });

  it("escapes RFC 4180 special characters (commas, quotes, newlines)", () => {
    const s = setup();
    createTransaction(s.of(s.a), {
      accountId: s.shared,
      postedOn: "2026-09-25",
      amountCents: 5000,
      description: 'Coffee, "Tea" & Snacks',
    });

    const csv = exportTransactionsCsv(s.of(s.a));
    expect(csv).toContain('"Coffee, ""Tea"" & Snacks"');
  });
});
