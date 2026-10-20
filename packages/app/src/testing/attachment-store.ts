// Test support only: an in-memory `AttachmentStore`. Names are the content's SHA-256, "files"
// are kept as given (no encryption), and `tamper` makes the next `get` of a name fail.
import { sha256Hex } from "@pangolin/domain";
import type { AttachmentStore } from "../ports/attachment-store.ts";

export interface FakeAttachmentStore extends AttachmentStore {
  readonly files: Map<string, Uint8Array>;
  /** Makes `get(name)` throw, as for a file whose ciphertext was altered. */
  tamper(name: string): void;
}

export function fakeAttachmentStore(): FakeAttachmentStore {
  const files = new Map<string, Uint8Array>();
  const tampered = new Set<string>();
  return {
    files,
    tamper: (name) => {
      tampered.add(name);
    },
    put: (content) => {
      const name = sha256Hex(new TextDecoder().decode(content));
      if (!files.has(name)) files.set(name, Uint8Array.from(content));
      return name;
    },
    get: (name) => {
      const content = files.get(name);
      if (content === undefined) throw new Error("Attachment is missing");
      if (tampered.has(name)) throw new Error("Attachment failed authentication");
      return Uint8Array.from(content);
    },
    remove: (name) => {
      files.delete(name);
      tampered.delete(name);
    },
  };
}
