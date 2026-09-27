import { idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { systemViewer } from "../system-viewer.ts";
import { manualClock } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { REAUTH_WINDOW_MS, requireRecentAuth } from "./reauth.ts";

const alex = idSchema("Person").parse("01J0000000000000000000000A");
const signedIn = Temporal.Instant.from("2026-09-27T00:00:00Z");

describe("requireRecentAuth", () => {
  it("passes within the window and throws ReauthRequired after it", () => {
    const clock = manualClock("2026-09-27T00:00:00Z");
    const ctx = { viewer: personViewer(alex, signedIn), clock };
    clock.advance(REAUTH_WINDOW_MS);
    expect(() => requireRecentAuth(ctx)).not.toThrow();
    clock.advance(1);
    expect(() => requireRecentAuth(ctx)).toThrow(
      expect.objectContaining({ code: "ReauthRequired" }),
    );
  });

  it("takes a per-action window", () => {
    const clock = manualClock("2026-09-27T00:01:00Z");
    const ctx = { viewer: personViewer(alex, signedIn), clock };
    expect(() => requireRecentAuth(ctx, 30_000)).toThrow(
      expect.objectContaining({ code: "ReauthRequired" }),
    );
  });

  it("never asks a system viewer", () => {
    const clock = manualClock("2030-01-01T00:00:00Z");
    expect(() => requireRecentAuth({ viewer: systemViewer("cli:test"), clock })).not.toThrow();
  });
});
