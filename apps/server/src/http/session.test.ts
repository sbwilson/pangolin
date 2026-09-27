import { describe, expect, it } from "vitest";
import { isPublicApiPath } from "./session.ts";

describe("isPublicApiPath", () => {
  it("lets only health, better-auth and sign-up through without a session", () => {
    for (const path of [
      "/api/system/health",
      "/api/auth/get-session",
      "/api/auth/sign-in/email",
      "/api/identity/sign-up",
    ]) {
      expect(isPublicApiPath(path)).toBe(true);
    }
    for (const path of [
      "/api/system/jobs",
      "/api/identity/me",
      "/api/identity/setup-links",
      "/api/authx",
      "/api/identity/sign-up/x",
      "/api/system/health/x",
    ]) {
      expect(isPublicApiPath(path)).toBe(false);
    }
  });
});
