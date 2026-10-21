// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api.ts";
import { NeedsReviewBadge } from "./NeedsReviewBadge.tsx";

vi.mock("../../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api.ts")>()),
  fetchReviewCounts: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

function renderBadge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NeedsReviewBadge />
    </QueryClientProvider>,
  );
}

describe("NeedsReviewBadge", () => {
  it("shows the count of open items", async () => {
    vi.mocked(api.fetchReviewCounts).mockResolvedValue({ open: 4, partner: null });
    renderBadge();
    expect((await screen.findByTestId("review-badge")).textContent).toBe("4 waiting");
  });

  it("shows a check at zero", async () => {
    vi.mocked(api.fetchReviewCounts).mockResolvedValue({ open: 0, partner: null });
    renderBadge();
    expect((await screen.findByTestId("review-badge")).textContent).toBe(", all clear");
  });

  it("shows nothing while loading or when the count is unavailable", async () => {
    vi.mocked(api.fetchReviewCounts).mockRejectedValue(new Error("down"));
    renderBadge();
    expect(screen.queryByTestId("review-badge")).toBeNull();
    await vi.waitFor(() => expect(api.fetchReviewCounts).toHaveBeenCalled());
    expect(screen.queryByTestId("review-badge")).toBeNull();
  });
});
