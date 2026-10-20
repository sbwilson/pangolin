/**
 * Encrypted file storage (AD-21). Implemented in `apps/server` over the data directory, so `app`
 * stays free of runtime-specific APIs and tests use an in-memory fake. Synchronous, like the
 * repositories: a use case does its file I/O around its write, never across an `await`.
 *
 * A file is named by a keyed hash of its content, so equal content is stored once. Callers fetch
 * a file only through the row that links it, never by a name a person supplied.
 */
export interface AttachmentStore {
  /** Encrypts and stores `content` (if not already stored); returns its name. */
  put(content: Uint8Array): string;
  /** The decrypted content. Throws when the file is missing or has been altered. */
  get(name: string): Uint8Array;
  /** Deletes the file; a missing file is not an error. */
  remove(name: string): void;
}
