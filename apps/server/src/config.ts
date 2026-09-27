import { z } from "zod";

/** Every environment variable the server reads, parsed once at startup. */
const envSchema = z.object({
  PANGOLIN_DATA_DIR: z.string().min(1).default("/data"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** `true`/`false` (also `1`/`0`, `yes`/`no`, `on`/`off`). */
  PANGOLIN_DEMO: z.stringbool().default(false),
  /** The seed file demo mode loads; defaults to `demo-seed.json` next to the bundle. */
  PANGOLIN_SEED_FILE: z.string().min(1).optional(),
  /** Jobs each lane runs at once (AD-8). */
  PANGOLIN_JOB_CONCURRENCY_LLM: z.coerce.number().int().min(0).max(64).default(1),
  PANGOLIN_JOB_CONCURRENCY_NET: z.coerce.number().int().min(0).max(64).default(2),
  PANGOLIN_JOB_CONCURRENCY_LOCAL: z.coerce.number().int().min(0).max(64).default(1),
  /** How long a claimed job's lease lasts before another runner may take it over. */
  PANGOLIN_JOB_LEASE_MS: z.coerce.number().int().min(3000).default(60_000),
});

export interface JobsConfig {
  readonly concurrency: { readonly llm: number; readonly net: number; readonly local: number };
  readonly leaseMs: number;
}

export const DEFAULT_JOBS_CONFIG: JobsConfig = {
  concurrency: { llm: 1, net: 2, local: 1 },
  leaseMs: 60_000,
};

export interface Config {
  readonly dataDir: string;
  readonly port: number;
  /** Demo mode: an in-memory database loaded from the seed, read-only. */
  readonly demo: boolean;
  readonly seedFile?: string;
  readonly jobs: JobsConfig;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.parse(env);
  return {
    dataDir: parsed.PANGOLIN_DATA_DIR,
    port: parsed.PORT,
    demo: parsed.PANGOLIN_DEMO,
    ...(parsed.PANGOLIN_SEED_FILE === undefined ? {} : { seedFile: parsed.PANGOLIN_SEED_FILE }),
    jobs: {
      concurrency: {
        llm: parsed.PANGOLIN_JOB_CONCURRENCY_LLM,
        net: parsed.PANGOLIN_JOB_CONCURRENCY_NET,
        local: parsed.PANGOLIN_JOB_CONCURRENCY_LOCAL,
      },
      leaseMs: parsed.PANGOLIN_JOB_LEASE_MS,
    },
  };
}
