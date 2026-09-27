import { z } from "zod";
import type { SystemHealthPort } from "../ports/system-health.ts";

export interface HealthContext {
  readonly systemHealth: SystemHealthPort;
}

export const healthInput = z.object({}).strict();
export type HealthInput = z.input<typeof healthInput>;

export interface HealthOutput {
  readonly status: "ok" | "unhealthy";
  readonly schemaVersion: number;
  readonly writable: boolean;
}

/** `system.health`: reports the schema version and whether the database is writable. */
export function health(ctx: HealthContext, input: HealthInput): HealthOutput {
  healthInput.parse(input);
  const schemaVersion = ctx.systemHealth.schemaVersion();
  const writable = ctx.systemHealth.probeWrite();
  return { status: writable ? "ok" : "unhealthy", schemaVersion, writable };
}
