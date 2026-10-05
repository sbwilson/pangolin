// The privacy suite's scenarios (AD-3, AD-4, AD-5, AD-7, AD-18, decision 80): sequences of writes
// run in two worlds that differ in one thing partner B must never learn, with checkpoints where
// the suite compares what B can read. They go through the use cases and the real HTTP app, so a
// refusal or a success is the answer a client would get. Test support only; the assertions are in
// `privacy.test.ts`.
//
//   hiddenNameScenario  A hides the description and payee of a shared, payee-bearing, imported
//                       transaction; B reads, then edits, splits, tags and deletes it.
//   switchScenario      owner changes and privacy switches, both ways, on accounts whose history
//                       or hidden names must stay out of B's sight.
import { createHash } from "node:crypto";
import {
  createAccount,
  createActivity,
  createPayee,
  createTransaction,
  getTransaction,
  hideTransactionName,
  type SplitRow,
  setSplitField,
  type TransactionRow,
  type UseCaseContext,
  updateTransaction,
  write,
} from "@pangolin/app";
import type { Who, World } from "./privacy-harness.ts";

/** The two things the paired worlds differ in: a name, a payee, a private-era description. */
export type Flavour = "one" | "two";

/** One request or refusal in a scenario, as the client saw it. */
export interface Step {
  readonly name: string;
  readonly who: Who;
  readonly status: number;
  readonly text: string;
}

/** What B may read at a checkpoint: GET paths and the ids of transactions to read in the repo. */
export interface View {
  readonly paths: readonly string[];
  readonly transactionIds: readonly string[];
}

/** Called at each checkpoint; the suite records everything B can read there. */
export type Observe = (checkpoint: string, view: View) => Promise<void>;

async function step(
  world: World,
  log: Step[],
  who: Who,
  name: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Step> {
  const res = await world.request(who, method, path, body);
  const done = { name, who, status: res.status, text: res.text };
  log.push(done);
  return done;
}

/** The world's current instant as the stored timestamp text (milliseconds, UTC). */
const stamp = (ctx: UseCaseContext): string =>
  ctx.clock.now().toString({ fractionalSecondDigits: 3 });

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A day `days` after the world's today, `YYYY-MM-DD`. */
const after = (world: World, days: number): string => world.clock.today().add({ days }).toString();

const POSTED = "2026-07-11";

// ------------------------------------------------------------------------------------ hidden

export interface HiddenIds {
  readonly accountId: string;
  readonly transactionId: string;
  readonly payeeId: string;
  readonly description: string;
  readonly externalId: string;
  readonly fingerprint: string;
}

export interface HiddenRun {
  readonly ids: HiddenIds;
  readonly steps: Step[];
}

/**
 * A creates a joint account and puts an imported transaction on it, with a payee and a v1
 * fingerprint that hashes the description, then hides its name from B. The two flavours differ in
 * the description, the payee and the external ID, nothing else. Rows of unusual shape are planted
 * in the audit log beside it (a bare string, an array, an object with no name keys), for the
 * read's fail-closed paths. B then reads it, and edits, splits, tags and deletes it; the
 * checkpoints are before and after.
 */
export async function hiddenNameScenario(
  world: World,
  flavour: Flavour,
  observe: Observe,
): Promise<HiddenRun> {
  const a = world.ctx("a");
  const b = world.ctx("b");
  const steps: Step[] = [];
  const payees = {
    one: createPayee(b, { name: "Hidden probe payee one" }),
    two: createPayee(b, { name: "Hidden probe payee two" }),
  };
  const accountId = createAccount(a, {
    name: "Hidden probe joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [
      { personId: world.people.a, shareBp: 5000 },
      { personId: world.people.b, shareBp: 5000 },
    ],
  });
  const description = `Hidden probe ${flavour} description`;
  const externalId = `BANK-HIDDEN-${flavour.toUpperCase()}`;
  const amountCents = -2500;
  const fingerprint = sha256(`${accountId}\n${POSTED}\n${amountCents}\n${description}`);
  const payeeId = payees[flavour].id;
  const transactionId = a.newId<"Transaction">();
  write(a, (tx, audit) => {
    const at = stamp(a);
    const row: TransactionRow = {
      id: transactionId,
      accountId,
      postedOn: POSTED,
      amountCents,
      descriptionRaw: description,
      payeeId,
      status: "posted",
      externalId,
      fingerprint,
      fingerprintVersion: 1,
      importId: "import-probe",
      performedBy: null,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    };
    const split: SplitRow = {
      id: a.newId<"Split">(),
      transactionId,
      amountCents,
      categoryId: null,
      activityId: null,
      beneficiary: "shared",
      propertyId: null,
      taxCategoryId: null,
      deductibleBp: null,
      memo: null,
      categorySource: null,
      activitySource: null,
      taxCategorySource: null,
      beneficiarySource: null,
      deductibleBpSource: null,
      createdAt: at,
      updatedAt: at,
    };
    tx.transactions.insert(row, [split]);
    audit({
      entity: "transaction",
      entityId: row.id,
      accountId,
      action: "create",
      before: null,
      after: { ...row, splits: [split] },
    });
  });
  hideTransactionName(a, { id: transactionId, until: after(world, 90) });
  plantAuditRows(world, { accountId, transactionId, description });

  const ids: HiddenIds = {
    accountId,
    transactionId,
    payeeId,
    description,
    externalId,
    fingerprint,
  };
  const path = `/api/ledger/transactions/${transactionId}`;
  const view: View = {
    paths: ["/api/ledger/transactions", path, "/api/classify/payees"],
    transactionIds: [transactionId],
  };
  await observe("hidden row, before B writes", view);

  // B's writes on the hidden row: the same outcome in both worlds, and nothing it answers differs.
  world.startRequestIds();
  await step(world, steps, "b", "B edits the notes", "PATCH", path, { notes: "B note" });
  const split = await step(world, steps, "b", "B splits it", "PUT", `${path}/splits`, {
    splits: [{ amountCents: -1500 }, { amountCents: -1000 }],
  });
  if (split.status !== 200) {
    throw new Error(`B's split of the hidden row answered ${split.status}: ${split.text}`);
  }
  const splitId = (JSON.parse(split.text) as { transaction: { splits: { id: string }[] } })
    .transaction.splits[0]?.id as string;
  await step(world, steps, "b", "B sets a category", "PATCH", `${path}/splits/${splitId}`, {
    field: "category",
    value: world.ok("category"),
  });
  await step(world, steps, "b", "B tags a split", "PUT", `${path}/splits/${splitId}/tags`, {
    tagIds: [world.ok("tag")],
  });
  await observe("hidden row, after B's edits", view);
  await step(world, steps, "b", "B deletes it", "DELETE", path);
  await observe("hidden row, after B's delete", view);
  return { ids, steps };
}

/**
 * Audit rows of a shape the real use cases never write, all about the hidden transaction. The
 * table's own check refuses text that is not JSON, so these are the odd JSON the read must still
 * fail closed on.
 */
function plantAuditRows(
  world: World,
  row: { accountId: string; transactionId: string; description: string },
): void {
  const a = world.ctx("a");
  const { accountId, transactionId, description } = row;
  // A bare string and an array that hold the description: valid JSON that SQL passes through.
  // An object with none of the name keys: the read must not add one.
  for (const after of [description, [description], { unrelated: 1 }]) {
    write(a, (_tx, audit) =>
      audit({
        entity: "transaction",
        entityId: transactionId,
        accountId,
        action: "update",
        before: null,
        after,
      }),
    );
  }
}

// ------------------------------------------------------------------------------------ switch

export interface SwitchIds {
  /** A joint account whose owners change and whose hidden name must survive. */
  readonly joint: string;
  readonly hiddenTransaction: string;
  /** A's private account with a private-era history, made public. */
  readonly privateAccount: string;
  /** A's public account made private and public again. */
  readonly flipped: string;
  readonly flippedTransaction: string;
  /** A's second transaction on the flipped account, made in its private era. */
  readonly privateEraTransaction: string;
  /** A's private activity (owner-scoped, with a private origin account). */
  readonly activity: string;
}

export interface SwitchRun {
  readonly ids: SwitchIds;
  readonly steps: Step[];
}

/**
 * Owner changes and privacy switches. The worlds differ in the description a private account's
 * transaction had in its private era and in the one a joint account's hidden transaction carries;
 * both end the same, so B reads the same whatever they were.
 *
 *   joint     B tries to strip A from a joint account A hid a name on (refused), A removes
 *             themself, B makes it private and public again: the name stays hidden throughout
 *   private   A's private account uses a private activity, so making it public is refused; it
 *             goes public once the activity is cleared, and its private-era audit rows stay A's
 *   public    A's public account refuses a private activity on its split and B's hiding of a name
 *             on a row of an account B does not own, refuses to go private while a split is
 *             shared, goes private and public again, and its joint-era rows stay B's to read
 */
export async function switchScenario(
  world: World,
  flavour: Flavour,
  observe: Observe,
): Promise<SwitchRun> {
  const a = world.ctx("a");
  const steps: Step[] = [];
  const A = world.people.a;
  const B = world.people.b;
  const account = (
    name: string,
    isPrivate: boolean,
    owners: { personId: string; shareBp: number }[],
  ) => createAccount(a, { name, type: "transaction", currency: "AUD", isPrivate, owners });
  const firstSplit = (id: string) => getTransaction(a, { id }).splits[0]?.id as string;
  const privacy = (_id: string, isPrivate: boolean) => ({ isPrivate });

  // A joint account with a transaction whose name A hides.
  const joint = account("Switch probe joint", false, [
    { personId: A, shareBp: 5000 },
    { personId: B, shareBp: 5000 },
  ]);
  const hidden = createTransaction(a, {
    accountId: joint,
    postedOn: POSTED,
    amountCents: -1200,
    description: `Switch probe ${flavour} hidden`,
  });
  const hiddenSplit = firstSplit(hidden);
  hideTransactionName(a, { id: hidden, until: after(world, 90) });

  // A private account, a private activity of A's and a transaction that uses it.
  const privateAccount = account("Switch probe private", true, [{ personId: A, shareBp: 10_000 }]);
  const activity = createActivity(a, {
    name: "Switch probe private activity",
    originAccountId: privateAccount,
  });
  const privateTxn = createTransaction(a, {
    accountId: privateAccount,
    postedOn: POSTED,
    amountCents: -600,
    description: `Switch probe ${flavour} private era`,
  });
  const privateSplit = firstSplit(privateTxn);
  setSplitField(a, {
    transactionId: privateTxn,
    splitId: privateSplit,
    field: "activity",
    value: activity.id,
  });

  // A public account A owns alone, with a shared transaction.
  const flipped = account("Switch probe public", false, [{ personId: A, shareBp: 10_000 }]);
  const flippedTxn = createTransaction(a, {
    accountId: flipped,
    postedOn: POSTED,
    amountCents: -800,
    description: "Switch probe public one",
  });
  const flippedSplit = firstSplit(flippedTxn);

  const reads = (accounts: readonly string[], transactions: readonly string[]): View => ({
    paths: [
      "/api/accounts",
      "/api/ledger/transactions",
      ...accounts.flatMap((id) => [`/api/accounts/${id}`, `/api/accounts/${id}/balance`]),
      ...transactions.map((id) => `/api/ledger/transactions/${id}`),
    ],
    transactionIds: transactions,
  });
  const all = reads([joint, privateAccount, flipped], [hidden, privateTxn, flippedTxn]);
  const patch = (id: string, split: string) => `/api/ledger/transactions/${id}/splits/${split}`;

  // joint: the hiding outlives an owner change and both switches.
  await observe("start", all);
  world.startRequestIds();
  await step(
    world,
    steps,
    "b",
    "B strips A from the joint account",
    "PATCH",
    `/api/accounts/${joint}`,
    {
      owners: [{ personId: B, shareBp: 10_000 }],
    },
  );
  await observe("B's takeover refused", all);
  await step(world, steps, "a", "A removes themself from it", "PATCH", `/api/accounts/${joint}`, {
    owners: [{ personId: B, shareBp: 10_000 }],
  });
  await step(world, steps, "b", "B takes the split", "PATCH", patch(hidden, hiddenSplit), {
    field: "beneficiary",
    value: B,
  });
  await step(
    world,
    steps,
    "b",
    "B makes it private",
    "POST",
    `/api/accounts/${joint}/privacy`,
    privacy(joint, true),
  );
  await observe("joint account private", all);
  await step(
    world,
    steps,
    "b",
    "B makes it public",
    "POST",
    `/api/accounts/${joint}/privacy`,
    privacy(joint, false),
  );
  await observe("joint account public again", all);

  // private: owner-scoped references stop the switch; private-era history stays A's.
  await step(
    world,
    steps,
    "a",
    "A makes the private account public while it uses a private activity",
    "POST",
    `/api/accounts/${privateAccount}/privacy`,
    privacy(privateAccount, false),
  );
  await observe("private account refused", all);
  updateTransaction(a, { id: privateTxn, description: "Switch probe edited" });
  await step(world, steps, "a", "A clears the activity", "PATCH", patch(privateTxn, privateSplit), {
    field: "activity",
    value: null,
  });
  await step(
    world,
    steps,
    "a",
    "A makes the private account public",
    "POST",
    `/api/accounts/${privateAccount}/privacy`,
    privacy(privateAccount, false),
  );
  await observe("private account public", all);

  // public: the guards on the account A owns alone, then a private era in the middle of its life.
  await step(
    world,
    steps,
    "a",
    "A puts a private activity on a public split",
    "PATCH",
    patch(flippedTxn, flippedSplit),
    {
      field: "activity",
      value: activity.id,
    },
  );
  await step(
    world,
    steps,
    "a",
    "A sets a private activity through setSplits",
    "PUT",
    `/api/ledger/transactions/${flippedTxn}/splits`,
    {
      splits: [{ amountCents: -800, activityId: activity.id }],
    },
  );
  await step(
    world,
    steps,
    "b",
    "B hides a name on an account B does not own",
    "PUT",
    `/api/ledger/transactions/${flippedTxn}/name-hidden`,
    {},
  );
  await observe("public account refused", all);
  await step(
    world,
    steps,
    "a",
    "A makes it private while a split is shared",
    "POST",
    `/api/accounts/${flipped}/privacy`,
    privacy(flipped, true),
  );
  await step(
    world,
    steps,
    "a",
    "A gives the split to B",
    "PATCH",
    patch(flippedTxn, flippedSplit),
    {
      field: "beneficiary",
      value: B,
    },
  );
  await step(
    world,
    steps,
    "a",
    "A makes it private while a split is B's",
    "POST",
    `/api/accounts/${flipped}/privacy`,
    privacy(flipped, true),
  );
  await step(world, steps, "a", "A takes the split", "PATCH", patch(flippedTxn, flippedSplit), {
    field: "beneficiary",
    value: A,
  });
  await step(
    world,
    steps,
    "a",
    "A makes it private",
    "POST",
    `/api/accounts/${flipped}/privacy`,
    privacy(flipped, true),
  );
  const second = createTransaction(a, {
    accountId: flipped,
    postedOn: POSTED,
    amountCents: -400,
    description: `Switch probe ${flavour} private era two`,
  });
  updateTransaction(a, { id: second, description: "Switch probe edited two" });
  await observe("public account private", reads([flipped], [flippedTxn]));
  await step(
    world,
    steps,
    "a",
    "A makes it public",
    "POST",
    `/api/accounts/${flipped}/privacy`,
    privacy(flipped, false),
  );
  await observe(
    "public account public again",
    reads([joint, privateAccount, flipped], [hidden, privateTxn, flippedTxn, second]),
  );
  const ids: SwitchIds = {
    joint,
    hiddenTransaction: hidden,
    privateAccount,
    flipped,
    flippedTransaction: flippedTxn,
    privateEraTransaction: second,
    activity: activity.id,
  };
  return { ids, steps };
}
