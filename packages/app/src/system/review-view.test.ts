import { Temporal } from "@pangolin/shared/temporal";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { createCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import { CLASSIFY_RULE_OFFER_REVIEW, CLASSIFY_UNCLASSIFIED_REVIEW } from "../classify/rules.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import {
  checkReEnrolmentLink,
  issueReEnrolmentLink,
  PARTNER_RESET_REVIEW,
} from "../identity/re-enrolment.ts";
import { RECOVERY_CODE_USED_REVIEW } from "../identity/recovery-codes.ts";
import { createHandoff } from "../imports/handoff.ts";
import { importStatement } from "../imports/import-statement.ts";
import {
  IMPORT_PROBABLE_DUPLICATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
  probableDuplicateKey,
  transferAmbiguousKey,
  transferAmbiguousPrivateKey,
} from "../imports/match-transfers.ts";
import {
  IMPORT_PDF_FAILED_REVIEW,
  pdfFailedDedupeKey,
  pdfFailedEntityRef,
} from "../imports/pdf-review.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { getTransaction } from "../ledger/get-transaction.ts";
import { hideTransactionName } from "../ledger/hide-name.ts";
import {
  registerTransactionNeedsReviewSync,
  transactionEntityRef,
  transferCandidateEntityRef,
} from "../ledger/needs-review.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import { systemViewer } from "../system-viewer.ts";
import { fakeAttachmentStore } from "../testing/attachment-store.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { fakeCodeHasher, fakeTokens } from "../testing/tokens.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import {
  acceptHandoffItem,
  acceptRuleOfferItem,
  confirmSetAsideProposalItem,
  correctPdfRowItem,
  discardSetAsideRowItem,
  dismissHandoffItem,
  dismissNoticeItem,
  dismissRuleOfferItem,
  dismissTransferItem,
  fixSetAsideRowItem,
  interpretSetAsideRowsItem,
  keepDuplicateItem,
  linkTransferItem,
  recheckPdfItem,
  removeDuplicateItem,
  revokeLinksItem,
} from "./review-actions.ts";
import { JOB_DEAD_REVIEW, type RaiseReviewItemInput, raiseReviewItem } from "./review-items.ts";
import { countReviewItems, listReviewCards } from "./review-view.ts";

beforeAll(() => registerTransactionNeedsReviewSync());

const CSV = `Date,Amount,Description,Balance
01/09/2026,-50.00,"GROCER",1000.00
not-a-date,-12.00,"BOOKSTORE",988.00`;

function setup() {
  const clock = manualClock("2026-10-20T12:00:00Z");
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const attachments = fakeAttachmentStore();
  const at = Temporal.Instant.from("2026-10-20T12:00:00Z");
  const sys = { viewer: systemViewer("cli:test"), clock, newId, uow };
  const a = createPerson(sys, { displayName: "Alex", colour: "#ff0000", userId: "user-a" });
  const b = createPerson(sys, { displayName: "Sam", colour: "#0000ff", userId: "user-b" });
  uow.state.users.push("user-a", "user-b");
  uow.state.enrolments = {
    "user-a": { totp: true, passkeys: 1 },
    "user-b": { totp: true, passkeys: 1 },
  };
  uow.state.sessions = { "user-a": 1, "user-b": 1 };
  uow.state.passwords = { "user-a": "hash-a", "user-b": "hash-b" };
  const as = (id: typeof a) => ({ viewer: personViewer(id, at), clock, newId, uow, attachments });
  const A = as(a);
  const B = as(b);
  const account = (ctx: UseCaseContext, name: string, owner: typeof a, isPrivate: boolean) =>
    createAccount(ctx, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      owners: [{ personId: owner, shareBp: 10000 }],
    });
  const joint = createAccount(A, {
    name: "Joint everyday",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [
      { personId: a, shareBp: 5000 },
      { personId: b, shareBp: 5000 },
    ],
  });
  const savings = account(A, "Joint savings", a, false);
  const aPrivate = account(A, "Alex private", a, true);
  const bPrivate = account(B, "Sam private", b, true);
  const raise = (input: RaiseReviewItemInput) =>
    write(sys, (tx, audit) => raiseReviewItem(tx, audit, sys, input)).id;
  const txn = (ctx: UseCaseContext, accountId: string, amountCents: number, description: string) =>
    createTransaction(ctx, { accountId, postedOn: "2026-10-19", amountCents, description });
  return {
    clock,
    uow,
    attachments,
    sys,
    a,
    b,
    A,
    B,
    joint,
    savings,
    aPrivate,
    bPrivate,
    raise,
    txn,
  };
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : `other:${String(error)}`;
  }
  return "ok";
};

const openIds = (ctx: UseCaseContext) => listReviewCards(ctx).map((c) => c.id);

const PDF_GAP_REASON =
  "Statement balance reconciliation failed: opening balance ($1000.00) + sum of transactions ($29.99) = $1029.99, differing from closing balance ($1030.00) by exact gap of 1 cents ($0.01)";

function seedPdfFailed(w: ReturnType<typeof setup>, accountId: string) {
  const batchId = "pdf-batch-1";
  w.uow.state.importBatches.push({
    id: batchId as never,
    accountId: accountId as never,
    source: "statement_pdf",
    fileSha256: "b".repeat(64),
    rowCount: 2,
    newCount: 0,
    dupCount: 0,
    status: "failed",
    importedByPersonId: w.a,
    undoneAt: null,
    reconcileStatus: "gap",
    reconcileGapCents: 1,
    openingBalanceCents: 100_000,
    closingBalanceCents: 103_000,
    firstPostedOn: "2024-09-02",
    lastPostedOn: "2024-09-05",
    attachmentId: null,
    statementMeta: JSON.stringify({
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      accountNumberLast4: "1234",
    }),
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  });
  const rowIds = ["pdf-row-1", "pdf-row-2"];
  const seeded = [
    {
      postedOn: "2024-09-02",
      description: "SALARY",
      amountCents: 5_000,
      runningBalanceCents: 105_000,
    },
    {
      postedOn: "2024-09-05",
      description: "WOOLWORTHS",
      amountCents: -2_001,
      runningBalanceCents: 103_000,
    },
  ];
  w.uow.state.importRows.push(
    ...seeded.map((r, idx) => ({
      id: rowIds[idx] as never,
      batchId: batchId as never,
      rowNumber: idx + 1,
      rawLine: `${r.postedOn}, ${r.description}, ${r.amountCents}`,
      status: "staged" as const,
      reason: PDF_GAP_REASON,
      proposal: JSON.stringify(r),
      pdfPage: 1,
      createdAt: "2026-10-20T12:00:00Z",
      updatedAt: "2026-10-20T12:00:00Z",
    })),
  );
  const id = w.raise({
    kind: IMPORT_PDF_FAILED_REVIEW,
    entityRef: pdfFailedEntityRef(batchId),
    dedupeKey: pdfFailedDedupeKey(batchId),
    accountId,
  });
  return { batchId, rowIds, id };
}

describe("review cards", () => {
  it("lists one card per item, oldest first, with the detail of each kind", () => {
    const w = setup();
    const dup = w.txn(w.A, w.joint, -2500, "Coffee shop");
    const offered = w.txn(w.A, w.joint, -900, "Bakery");
    const outA = w.txn(w.A, w.joint, -10000, "Move to savings");
    const inA = w.txn(w.A, w.savings, 10000, "From joint");
    const inB = w.txn(w.A, w.savings, 10000, "From joint again");
    const kinds = [
      [IMPORT_PROBABLE_DUPLICATE_REVIEW, dup, probableDuplicateKey(dup)],
      [CLASSIFY_RULE_OFFER_REVIEW, offered, `classify.rule_offer:${offered}`],
      [IMPORT_TRANSFER_AMBIGUOUS_REVIEW, outA, transferAmbiguousKey(outA)],
    ] as const;
    for (const [kind, id, dedupeKey] of kinds) {
      w.raise({ kind, entityRef: transactionEntityRef(id), dedupeKey, accountId: w.joint });
    }
    w.raise({ kind: JOB_DEAD_REVIEW, entityRef: "job:1", dedupeKey: "job.dead:1" });
    w.raise({
      kind: RECOVERY_CODE_USED_REVIEW,
      entityRef: "recovery_code:x",
      dedupeKey: "code:x",
      personId: w.b,
    });
    w.raise({
      kind: PARTNER_RESET_REVIEW,
      entityRef: "re_enrolment_link:none",
      dedupeKey: "reset:x",
      personId: w.b,
    });
    createHandoff(w.A, {
      recipientId: w.b,
      filename: "september.csv",
      format: "commbank_csv",
      content: CSV,
    });
    importStatement(w.B, { accountId: w.joint, format: "commbank_csv", content: CSV });
    void inA;
    void inB;

    const cards = listReviewCards(w.B);
    expect(cards.map((c) => c.kind)).toEqual([
      "import.probable_duplicate",
      "classify.rule_offer",
      "import.transfer_ambiguous",
      "job.dead",
      "identity.recovery-code-used",
      "identity.partner-reset",
      "imports.handoff",
      "import.set_aside",
      // The imported row has no category yet.
      "classify.unclassified",
    ]);
    const byKind = Object.fromEntries(cards.map((c) => [c.kind, c.detail]));
    expect(byKind["import.probable_duplicate"]).toMatchObject({
      type: "transaction",
      transaction: {
        description: "Coffee shop",
        accountName: "Joint everyday",
        amountCents: -2500,
      },
      candidates: [],
    });
    const ambiguous = byKind["import.transfer_ambiguous"];
    expect(ambiguous?.type === "transaction" && ambiguous.candidates).toHaveLength(2);
    expect(byKind["imports.handoff"]).toEqual({
      type: "handoff",
      filename: "september.csv",
      senderName: "Alex",
    });
    expect(byKind["import.set_aside"]).toMatchObject({
      type: "batch",
      accountName: "Joint everyday",
      rows: [{ rowNumber: 3 }],
    });
    expect(byKind["job.dead"]).toEqual({ type: "none" });
    expect(byKind["identity.recovery-code-used"]).toEqual({ type: "notice", issuedBy: null });
  });

  it("hides what the viewer cannot see: A's private items are absent from B's cards and counts", () => {
    const w = setup();
    const secret = w.txn(w.A, w.aPrivate, -4200, "SECRET PRIVATE THING");
    w.raise({
      kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
      entityRef: transactionEntityRef(secret),
      dedupeKey: probableDuplicateKey(secret),
      accountId: w.aPrivate,
    });
    w.raise({
      kind: RECOVERY_CODE_USED_REVIEW,
      entityRef: "recovery_code:a",
      dedupeKey: "code:a",
      personId: w.a,
    });
    w.raise({ kind: JOB_DEAD_REVIEW, entityRef: "job:1", dedupeKey: "job.dead:1" });
    const shared = w.txn(w.A, w.joint, -100, "Shared");
    w.raise({
      kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
      entityRef: transactionEntityRef(shared),
      dedupeKey: probableDuplicateKey(shared),
      accountId: w.joint,
    });

    expect(JSON.stringify(listReviewCards(w.B))).not.toContain("SECRET");
    expect(listReviewCards(w.B)).toHaveLength(2);
    expect(listReviewCards(w.A)).toHaveLength(4);
    // The chip counts only what both see: the dead job and the shared duplicate.
    expect(countReviewItems(w.B)).toEqual({
      open: 2,
      partner: { displayName: "Alex", pending: 2 },
    });
    expect(countReviewItems(w.A)).toEqual({ open: 4, partner: { displayName: "Sam", pending: 2 } });
    // A private item arriving or leaving does not move B's numbers.
    const before = JSON.stringify([listReviewCards(w.B), countReviewItems(w.B)]);
    const more = w.txn(w.A, w.aPrivate, -1, "more");
    w.raise({
      kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
      entityRef: transactionEntityRef(more),
      dedupeKey: probableDuplicateKey(more),
      accountId: w.aPrivate,
    });
    expect(JSON.stringify([listReviewCards(w.B), countReviewItems(w.B)])).toBe(before);
  });

  it("hides the partner chip at zero, and with no partner", () => {
    const w = setup();
    expect(countReviewItems(w.B)).toEqual({ open: 0, partner: null });
    w.raise({
      kind: RECOVERY_CODE_USED_REVIEW,
      entityRef: "recovery_code:a",
      dedupeKey: "code:a",
      personId: w.a,
    });
    expect(countReviewItems(w.B).partner).toBeNull();
  });

  it("shows a hidden transaction name as the placeholder", () => {
    const w = setup();
    const id = w.txn(w.A, w.joint, -100, "Surprise gift");
    hideTransactionName(w.A, { id });
    w.raise({
      kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
      entityRef: transactionEntityRef(id),
      dedupeKey: probableDuplicateKey(id),
      accountId: w.joint,
    });
    const [card] = listReviewCards(w.B);
    expect(JSON.stringify(card)).not.toContain("Surprise");
    expect(JSON.stringify(card)).toContain("Hidden");
    expect(JSON.stringify(listReviewCards(w.A))).toContain("Surprise gift");
  });

  it("shows a failed PDF statement card with its staged rows and gap", () => {
    const w = setup();
    seedPdfFailed(w, w.joint);
    const card = listReviewCards(w.B).find((c) => c.kind === "import.pdf_failed");
    expect(card?.detail).toMatchObject({
      type: "pdf_batch",
      accountName: "Joint everyday",
      gapCents: 1,
    });
    if (card?.detail.type !== "pdf_batch") throw new Error("expected a pdf_batch detail");
    expect(card.detail.error).toContain("exact gap of 1 cents");
    expect(card.detail.rows).toHaveLength(2);
    expect(card.detail.rows[1]?.corrected).toEqual({
      postedOn: "2024-09-05",
      amountCents: -2_001,
      description: "WOOLWORTHS",
      runningBalanceCents: 103_000,
    });
  });

  it("needs a signed-in person", () => {
    const w = setup();
    expect(code(() => listReviewCards(w.sys))).toBe("Unauthenticated");
    expect(code(() => countReviewItems(w.sys))).toBe("Unauthenticated");
  });
});

describe("review actions", () => {
  it("keeps or removes a probable duplicate, and refuses a second try", () => {
    const w = setup();
    const keep = w.txn(w.A, w.joint, -100, "Keep me");
    const drop = w.txn(w.A, w.joint, -200, "Drop me");
    const ids = [keep, drop].map((id) =>
      w.raise({
        kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
        entityRef: transactionEntityRef(id),
        dedupeKey: probableDuplicateKey(id),
        accountId: w.joint,
      }),
    );
    keepDuplicateItem(w.B, { id: ids[0] as string });
    expect(getTransaction(w.B, { id: keep }).needsReview).toBe(false);
    expect(openIds(w.B)).toEqual([ids[1]]);
    expect(code(() => keepDuplicateItem(w.B, { id: ids[0] as string }))).toBe("NotFound");
    // A kind that does not belong to the action is not found either.
    expect(code(() => dismissTransferItem(w.B, { id: ids[1] as string }))).toBe("NotFound");
    removeDuplicateItem(w.B, { id: ids[1] as string });
    expect(openIds(w.B)).toEqual([]);
    expect(code(() => getTransaction(w.B, { id: drop }))).toBe("NotFound");
  });

  it("does not let B act on A's private items, answering as for an unknown id", () => {
    const w = setup();
    const secret = w.txn(w.A, w.aPrivate, -4200, "Private");
    const id = w.raise({
      kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
      entityRef: transactionEntityRef(secret),
      dedupeKey: probableDuplicateKey(secret),
      accountId: w.aPrivate,
    });
    expect(code(() => keepDuplicateItem(w.B, { id }))).toBe("NotFound");
    expect(code(() => keepDuplicateItem(w.B, { id: "nope" }))).toBe("NotFound");
    expect(openIds(w.A)).toEqual([id]);
  });

  it("links the chosen candidate of an ambiguous transfer and resolves the item", () => {
    const w = setup();
    const out = w.txn(w.A, w.joint, -10000, "Move to savings");
    const one = w.txn(w.A, w.savings, 10000, "In one");
    const two = w.txn(w.A, w.savings, 10000, "In two");
    const stranger = w.txn(w.A, w.savings, 9999, "Not a match");
    const id = w.raise({
      kind: IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
      entityRef: transactionEntityRef(out),
      dedupeKey: transferAmbiguousKey(out),
      accountId: w.joint,
    });
    expect(code(() => linkTransferItem(w.B, { id, candidateId: stranger }))).toBe("Validation");
    expect(openIds(w.B)).toEqual([id]);
    linkTransferItem(w.B, { id, candidateId: two });
    expect(openIds(w.B)).toEqual([]);
    expect(getTransaction(w.B, { id: out }).transferGroupId).toBe(
      getTransaction(w.B, { id: two }).transferGroupId,
    );
    expect(getTransaction(w.B, { id: one }).transferGroupId).toBeNull();
  });

  it("shows, links and dismisses a private transfer ambiguity for its owner only", () => {
    const w = setup();
    const out = w.txn(w.A, w.joint, -10000, "Move out");
    const priv = w.txn(w.A, w.aPrivate, 10000, "Private in");
    const other = w.txn(w.A, w.savings, 10000, "Savings in");
    const id = w.raise({
      kind: IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
      entityRef: transferCandidateEntityRef(out),
      dedupeKey: transferAmbiguousPrivateKey(out),
      personId: w.a,
    });
    expect(openIds(w.B)).toEqual([]);
    expect(countReviewItems(w.B)).toMatchObject({ open: 0 });
    const [card] = listReviewCards(w.A);
    expect(card?.kind).toBe("import.transfer_ambiguous_private");
    expect(card?.detail).toMatchObject({
      type: "transaction",
      transaction: { id: out, description: "Move out" },
    });
    expect(card?.detail.type === "transaction" && card.detail.candidates).toHaveLength(2);
    expect(code(() => dismissTransferItem(w.B, { id }))).toBe("NotFound");
    expect(code(() => linkTransferItem(w.A, { id, candidateId: "nope" }))).toBe("Validation");
    linkTransferItem(w.A, { id, candidateId: priv });
    expect(openIds(w.A)).toEqual([]);
    expect(getTransaction(w.A, { id: out }).transferGroupId).not.toBeNull();
    void other;

    const again = w.txn(w.A, w.joint, -5000, "Another");
    const id2 = w.raise({
      kind: IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
      entityRef: transferCandidateEntityRef(again),
      dedupeKey: transferAmbiguousPrivateKey(again),
      personId: w.a,
    });
    dismissTransferItem(w.A, { id: id2 });
    expect(openIds(w.A)).toEqual([]);
  });

  it("dismisses a transfer ambiguity and a rule offer", () => {
    const w = setup();
    const t = w.txn(w.A, w.joint, -10000, "Maybe a transfer");
    const o = w.txn(w.A, w.joint, -900, "Bakery");
    const ambiguous = w.raise({
      kind: IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
      entityRef: transactionEntityRef(t),
      dedupeKey: transferAmbiguousKey(t),
      accountId: w.joint,
    });
    const offer = w.raise({
      kind: CLASSIFY_RULE_OFFER_REVIEW,
      entityRef: transactionEntityRef(o),
      dedupeKey: `classify.rule_offer:${o}`,
      accountId: w.joint,
    });
    dismissTransferItem(w.B, { id: ambiguous });
    dismissRuleOfferItem(w.B, { id: offer });
    expect(openIds(w.B)).toEqual([]);
    expect(code(() => acceptRuleOfferItem(w.B, { id: offer }))).toBe("NotFound");
  });

  it("accepts a real rule offer with no body: a correction rule exists and the item is resolved", () => {
    const w = setup();
    const group = createCategoryGroup(w.A, { name: "Food", kind: "expense" });
    const category = createCategory(w.A, { groupId: group.id, name: "Groceries" });
    const id = w.txn(w.A, w.joint, -900, "Bakery");
    const splitId = getTransaction(w.A, { id }).splits[0]?.id as string;
    // Categorising an unclassified item is what raises the offer.
    w.raise({
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: transactionEntityRef(id),
      dedupeKey: `classify.unclassified:${id}`,
      accountId: w.joint,
    });
    setSplitField(w.A, { transactionId: id, splitId, field: "category", value: category.id });
    const offer = listReviewCards(w.B).find((c) => c.kind === "classify.rule_offer");
    expect(offer).toBeDefined();
    acceptRuleOfferItem(w.B, { id: offer?.id as string });
    const rules = w.uow.state.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.origin).toBe("correction");
    expect(JSON.parse(rules[0]?.actions as string)).toEqual({ categoryId: category.id });
    expect(JSON.parse(rules[0]?.conditions as string)).toBeTruthy();
    expect(openIds(w.B)).not.toContain(offer?.id);
  });

  it("accepts a hand-off into the recipient's account, and dismisses another", () => {
    const w = setup();
    const send = () =>
      createHandoff(w.A, {
        recipientId: w.b,
        filename: "x.csv",
        format: "commbank_csv",
        content: CSV,
      });
    send();
    const [first] = listReviewCards(w.B);
    expect(
      code(() => acceptHandoffItem(w.A, { id: first?.id as string, accountId: w.joint })),
    ).toBe("NotFound");
    acceptHandoffItem(w.B, { id: first?.id as string, accountId: w.bPrivate });
    expect(openIds(w.B).filter((id) => id === first?.id)).toEqual([]);
    expect(
      code(() => acceptHandoffItem(w.B, { id: first?.id as string, accountId: w.bPrivate })),
    ).toBe("NotFound");
    send();
    const second = listReviewCards(w.B).find((c) => c.kind === "imports.handoff");
    dismissHandoffItem(w.B, { id: second?.id as string });
    expect(listReviewCards(w.B).some((c) => c.kind === "imports.handoff")).toBe(false);
  });

  it("fixes or discards a set-aside row of the item's batch only", () => {
    const w = setup();
    importStatement(w.B, {
      accountId: w.joint,
      format: "commbank_csv",
      content: `${CSV}\nbad-date,-1.00,"THIRD",1.00`,
    });
    const card = listReviewCards(w.B).find((c) => c.kind === "import.set_aside");
    const rows = card?.detail.type === "batch" ? card.detail.rows : [];
    expect(rows).toHaveLength(2);
    expect(
      code(() =>
        discardSetAsideRowItem(w.B, { id: card?.id as string, rowId: "someone-elses-row" }),
      ),
    ).toBe("NotFound");
    fixSetAsideRowItem(w.B, {
      id: card?.id as string,
      rowId: rows[0]?.id as string,
      postedOn: "2026-09-02",
      amountCents: -1200,
      description: "BOOKSTORE",
    });
    discardSetAsideRowItem(w.B, { id: card?.id as string, rowId: rows[1]?.id as string });
    expect(listReviewCards(w.B).some((c) => c.kind === "import.set_aside")).toBe(false);
  });

  it("exposes proposals on set-aside rows and confirms proposal via review action", async () => {
    const w = setup();
    importStatement(w.B, {
      accountId: w.joint,
      format: "commbank_csv",
      content: `${CSV}`,
    });

    const card = listReviewCards(w.B).find((c) => c.kind === "import.set_aside");
    expect(card).toBeDefined();
    const rowsBefore = card?.detail.type === "batch" ? card.detail.rows : [];
    expect(rowsBefore).toHaveLength(1);
    expect(rowsBefore[0]?.proposal).toBeNull();

    // Mock LLM provider for row interpret
    const mockProvider = {
      generateStructured: async () => ({
        data: {
          proposals: [
            {
              index: 0,
              rowId: rowsBefore[0]?.id,
              postedOn: "2026-09-02",
              amountCents: -1200,
              description: "BOOKSTORE PROPOSED",
              confidence: 0.92,
            },
          ],
        },
        raw: "{}",
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        model: "mock-model",
      }),
    };

    const interpretRes = await interpretSetAsideRowsItem(
      { ...w.B, provider: mockProvider as never, providerIsLocal: true },
      { id: card!.id },
    );
    expect(interpretRes.interpretedCount).toBe(1);

    // Now listReviewCards should expose the parsed proposal
    const cardAfter = listReviewCards(w.B).find((c) => c.kind === "import.set_aside");
    const rowsAfter = cardAfter?.detail.type === "batch" ? cardAfter.detail.rows : [];
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]?.proposal).toEqual({
      postedOn: "2026-09-02",
      amountCents: -1200,
      description: "BOOKSTORE PROPOSED",
      confidence: 0.92,
      explanation: null,
    });

    // Confirm the proposal
    const fixResult = confirmSetAsideProposalItem(w.B, {
      id: card!.id,
      rowId: rowsAfter[0]!.id,
    });
    expect(fixResult.transactionId).toBeDefined();

    // Card should now be gone because all rows in batch reached terminal status
    expect(listReviewCards(w.B).some((c) => c.kind === "import.set_aside")).toBe(false);
  });

  it("dismisses a notice, only the viewer's own, and revokes links", () => {
    const w = setup();
    const mine = w.raise({
      kind: RECOVERY_CODE_USED_REVIEW,
      entityRef: "recovery_code:b",
      dedupeKey: "code:b",
      personId: w.b,
    });
    const reset = w.raise({
      kind: PARTNER_RESET_REVIEW,
      entityRef: "re_enrolment_link:l1",
      dedupeKey: "reset:l1",
      personId: w.b,
    });
    expect(code(() => dismissNoticeItem(w.A, { id: mine }))).toBe("NotFound");
    expect(code(() => revokeLinksItem(w.B, { id: mine }))).toBe("NotFound");
    dismissNoticeItem(w.B, { id: mine });
    expect(revokeLinksItem(w.B, { id: reset })).toEqual({ revoked: 0 });
    // A real issued link: revoking ends it, and it can no longer be redeemed.
    const tokens = fakeTokens();
    const issuer = { ...w.A, tokens, codes: fakeCodeHasher() };
    const link = issueReEnrolmentLink(issuer, { personId: w.b });
    const real = listReviewCards(w.B).find(
      (c) =>
        c.kind === "identity.partner-reset" &&
        c.detail.type === "notice" &&
        c.detail.issuedBy === "Alex",
    );
    expect(revokeLinksItem(w.B, { id: real?.id as string })).toEqual({ revoked: 1 });
    expect(() => checkReEnrolmentLink({ ...w.sys, tokens }, { token: link.token })).toThrow();
    expect(openIds(w.B)).not.toContain(real?.id);
    expect(openIds(w.B)).toEqual([]);
  });

  it("corrects a PDF row and re-checks the batch without a second LLM pass", () => {
    const w = setup();
    const { batchId, rowIds, id } = seedPdfFailed(w, w.joint);

    expect(recheckPdfItem(w.A, { id }).ok).toBe(false);
    expect(listReviewCards(w.A).some((c) => c.kind === "import.pdf_failed")).toBe(true);

    correctPdfRowItem(w.A, { id, rowId: rowIds[1] as never, amountCents: -2_000 });
    expect(recheckPdfItem(w.A, { id })).toMatchObject({ ok: true, error: null });

    expect(w.uow.state.importBatches.find((b) => b.id === batchId)?.status).toBe("ready");
    expect(w.uow.state.importRows.every((r) => r.reason === null)).toBe(true);
    expect(listReviewCards(w.A).some((c) => c.kind === "import.pdf_failed")).toBe(false);
  });
});
