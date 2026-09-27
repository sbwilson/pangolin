// The contract every epic's seed module implements (AD-15).
import type { Rng } from "./rng.ts";
import type { SeedEvent, World } from "./world.ts";

/** A JSON value, as expectations are serialised into `seed.json`. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [k: string]: Json };

export interface ModuleOutput {
  /** Events to add to the world, in order. The runner stamps each with the module's name. */
  readonly events: readonly SeedEvent[];
  /**
   * Figures tests assert against instead of hard-coding them. Keys are bare here; the runner
   * prefixes each with `<module>.`.
   */
  readonly expectations: Readonly<Record<string, Json>>;
}

export interface SeedModule {
  /** Lowercase letters, digits and hyphens. Also names the module's random stream. */
  readonly name: string;
  /** Modules whose events this one needs in its world. They always run first. */
  readonly dependsOn: readonly string[];
  /**
   * Pure: the output depends only on `world` (the events of this module's dependencies) and
   * `rng` (this module's own stream). Never read `Math.random`, `Date` or the clock.
   */
  generate(world: World, rng: Rng): ModuleOutput;
}
