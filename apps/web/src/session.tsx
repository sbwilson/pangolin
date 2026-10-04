import { createContext, useContext } from "react";
import type { Me } from "./api.ts";

export const ME_KEY = ["identity", "me"] as const;

/** What the root layout offers the pages: the signed-in person and the session actions. */
export interface Session {
  /** The signed-in person, or null when nobody is. */
  readonly me: Me | null;
  readonly signOut: () => Promise<void>;
  /** Refetches everything cached, including who is signed in. */
  readonly refresh: () => Promise<void>;
  /** Called once a sign-in (or sign-up) completes: goes home and refetches. */
  readonly signedIn: () => Promise<void>;
  /** Called once sign-up or re-enrolment succeeded; keeps the password in memory for TOTP setup. */
  readonly signedUp: (password: string) => Promise<void>;
  /** A one-time link token read from the URL once; the URL no longer carries it. */
  readonly token: string;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession must be used inside the root layout");
  return session;
}

/** The session of a page that is only shown to a signed-in person (the layout guarantees it). */
export function useSignedIn(): Session & { readonly me: Me } {
  const session = useSession();
  if (session.me === null) throw new Error("This page needs a signed-in person");
  return { ...session, me: session.me };
}
