import { describe, expect, it } from "vitest";
import type { SystemHealthPort } from "../ports/system-health.ts";
import { health } from "./health.ts";

function port(schemaVersion: number, writable: boolean): SystemHealthPort {
  return { schemaVersion: () => schemaVersion, probeWrite: () => writable };
}

describe("system.health", () => {
  it("is ok when the database is writable", () => {
    expect(health({ systemHealth: port(1, true) }, {})).toEqual({
      status: "ok",
      schemaVersion: 1,
      writable: true,
    });
  });

  it("is unhealthy when the database is read-only", () => {
    expect(health({ systemHealth: port(3, false) }, {})).toEqual({
      status: "unhealthy",
      schemaVersion: 3,
      writable: false,
    });
  });

  it("rejects unknown input fields", () => {
    const input = { extra: 1 } as unknown as Record<string, never>;
    expect(() => health({ systemHealth: port(1, true) }, input)).toThrow();
  });
});
