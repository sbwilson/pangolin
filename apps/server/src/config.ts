import { z } from "zod";

/** Every environment variable the server reads, parsed once at startup. */
const envSchema = z.object({
  PANGOLIN_DATA_DIR: z.string().min(1).default("/data"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** `true`/`false` (also `1`/`0`, `yes`/`no`, `on`/`off`). */
  PANGOLIN_DEMO: z.stringbool().default(false),
  /** The seed file demo mode loads; defaults to `demo-seed.json` next to the bundle. */
  PANGOLIN_SEED_FILE: z.string().min(1).optional(),
});

export interface Config {
  readonly dataDir: string;
  readonly port: number;
  /** Demo mode: an in-memory database loaded from the seed, read-only. */
  readonly demo: boolean;
  readonly seedFile?: string;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.parse(env);
  return {
    dataDir: parsed.PANGOLIN_DATA_DIR,
    port: parsed.PORT,
    demo: parsed.PANGOLIN_DEMO,
    ...(parsed.PANGOLIN_SEED_FILE === undefined ? {} : { seedFile: parsed.PANGOLIN_SEED_FILE }),
  };
}
