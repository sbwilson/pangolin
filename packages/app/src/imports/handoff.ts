// Partner hand-off (AD-5, AD-21): a person imports a statement "for" their partner. The file is
// stored encrypted and the partner picks which of her accounts it lands in, so the sender never
// learns the account. The sender reads only `HandoffStatus`: a type with no batch or account.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { AttachmentContext, UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import type {
  AttachmentRow,
  HandoffStatus,
  ImportHandoffRow,
  TxRepos,
  UnitOfWork,
} from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { type Audit, write } from "../write.ts";
import {
  csvColumnMappingSchema,
  importStatement,
  importStatementInput,
} from "./import-statement.ts";

/** A statement was handed to this person. Person scope; entity `import_handoff:<id>`. */
export const IMPORT_HANDOFF_REVIEW = defineReviewKind({
  kind: "imports.handoff",
  module: "imports",
  scope: "person",
});

/** The most a hand-off file may hold, in bytes. */
export const MAX_HANDOFF_BYTES = 10 * 1024 * 1024;

const handoffEntityRef = (id: string) => `import_handoff:${id}`;
const handoffDedupeKey = (id: string) => `imports.handoff:${id}`;

const MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  commbank_ofx: "application/x-ofx",
  commbank_qif: "application/x-qif",
  qif: "application/x-qif",
};

export const createHandoffInput = z
  .object({
    recipientId: idInput,
    filename: z.string().trim().min(1).max(255),
    format: importStatementInput.shape.format,
    content: importStatementInput.shape.content,
    csvMapping: csvColumnMappingSchema.optional(),
  })
  .strict();
export type CreateHandoffInput = z.input<typeof createHandoffInput>;

export const handoffIdInput = z.object({ handoffId: idInput }).strict();
export type HandoffIdInput = z.input<typeof handoffIdInput>;

export const acceptHandoffInput = z.object({ handoffId: idInput, accountId: idInput }).strict();
export type AcceptHandoffInput = z.input<typeof acceptHandoffInput>;

export const listMyHandoffsInput = z.object({}).strict();
export type ListMyHandoffsInput = z.input<typeof listMyHandoffsInput>;

function requirePerson(ctx: UseCaseContext): Id<"Person"> {
  if (ctx.viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return ctx.viewer.personId;
}

/** What the audit trail keeps of a hand-off: never the content, the mapping or a batch. */
function senderView(row: ImportHandoffRow) {
  return {
    id: row.id,
    senderId: row.senderId,
    recipientId: row.recipientId,
    filename: row.filename,
    status: row.status,
  };
}

/**
 * `imports.createHandoff`: encrypts `content`, stores it, and records a pending hand-off to
 * `recipientId` with a review item for her alone. The recipient must be another active person
 * (`Validation`). The file is written before the transaction; a failed write removes it again
 * unless another row links the same content.
 */
export function createHandoff(
  ctx: AttachmentContext,
  input: CreateHandoffInput,
): { readonly id: Id<"ImportHandoff"> } {
  const senderId = requirePerson(ctx);
  const parsed = parseInput(createHandoffInput, input);
  if (parsed.recipientId === senderId) {
    throw new AppError("Validation", "Choose someone other than yourself");
  }
  const bytes = new TextEncoder().encode(parsed.content);
  if (bytes.length > MAX_HANDOFF_BYTES) {
    throw new AppError("Validation", "The file is too large to hand off");
  }
  const name = ctx.attachments.put(bytes);
  try {
    return write(ctx, (tx, audit) => {
      const recipient = tx.person.listActive().find((p) => p.id === parsed.recipientId);
      if (recipient === undefined) {
        throw new AppError("Validation", "Choose an active person in the household");
      }
      const at = formatInstant(ctx.clock.now());
      let attachment: AttachmentRow | undefined = tx.attachments.findByName(name);
      if (attachment === undefined) {
        attachment = {
          id: ctx.newId<"Attachment">(),
          name,
          mime: MIME_BY_FORMAT[parsed.format] ?? "text/csv",
          bytes: bytes.length,
          createdAt: at,
        };
        tx.attachments.insert(attachment);
      }
      const row: ImportHandoffRow = {
        id: ctx.newId<"ImportHandoff">(),
        attachmentId: attachment.id,
        senderId,
        recipientId: recipient.id,
        filename: parsed.filename,
        format: parsed.format,
        csvMapping: parsed.csvMapping === undefined ? null : JSON.stringify(parsed.csvMapping),
        status: "pending",
        batchId: null,
        createdAt: at,
        updatedAt: at,
      };
      tx.importHandoffs.insert(row);
      // Scoped to the sender: the recipient reads the item, not the sender's trail.
      audit({
        entity: "import_handoff",
        entityId: row.id,
        action: "create",
        before: null,
        after: senderView(row),
        personId: senderId,
      });
      raiseReviewItem(tx, audit, ctx, {
        kind: IMPORT_HANDOFF_REVIEW,
        entityRef: handoffEntityRef(row.id),
        dedupeKey: handoffDedupeKey(row.id),
        personId: recipient.id,
      });
      return { id: row.id };
    });
  } catch (error) {
    removeIfUnlinked(ctx, name);
    throw error;
  }
}

function removeIfUnlinked(ctx: AttachmentContext, name: string): void {
  try {
    const orphan = write(ctx, (tx) => tx.attachments.findByName(name) === undefined);
    if (orphan) ctx.attachments.remove(name);
  } catch {
    // Best effort: the original error is the one to report.
  }
}

/**
 * `imports.listMyHandoffs`: the viewer's own hand-offs as `{ id, recipient, filename, status }`,
 * oldest first. Nothing about the recipient's account or batch is reachable from here.
 */
export function listMyHandoffs(
  ctx: UseCaseContext,
  input: ListMyHandoffsInput = {},
): HandoffStatus[] {
  parseInput(listMyHandoffsInput, input);
  requirePerson(ctx);
  return ctx.uow.read((repos) => repos.importHandoffs.listForSender(ctx.viewer));
}

/** The pending hand-off addressed to the viewer; `NotFound` for anyone else, `Conflict` once done. */
function pendingFor(ctx: UseCaseContext, tx: TxRepos, handoffId: string): ImportHandoffRow {
  const row = tx.importHandoffs.findForRecipient(ctx.viewer, handoffId);
  if (row === undefined) throw new AppError("NotFound", "Hand-off not found");
  if (row.status !== "pending") {
    throw new AppError("Conflict", "This hand-off has already been dealt with");
  }
  return row;
}

/** A unit of work whose every transaction is the one already open. */
function insideOpen(tx: TxRepos): UnitOfWork {
  return { transaction: (fn) => fn(tx), read: (fn) => fn(tx) };
}

/**
 * `imports.acceptHandoff`: the recipient picks one of her visible accounts (`NotFound`
 * otherwise); the file is decrypted and imported there as her through `importStatement`, and the
 * hand-off becomes `imported`, all in one write. A failed decryption or import leaves it
 * `pending`. A non-recipient gets `NotFound`, the recipient of a finished hand-off `Conflict`.
 */
export function acceptHandoff(
  ctx: AttachmentContext,
  input: AcceptHandoffInput,
): { readonly status: "imported" } {
  requirePerson(ctx);
  const parsed = parseInput(acceptHandoffInput, input);
  return write(ctx, (tx, audit) => {
    const row = pendingFor(ctx, tx, parsed.handoffId);
    if (tx.accounts.findVisible(ctx.viewer, parsed.accountId) === undefined) {
      throw new AppError("NotFound", "Account not found");
    }
    const attachment =
      row.attachmentId === null ? undefined : tx.attachments.find(row.attachmentId);
    if (attachment === undefined) throw new Error(`Hand-off ${row.id} has no attachment`);
    // Throws when the ciphertext was altered: nothing is imported.
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      ctx.attachments.get(attachment.name),
    );
    const result = importStatement(
      { ...ctx, uow: insideOpen(tx) },
      {
        accountId: parsed.accountId,
        format: row.format as z.input<typeof importStatementInput>["format"],
        content,
        ...(row.csvMapping === null ? {} : { csvMapping: JSON.parse(row.csvMapping) }),
      },
    );
    const at = formatInstant(ctx.clock.now());
    if (!tx.importHandoffs.markImported(row.id, result.batchId, at)) {
      throw new AppError("Conflict", "This hand-off has already been dealt with");
    }
    // Recipient-scoped: the sender's trail must not learn the account or batch.
    audit({
      entity: "import_handoff",
      entityId: row.id,
      action: "accept",
      before: senderView(row),
      after: {
        ...senderView(row),
        status: "imported",
        batchId: result.batchId,
        accountId: parsed.accountId,
      },
      personId: row.recipientId,
    });
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: handoffDedupeKey(row.id),
      resolution: "imported",
    });
    return { status: "imported" as const };
  });
}

/**
 * `imports.dismissHandoff`: the recipient turns the hand-off down. It becomes `dismissed`, its
 * review item is resolved, and the file is deleted unless another hand-off of the same content
 * still links it. Errors as for `acceptHandoff`.
 */
export function dismissHandoff(
  ctx: AttachmentContext,
  input: HandoffIdInput,
): { readonly status: "dismissed" } {
  requirePerson(ctx);
  const parsed = parseInput(handoffIdInput, input);
  const unlinked = write(ctx, (tx, audit) => {
    const row = pendingFor(ctx, tx, parsed.handoffId);
    const at = formatInstant(ctx.clock.now());
    if (!tx.importHandoffs.markDismissed(row.id, at)) {
      throw new AppError("Conflict", "This hand-off has already been dealt with");
    }
    audit({
      entity: "import_handoff",
      entityId: row.id,
      action: "dismiss",
      before: senderView(row),
      after: { ...senderView(row), status: "dismissed" },
      personId: row.recipientId,
    });
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey: handoffDedupeKey(row.id),
      resolution: "dismissed",
    });
    return row.attachmentId === null
      ? undefined
      : tx.attachments.deleteIfUnlinked(row.attachmentId);
  });
  // After the commit: a file removed for a rolled-back write could not be brought back.
  if (unlinked !== undefined) {
    try {
      ctx.attachments.remove(unlinked);
    } catch {
      // Committed already: a file left behind is an orphan, not a failed dismiss.
    }
  }
  return { status: "dismissed" };
}

/**
 * The leave's share of the hand-offs (`accounts.leaveHousehold`): drops every hand-off the
 * person sent or received, resolves the other side's review item for each, and returns the names
 * of the files no other hand-off still links, for the caller to remove after the commit.
 */
export function dropHandoffsOf(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "clock">,
  personId: string,
): string[] {
  const names: string[] = [];
  for (const { id, attachmentId } of tx.importHandoffs.deleteForPerson(personId)) {
    resolveReviewItem(tx, audit, ctx, { dedupeKey: handoffDedupeKey(id), resolution: "withdrawn" });
    if (attachmentId === null) continue;
    const name = tx.attachments.deleteIfUnlinked(attachmentId);
    if (name !== undefined) names.push(name);
  }
  return names;
}
