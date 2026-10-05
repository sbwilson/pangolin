import { describe, expect, it } from "vitest";
import { hiddenLabel, redact, scrubJson } from "./redact.ts";
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

  it("writes the label into the audit JSON's name keys that are present, adding none", () => {
    const label = "Hidden until 12 Mar 2027";
    const before = JSON.stringify({ descriptionRaw: null, payeeId: null, notes: "keep" });
    const after = JSON.stringify({ transferGroupId: null, notes: "keep" });
    const [row] = redact(viewer, [
      { entity: "transaction", hiddenUntil: "2027-03-12", before, after },
    ]);
    expect(JSON.parse(row?.before ?? "")).toEqual({
      descriptionRaw: label,
      payeeId: label,
      notes: "keep",
    });
    expect(JSON.parse(row?.after ?? "")).toEqual({ transferGroupId: null, notes: "keep" });
  });

  it("fails closed on audit JSON it cannot read: the label, never the input", () => {
    const label = "Hidden until 12 Mar 2027";
    for (const bad of [
      '{"descriptionRaw":"Surprise"',
      "Surprise",
      '["Surprise"]',
      '"Surprise"',
      "42",
      7,
    ]) {
      expect(scrubJson(bad, label)).toBe(label);
    }
    expect(scrubJson(null, label)).toBeNull();
    const [row] = redact(viewer, [
      {
        entity: "transaction",
        hiddenUntil: "2027-03-12",
        before: "not json Surprise",
        after: null,
      },
    ]);
    expect(row).toMatchObject({ before: label, after: null });
  });

  it("throws without a viewer", () => {
    expect(() => redact(undefined, [])).toThrow(TypeError);
  });
});
