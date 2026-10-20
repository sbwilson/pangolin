// Encrypted attachment storage (AD-21). Each file is AES-256-GCM under a key derived from the
// auth secret by label, stored at `<dir>/<HMAC(key, content)>` as `iv (12) | tag (16) | ciphertext`.
// Equal content is stored once; every write uses a fresh random IV. The file name is bound to the
// ciphertext as additional authenticated data, so a file renamed to another name fails to open.
//
// Rotating the auth secret orphans every stored file (the key changes). Accepted for v1.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AttachmentStore } from "@pangolin/app";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const NAME_PATTERN = /^[0-9a-f]{64}$/;

/** The attachment key: `HMAC(authSecret, "attachments")`, held in memory only. */
function attachmentKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("attachments").digest();
}

function requireName(name: string): string {
  if (!NAME_PATTERN.test(name)) throw new Error("Not an attachment name");
  return name;
}

export function createFileAttachmentStore(dir: string, authSecret: string): AttachmentStore {
  const key = attachmentKey(authSecret);
  const pathOf = (name: string) => join(dir, requireName(name));
  const store: AttachmentStore = {
    put: (content) => {
      const name = createHmac("sha256", key).update(content).digest("hex");
      const path = pathOf(name);
      if (existsSync(path)) {
        // Trust a file only if it opens under this key; else it is damaged or foreign: rewrite.
        try {
          store.get(name);
          return name;
        } catch {
          // fall through to the rewrite
        }
      }
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(name, "utf8"));
      const body = Buffer.concat([cipher.update(content), cipher.final()]);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // Written whole under a temporary name, then renamed: no reader sees half a file.
      const partial = `${path}.${randomBytes(4).toString("hex")}.partial`;
      try {
        writeFileSync(partial, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
        renameSync(partial, path);
      } catch (error) {
        rmSync(partial, { force: true });
        throw error;
      }
      return name;
    },
    get: (name) => {
      const file = readFileSync(pathOf(name));
      if (file.length < IV_BYTES + TAG_BYTES) throw new Error("Attachment is damaged");
      const iv = file.subarray(0, IV_BYTES);
      const tag = file.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(name, "utf8"));
      decipher.setAuthTag(tag);
      let content: Buffer;
      try {
        content = Buffer.concat([
          decipher.update(file.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]);
      } catch {
        throw new Error("Attachment failed authentication");
      }
      // The name is a keyed hash of the content; a mismatch means the file is not what was stored.
      const expected = createHmac("sha256", key).update(content).digest();
      if (!timingSafeEqual(expected, Buffer.from(name, "hex"))) {
        throw new Error("Attachment failed authentication");
      }
      return new Uint8Array(content);
    },
    remove: (name) => {
      rmSync(pathOf(name), { force: true });
    },
  };
  return store;
}
