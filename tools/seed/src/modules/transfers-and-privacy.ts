// Money moving between the household's own accounts, and the names a partner hides.
//
// Every transfer is a pair of transactions linked as a manual transfer group. Most are between
// shared accounts; some have a counterpart in a partner's private account, which the other
// partner sees only as "Transfer from/to <owner>". Surprise purchases on shared accounts have
// their names hidden by whoever made them. This module also states what each partner should
// see, because it is the last module to add transactions.
import { Temporal } from "@pangolin/shared/temporal";
import type { Json, SeedModule } from "../module.ts";
import type {
  CategoryRef,
  NameHiddenEvent,
  TransactionCreatedEvent,
  TransferGroupedEvent,
  World,
} from "../world.ts";
import { ACCOUNT_KEYS, cat, OPENING_CENTS } from "./catalogue.ts";
import { everyMonth, inWindow, iso, monthlyOn, type Window, windowOf } from "./dates.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

const [A, B] = PERSON_KEYS;

interface Pair {
  readonly id: string;
  readonly date: Temporal.PlainDate;
  readonly cents: number;
  readonly from: { account: string; description: string; category: CategoryRef };
  readonly to: { account: string; description: string; category: CategoryRef };
  /** The person the group is created as. */
  readonly by: string;
}

const BETWEEN = cat("Transfers (not spending)", "Between our accounts");
const TO_SAVINGS = cat("Transfers (not spending)", "To savings");
const CARD_PAYMENT = cat("Transfers (not spending)", "Credit card payment");

interface Surprise {
  readonly key: string;
  readonly by: string;
  readonly account: string;
  readonly monthsIn: number;
  readonly day: number;
  readonly cents: number;
  readonly description: string;
  readonly category: CategoryRef;
}

const SURPRISES: readonly Surprise[] = [
  {
    key: "surprise-1",
    by: A,
    account: ACCOUNT_KEYS.card,
    monthsIn: 10,
    day: 2,
    cents: 38_900,
    description: "Pandora anniversary gift",
    category: cat("Personal", "Gifts"),
  },
  {
    key: "surprise-2",
    by: A,
    account: ACCOUNT_KEYS.everyday,
    monthsIn: 11,
    day: 20,
    cents: 45_000,
    description: "Party catering deposit",
    category: cat("Personal", "Gifts"),
  },
  {
    key: "surprise-3",
    by: B,
    account: ACCOUNT_KEYS.card,
    monthsIn: 8,
    day: 8,
    cents: 25_600,
    description: "Ticketek concert tickets",
    category: cat("Lifestyle", "Entertainment"),
  },
  {
    key: "surprise-4",
    by: B,
    account: ACCOUNT_KEYS.card,
    monthsIn: 11,
    day: 12,
    cents: 14_000,
    description: "Engraving, birthday present",
    category: cat("Personal", "Gifts"),
  },
];

function surpriseDate(window: Window, s: Surprise): Temporal.PlainDate {
  const month = window.start.toPlainYearMonth().add({ months: s.monthsIn });
  return Temporal.PlainDate.from(
    { year: month.year, month: month.month, day: s.day },
    { overflow: "constrain" },
  );
}

/** What `person` sees: public accounts plus their own private ones (AD-3). */
function visibleTo(world: World, person: string): ReadonlySet<string> {
  return new Set(
    world.accounts
      .filter((a) => !a.isPrivate || a.owners.some((o) => o.person === person))
      .map((a) => a.key),
  );
}

export const transfersAndPrivacy: SeedModule = {
  name: "transfers-and-privacy",
  dependsOn: ["ledger-transactions"],
  generate(world) {
    const w = windowOf(world.today);
    const pairs: Pair[] = [];
    let n = 0;
    const add = (pair: Omit<Pair, "id">): void => {
      if (!inWindow(w, pair.date)) return;
      n += 1;
      pairs.push({ ...pair, id: `xfer-${String(n).padStart(2, "0")}` });
    };

    // Monthly: everyday into savings, and a top-up of the offset account.
    for (const date of monthlyOn(w, 16)) {
      add({
        date,
        cents: 120_000,
        from: {
          account: ACCOUNT_KEYS.everyday,
          description: "Transfer to joint savings",
          category: TO_SAVINGS,
        },
        to: {
          account: ACCOUNT_KEYS.savings,
          description: "Transfer from everyday",
          category: TO_SAVINGS,
        },
        by: A,
      });
    }
    for (const date of monthlyOn(w, 25)) {
      add({
        date,
        cents: 100_000,
        from: {
          account: ACCOUNT_KEYS.everyday,
          description: "Transfer to offset",
          category: BETWEEN,
        },
        to: {
          account: ACCOUNT_KEYS.offset,
          description: "Transfer from everyday",
          category: BETWEEN,
        },
        by: B,
      });
    }

    // With a partner's private account: A tops up the joint account every third month, and the
    // joint account pays an allowance into B's.
    for (const date of everyMonth(w, 3, 1, 8)) {
      add({
        date,
        cents: 50_000,
        from: {
          account: ACCOUNT_KEYS.privateA,
          description: "Top up joint account",
          category: BETWEEN,
        },
        to: {
          account: ACCOUNT_KEYS.everyday,
          description: "Top up from personal account",
          category: BETWEEN,
        },
        by: A,
      });
    }
    for (const date of everyMonth(w, 3, 2, 21)) {
      add({
        date,
        cents: 30_000,
        from: {
          account: ACCOUNT_KEYS.everyday,
          description: "Transfer to personal account",
          category: BETWEEN,
        },
        to: {
          account: ACCOUNT_KEYS.privateB,
          description: "From joint account",
          category: BETWEEN,
        },
        by: B,
      });
    }

    // The surprises, as transactions of their own (the card payments below include them).
    const surpriseEvents: TransactionCreatedEvent[] = SURPRISES.flatMap((s) => {
      const date = surpriseDate(w, s);
      if (!inWindow(w, date)) return [];
      return [
        {
          type: "transaction.created" as const,
          key: s.key,
          account: s.account,
          postedOn: iso(date),
          amountCents: -s.cents,
          description: s.description,
          category: s.category,
        },
      ];
    });

    // Card payments: each month pays what is owed, the opening balance and every charge since.
    const chargesOn = (from: string, to: string): number =>
      [...world.transactions, ...surpriseEvents]
        .filter((t) => t.account === ACCOUNT_KEYS.card && t.postedOn > from && t.postedOn <= to)
        .reduce((sum, t) => sum - t.amountCents, 0);
    let owed = -(OPENING_CENTS[ACCOUNT_KEYS.card] ?? 0);
    let previous = iso(w.start.subtract({ days: 1 }));
    for (const date of monthlyOn(w, 22)) {
      const day = iso(date);
      owed += chargesOn(previous, day);
      previous = day;
      if (owed <= 0) continue;
      add({
        date,
        cents: owed,
        from: {
          account: ACCOUNT_KEYS.everyday,
          description: "Credit card payment",
          category: CARD_PAYMENT,
        },
        to: { account: ACCOUNT_KEYS.card, description: "Payment received", category: CARD_PAYMENT },
        by: A,
      });
      owed = 0;
    }

    const transferEvents: (TransactionCreatedEvent | TransferGroupedEvent)[] = [];
    const created: TransactionCreatedEvent[] = [];
    const groups: TransferGroupedEvent[] = [];
    const privateAccounts = new Set(world.accounts.filter((a) => a.isPrivate).map((a) => a.key));
    const transfers: Json[] = [];
    for (const p of pairs) {
      const out: TransactionCreatedEvent = {
        type: "transaction.created",
        key: `${p.id}-out`,
        account: p.from.account,
        postedOn: iso(p.date),
        amountCents: -p.cents,
        description: p.from.description,
        category: p.from.category,
      };
      const into: TransactionCreatedEvent = {
        type: "transaction.created",
        key: `${p.id}-in`,
        account: p.to.account,
        postedOn: iso(p.date),
        amountCents: p.cents,
        description: p.to.description,
        category: p.to.category,
      };
      created.push(out, into);
      groups.push({ type: "transfer.grouped", transactions: [out.key, into.key], by: p.by });
      transfers.push({
        transactions: [out.key, into.key],
        by: p.by,
        amountCents: p.cents,
        withPrivateAccount:
          privateAccounts.has(p.from.account) || privateAccounts.has(p.to.account),
      });
    }
    transferEvents.push(...created, ...groups);

    const hidden: NameHiddenEvent[] = surpriseEvents.map((e) => ({
      type: "transaction.name-hidden",
      transaction: e.key,
      by: (SURPRISES.find((s) => s.key === e.key) as Surprise).by,
    }));

    const events = [...surpriseEvents, ...transferEvents, ...hidden];

    // What each person sees: every transaction so far in an account they can see.
    const all = [...world.transactions, ...created, ...surpriseEvents];
    const visibleCounts: Record<string, number> = {};
    for (const person of PERSON_KEYS) {
      const accounts = visibleTo(world, person);
      visibleCounts[person] = all.filter((t) => accounts.has(t.account)).length;
    }
    return {
      events,
      expectations: {
        transactionCount: all.length,
        visibleCounts,
        hidden: hidden.map((h) => {
          const txn = surpriseEvents.find(
            (e) => e.key === h.transaction,
          ) as TransactionCreatedEvent;
          return {
            transaction: h.transaction,
            by: h.by,
            account: txn.account,
            description: txn.description,
          };
        }),
        hiddenKeys: hidden.map((h) => h.transaction),
        transfers,
        transferKeys: pairs.flatMap((p) => [`${p.id}-out`, `${p.id}-in`]),
        privateTransferKeys: pairs
          .filter((p) => privateAccounts.has(p.from.account) || privateAccounts.has(p.to.account))
          .flatMap((p) => [`${p.id}-out`, `${p.id}-in`]),
      },
    };
  },
};
