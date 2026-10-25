import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_LABEL = "llm-api-keys";

/**
 * Derives the 32-byte AES-256 encryption key from authSecret.
 */
export function deriveKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update(KEY_LABEL).digest();
}

/**
 * Extracts at most the last 4 characters of an API key for safe display and logging.
 */
export function extractApiKeyLast4(apiKey: string): string {
  if (apiKey.length <= 4) {
    return apiKey;
  }
  return apiKey.slice(-4);
}

/**
 * Encrypts an API key with AES-256-GCM using a key derived from authSecret.
 * Stored format: `${iv_hex}:${tag_hex}:${ciphertext_hex}`
 */
export function encryptApiKey(apiKey: string, authSecret: string): string {
  if (!authSecret) {
    throw new Error("authSecret must be provided for encryption");
  }
  const key = deriveKey(authSecret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(apiKey, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts an API key encrypted with encryptApiKey.
 * Throws an error if ciphertext or tag was tampered with or authSecret is incorrect.
 */
export function decryptApiKey(encrypted: string, authSecret: string): string {
  if (!authSecret) {
    throw new Error("authSecret must be provided for decryption");
  }
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted API key format; expected iv:tag:ciphertext");
  }
  const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid tag length: expected ${TAG_BYTES} bytes, got ${tag.length}`);
  }

  const key = deriveKey(authSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new Error(
      "Failed to decrypt API key: authentication tag mismatch or corrupted ciphertext",
      {
        cause: err,
      },
    );
  }
}
