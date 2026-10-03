// The release order (story 1.18, retro R5): nothing is tagged or released until the image is
// signed and attested and the upgrade test and the previous-release migration both passed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly id?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly needs?: string | readonly string[];
  readonly steps?: readonly Step[];
}

const here = dirname(fileURLToPath(import.meta.url));
const workflow = parse(
  readFileSync(join(here, "..", ".github", "workflows", "release.yml"), "utf8"),
) as {
  jobs: Record<string, Job>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
};
const jobs = workflow.jobs;

const needs = (job: Job): string[] =>
  job.needs === undefined ? [] : typeof job.needs === "string" ? [job.needs] : [...job.needs];

const isTagStep = (step: Step) => step.name === "Tag the image";
const isReleaseStep = (step: Step) => step.uses?.startsWith("softprops/action-gh-release") ?? false;
/** A step that pushes a tag: `imagetools create`, `docker push`, or a build that pushes tags. */
const pushesTag = (step: Step) =>
  isTagStep(step) ||
  /imagetools\s+create|docker\s+(image\s+)?push|docker\s+tag/.test(step.run ?? "") ||
  (step.uses?.startsWith("docker/build-push-action") === true && step.with?.tags !== undefined);

/** Where in `job` the first step matching `match` is; fails the test when there is none. */
function indexOf(job: Job, what: string, match: (step: Step) => boolean): number {
  const index = (job.steps ?? []).findIndex(match);
  expect(index, `${what} is missing`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("release.yml", () => {
  it("tags the image and creates the release only in the publish job", () => {
    for (const [name, job] of Object.entries(jobs)) {
      const steps = job.steps ?? [];
      const tags = steps.filter(isTagStep).length;
      const releases = steps.filter(isReleaseStep).length;
      if (name === "publish") {
        expect(tags, "publish tags the image once").toBe(1);
        expect(releases, "publish creates the release once").toBe(1);
      } else {
        expect(tags, `${name} must not tag the image`).toBe(0);
        expect(releases, `${name} must not create the release`).toBe(0);
      }
    }
  });

  it("publishes only after every gate", () => {
    expect(needs(jobs.publish ?? {})).toEqual(
      expect.arrayContaining(["image", "upgrade-test", "migrate-previous"]),
    );
  });

  it("tags in publish before it creates the release", () => {
    const publish = jobs.publish ?? {};
    expect(indexOf(publish, "the tag step", isTagStep)).toBeLessThan(
      indexOf(publish, "the release step", isReleaseStep),
    );
  });

  it("migrates the previous release's database in migrate-previous", () => {
    const job = jobs["migrate-previous"] ?? {};
    const checkout = (job.steps ?? []).find((s) => s.uses?.startsWith("actions/checkout"));
    // Without every tag, the previous release is never found and the job passes doing nothing.
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    const runs = (pattern: RegExp) => (s: Step) => pattern.test(s.run ?? "");
    const find = indexOf(
      job,
      "previous-release.sh",
      runs(/\.github\/scripts\/previous-release\.sh/),
    );
    const boot = indexOf(job, "previous-db.sh", runs(/\.github\/scripts\/previous-db\.sh/));
    const check = indexOf(job, "pnpm check:upgrade", runs(/pnpm check:upgrade\b/));
    expect(find).toBeLessThan(boot);
    expect(boot).toBeLessThan(check);
  });

  it("signs and attests in the image job after the build and the scan", () => {
    const image = jobs.image ?? {};
    const build = indexOf(image, "the build", (s) => s.id === "build");
    const scan = indexOf(
      image,
      "the scan",
      (s) => s.uses?.startsWith("anchore/scan-action") ?? false,
    );
    const sign = indexOf(image, "the signature", (s) => /cosign\s+sign\b/.test(s.run ?? ""));
    const attest = indexOf(image, "the attestation", (s) => /cosign\s+attest\b/.test(s.run ?? ""));
    expect(build).toBeLessThan(scan);
    expect(scan).toBeLessThan(sign);
    expect(sign).toBeLessThan(attest);
  });

  it("pushes the release image by digest only, outside publish", () => {
    const build = (jobs.image?.steps ?? []).find((s) => s.id === "build");
    expect(String(build?.with?.outputs)).toContain("push-by-digest=true");
    expect(build?.with?.tags).toBeUndefined();
  });

  it("has no other job push a tag to the registry", () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === "publish" || name === "upgrade-test") continue;
      const offending = (job.steps ?? []).filter(pushesTag).map((s) => s.name ?? s.uses ?? s.run);
      expect(offending, `${name} pushes a tag`).toEqual([]);
    }
  });

  it("pushes tags in upgrade-test only to its local registry", () => {
    for (const step of jobs["upgrade-test"]?.steps ?? []) {
      if (!pushesTag(step)) continue;
      const tags = String(step.with?.tags ?? "");
      expect(tags, `${step.name} pushes outside localhost:5000`).toMatch(/^localhost:5000\//);
      expect(step.run ?? "").not.toMatch(/imagetools\s+create|docker\s+push/);
    }
  });

  it("runs one release at a time, never cancelling one (story 11.6)", () => {
    expect(workflow.concurrency?.group).toBe("release");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("tags only what release-tags.sh allows, with every tag fetched, and badges to match", () => {
    const publish = jobs.publish ?? {};
    const steps = publish.steps ?? [];
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    const tag = steps.find(isTagStep);
    expect(tag?.run).toContain(".github/scripts/release-tags.sh");
    // Its output is captured before the loop, so a failing script fails the step.
    expect(tag?.run).toMatch(/tags=\$\(\.github\/scripts\/release-tags\.sh/);
    expect(tag?.run).not.toMatch(/for tag in \$\(/);
    // No tag is hard-coded: latest and vX.Y come only from the script.
    expect(tag?.run).not.toMatch(/:latest"|\$MAJOR_MINOR/);
    const release = steps.find(isReleaseStep);
    expect(release?.with?.make_latest).toMatch(/^\$\{\{ steps\.tags\.outputs\.latest \}\}$/);
    expect(release?.with?.prerelease).toMatch(/^\$\{\{ steps\.tags\.outputs\.prerelease \}\}$/);
  });
});
