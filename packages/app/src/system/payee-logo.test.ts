// `readPayeeLogo`'s 404 semantics: bytes + stored mime for a visible payee with a logo; the
// same `NotFound` for a logoless payee, an unknown one, and another person's scoped payee.

import type { Id } from "@pangolin/shared";
import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { AttachmentContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { AttachmentRow, PayeeRow } from "../ports/unit-of-work.ts";
import { fakeAttachmentStore } from "../testing/attachment-store.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { readPayeeLogo } from "./payee-logo.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const personB = idSchema("Person").parse("01J0000000000000000000000B");
const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

const payeeRow = (
  over: Omit<Partial<PayeeRow>, "id" | "scopePersonId"> & {
    id: string;
    scopePersonId: string | null;
  },
): PayeeRow =>
  ({
    name: "Shop",
    websiteUrl: "https://shop.example.com",
    logoAttachmentId: null,
    defaultCategoryId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as PayeeRow;

function fixture() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const made = memoryContext(personViewer(personA, now), clock);
  const attachments = fakeAttachmentStore();
  const ctx: AttachmentContext = { ...made.ctx, attachments };
  const name = attachments.put(PNG);
  const attachment: AttachmentRow = {
    id: "att1" as unknown as Id<"Attachment">,
    name,
    mime: "image/png",
    bytes: PNG.length,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  made.uow.state.attachments.push(attachment);
  made.uow.state.payees.push(
    payeeRow({ id: "pub-logo", scopePersonId: null, logoAttachmentId: "att1" }),
    payeeRow({ id: "pub-nologo", scopePersonId: null }),
    payeeRow({ id: "priv-logo", scopePersonId: personB, logoAttachmentId: "att1" }),
    payeeRow({ id: "dangling", scopePersonId: null, logoAttachmentId: "att-missing" }),
  );
  return { ctx, uow: made.uow };
}

describe("readPayeeLogo", () => {
  it("returns the decrypted bytes with the stored mime for a visible payee with a logo", () => {
    const { ctx } = fixture();
    const file = readPayeeLogo(ctx, { payeeId: "pub-logo" });
    expect(file.contentType).toBe("image/png");
    expect(Array.from(file.bytes)).toEqual(Array.from(PNG));
    // A bare id is accepted too.
    expect(readPayeeLogo(ctx, "pub-logo").contentType).toBe("image/png");
  });

  it("is NotFound for a logoless, unknown, or dangling-attachment payee", () => {
    const { ctx } = fixture();
    expect(() => readPayeeLogo(ctx, { payeeId: "pub-nologo" })).toThrow(AppError);
    expect(() => readPayeeLogo(ctx, { payeeId: "nope" })).toThrow(AppError);
    expect(() => readPayeeLogo(ctx, { payeeId: "dangling" })).toThrow(AppError);
  });

  it("is NotFound for another person's scoped payee, even when it has a logo", () => {
    const { ctx } = fixture();
    expect(() => readPayeeLogo(ctx, { payeeId: "priv-logo" })).toThrow(AppError);
  });

  it("rejects unknown input fields", () => {
    const { ctx } = fixture();
    expect(() => readPayeeLogo(ctx, { payeeId: "pub-logo", extra: 1 } as never)).toThrow(AppError);
  });
});
