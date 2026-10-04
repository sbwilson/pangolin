import { z } from "zod";
import { dayInput } from "../accounts/inputs.ts";

/** The transaction field rules `createTransaction` and `updateTransaction` share, one message each. */

/** `YYYY-MM-DD`, a real calendar date. */
export const postedOnField = dayInput;

/** A trimmed, non-blank line of at most 500 characters. */
export const descriptionField = z
  .string()
  .trim()
  .min(1, { message: "Enter a description" })
  .max(500);

/** Plain text, at most 1000 characters; `null` (or blank) clears it. */
export const notesField = z.string().trim().max(1000).nullable();
