import { describe, expect, it } from "vitest";
import { hiddenLabel, redact } from "./redact.ts";
import { systemViewer } from "./system-viewer.ts";

const viewer = systemViewer("cli:test");

describe("redact", () => {
  it("formats the placeholder from a date or a timestamp", () => {
    expect(hiddenLabel("2027-03-12")).toBe("Hidden until 12 Mar 2027");
    expect(hiddenLabel("2027-12-01T00:00:00.000Z")).toBe("Hidden until 1 Dec 2027");
  });

  it("renders only rows the projection flagged, and keeps notes", () => {
    const rows = [
      {
        nameHidden: true,
        nameHiddenUntil: "2027-03-12",
        descriptionRaw: null,
        payeeName: null,
        notes: "keep",
      },
      {
        nameHidden: false,
        nameHiddenUntil: null,
        descriptionRaw: "real",
        payeeName: null,
        notes: null,
      },
      { kind: "job.dead", entityRef: "x" },
    ];
    const [hidden, plain, other] = redact(viewer, rows);
    expect(hidden).toMatchObject({
      descriptionRaw: "Hidden until 12 Mar 2027",
      payeeName: "Hidden until 12 Mar 2027",
      notes: "keep",
    });
    expect(plain).toEqual(rows[1]);
    expect(other).toEqual(rows[2]);
  });

  it("throws without a viewer", () => {
    expect(() => redact(undefined, [])).toThrow(TypeError);
  });
});
