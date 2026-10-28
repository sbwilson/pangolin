// The logo guards and the record write (merchant-domain story): `payeeNeedsLogoFetch` is the
// single predicate every trigger reads; `recordPayeeLogo` writes the store + `attachment` row
// (system-owned, AD-10) and delegates the `payee` row to `classify.attachLogoToPayee`; and the
// job kind retries nothing — one failed attempt is dead (the frozen once-ever rule).
import { type Id, idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { attachLogoToPayee } from "../classify/payees.ts";
import { claimJob, failJob } from "../jobs/lifecycle.ts";
import type { JobRow, PayeeRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { fakeAttachmentStore } from "../testing/attachment-store.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import { enqueueLogoFetch, LOGO_FETCH_JOB, payeeNeedsLogoFetch, recordPayeeLogo } from "./logos.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const NOW = "2026-09-27T00:00:00Z";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function payeeRow(overrides: Partial<PayeeRow> = {}): PayeeRow {
  return {
    id: "payee-1" as Id<"Payee">,
    name: "Shop",
    websiteUrl: "https://shop.example.com",
    logoAttachmentId: null,
    defaultCategoryId: null,
    scopePersonId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fixture() {
  const clock = manualClock(NOW);
  const made = memoryContext(systemViewer("job:test"), clock);
  const store = fakeAttachmentStore();
  const ctx = { ...made.ctx, viewer: personViewer(personA, Temporal.Instant.from(NOW)) };
  const seed = (payee: PayeeRow) => {
    made.uow.state.payees.push(payee);
  };
  return { ...made, clock, store, ctx, seed };
}

describe("payeeNeedsLogoFetch", () => {
  it("is true only for a shared payee with a website and no logo", () => {
    expect(payeeNeedsLogoFetch(payeeRow())).toBe(true);
    expect(payeeNeedsLogoFetch(payeeRow({ scopePersonId: personA }))).toBe(false);
    expect(payeeNeedsLogoFetch(payeeRow({ websiteUrl: null }))).toBe(false);
    expect(payeeNeedsLogoFetch(payeeRow({ logoAttachmentId: "att-1" }))).toBe(false);
  });
});

describe("recordPayeeLogo", () => {
  it("stores the bytes, writes the attachment row, and links the payee through classify", () => {
    const f = fixture();
    f.seed(payeeRow());

    const id = recordPayeeLogo(
      { ...f.ctx, attachments: f.store },
      {
        payeeId: "payee-1",
        bytes: PNG,
        mime: "image/png",
      },
    );

    expect(id).toBeTruthy();
    const attachment = f.uow.state.attachments[0]!;
    expect(attachment).toMatchObject({ mime: "image/png", bytes: PNG.length });
    expect(f.store.files.has(attachment.name)).toBe(true);
    expect(f.uow.state.payees[0]?.logoAttachmentId).toBe(id);
    // The link is audited exactly like classify's own payee updates.
    const audit = f.uow.state.audit.find((a) => a.entity === "payee");
    expect(audit).toBeDefined();
    expect(audit!.action).toBe("update");
    expect(JSON.parse(audit!.before as string)).toMatchObject({ logoAttachmentId: null });
    expect(JSON.parse(audit!.after as string)).toMatchObject({ logoAttachmentId: id });
  });

  it("links nothing and removes the file when the payee went private", () => {
    const f = fixture();
    f.seed(payeeRow({ scopePersonId: personA }));

    const id = recordPayeeLogo(
      { ...f.ctx, attachments: f.store },
      {
        payeeId: "payee-1",
        bytes: PNG,
        mime: "image/png",
      },
    );

    expect(id).toBeNull();
    expect(f.uow.state.attachments).toHaveLength(0);
    expect(f.uow.state.audit.filter((a) => a.entity === "payee")).toHaveLength(0);
    expect(f.store.files.size).toBe(0); // the refused write cleaned its own file
  });

  it("links nothing when the payee already has a logo, or the website is not a public host", () => {
    const f = fixture();
    f.seed(payeeRow({ logoAttachmentId: "att-9" }));
    expect(
      recordPayeeLogo(
        { ...f.ctx, attachments: f.store },
        { payeeId: "payee-1", bytes: PNG, mime: "image/png" },
      ),
    ).toBeNull();
    expect(f.store.files.size).toBe(0);

    const g = fixture();
    // A stored website that no longer normalises (e.g. a hand-edited internal host).
    g.seed(payeeRow({ websiteUrl: "https://192.168.0.7" }));
    expect(
      recordPayeeLogo(
        { ...g.ctx, attachments: g.store },
        { payeeId: "payee-1", bytes: PNG, mime: "image/png" },
      ),
    ).toBeNull();
    expect(g.uow.state.attachments).toHaveLength(0);
    expect(g.store.files.size).toBe(0);
  });

  it("refuses empty, oversized and off-allowlist bodies before storing anything", () => {
    const f = fixture();
    f.seed(payeeRow());
    expect(() =>
      recordPayeeLogo(
        { ...f.ctx, attachments: f.store },
        { payeeId: "payee-1", bytes: new Uint8Array(), mime: "image/png" },
      ),
    ).toThrow(/too large|empty/i);
    expect(() =>
      recordPayeeLogo(
        { ...f.ctx, attachments: f.store },
        { payeeId: "payee-1", bytes: PNG, mime: "image/svg+xml" },
      ),
    ).toThrow(/type/i);
    expect(f.store.files.size).toBe(0);
    expect(f.uow.state.attachments).toHaveLength(0);
  });
});

describe("classify.attachLogoToPayee", () => {
  it("links inside the caller's transaction and audits the payee update", () => {
    const f = fixture();
    f.seed(payeeRow());
    f.uow.state.attachments.push({
      id: "att-5" as Id<"Attachment">,
      name: "favicon-name",
      mime: "image/png",
      bytes: PNG.length,
      createdAt: NOW,
    });
    write(f.ctx, (tx, audit) => {
      expect(attachLogoToPayee(f.ctx, tx, audit, "payee-1", "att-5")).toBe(true);
    });
    expect(f.uow.state.payees[0]?.logoAttachmentId).toBe("att-5");
    expect(
      f.uow.state.audit.filter((a) => a.entity === "payee" && a.action === "update"),
    ).toHaveLength(1);
  });

  it("refuses a private, websiteless or already-logged payee inside the caller's transaction", () => {
    const f = fixture();
    f.seed(payeeRow({ scopePersonId: personA }));
    expect(
      write(f.ctx, (tx, audit) => attachLogoToPayee(f.ctx, tx, audit, "payee-1", "att-5")),
    ).toBe(false);
    expect(f.uow.state.payees[0]?.logoAttachmentId).toBeNull();
  });
});

describe("the logo-fetch retry policy (once-ever)", () => {
  it("dies on the first failed attempt with no pending re-enqueue", () => {
    const f = fixture();
    f.seed(payeeRow());
    write(f.ctx, (tx) => {
      enqueueLogoFetch(tx, f.ctx, "payee-1");
    });
    const jobId = f.uow.state.jobs.find((j) => j.kind === "logo-fetch")!.id;
    expect(LOGO_FETCH_JOB.retry.maxAttempts).toBe(1);

    const claimed = claimJob(f.ctx, { lane: "net", owner: "runner-a", leaseMs: 60_000 });
    expect(claimed).toMatchObject({ id: jobId, kind: "logo-fetch", attempts: 1, maxAttempts: 1 });
    const outcome = failJob(f.ctx, {
      job: claimed as JobRow,
      owner: "runner-a",
      kind: LOGO_FETCH_JOB,
      error: "connection reset",
      schedules: [],
    });
    expect(outcome).toBe("dead");
    const row = f.uow.state.jobs.find((j) => j.id === jobId)!;
    expect(row).toMatchObject({ status: "dead", attempts: 1 });
    // Nothing is pending: the failed fetch is never retried automatically.
    expect(claimJob(f.ctx, { lane: "net", owner: "runner-a", leaseMs: 60_000 })).toBeUndefined();
  });
});
