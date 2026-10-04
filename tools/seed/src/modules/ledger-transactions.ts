// The seed's day-to-day ledger: about 12 months of salaries, bills, groceries and card spending
// built from merchant and bill templates, plus a holiday and each person's private account.
// Transfers between accounts and hidden names are `transfers-and-privacy`'s.
import { allocate, cents } from "@pangolin/shared";
import { type PlainDate, Temporal } from "@pangolin/shared/temporal";
import type { SeedModule } from "../module.ts";
import type { Rng } from "../rng.ts";
import type { CategoryRef, SeedSplit, TransactionCreatedEvent } from "../world.ts";
import { ACCOUNT_KEYS, cat, payeeByKey } from "./catalogue.ts";
import {
  everyDays,
  everyMonth,
  inWindow,
  iso,
  monthlyOn,
  shifted,
  type Window,
  windowOf,
} from "./dates.ts";

/** A transaction before it has a key; the module sorts the drafts by date and then keys them. */
interface Draft {
  readonly account: string;
  readonly postedOn: PlainDate;
  readonly amountCents: number;
  readonly description: string;
  readonly payee?: string;
  readonly notes?: string;
  readonly category?: CategoryRef;
  readonly tags?: readonly string[];
  readonly splits?: readonly SeedSplit[];
}

const SUBURBS = ["Newtown", "Marrickville", "Enmore", "Summer Hill", "Petersham"] as const;

/** A whole-multiple-of-5-cents amount in `[lo, hi]` (both multiples of 5). */
function amountBetween(rng: Rng, lo: number, hi: number): number {
  return rng.int(lo / 5, hi / 5) * 5;
}

interface Discretionary {
  readonly payee: string;
  readonly lo: number;
  readonly hi: number;
  readonly weight: number;
  readonly suburb: boolean;
}

const DISCRETIONARY: readonly Discretionary[] = [
  { payee: "local-cafe", lo: 550, hi: 1_450, weight: 5, suburb: true },
  { payee: "bistro", lo: 6_500, hi: 14_500, weight: 2, suburb: false },
  { payee: "thai-house", lo: 4_500, hi: 8_500, weight: 2, suburb: false },
  { payee: "pizza-place", lo: 3_500, hi: 6_500, weight: 1, suburb: false },
  { payee: "bottle-shop", lo: 3_500, hi: 9_500, weight: 1, suburb: true },
  { payee: "shell", lo: 5_500, hi: 9_500, weight: 2, suburb: true },
  { payee: "ampol", lo: 5_500, hi: 9_500, weight: 1, suburb: true },
  { payee: "uber", lo: 1_500, hi: 4_500, weight: 1, suburb: false },
  { payee: "chemist", lo: 1_500, hi: 7_500, weight: 1, suburb: true },
  { payee: "kmart", lo: 2_500, hi: 14_000, weight: 1, suburb: true },
  { payee: "bunnings", lo: 3_000, hi: 28_000, weight: 1, suburb: true },
  { payee: "cinema", lo: 3_500, hi: 6_000, weight: 1, suburb: true },
  { payee: "opal", lo: 2_000, hi: 4_000, weight: 1, suburb: false },
];

const DISCRETIONARY_POOL: readonly Discretionary[] = DISCRETIONARY.flatMap((m) =>
  Array.from({ length: m.weight }, () => m),
);

const GROCERS = ["woolworths", "woolworths", "coles", "aldi", "harris-farm"] as const;

/** The categories of a receipt that is split, by weight in basis points. */
function splitPlans(
  payee: string,
  total: number,
  rng: Rng,
): { splits: SeedSplit[]; notes?: string } | null {
  const [a, b] = ["person-a", "person-b"];
  if (payee === "woolworths" || payee === "coles") {
    if (rng.next() >= 0.3) return null;
    const [food, pharmacy] = allocate(cents(total), [8500, 1500]);
    return {
      splits: [
        { amountCents: food as number, category: cat("Food", "Groceries") },
        { amountCents: pharmacy as number, category: cat("Health", "Pharmacy") },
      ],
    };
  }
  if (payee === "kmart") {
    if (rng.next() >= 0.5) return null;
    const [forA, forB, gift] = allocate(cents(total), [4000, 4000, 2000]);
    return {
      splits: [
        {
          amountCents: forA as number,
          category: cat("Personal", "Clothing"),
          beneficiary: a as string,
        },
        {
          amountCents: forB as number,
          category: cat("Personal", "Clothing"),
          beneficiary: b as string,
        },
        {
          amountCents: gift as number,
          category: cat("Personal", "Gifts"),
          beneficiary: "shared",
          tags: ["gift"],
        },
      ],
    };
  }
  if (payee === "bunnings") {
    if (rng.next() >= 0.6) return null;
    const [repairs, hobby] = allocate(cents(total), [7000, 3000]);
    return {
      splits: [
        {
          amountCents: repairs as number,
          category: cat("Housing", "Home maintenance"),
          tags: ["home-improvement"],
        },
        {
          amountCents: hobby as number,
          category: cat("Lifestyle", "Hobbies"),
          beneficiary: a as string,
        },
      ],
      notes: "Weekend project",
    };
  }
  return null;
}

function totalDays(window: Window): number {
  return window.start.until(window.end).days;
}

function randomDay(window: Window, rng: Rng): PlainDate {
  return window.start.add({ days: rng.int(0, totalDays(window)) });
}

export const ledgerTransactions: SeedModule = {
  name: "ledger-transactions",
  dependsOn: ["institutions-and-accounts", "classification"],
  generate(world, rng) {
    const w = windowOf(world.today);
    const drafts: Draft[] = [];
    const push = (draft: Draft | null): void => {
      if (draft !== null && inWindow(w, draft.postedOn)) drafts.push(draft);
    };
    /** A merchant purchase: payee, a suburb on its description, its default category. */
    const purchase = (
      account: string,
      date: PlainDate,
      m: Discretionary,
      rng: Rng,
      extra: Pick<Draft, "tags" | "notes"> = {},
    ): Draft => {
      const spec = payeeByKey(m.payee);
      const total = -amountBetween(rng, m.lo, m.hi);
      const suburb = m.suburb ? ` ${rng.pick(SUBURBS)}` : "";
      const base = {
        account,
        postedOn: date,
        amountCents: total,
        description: `${spec.name}${suburb}`,
        payee: m.payee,
      };
      const plan = splitPlans(m.payee, total, rng);
      // About one in ten single-split purchases is left uncategorised, for review later.
      const keepCategory = rng.next() >= 0.1;
      if (plan !== null) {
        return {
          ...base,
          splits: plan.splits,
          ...(plan.notes === undefined ? {} : { notes: plan.notes }),
        };
      }
      return {
        ...base,
        ...(keepCategory && spec.category !== null ? { category: spec.category } : {}),
        ...extra,
      };
    };

    // --- Salaries, fortnightly into the joint everyday account, attributed to the earner.
    const salaries = [
      { payee: "brightwave", person: "person-a", net: 285_000, first: w.start.add({ days: 2 }) },
      { payee: "northside", person: "person-b", net: 240_000, first: w.start.add({ days: 4 }) },
    ] as const;
    for (const s of salaries) {
      for (const date of everyDays(w, s.first, 14)) {
        push({
          account: ACCOUNT_KEYS.everyday,
          postedOn: date,
          amountCents: s.net,
          description: `Salary ${payeeByKey(s.payee).name}`,
          payee: s.payee,
          splits: [
            { amountCents: s.net, category: cat("Income", "Salary"), beneficiary: s.person },
          ],
        });
      }
    }

    // --- The home loan: a repayment from everyday, and the loan's own interest.
    for (const date of monthlyOn(w, 5)) {
      push({
        account: ACCOUNT_KEYS.everyday,
        postedOn: date,
        amountCents: -420_000,
        description: "Home loan repayment",
        payee: "harbour-loan",
        category: cat("Housing", "Mortgage repayments"),
      });
      push({
        account: ACCOUNT_KEYS.homeLoan,
        postedOn: date,
        amountCents: 420_000,
        description: "Repayment received",
      });
    }
    for (const date of monthlyOn(w, 28)) {
      push({
        account: ACCOUNT_KEYS.homeLoan,
        postedOn: date,
        amountCents: -amountBetween(rng, 215_000, 225_000),
        description: "Interest charged",
        category: cat("Financial", "Interest charges"),
      });
    }

    // --- Bills from the everyday account.
    const bill = (
      payee: string,
      dates: readonly PlainDate[],
      description: string,
      lo: number,
      hi: number,
    ): void => {
      const spec = payeeByKey(payee);
      for (const date of dates) {
        push({
          account: ACCOUNT_KEYS.everyday,
          postedOn: shifted(w, date, rng.int(-1, 1)) ?? date,
          amountCents: -amountBetween(rng, lo, hi),
          description,
          payee,
          ...(spec.category === null ? {} : { category: spec.category }),
        });
      }
    };
    bill("origin", everyMonth(w, 3, 0, 12), "Origin Energy electricity", 28_000, 36_500);
    bill("agl", everyMonth(w, 3, 1, 14), "AGL gas", 9_000, 14_500);
    bill("sydney-water", everyMonth(w, 3, 2, 18), "Sydney Water", 18_000, 22_500);
    bill("council", everyMonth(w, 3, 1, 30), "Inner West Council rates", 48_000, 48_000);
    bill("aussie-bb", monthlyOn(w, 9), "Aussie Broadband internet", 8_900, 8_900);
    bill("telstra", monthlyOn(w, 15), "Telstra mobile plans", 8_400, 8_400);
    bill("medibank", monthlyOn(w, 3), "Medibank health cover", 31_200, 31_200);
    bill("nrma-car", monthlyOn(w, 22), "NRMA car insurance", 11_500, 11_500);
    bill("nrma-home", everyMonth(w, 12, 5, 20), "NRMA home and contents", 168_000, 168_000);

    // --- Subscriptions on the card.
    for (const [payee, day, lo, description] of [
      ["netflix", 11, 2_300, "Netflix"],
      ["spotify", 17, 1_300, "Spotify Duo"],
    ] as const) {
      for (const date of monthlyOn(w, day)) {
        push({
          account: ACCOUNT_KEYS.card,
          postedOn: date,
          amountCents: -lo,
          description,
          payee,
          category: cat("Lifestyle", "Subscriptions"),
        });
      }
    }

    // --- Each week: groceries from everyday, a few purchases on the card.
    for (const weekStart of everyDays(w, w.start, 7)) {
      const trips = 1 + (rng.next() < 0.4 ? 1 : 0);
      for (let i = 0; i < trips; i++) {
        const grocer = rng.pick(GROCERS);
        const m: Discretionary = { payee: grocer, lo: 4_500, hi: 24_000, weight: 1, suburb: true };
        push(purchase(ACCOUNT_KEYS.everyday, weekStart.add({ days: rng.int(0, 6) }), m, rng));
      }
      const extras = rng.int(1, 3);
      for (let i = 0; i < extras; i++) {
        const m = rng.pick(DISCRETIONARY_POOL);
        const date = weekStart.add({ days: rng.int(0, 6) });
        const claimable = m.payee === "bistro" && rng.next() < 0.25;
        push(
          purchase(
            ACCOUNT_KEYS.card,
            date,
            m,
            rng,
            claimable ? { tags: ["reimbursable"], notes: "Client lunch, claim back" } : {},
          ),
        );
      }
    }

    // --- A holiday, tagged.
    const trip = w.start.add({ months: 7, days: 3 });
    const holiday = (date: PlainDate, payee: string, description: string, amount: number): void => {
      const category = payeeByKey(payee).category;
      push({
        account: ACCOUNT_KEYS.card,
        postedOn: date,
        amountCents: -amount,
        description,
        payee,
        ...(category === null ? {} : { category }),
        tags: ["holiday"],
      });
    };
    holiday(trip.subtract({ days: 60 }), "qantas", "Qantas flights", 164_000);
    holiday(trip, "stay-co", "Stay Co Apartments, 5 nights", 145_000);
    for (let i = 1; i <= 3; i++) {
      holiday(
        trip.add({ days: i }),
        "reef-tours",
        "Reef Tours day trip",
        amountBetween(rng, 8_500, 12_500),
      );
    }
    holiday(trip.add({ days: 2 }), "bistro", "The Wattle Bistro, holiday dinner", 18_500);

    // --- Joint savings interest.
    for (const date of monthlyOn(w, 28)) {
      push({
        account: ACCOUNT_KEYS.savings,
        postedOn: date,
        amountCents: amountBetween(rng, 8_000, 11_000),
        description: "Interest paid",
        category: cat("Income", "Interest"),
      });
    }

    // --- Person A's private account: freelance income, books, hobbies, small gifts.
    for (const date of everyMonth(w, 2, 0, 14)) {
      push({
        account: ACCOUNT_KEYS.privateA,
        postedOn: date,
        amountCents: amountBetween(rng, 40_000, 65_000),
        description: "Freelance Fernwood Design",
        payee: "design-client",
        category: cat("Income", "Other income"),
      });
    }
    for (let i = 0; i < 8; i++) {
      const surprise = rng.next() < 0.3;
      push({
        account: ACCOUNT_KEYS.privateA,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 1_900, 5_500),
        description: "Dymocks",
        payee: "dymocks",
        category: cat("Lifestyle", "Books and media"),
        ...(surprise ? { tags: ["surprise"], notes: "Birthday present" } : {}),
      });
    }
    for (let i = 0; i < 5; i++) {
      push({
        account: ACCOUNT_KEYS.privateA,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 2_500, 9_500),
        description: "Eckersley's Art",
        payee: "art-supplies",
        category: cat("Lifestyle", "Hobbies"),
      });
    }
    for (let i = 0; i < 8; i++) {
      push({
        account: ACCOUNT_KEYS.privateA,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 550, 1_450),
        description: `Corner Cafe ${rng.pick(SUBURBS)}`,
        payee: "local-cafe",
        category: cat("Food", "Coffee"),
      });
    }
    for (let i = 0; i < 3; i++) {
      push({
        account: ACCOUNT_KEYS.privateA,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 3_500, 12_500),
        description: "Etsy gift order",
        category: cat("Personal", "Gifts"),
        tags: ["surprise"],
      });
    }

    // --- Person B's private account: interest, the gym, records, a side project.
    for (const date of monthlyOn(w, 30)) {
      push({
        account: ACCOUNT_KEYS.privateB,
        postedOn: date,
        amountCents: amountBetween(rng, 1_500, 2_500),
        description: "Interest paid",
        category: cat("Income", "Interest"),
      });
    }
    for (const date of monthlyOn(w, 6)) {
      push({
        account: ACCOUNT_KEYS.privateB,
        postedOn: date,
        amountCents: -4_950,
        description: "Fitness Hub membership",
        payee: "fitness-hub",
        category: cat("Health", "Fitness"),
      });
    }
    for (let i = 0; i < 6; i++) {
      push({
        account: ACCOUNT_KEYS.privateB,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 2_900, 8_900),
        description: "Vinyl Vault",
        payee: "vinyl-vault",
        category: cat("Lifestyle", "Books and media"),
      });
    }
    for (let i = 0; i < 3; i++) {
      push({
        account: ACCOUNT_KEYS.privateB,
        postedOn: randomDay(w, rng),
        amountCents: -amountBetween(rng, 1_500, 4_500),
        description: "Domain and hosting",
        category: cat("Lifestyle", "Hobbies"),
        tags: ["side-project"],
      });
    }

    // --- Order by date (a stable sort keeps same-day drafts in the order they were made).
    const ordered = drafts
      .map((draft, index) => ({ draft, index }))
      .sort(
        (x, y) =>
          Temporal.PlainDate.compare(x.draft.postedOn, y.draft.postedOn) || x.index - y.index,
      )
      .map(({ draft }) => draft);

    const events: TransactionCreatedEvent[] = ordered.map((d, i) => ({
      type: "transaction.created",
      key: `txn-${String(i + 1).padStart(4, "0")}`,
      account: d.account,
      postedOn: iso(d.postedOn),
      amountCents: d.amountCents,
      description: d.description,
      ...(d.payee === undefined ? {} : { payee: d.payee }),
      ...(d.notes === undefined ? {} : { notes: d.notes }),
      ...(d.category === undefined ? {} : { category: d.category }),
      ...(d.tags === undefined ? {} : { tags: d.tags }),
      ...(d.splits === undefined ? {} : { splits: d.splits }),
    }));

    const byAccount: Record<string, number> = {};
    for (const e of events) byAccount[e.account] = (byAccount[e.account] ?? 0) + 1;
    const multi = events.filter((e) => (e.splits?.length ?? 0) > 1);
    return {
      events,
      expectations: {
        transactionCount: events.length,
        transactionsByAccount: byAccount,
        windowStart: iso(w.start),
        windowEnd: iso(w.end),
        multiSplitKeys: multi.map((e) => e.key),
        taggedKeys: events
          .filter(
            (e) => (e.tags?.length ?? 0) > 0 || e.splits?.some((s) => (s.tags?.length ?? 0) > 0),
          )
          .map((e) => e.key),
        payeeKeys: [
          ...new Set(events.flatMap((e) => (e.payee === undefined ? [] : [e.payee]))),
        ].sort(),
      },
    };
  },
};
