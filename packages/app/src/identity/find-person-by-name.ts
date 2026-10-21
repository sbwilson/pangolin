// Who an operator command runs as (retro F7): the server console names a household person and
// the command then runs as that person's viewer. Only for the console (AD-6).
import type { Id } from "@pangolin/shared";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";

export const findActivePersonByNameInput = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
export type FindActivePersonByNameInput = z.input<typeof findActivePersonByNameInput>;

/**
 * `identity.findActivePersonByName`: the id of the one active person whose display name matches
 * `name`, ignoring case. `NotFound` when nobody does, `Conflict` when more than one does. The
 * messages name only the name given. Throws `Unauthenticated` for any viewer but a system viewer.
 */
export function findActivePersonByName(
  ctx: UseCaseContext,
  input: FindActivePersonByNameInput,
): Id<"Person"> {
  const { name } = parseInput(findActivePersonByNameInput, input);
  if (ctx.viewer.kind !== "system") {
    throw new AppError("Unauthenticated", "Only the server console can look up a person by name");
  }
  const wanted = name.toLowerCase();
  const matches = ctx.uow.read((repos) =>
    repos.person.listActive().filter((p) => p.displayName.trim().toLowerCase() === wanted),
  );
  const [only, ...others] = matches;
  if (only === undefined) throw new AppError("NotFound", `No active person named ${name}`);
  if (others.length > 0) {
    throw new AppError(
      "Conflict",
      `More than one active person is named ${name}: give the exact display name`,
    );
  }
  return only.id;
}
