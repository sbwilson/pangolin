import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { PersonRow, TxRepos } from "../ports/unit-of-work.ts";
import { type Audit, write } from "../write.ts";

export const createPersonInput = z
  .object({
    displayName: z.string().trim().min(1, { message: "Enter a name" }).max(100),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i, { message: "Expected a #RRGGBB colour" }),
    /** The better-auth user this person signs in as; absent for a person with no login. */
    userId: z.string().min(1).max(100).optional(),
  })
  .strict();
export type CreatePersonInput = z.input<typeof createPersonInput>;

/**
 * Inserts a person inside an open write and audits the `create`. For `identity` use cases that
 * add a person as part of a larger change (sign-up); everyone else calls `createPerson`.
 */
export function insertPerson(
  ctx: Pick<UseCaseContext, "clock">,
  tx: TxRepos,
  audit: Audit,
  id: Id<"Person">,
  input: z.output<typeof createPersonInput>,
): PersonRow {
  const at = formatInstant(ctx.clock.now());
  const row: PersonRow = {
    id,
    userId: input.userId ?? null,
    displayName: input.displayName,
    colour: input.colour,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  tx.person.insert(row);
  audit({ entity: "person", entityId: row.id, action: "create", before: null, after: row });
  return row;
}

/**
 * `identity.createPerson`: adds a person, optionally linked to a login, audited as one `create`
 * of `person`. The display name is trimmed. Returns the new person's
 * server-minted ID.
 */
export function createPerson(ctx: UseCaseContext, input: CreatePersonInput): Id<"Person"> {
  const parsed = parseInput(createPersonInput, input);
  return write(ctx, (tx, audit) => insertPerson(ctx, tx, audit, ctx.newId<"Person">(), parsed).id);
}
