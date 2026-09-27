// Runs seed modules in dependency order (AD-15) and collects their events and expectations.
import { formatDate, type PlainDate, parseDate } from "@pangolin/shared/temporal";
import type { Json, SeedModule } from "./module.ts";
import { rngFor } from "./rng.ts";
import { applyEvent, type EmittedEvent, emptyWorld, type World } from "./world.ts";

export const DEFAULT_SEED = "pangolin-v1";
export const DEFAULT_TODAY = "2026-07-15";

export interface RunOptions {
  readonly seed?: string;
  /** `YYYY-MM-DD`. */
  readonly today?: string;
  readonly modules: readonly SeedModule[];
}

/** What `seed.json` holds. */
export interface SeedOutput {
  readonly seed: string;
  /** `YYYY-MM-DD`. */
  readonly today: string;
  readonly events: readonly EmittedEvent[];
  /** Keyed `<module>.<name>`. */
  readonly expectations: Readonly<Record<string, Json>>;
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Orders modules so each runs after everything it depends on; among modules that are ready
 * at the same time, the name decides. Throws, naming the module, for a duplicate or invalid
 * name, an unknown dependency or a cycle.
 */
export function orderModules(modules: readonly SeedModule[]): SeedModule[] {
  const byName = new Map<string, SeedModule>();
  for (const module of modules) {
    if (!NAME_RE.test(module.name)) {
      throw new Error(
        `Seed module name "${module.name}" must be lowercase letters, digits and hyphens`,
      );
    }
    if (byName.has(module.name)) throw new Error(`Seed module "${module.name}" is listed twice`);
    byName.set(module.name, module);
  }
  for (const module of modules) {
    for (const dep of module.dependsOn) {
      if (!byName.has(dep)) {
        throw new Error(`Seed module "${module.name}" depends on unknown module "${dep}"`);
      }
    }
  }

  const done = new Set<string>();
  const ordered: SeedModule[] = [];
  while (ordered.length < modules.length) {
    const ready = [...byName.values()]
      .filter((m) => !done.has(m.name) && m.dependsOn.every((dep) => done.has(dep)))
      .map((m) => m.name)
      .sort();
    const nextName = ready[0];
    if (nextName === undefined) {
      const stuck = [...byName.keys()].filter((name) => !done.has(name)).sort();
      throw new Error(`Seed modules have a dependency cycle: ${stuck.join(", ")}`);
    }
    done.add(nextName);
    ordered.push(byName.get(nextName) as SeedModule);
  }
  return ordered;
}

/** Every module `name` depends on, directly or through others. */
function closure(name: string, byName: ReadonlyMap<string, SeedModule>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byName.get(name)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const dep = stack.pop() as string;
    if (seen.has(dep)) continue;
    seen.add(dep);
    stack.push(...(byName.get(dep)?.dependsOn ?? []));
  }
  return seen;
}

/**
 * Runs every module once. Each module sees a world built only from the events of the modules
 * it depends on (transitively) and draws from its own random stream, so adding or removing an
 * unrelated module never changes its output.
 */
export function runSeed(options: RunOptions): SeedOutput {
  const seed = options.seed ?? DEFAULT_SEED;
  if (seed.length === 0) throw new Error("The seed must not be empty");
  const today: PlainDate = parseDate(options.today ?? DEFAULT_TODAY);
  const ordered = orderModules(options.modules);
  const byName = new Map(ordered.map((m) => [m.name, m]));

  const eventsBy = new Map<string, EmittedEvent[]>();
  const events: EmittedEvent[] = [];
  const expectations: Record<string, Json> = {};

  for (const module of ordered) {
    const deps = closure(module.name, byName);
    let world: World = emptyWorld(seed, today);
    for (const done of ordered) {
      if (!deps.has(done.name)) continue;
      for (const event of eventsBy.get(done.name) ?? []) world = applyEvent(world, event);
    }

    const output = module.generate(world, rngFor(seed, module.name));
    const stamped = output.events.map((event): EmittedEvent => ({ ...event, module: module.name }));
    // Applying the module's own events checks they are consistent with its world.
    stamped.reduce(applyEvent, world);
    eventsBy.set(module.name, stamped);
    events.push(...stamped);
    for (const [key, value] of Object.entries(output.expectations)) {
      expectations[`${module.name}.${key}`] = value;
    }
  }

  assertGloballyConsistent(events);
  return { seed, today: formatDate(today), events, expectations };
}

/**
 * Modules only see their dependencies' events, so a clash between unrelated modules is caught
 * here: person keys must be unique and at most one module may set the household settings.
 */
function assertGloballyConsistent(events: readonly EmittedEvent[]): void {
  const personOwner = new Map<string, string>();
  let settingsOwner: string | undefined;
  for (const event of events) {
    if (event.type === "person.created") {
      const other = personOwner.get(event.key);
      if (other !== undefined) {
        throw new Error(
          `Seed modules "${other}" and "${event.module}" both create person "${event.key}"`,
        );
      }
      personOwner.set(event.key, event.module);
    } else {
      if (settingsOwner !== undefined) {
        throw new Error(
          `Seed modules "${settingsOwner}" and "${event.module}" both set the household settings`,
        );
      }
      settingsOwner = event.module;
    }
  }
}
