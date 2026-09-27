import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { PersonRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

export const createPersonInput = z
  .object({
    displayName: z.string().trim().min(1, { message: "Enter a name" }).max(100),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i, { message: "Expected a #RRGGBB colour" }),
  })
  .strict();
export type CreatePersonInput = z.input<typeof createPersonInput>;

/**
 * `identity.createPerson`: adds a person with no login, audited as one `create` of `person`.
 * The display name is trimmed. Returns the new person's server-minted ID.
 */
export function createPerson(ctx: UseCaseContext, input: CreatePersonInput): Id<"Person"> {
  const parsed = parseInput(createPersonInput, input);
  return write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const row: PersonRow = {
      id: ctx.newId<"Person">(),
      userId: null,
      displayName: parsed.displayName,
      colour: parsed.colour,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    tx.person.insert(row);
    audit({ entity: "person", entityId: row.id, action: "create", before: null, after: row });
    return row.id;
  });
}
