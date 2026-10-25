import { z } from "zod";

/**
 * Converts a Zod schema into a JSON Schema object suitable for
 * OpenAI structured output (`response_format.json_schema.schema`)
 * and Anthropic forced tool calls (`tool.input_schema`).
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _, ...cleanSchema } = jsonSchema;
  return cleanSchema;
}
