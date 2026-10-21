// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportResult } from "../../api.ts";
import { ImportSummary, reviewLinkText, summaryText } from "./ImportSummary.tsx";

afterEach(cleanup);

const result = (over: Partial<ImportResult>): ImportResult => ({
  batchId: "b",
  status: "committed",
  rowCount: 0,
  newCount: 0,
  dupCount: 0,
  setAsideCount: 0,
  needReviewCount: 0,
  ...over,
});

describe("summaryText", () => {
  it.each([
    [{ newCount: 142 }, "142 new"],
    [{ newCount: 1 }, "1 new"],
    [{ newCount: 142, dupCount: 3 }, "142 new · 3 duplicates skipped"],
    [{ newCount: 2, dupCount: 1 }, "2 new · 1 duplicate skipped"],
    [{ newCount: 139, setAsideCount: 3 }, "139 imported · 3 set aside"],
    [
      { newCount: 1, setAsideCount: 1, dupCount: 2 },
      "1 imported · 1 set aside · 2 duplicates skipped",
    ],
    [{ dupCount: 145 }, "Nothing new. You've already imported all of this."],
    [{ dupCount: 145, needReviewCount: 2 }, "0 new · 145 duplicates skipped"],
    [{}, "Nothing to import. That file had no transactions."],
  ] as [Partial<ImportResult>, string][])("%j reads %s", (over, text) => {
    expect(summaryText(result(over))).toBe(text);
  });
});

describe("reviewLinkText", () => {
  it("uses singular and plural forms", () => {
    expect(reviewLinkText(1)).toBe("1 needs review");
    expect(reviewLinkText(3)).toBe("3 need review");
  });
});

function renderSummary(over: Partial<ImportResult>) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ImportSummary result={result(over)} onNavigate={() => {}} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
    origin: "http://localhost",
  });
  render(<RouterProvider router={router} />);
}

describe("ImportSummary", () => {
  it("links to Needs review whenever items are open, even with no new rows", async () => {
    renderSummary({ dupCount: 10, needReviewCount: 1 });
    expect(
      (
        (await screen.findByRole("link", { name: "1 needs review" })) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/review");
  });

  it("shows no link when nothing is open", async () => {
    renderSummary({ newCount: 5, dupCount: 2 });
    await screen.findByText("5 new · 2 duplicates skipped");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
