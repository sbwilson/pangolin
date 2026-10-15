import { parseDate } from "@pangolin/shared/temporal";
import { z } from "zod";

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
