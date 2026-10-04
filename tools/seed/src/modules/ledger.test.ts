import { describe, expect, it } from "vitest";
import { runSeed } from "../run.ts";
import { serialize } from "../serialize.ts";
import type { AccountCreatedEvent, EmittedEvent, TransactionCreatedEvent } from "../world.ts";
import { ACCOUNT_KEYS, PAYEES, TAGS } from "./catalogue.ts";
import { defaultModules } from "./index.ts";

const out = runSeed({ modules: defaultModules });
const events = out.events;
const ex = out.expectations;

const of = <T extends EmittedEvent["type"]>(type: T) =>
  events.filter((e): e is Extract<EmittedEvent, { type: T }> => e.type === type);
const accounts = of("account.created");
const txns = of("transaction.created");
const accountOf = (key: string): AccountCreatedEvent => {
  const found = accounts.find((a) => a.key === key);
  if (found === undefined) throw new Error(`no account ${key}`);
  return found;
};

describe("institutions-and-accounts", () => {
  it("has institutions, and accounts of every cash type and only those", () => {
    expect(of("institution.created").length).toBe(ex["institutions-and-accounts.institutionCount"]);
    expect(new Set(accounts.map((a) => a.accountType))).toEqual(
      new Set(["transaction", "savings", "offset", "credit_card", "home_loan"]),
    );
    for (const a of accounts) {
      expect(a.institution).not.toBeNull();
      expect(a.owners.reduce((sum, o) => sum + o.shareBp, 0)).toBe(10000);
    }
  });

  it("has a 50/50 joint account, a 6000/4000 one and one private account per person", () => {
    const shares = (key: string) => accountOf(key).owners.map((o) => o.shareBp);
    expect(shares(ACCOUNT_KEYS.everyday)).toEqual([5000, 5000]);
    expect(shares(ACCOUNT_KEYS.savings)).toEqual([6000, 4000]);
    expect(ex["institutions-and-accounts.unequalSharesBp"]).toEqual({
      "person-a": 6000,
      "person-b": 4000,
    });
    const priv = accounts.filter((a) => a.isPrivate);
    expect(priv.map((a) => a.owners.map((o) => o.person))).toEqual([["person-a"], ["person-b"]]);
  });
});

describe("classification", () => {
  it("creates shared and owner-only tags and payees from the catalogue", () => {
    expect(of("tag.created").map((t) => t.key)).toEqual(TAGS.map((t) => t.key));
    expect(of("payee.created").map((p) => p.key)).toEqual(PAYEES.map((p) => p.key));
    for (const row of [...of("tag.created"), ...of("payee.created")]) {
      if (row.origin !== null) expect(accountOf(row.origin).isPrivate).toBe(true);
    }
    expect(of("tag.created").some((t) => t.origin !== null)).toBe(true);
    expect(of("payee.created").some((p) => p.origin !== null)).toBe(true);
  });
});

describe("ledger-transactions", () => {
  const own = txns.filter((t) => t.module === "ledger-transactions");

  it("makes a few hundred transactions over the 12 months before today", () => {
    expect(txns.length).toBeGreaterThanOrEqual(300);
    expect(txns.length).toBeLessThanOrEqual(600);
    expect(ex["transfers-and-privacy.transactionCount"]).toBe(txns.length);
    for (const t of txns) {
      expect(t.postedOn >= "2025-07-16" && t.postedOn <= "2026-07-15").toBe(true);
      expect(Number.isSafeInteger(t.amountCents)).toBe(true);
    }
    expect(new Set(txns.map((t) => t.key)).size).toBe(txns.length);
    expect(ex["ledger-transactions.transactionCount"]).toBe(own.length);
  });

  it("puts transactions in every account, with payees, categories, tags and notes", () => {
    expect(new Set(txns.map((t) => t.account))).toEqual(new Set(Object.values(ACCOUNT_KEYS)));
    expect(own.some((t) => t.payee !== undefined)).toBe(true);
    expect(own.some((t) => t.category !== undefined)).toBe(true);
    expect(own.some((t) => t.notes !== undefined)).toBe(true);
    expect(own.some((t) => t.tags !== undefined)).toBe(true);
  });

  it("refers only to payees and tags the classification module creates", () => {
    const payees = new Set(PAYEES.map((p) => p.key));
    const tags = new Set(TAGS.map((t) => t.key));
    for (const t of own) {
      if (t.payee !== undefined) expect(payees.has(t.payee)).toBe(true);
      for (const tag of [...(t.tags ?? []), ...(t.splits ?? []).flatMap((s) => s.tags ?? [])]) {
        expect(tags.has(tag)).toBe(true);
      }
    }
  });

  it("keeps owner-only payees and tags out of shared accounts", () => {
    const ownerOnly = (key: string, list: readonly { key: string; owner: string | null }[]) =>
      list.find((x) => x.key === key)?.owner ?? null;
    for (const t of own) {
      if (!accountOf(t.account).isPrivate) {
        if (t.payee !== undefined) expect(ownerOnly(t.payee, PAYEES)).toBeNull();
        for (const tag of [...(t.tags ?? []), ...(t.splits ?? []).flatMap((s) => s.tags ?? [])]) {
          expect(ownerOnly(tag, TAGS)).toBeNull();
        }
      } else {
        const [owner] = accountOf(t.account).owners;
        if (t.payee !== undefined) {
          expect([null, owner?.person]).toContain(ownerOnly(t.payee, PAYEES));
        }
        for (const tag of t.tags ?? [])
          expect([null, owner?.person]).toContain(ownerOnly(tag, TAGS));
      }
    }
  });

  it("has multi-split transactions whose splits sum to the parent, with beneficiaries", () => {
    const multi = txns.filter((t) => (t.splits?.length ?? 0) > 1);
    expect(multi.map((t) => t.key)).toEqual(ex["ledger-transactions.multiSplitKeys"]);
    expect(multi.length).toBeGreaterThan(5);
    for (const t of multi) {
      expect((t.splits ?? []).reduce((sum, s) => sum + s.amountCents, 0)).toBe(t.amountCents);
      // A split transaction classifies in its splits, not on the parent.
      expect(t.category).toBeUndefined();
    }
    const beneficiaries = multi.flatMap((t) => (t.splits ?? []).map((s) => s.beneficiary));
    expect(beneficiaries).toContain("person-a");
    expect(beneficiaries).toContain("person-b");
    // A private account's splits belong to its owner: none names anyone else.
    for (const t of txns) {
      if (accountOf(t.account).isPrivate) {
        for (const s of t.splits ?? []) expect(s.beneficiary).toBeUndefined();
      }
    }
  });
});

describe("transfers-and-privacy", () => {
  const byKey = new Map(txns.map((t) => [t.key, t]));
  const groups = of("transfer.grouped");
  const hides = of("transaction.name-hidden");

  it("links each transfer's two sides: opposite amounts, different accounts, none twice", () => {
    expect(groups.length).toBeGreaterThan(10);
    const used = new Set<string>();
    for (const g of groups) {
      const [x, y] = g.transactions.map((k) => byKey.get(k) as TransactionCreatedEvent);
      expect(
        (x as TransactionCreatedEvent).amountCents + (y as TransactionCreatedEvent).amountCents,
      ).toBe(0);
      expect((x as TransactionCreatedEvent).account).not.toBe(
        (y as TransactionCreatedEvent).account,
      );
      for (const k of g.transactions) {
        expect(used.has(k)).toBe(false);
        used.add(k);
      }
    }
    expect([...used].sort()).toEqual(
      [...(ex["transfers-and-privacy.transferKeys"] as string[])].sort(),
    );
  });

  it("applies each transfer as a person who sees both accounts, one with a private counterpart", () => {
    const privateKeys = new Set(ex["transfers-and-privacy.privateTransferKeys"] as string[]);
    expect(privateKeys.size).toBeGreaterThan(0);
    for (const g of groups) {
      for (const k of g.transactions) {
        const account = accountOf((byKey.get(k) as TransactionCreatedEvent).account);
        if (account.isPrivate) expect(account.owners.map((o) => o.person)).toEqual([g.by]);
      }
    }
    const withPrivate = groups.filter((g) =>
      g.transactions.some(
        (k) => accountOf((byKey.get(k) as TransactionCreatedEvent).account).isPrivate,
      ),
    );
    expect(withPrivate.flatMap((g) => g.transactions).sort()).toEqual([...privateKeys].sort());
    // Both partners' private accounts have a counterpart in a shared one.
    expect(new Set(withPrivate.map((g) => g.by))).toEqual(new Set(["person-a", "person-b"]));
  });

  it("hides names only in shared accounts, by one of their owners", () => {
    expect(hides.map((h) => h.transaction)).toEqual(ex["transfers-and-privacy.hiddenKeys"]);
    expect(hides.length).toBeGreaterThan(0);
    for (const h of hides) {
      const account = accountOf((byKey.get(h.transaction) as TransactionCreatedEvent).account);
      expect(account.isPrivate).toBe(false);
      expect(account.owners.map((o) => o.person)).toContain(h.by);
    }
    expect(new Set(hides.map((h) => h.by)).size).toBe(2);
  });

  it("states how many transactions each person sees: shared accounts plus their own", () => {
    const counts = ex["transfers-and-privacy.visibleCounts"] as Record<string, number>;
    for (const person of ["person-a", "person-b"]) {
      const seen = txns.filter((t) => {
        const account = accountOf(t.account);
        return !account.isPrivate || account.owners.some((o) => o.person === person);
      });
      expect(counts[person]).toBe(seen.length);
    }
    const shared = txns.filter((t) => !accountOf(t.account).isPrivate).length;
    expect((counts["person-a"] as number) + (counts["person-b"] as number)).toBeGreaterThan(shared);
  });
});

describe("balance-snapshots", () => {
  const snapshots = of("balance.recorded");

  it("states an opening balance, month ends and today for every account", () => {
    expect(snapshots.length).toBe(ex["balance-snapshots.snapshotCount"]);
    const days = ex["balance-snapshots.snapshotDays"] as string[];
    expect(days[0]).toBe("2025-07-15");
    expect(days.at(-1)).toBe("2026-07-15");
    for (const a of accounts) {
      expect(snapshots.filter((s) => s.account === a.key).map((s) => s.asOf)).toEqual(days);
    }
  });

  it("has no gaps: each snapshot is the previous one plus the transactions between", () => {
    for (const a of accounts) {
      const mine = snapshots.filter((s) => s.account === a.key);
      for (let i = 1; i < mine.length; i++) {
        const previous = mine[i - 1] as (typeof mine)[number];
        const next = mine[i] as (typeof mine)[number];
        const between = txns
          .filter(
            (t) => t.account === a.key && t.postedOn > previous.asOf && t.postedOn <= next.asOf,
          )
          .reduce((sum, t) => sum + t.amountCents, 0);
        expect(next.balanceCents).toBe(previous.balanceCents + between);
      }
    }
  });

  it("keeps loans and cards negative, per the sign convention", () => {
    for (const s of snapshots) {
      const type = accountOf(s.account).accountType;
      if (type === "home_loan" || type === "credit_card")
        expect(s.balanceCents).toBeLessThanOrEqual(0);
    }
  });
});

describe("determinism", () => {
  it("serialises identically on every run", () => {
    expect(serialize(runSeed({ modules: defaultModules }))).toBe(serialize(out));
  });

  it("gives each module the same events whether or not unrelated modules run", () => {
    const [classificationModule] = defaultModules.filter((m) => m.name === "classification");
    const alone = runSeed({
      modules: defaultModules.filter((m) =>
        ["people-and-household", "institutions-and-accounts", "classification"].includes(m.name),
      ),
    });
    expect(classificationModule).toBeDefined();
    const pick = (o: typeof out) => o.events.filter((e) => e.module === "classification");
    expect(pick(alone)).toEqual(pick(out));
  });

  it("handles any 'today', including a leap day", () => {
    for (const today of ["2024-02-29", "2026-01-31", "2026-12-31"]) {
      const run = runSeed({ today, modules: defaultModules });
      expect(run.events.filter((e) => e.type === "transaction.created").length).toBeGreaterThan(
        200,
      );
    }
  });
});
