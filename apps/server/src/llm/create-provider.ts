// The one adapter factory: build an LLM provider from a stored row and its decrypted key.

import type { LlmProvider, LlmProviderRow } from "@pangolin/app";
import { AnthropicAdapter, OpenAiAdapter } from "@pangolin/llm";

/**
 * The adapter for a stored provider row: `anthropic` rows get the Anthropic adapter, everything
 * else the OpenAI-compatible one. The HTTP app wires it into its LLM contexts and the server wires
 * it into the admin `categorise` command, so a suggestion and a test-connection speak the same
 * dialect. `apiKey` is the decrypted key; a row stored without one gets no header.
 */
export function createLlmAdapter(row: LlmProviderRow, apiKey?: string): LlmProvider {
  if (row.kind === "anthropic") {
    return new AnthropicAdapter({
      baseUrl: row.baseUrl,
      apiKey: apiKey ?? undefined,
      model: row.model,
    });
  }
  return new OpenAiAdapter({ baseUrl: row.baseUrl, apiKey: apiKey ?? undefined, model: row.model });
}
