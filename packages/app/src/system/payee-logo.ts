// Reading a payee's logo (the merchant-domain story), owned by `system`: the bytes behind
// `GET /api/payees/:id/logo`. Like every attachment read, it goes through the row that links
// the file — never a store name a client supplies — under the viewer's own visibility.
import { z } from "zod";
import type { AttachmentContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";

export const readPayeeLogoInput = z.object({ payeeId: idInput }).strict();
export type ReadPayeeLogoInput = z.input<typeof readPayeeLogoInput>;

/** The stored logo: the decrypted bytes and the mime they were recorded with. */
export interface PayeeLogoFile {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * `system.readPayeeLogo`: the payee's stored favicon. `NotFound` — the same answer for every
 * miss (AD-3) — when the viewer cannot see the payee, it has no logo, or the attachment row is
 * gone. A tampered store read surfaces as its own error.
 */
export function readPayeeLogo(
  ctx: AttachmentContext,
  input: ReadPayeeLogoInput | string,
): PayeeLogoFile {
  const parsed = parseInput(
    readPayeeLogoInput,
    typeof input === "string" ? { payeeId: input } : input,
  );
  const file = ctx.uow.read((repos) => {
    const payee = repos.payees.find(ctx.viewer, parsed.payeeId);
    if (payee === undefined || payee.logoAttachmentId === null) return null;
    const attachment = repos.attachments.find(payee.logoAttachmentId);
    if (attachment === undefined) return null;
    return { name: attachment.name, mime: attachment.mime };
  });
  if (file === null) throw new AppError("NotFound", "Logo not found");
  return { contentType: file.mime, bytes: ctx.attachments.get(file.name) };
}
