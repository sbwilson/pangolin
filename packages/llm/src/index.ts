// Adapter: LLM providers (OpenAI-compatible and Anthropic-compatible)
export type {
  LlmProvider,
  LlmUsage,
  StructuredPrompt,
  StructuredResponse,
} from "@pangolin/app";

export { AnthropicAdapter, type AnthropicConfig } from "./anthropic.ts";
export {
  decryptApiKey,
  deriveKey,
  encryptApiKey,
  extractApiKeyLast4,
} from "./crypto.ts";
export {
  LlmError,
  LlmHttpError,
  LlmMalformedJsonError,
  LlmRateLimitError,
  LlmRefusalError,
  LlmTimeoutError,
  LlmValidationError,
} from "./errors.ts";
export {
  CATEGORY_CHOICES,
  type CategoryChoice,
  type EvalItem,
  SYNTHETIC_DATASET,
} from "./eval/dataset.ts";
export {
  type EvalCategoriseOutput,
  type EvalItemResult,
  type EvalOptions,
  type EvalReport,
  evalCategoriseSchema,
  evaluateProvider,
  runEval,
} from "./eval/harness.ts";
export {
  calculateAccuracy,
  calculateBrierScore,
  calculateLatencyStats,
  type LatencyStats,
} from "./eval/metrics.ts";
export { isLanAddress } from "./lan.ts";
export { OpenAiAdapter, type OpenAiConfig } from "./openai.ts";
export { zodToJsonSchema } from "./schema-converter.ts";
