import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";
import { AppError } from "../errors.ts";
import type { AccountOwnerRow, TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export const FULL_SHARE_BP = 10_000;

/** A real `YYYY-MM-DD` calendar date. */
export const dayInput = z.string().refine(
  (value) => {
    try {
      parseDate(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Expected a real YYYY-MM-DD date" },
);

export const idInput = z.string().min(1).max(100);

export const ownersInput = z
  .array(
    z
      .object({
        personId: z.string().min(1).max(100),
        /** Basis points: 5000 = 50%. */
        shareBp: z.int().min(1).max(FULL_SHARE_BP),
      })
      .strict(),
  )
  .min(1, { message: "An account needs an owner" })
  .max(2);
export type OwnersInput = z.output<typeof ownersInput>;

/**
 * The owner rules shared by create and update: no repeats; a private account has one owner with
 * the whole share, and a person may only make or keep one for themselves; shares otherwise sum
 * to 100%.
 */
export function validateOwners(owners: OwnersInput, isPrivate: boolean, viewer: Viewer): void {
  if (new Set(owners.map((owner) => owner.personId)).size !== owners.length) {
    throw new AppError("Validation", "An owner is listed twice");
  }
  if (isPrivate) {
    const [only] = owners;
    if (owners.length !== 1 || only?.shareBp !== FULL_SHARE_BP) {
      throw new AppError("Validation", "A private account has one owner with the whole share");
    }
    if (viewer.kind === "person" && only.personId !== viewer.personId) {
      throw new AppError("Validation", "You can only make a private account for yourself");
    }
  } else if (owners.reduce((sum, owner) => sum + owner.shareBp, 0) !== FULL_SHARE_BP) {
    throw new AppError("Validation", "Owner shares must add up to 100%");
  }
}

/** Throws `Validation` unless every owner is an active person. */
export function requireKnownPeople(tx: TxRepos, owners: OwnersInput): void {
  const people = new Set(tx.person.listActive().map((person) => person.id as string));
  for (const owner of owners) {
    if (!people.has(owner.personId)) throw new AppError("Validation", "Unknown owner");
  }
}

export function ownerRows(
  accountId: Id<"Account">,
  owners: OwnersInput,
  at: string,
  /** Existing rows, so a person who stays an owner keeps their `createdAt`. */
  existing: readonly AccountOwnerRow[] = [],
): AccountOwnerRow[] {
  return owners.map((owner) => ({
    accountId,
    personId: owner.personId as Id<"Person">,
    shareBp: owner.shareBp,
    createdAt: existing.find((row) => row.personId === owner.personId)?.createdAt ?? at,
    updatedAt: at,
  }));
}

/** Throws `Validation` unless the institution exists (they are household-wide). */
export function requireInstitution(tx: TxRepos, viewer: Viewer, id: string | null): void {
  if (id !== null && tx.institutions.find(viewer, id) === undefined) {
    throw new AppError("Validation", "Unknown institution");
  }
}

export function requireDatesInOrder(openedOn: string | null, closedOn: string | null): void {
  if (openedOn !== null && closedOn !== null && closedOn < openedOn) {
    throw new AppError("Validation", "An account cannot close before it opens");
  }
}
