// createPayee/updatePayee logo triggers (decision 3): a person supplying a website address for
// a SHARED payee confirms the domain, so those paths enqueue a logo fetch; a private payee
// never does, and an address that was already there is not a new confirmation.
import { type Id, idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { createPayee, updatePayee } from "./payees.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const now = "2026-09-27T00:00:00Z";

/** Fails the test loudly when a row that must exist is absent, and narrows the type. */
function defined<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to be defined`);
  return value;
}

function fixture() {
  const clock = manualClock(now);
  const made = memoryContext(systemViewer("job:test"), clock);
  made.uow.state.people = [
    {
      id: personA,
      userId: null,
      displayName: "Alex",
      colour: "#000000",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];
  made.uow.state.accounts.push(
    {
      id: "pub1" as Id<"Account">,
      name: "Joint everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "priv1" as Id<"Account">,
      name: "Alex private",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      createdAt: now,
      updatedAt: now,
    },
  );
  made.uow.state.accountOwners.push(
    {
      accountId: "pub1" as Id<"Account">,
      personId: personA,
      shareBp: 5000,
      createdAt: now,
      updatedAt: now,
    },
    {
      accountId: "priv1" as Id<"Account">,
      personId: personA,
      shareBp: 10000,
      createdAt: now,
      updatedAt: now,
    },
  );
  const ctx = { ...made.ctx, viewer: personViewer(personA, Temporal.Instant.from(now)) };
  const logoJobs = () => made.uow.state.jobs.filter((j) => j.kind === "logo-fetch");
  return { ...made, ctx, logoJobs };
}

describe("payee logo triggers", () => {
  it("createPayee with a website on a shared payee enqueues one job", () => {
    const f = fixture();
    const payee = createPayee(f.ctx, {
      name: "Bunnings",
      websiteUrl: "https://www.bunnings.com.au",
      originAccountId: "pub1",
    });
    const jobs = f.logoJobs();
    expect(jobs).toHaveLength(1);
    const job = defined(jobs[0], "logo job");
    expect(job.lane).toBe("net");
    expect(job.dedupeKey).toBe(`logo:${payee.id}`);
    expect(JSON.parse(job.payload)).toEqual({ payeeId: payee.id });
  });

  it("createPayee without a website enqueues nothing", () => {
    const f = fixture();
    createPayee(f.ctx, { name: "Cash", originAccountId: "pub1" });
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("createPayee on a private origin never enqueues, even with a website", () => {
    const f = fixture();
    createPayee(f.ctx, {
      name: "Private Clinic",
      websiteUrl: "https://clinic.example.com",
      originAccountId: "priv1",
    });
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("updatePayee newly setting a website on a shared payee enqueues", () => {
    const f = fixture();
    const payee = createPayee(f.ctx, { name: "Woolies", originAccountId: "pub1" });
    expect(f.logoJobs()).toHaveLength(0);
    updatePayee(f.ctx, { id: payee.id, websiteUrl: "https://woolworths.com.au" });
    const jobs = f.logoJobs();
    expect(jobs).toHaveLength(1);
    expect(defined(jobs[0], "logo job").dedupeKey).toBe(`logo:${payee.id}`);
  });

  it("updatePayee replacing an existing website does not enqueue", () => {
    const f = fixture();
    createPayee(f.ctx, {
      name: "Woolies",
      websiteUrl: "https://woolworths.com.au",
      originAccountId: "pub1",
    });
    expect(f.logoJobs()).toHaveLength(1); // from create
    const created = defined(f.uow.state.payees[0], "payee");
    updatePayee(f.ctx, { id: created.id, websiteUrl: "https://www.woolies.com.au" });
    expect(f.logoJobs()).toHaveLength(1); // still one, and it stays the create's job
  });

  it("updatePayee setting a website on a private payee never enqueues", () => {
    const f = fixture();
    const payee = createPayee(f.ctx, { name: "Clinic", originAccountId: "priv1" });
    updatePayee(f.ctx, { id: payee.id, websiteUrl: "https://clinic.example.com" });
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("updatePayee clearing a website does not enqueue", () => {
    const f = fixture();
    const payee = createPayee(f.ctx, {
      name: "Woolies",
      websiteUrl: "https://woolworths.com.au",
      originAccountId: "pub1",
    });
    f.uow.state.jobs.length = 0;
    updatePayee(f.ctx, { id: payee.id, websiteUrl: null });
    expect(f.logoJobs()).toHaveLength(0);
  });

  it("a live job is not duplicated by repeated updates", () => {
    const f = fixture();
    const payee = createPayee(f.ctx, { name: "Woolies", originAccountId: "pub1" });
    updatePayee(f.ctx, { id: payee.id, websiteUrl: "https://woolworths.com.au" });
    // Clear and set again while the first job is still pending: dedupe keeps one live job.
    updatePayee(f.ctx, { id: payee.id, websiteUrl: null });
    updatePayee(f.ctx, { id: payee.id, websiteUrl: "https://other.example.net" });
    expect(f.logoJobs()).toHaveLength(1);
  });
});
