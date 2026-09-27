// A CSP-violation guard on every test: `test` and `expect` from here collect every
// `securitypolicyviolation` event and every CSP console error from each page of the test's
// browser context, and fail the test on any. A test that opens another context passes it to
// `watchCsp` with the same `cspViolations` list.
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";

function watchPage(page: Page, violations: string[]): void {
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
}

/** Collects the CSP violations of every page in `context`, now and later, into `violations`. */
export async function watchCsp(context: BrowserContext, violations: string[]): Promise<void> {
  await context.exposeBinding("__pangolinCspViolation", (_source, report: string) => {
    violations.push(report);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = `${event.violatedDirective} blocked ${event.blockedURI || "inline"}`;
      (window as unknown as { __pangolinCspViolation(r: string): void }).__pangolinCspViolation(
        report,
      );
    });
  });
  for (const page of context.pages()) watchPage(page, violations);
  context.on("page", (page) => watchPage(page, violations));
}

export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      await watchCsp(context, violations);
      await use(violations);
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
