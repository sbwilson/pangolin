/**
 * Vision-capable model classification (CAP-1, AD-6).
 *
 * Scanned PDF statements without an extractable text layer require
 * a vision-capable multimodal model to interpret page images.
 */

const VISION_MODEL_PATTERNS: readonly RegExp[] = [
  /gpt-4o/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /claude-3/i,
  /gemini/i,
  /llava/i,
  /pixtral/i,
  /qwen.*vl/i,
  /\bvl\b/i,
  /vision/i,
];

export function isVisionCapableModel(model: string): boolean {
  if (!model || typeof model !== "string") {
    return false;
  }
  const trimmed = model.trim();
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}
