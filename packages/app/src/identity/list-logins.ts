// The people `pangolin reset-user` can name (story 1.9): only for the server console, which
// runs as a system viewer HTTP can never build (AD-6).
import type { Id } from "@pangolin/shared";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";

/** An active person with a login: their display name and login email, nothing else. */
export interface Login {
  readonly personId: Id<"Person">;
  readonly displayName: string;
  readonly email: string;
}

export const listLoginsInput = z.object({}).strict();
export type ListLoginsInput = z.input<typeof listLoginsInput>;

/**
 * `identity.listLogins`: the active people with a login, oldest first, with their login email.
 * Throws `Unauthenticated` for any viewer but a system viewer.
 */
export function listLogins(ctx: UseCaseContext, input: ListLoginsInput = {}): Login[] {
  parseInput(listLoginsInput, input);
  if (ctx.viewer.kind !== "system") {
    throw new AppError("Unauthenticated", "Only the server console can list logins");
  }
  return ctx.uow.read((repos) => repos.person.listLogins());
}
