// First-boot setup link (story 1.5). While nobody has a login, the server issues a one-time link
// and writes it to `<dataDir>/setup-link.txt` (mode 0600) for the installer to read. The token
// never reaches a log: callers log the file's path only. Story 1.9's CLI will reissue links over
// the admin socket.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Clock,
  ensureFirstSetupLink,
  type IdGenerator,
  type TokenPort,
  type UnitOfWork,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";

export const SETUP_LINK_FILE = "setup-link.txt";

export interface FirstSetupLinkDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly tokens: TokenPort;
  readonly dataDir: string;
  readonly publicUrl: string;
}

function removeIfPresent(path: string): void {
  rmSync(path, { force: true });
}

/**
 * Keeps `<dataDir>/setup-link.txt` in step with the first-boot link, at every boot:
 * - once anyone has a login, the file is deleted;
 * - while nobody has, a live link must be in the file: when the file is missing the old link is
 *   revoked and a new one issued, and a new link is written to a freshly created 0600 file
 *   (any older file is removed first, so it never keeps looser permissions).
 * Returns the file's path when it wrote a new link, otherwise undefined.
 */
export function writeFirstSetupLink(deps: FirstSetupLinkDeps): string | undefined {
  const path = join(deps.dataDir, SETUP_LINK_FILE);
  const result = ensureFirstSetupLink(
    {
      viewer: systemViewer("cli:setup-link"),
      clock: deps.clock,
      newId: deps.newId,
      uow: deps.uow,
      tokens: deps.tokens,
    },
    { reissue: !existsSync(path) },
  );
  if (result.status === "closed") {
    removeIfPresent(path);
    return undefined;
  }
  if (result.status === "live") return undefined;
  const url = `${deps.publicUrl}/setup?token=${encodeURIComponent(result.link.token)}`;
  removeIfPresent(path);
  writeFileSync(path, `${url}\n`, { flag: "wx", mode: 0o600 });
  return path;
}
