import { z } from "zod";

/** Every environment variable the server reads, parsed once at startup. */
const envSchema = z.object({
  PANGOLIN_DATA_DIR: z.string().min(1).default("/data"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export interface Config {
  readonly dataDir: string;
  readonly port: number;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.parse(env);
  return { dataDir: parsed.PANGOLIN_DATA_DIR, port: parsed.PORT };
}
