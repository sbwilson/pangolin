// The domain-link listener (merchant-domain story): an accepted LLM or import suggestion that
// carries a merchant domain links `https://<domain>` onto the transaction's payee and enqueues
// one `logo-fetch` job — in the SAME write transaction (AD-8), so a rolled-back acceptance
// leaves neither. A private payee's domain is linked but never fetched.
import { type Id, idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { getTransaction } from "../ledger/get-transaction.ts";
import { registerSplitFieldListener, setSplitField } from "../ledger/set-split-field.ts";
import type { SplitRow, SplitSource, SuggestionRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { type ManualClock, manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import { createCategory } from "./categories.ts";
import { createCategoryGroup } from "./category-groups.ts";
import { onSplitFieldWrite } from "./domain-link.ts"; // registers the listener at module load
import { createPayee } from "./payees.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const NOW = "2026-09-27T00:00:00Z";

/** Fails the test loudly when a row that must exist is absent, and narrows the type. */
function defined<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be defined`);
  return value;
}

function fixture() {
  const clock: ManualClock = manualClock(NOW);
  const made = memoryContext(systemViewer("job:test"), clock);
  made.uow.state.people = [
    {
      id: personA,
      userId: null,
      displayName: "Alex",
      colour: "#000000",
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  ];
  made.uow.state.accounts.push(
    {
      id: "pub1" as Id<"Account">,
      name: "Joint everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "priv1" as Id<"Account">,
      name: "Alex private",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  );
  made.uow.state.accountOwners.push(
    {
      accountId: "pub1" as Id<"Account">,
      personId: personA,
      shareBp: 10000,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      accountId: "priv1" as Id<"Account">,
      personId: personA,
      shareBp: 10000,
      createdAt: NOW,
      updatedAt: NOW,
    },
  );
  const ctx = { ...made.ctx, viewer: personViewer(personA, Temporal.Instant.from(NOW)) };
  const grp = createCategoryGroup(ctx, { name: "Living", kind: "expense" });
  const cat = createCategory(ctx, { groupId: grp.id, name: "Groceries", isFixedCost: false });
  const cat2 = createCategory(ctx, { groupId: grp.id, name: "Transport", isFixedCost: false });

  /** A payee plus an unclassified transaction pointing at it. */
  const withTransaction = (
    payeeName: string,
    accountId: string,
    websiteUrl?: string,
  ): { payeeId: string; txnId: Id<"Transaction">; splitId: string } => {
    const payee = createPayee(ctx, {
      name: payeeName,
      originAccountId: accountId,
      ...(websiteUrl === undefined ? {} : { websiteUrl }),
    });
    made.uow.state.jobs.length = 0; // drop any job the create itself queued
    const txnId = createTransaction(ctx, {
      accountId,
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: payeeName,
      payeeId: payee.id,
    });
    const splitId = defined(getTransaction(ctx, { id: txnId }).splits[0], "split").id;
    return { payeeId: payee.id, txnId, splitId };
  };

  const pushSuggestion = (
    txnId: Id<"Transaction">,
    splitId: string,
    websiteDomain: string | null,
  ): void => {
    const row: SuggestionRow = {
      id: made.ctx.newId<"Suggestion">(),
      accountId: "pub1" as Id<"Account">,
      transactionId: txnId,
      splitId: splitId as SuggestionRow["splitId"],
      source: "llm",
      field: "category",
      suggestedValue: cat.id,
      payeeName: "Shop",
      websiteDomain,
      taxCategoryId: null,
      activityId: null,
      confidence: 0.95,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: NOW,
      resolvedAt: null,
    };
    made.uow.state.suggestions.push(row);
  };

  const logoJobs = () => made.uow.state.jobs.filter((j) => j.kind === "logo-fetch");
  const payee = (id: string) => made.uow.state.payees.find((p) => p.id === id);

  return {
    ...made,
    clock,
    ctx,
    catId: cat.id,
    cat2Id: cat2.id,
    withTransaction,
    pushSuggestion,
    logoJobs,
    payee,
  };
}

/** A context that counts how many write transactions run through its unit of work. */
function countingWrites(ctx: UseCaseContext): { ctx: UseCaseContext; writes: () => number } {
  let writes = 0;
  return {
    writes: () => writes,
    ctx: {
      ...ctx,
      uow: {
        transaction: (fn) => {
          writes += 1;
          return ctx.uow.transaction(fn);
        },
        read: (fn) => ctx.uow.read(fn),
      },
    },
  };
}

describe("classify.onSplitFieldWrite (the domain link)", () => {
  it("links the domain and enqueues ONE job inside the accepting write — no second transaction", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction("Woolworths", "pub1");
    f.pushSuggestion(txnId, splitId, "https://www.Woolworths.com.au/store?x=1");
    const counted = countingWrites(f.ctx);

    setSplitField(counted.ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });

    expect(counted.writes()).toBe(1); // one commit: field, close, link and job together
    expect(f.payee(payeeId)?.websiteUrl).toBe("https://woolworths.com.au");
    const jobs = f.logoJobs();
    expect(jobs).toHaveLength(1);
    const job = defined(jobs[0], "logo job");
    expect(job.lane).toBe("net");
    expect(job.dedupeKey).toBe(`logo:${payeeId}`);
  });

  it("audits the link as a classify payee update", () => {
    const f = fixture();
    const { txnId, splitId } = f.withTransaction("Woolies", "pub1");
    f.pushSuggestion(txnId, splitId, "woolies.example.com");

    setSplitField(f.ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });

    const audits = f.uow.state.audit.filter((a) => a.entity === "payee" && a.action === "update");
    expect(audits).toHaveLength(1);
    const after = JSON.parse(defined(audits[0], "audit row").after as string) as {
      websiteUrl: string;
    };
    expect(after.websiteUrl).toBe("https://woolies.example.com");
  });

  it("links a private payee's domain but enqueues no fetch (AD-8)", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction("Secret Clinic", "priv1");
    f.pushSuggestion(txnId, splitId, "clinic.example.net/path");

    setSplitField(f.ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });

    expect(f.payee(payeeId)?.websiteUrl).toBe("https://clinic.example.net");
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("never overwrites an existing website and still enqueues for a public logoless payee", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction(
      "Woolies",
      "pub1",
      "https://existing.example.org",
    );
    f.pushSuggestion(txnId, splitId, "woolies.example.com");

    setSplitField(f.ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });

    expect(f.payee(payeeId)?.websiteUrl).toBe("https://existing.example.org");
    expect(f.logoJobs()).toHaveLength(1);
  });

  it("a live job is not duplicated while it is pending", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction("Woolies", "pub1");
    f.pushSuggestion(txnId, splitId, "woolies.example.com");

    setSplitField(f.ctx, {
      transactionId: txnId,
      splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });
    expect(f.logoJobs()).toHaveLength(1);
    // The job is still pending, so a second confirmation adds nothing.
    write(f.ctx, (tx, audit) =>
      onSplitFieldWrite(f.ctx, tx, audit, {
        transactionId: txnId,
        splitId,
        field: "category",
        value: f.catId,
        source: "llm",
        closedSuggestion: {
          id: "sug-2",
          websiteDomain: "woolies.example.com",
          outcome: "accepted",
        },
      }),
    );
    expect(f.logoJobs()).toHaveLength(1);
    expect(f.payee(payeeId)?.websiteUrl).toBe("https://woolies.example.com");
  });

  it("a rolled-back acceptance leaves neither the domain link nor the queued job", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction("Woolies", "pub1");
    f.pushSuggestion(txnId, splitId, "woolies.example.com");
    const auditsBefore = f.uow.state.audit.length;
    // A second listener that refuses the write, as a conflict inside the same transaction would.
    const unregister = registerSplitFieldListener(() => {
      throw new Error("boom");
    });
    try {
      expect(() =>
        setSplitField(f.ctx, {
          transactionId: txnId,
          splitId,
          field: "category",
          value: f.catId,
          source: "llm",
        }),
      ).toThrow("boom");
    } finally {
      unregister();
    }
    expect(f.payee(payeeId)?.websiteUrl).toBeNull();
    expect(f.logoJobs()).toHaveLength(0);
    expect(f.uow.state.audit).toHaveLength(auditsBefore);
    const split = f.uow.state.splits.find((s) => s.id === (splitId as SplitRow["id"]));
    expect(split?.categoryId).toBeNull();
  });

  it("an import-sourced accepted closure links and enqueues like the llm one", () => {
    const f = fixture();
    const { payeeId, txnId, splitId } = f.withTransaction("Imported Shop", "pub1");
    // `SPLIT_SOURCES` gains `import` with the import confirmation flow; the listener contract
    // already covers it, so drive the listener with that source directly.
    write(f.ctx, (tx, audit) =>
      onSplitFieldWrite(f.ctx, tx, audit, {
        transactionId: txnId,
        splitId,
        field: "category",
        value: f.catId,
        source: "import" as unknown as SplitSource, // `SPLIT_SOURCES` gains `import` with the import flow
        closedSuggestion: { id: "sug-1", websiteDomain: "shop.example.com", outcome: "accepted" },
      }),
    );
    expect(f.payee(payeeId)?.websiteUrl).toBe("https://shop.example.com");
    expect(f.logoJobs()).toHaveLength(1);
  });

  it("superseded closures, user closes and missing domains link nothing", () => {
    const f = fixture();
    // Superseded: the field is set to a value the suggestion did not offer.
    const one = f.withTransaction("Store One", "pub1");
    f.pushSuggestion(one.txnId, one.splitId, "one.example.com");
    setSplitField(f.ctx, {
      transactionId: one.txnId,
      splitId: one.splitId,
      field: "category",
      value: f.cat2Id,
      source: "rule",
    });
    expect(f.payee(one.payeeId)?.websiteUrl).toBeNull();

    // Accepted on a user write: not a domain confirmation.
    const two = f.withTransaction("Store Two", "pub1");
    f.pushSuggestion(two.txnId, two.splitId, "two.example.com");
    setSplitField(f.ctx, {
      transactionId: two.txnId,
      splitId: two.splitId,
      field: "category",
      value: f.catId,
      source: "user",
    });
    expect(f.payee(two.payeeId)?.websiteUrl).toBeNull();

    // Accepted, but the suggestion carried no domain, and a domain that cannot be stored.
    const three = f.withTransaction("Store Three", "pub1");
    f.pushSuggestion(three.txnId, three.splitId, null);
    setSplitField(f.ctx, {
      transactionId: three.txnId,
      splitId: three.splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });
    expect(f.payee(three.payeeId)?.websiteUrl).toBeNull();
    const four = f.withTransaction("Store Four", "pub1");
    f.pushSuggestion(four.txnId, four.splitId, "http://192.168.0.7/");
    setSplitField(f.ctx, {
      transactionId: four.txnId,
      splitId: four.splitId,
      field: "category",
      value: f.catId,
      source: "llm",
    });
    expect(f.payee(four.payeeId)?.websiteUrl).toBeNull();

    // A rejected closure, driven straight at the listener.
    write(f.ctx, (tx, audit) =>
      onSplitFieldWrite(f.ctx, tx, audit, {
        transactionId: one.txnId,
        splitId: one.splitId,
        field: "category",
        value: null,
        source: "llm",
        closedSuggestion: { id: "sug-x", websiteDomain: "late.example.com", outcome: "rejected" },
      }),
    );
    expect(f.payee(one.payeeId)?.websiteUrl).toBeNull();
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("a transaction without a payee links nothing and enqueues nothing", () => {
    const f = fixture();
    const txnId = createTransaction(f.ctx, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: "Mystery",
    });
    const splitId = defined(getTransaction(f.ctx, { id: txnId }).splits[0], "split").id;
    f.pushSuggestion(txnId, splitId, "mystery-brand.com");
    expect(() =>
      setSplitField(f.ctx, {
        transactionId: txnId,
        splitId,
        field: "category",
        value: f.catId,
        source: "llm",
      }),
    ).not.toThrow();
    expect(f.uow.state.payees.every((p) => p.websiteUrl === null)).toBe(true);
    expect(f.logoJobs()).toHaveLength(0);
  });
});
