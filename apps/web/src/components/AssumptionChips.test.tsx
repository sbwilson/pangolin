// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView, ForecastAssumptions } from "../api.ts";
import * as api from "../api.ts";
import {
  ASSUMPTIONS_QUERY_KEY,
  AssumptionChips,
  bpsToPercentText,
  FORECAST_ASSUMPTION_DEFAULTS,
  mortgageProse,
  percentTextToBps,
} from "./AssumptionChips.tsx";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  listAccounts: vi.fn(),
  upsertForecastAssumptions: vi.fn(),
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listAccounts).mockResolvedValue([]);
});

const stored = (over: Partial<ForecastAssumptions> = {}): ForecastAssumptions => ({
  ...FORECAST_ASSUMPTION_DEFAULTS,
  ...over,
});

/** Answers each PUT the way the server does: scalars merge, mortgages replace wholesale. */
function serverLike(initial: ForecastAssumptions): void {
  vi.mocked(api.upsertForecastAssumptions).mockImplementation(async (patch) => {
    Object.assign(initial, {
      savingsRateBps: patch.savingsRateBps ?? initial.savingsRateBps,
      returnLowBps: patch.returnLowBps ?? initial.returnLowBps,
      returnMidBps: patch.returnMidBps ?? initial.returnMidBps,
      returnHighBps: patch.returnHighBps ?? initial.returnHighBps,
      superRateBps: patch.superRateBps ?? initial.superRateBps,
      mortgages:
        patch.mortgages === undefined
          ? initial.mortgages
          : patch.mortgages.map((m) => ({
              accountId: m.accountId,
              countOffset: m.countOffset,
              annualRatePercent: m.annualRatePercent ?? null,
              monthlyRepaymentCents: m.monthlyRepaymentCents ?? null,
            })),
    });
    return { ...initial };
  });
}

/** Renders the chips under a live cache entry, so a successful PUT redraws through it. */
function renderChips(initial: ForecastAssumptions) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  function Harness() {
    const q = useQuery({
      queryKey: ASSUMPTIONS_QUERY_KEY,
      queryFn: () => Promise.resolve(initial),
      initialData: initial,
    });
    return <AssumptionChips assumptions={q.data} />;
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const chip = (name: "savings" | "returns" | "mortgages" | "super") =>
  screen.getByTestId(`assumption-chip-${name}`);

describe("percent text ⇄ basis points", () => {
  it("trims trailing zeros", () => {
    expect(bpsToPercentText(4500)).toBe("45");
    expect(bpsToPercentText(1250)).toBe("12.5");
    expect(bpsToPercentText(1234)).toBe("12.34");
    expect(bpsToPercentText(0)).toBe("0");
    expect(bpsToPercentText(10_000)).toBe("100");
    expect(bpsToPercentText(7)).toBe("0.07");
  });

  it("accepts 0–100 with at most two decimals, and refuses anything else", () => {
    expect(percentTextToBps("45")).toBe(4500);
    expect(percentTextToBps("0")).toBe(0);
    expect(percentTextToBps("100")).toBe(10_000);
    expect(percentTextToBps("12.5")).toBe(1250);
    expect(percentTextToBps("101")).toBeUndefined();
    expect(percentTextToBps("-1")).toBeUndefined();
    expect(percentTextToBps("abc")).toBeUndefined();
    expect(percentTextToBps("12.345")).toBeUndefined();
  });
});

describe("mortgage prose", () => {
  const name = (id: string) => (id === "loan-1" ? "35 Hawthorne St" : undefined);
  it("says none when nothing is paid down", () => {
    expect(mortgageProse([], name)).toBe("No mortgage paid down");
  });
  it("omits the offset clause when the offset is not counted", () => {
    expect(
      mortgageProse(
        [
          {
            accountId: "loan-1",
            countOffset: false,
            annualRatePercent: null,
            monthlyRepaymentCents: null,
          },
        ],
        name,
      ),
    ).toBe("35 Hawthorne St loan paid down");
  });
  it("joins several loans with ·, naming an unresolved account honestly", () => {
    expect(
      mortgageProse(
        [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: null,
            monthlyRepaymentCents: null,
          },
          {
            accountId: "loan-2",
            countOffset: false,
            annualRatePercent: null,
            monthlyRepaymentCents: null,
          },
        ],
        name,
      ),
    ).toBe("35 Hawthorne St loan paid down, offset counted · A home loan paid down");
  });
});

describe("AssumptionChips — display", () => {
  it("pristine: mockup copy at zero, no dot, no reset, no Reset all", () => {
    renderChips(stored());
    expect(chip("savings").textContent).toBe("Savings rate 0%");
    expect(chip("returns").textContent).toBe("Returns: low 0% · mid 0% · high 0%");
    expect(chip("mortgages").textContent).toBe("No mortgage paid down");
    expect(chip("super").textContent).toBe("Super contributions 0%");
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.queryByRole("img", { name: "changed" })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
    expect(screen.queryByTestId("assumption-reset-all")).toBeNull();
  });

  it("every value ≠ the zero default carries a dot and its own reset", () => {
    renderChips(
      stored({
        savingsRateBps: 4500,
        returnMidBps: 500,
        superRateBps: 1200,
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 342_100,
          },
        ],
      }),
    );
    for (const name of ["savings", "returns", "mortgages", "super"] as const) {
      expect(within(chip(name)).getByRole("img", { name: "changed" })).toBeDefined();
      expect(within(chip(name)).getByRole("button", { name: /reset/i })).toBeDefined();
    }
    expect(screen.getByTestId("assumption-reset-all")).toBeDefined();
    expect(chip("savings").textContent).toContain("Savings rate 45%");
    expect(chip("mortgages").textContent).toContain("loan paid down, offset counted");
  });
});

describe("AssumptionChips — inline percent editing", () => {
  it("types 45 and commits on Enter: one PUT, the chip redraws with a dot, lines invalidate", async () => {
    const user = userEvent.setup();
    serverLike(stored());
    const { invalidate } = renderChips(stored());

    await user.click(screen.getByRole("button", { name: "Savings rate: 0%. Edit" }));
    const input = screen.getByLabelText("Savings rate");
    await user.clear(input);
    await user.type(input, "45{Enter}");

    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({ savingsRateBps: 4500 }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["planning", "forecast", "networth"] }),
    );
    await waitFor(() => expect(chip("savings").textContent).toContain("Savings rate 45%"));
    expect(within(chip("savings")).getByRole("img", { name: "changed" })).toBeDefined();
    expect(within(chip("savings")).getByRole("button", { name: /reset/i })).toBeDefined();
  });

  it("blur commits only valid text; invalid text keeps the editor open and never PUTs", async () => {
    const user = userEvent.setup();
    serverLike(stored());
    renderChips(stored());

    await user.click(screen.getByRole("button", { name: "Super contributions: 0%. Edit" }));
    const input = screen.getByLabelText("Super contributions");
    await user.clear(input);
    await user.type(input, "abc");
    await user.tab();

    expect(screen.getByLabelText("Super contributions")).toBeDefined();
    expect((screen.getByLabelText("Super contributions") as HTMLInputElement).value).toBe("abc");
    expect(screen.getByLabelText("Super contributions").getAttribute("aria-invalid")).toBe("true");
    expect(api.upsertForecastAssumptions).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "12.5");
    await user.tab();
    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({ superRateBps: 1250 }),
    );
  });

  it("refuses 101 with the invalid state", async () => {
    const user = userEvent.setup();
    renderChips(stored());
    await user.click(screen.getByRole("button", { name: "Savings rate: 0%. Edit" }));
    const input = screen.getByLabelText("Savings rate");
    await user.clear(input);
    await user.type(input, "101{Enter}");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.upsertForecastAssumptions).not.toHaveBeenCalled();
  });

  it("Escape cancels without a PUT", async () => {
    const user = userEvent.setup();
    renderChips(stored());
    await user.click(screen.getByRole("button", { name: "Savings rate: 0%. Edit" }));
    const input = screen.getByLabelText("Savings rate");
    await user.clear(input);
    await user.type(input, "55{Escape}");
    expect(api.upsertForecastAssumptions).not.toHaveBeenCalled();
    expect(screen.getByText("Savings rate 0%")).toBeDefined();
  });

  it("committing the value already stored PUTs nothing", async () => {
    const user = userEvent.setup();
    renderChips(stored({ savingsRateBps: 4500 }));
    await user.click(screen.getByRole("button", { name: "Savings rate: 45%. Edit" }));
    await user.tab();
    expect(api.upsertForecastAssumptions).not.toHaveBeenCalled();
  });

  it("the returns chip edits three percents with one PUT", async () => {
    const user = userEvent.setup();
    serverLike(stored());
    renderChips(stored());

    await user.click(
      screen.getByRole("button", { name: "Returns: low 0% · mid 0% · high 0%. Edit" }),
    );
    for (const [label, value] of [
      ["Low expected return", "3"],
      ["Mid expected return", "5"],
      ["High expected return", "7"],
    ] as const) {
      const input = screen.getByLabelText(label);
      await user.clear(input);
      await user.type(input, value);
    }
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({
        returnLowBps: 300,
        returnMidBps: 500,
        returnHighBps: 700,
      }),
    );
    expect(vi.mocked(api.upsertForecastAssumptions).mock.calls).toHaveLength(1);
    await waitFor(() =>
      expect(chip("returns").textContent).toContain("Returns: low 3% · mid 5% · high 7%"),
    );
  });
  it("the returns editor opens focused on the low field", async () => {
    const user = userEvent.setup();
    renderChips(stored());

    await user.click(
      screen.getByRole("button", { name: "Returns: low 0% · mid 0% · high 0%. Edit" }),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Low expected return"));
  });

  it("resets stay hidden while an editor is open, so one click cannot fire two PUTs", async () => {
    const user = userEvent.setup();
    renderChips(stored({ savingsRateBps: 4500, returnMidBps: 500, superRateBps: 1200 }));

    await user.click(screen.getByRole("button", { name: "Savings rate: 45%. Edit" }));
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
    expect(screen.queryByTestId("assumption-reset-all")).toBeNull();

    // Escape closes the editor and the resets come back, still unclicked.
    await user.keyboard("{Escape}");
    expect(
      within(chip("savings")).getByRole("button", { name: "Reset savings rate" }),
    ).toBeDefined();
    expect(screen.getByTestId("assumption-reset-all")).toBeDefined();
    expect(api.upsertForecastAssumptions).not.toHaveBeenCalled();
  });
});

describe("AssumptionChips — reset", () => {
  const severalChanged = () =>
    stored({
      savingsRateBps: 4500,
      returnLowBps: 300,
      returnMidBps: 500,
      returnHighBps: 700,
      superRateBps: 1200,
      mortgages: [
        {
          accountId: "loan-1",
          countOffset: true,
          annualRatePercent: "6.175",
          monthlyRepaymentCents: 342_100,
        },
      ],
    });

  it("a chip reset PUTs exactly that chip's fields at their defaults", async () => {
    const user = userEvent.setup();
    serverLike(severalChanged());
    renderChips(severalChanged());

    await user.click(within(chip("savings")).getByRole("button", { name: "Reset savings rate" }));
    await waitFor(() => expect(api.upsertForecastAssumptions).toHaveBeenCalled());
    expect(vi.mocked(api.upsertForecastAssumptions).mock.calls).toEqual([[{ savingsRateBps: 0 }]]);
    await waitFor(() => expect(chip("savings").textContent).toContain("Savings rate 0%"));
    // The other chips keep their stored values and dots.
    expect(within(chip("super")).getByRole("img", { name: "changed" })).toBeDefined();
  });

  it("the mortgage chip reset PUTs mortgages: [] only", async () => {
    const user = userEvent.setup();
    serverLike(severalChanged());
    renderChips(severalChanged());

    await user.click(within(chip("mortgages")).getByRole("button", { name: "Reset mortgages" }));
    await waitFor(() => expect(api.upsertForecastAssumptions).toHaveBeenCalled());
    expect(vi.mocked(api.upsertForecastAssumptions).mock.calls).toEqual([[{ mortgages: [] }]]);
    await waitFor(() => expect(chip("mortgages").textContent).toBe("No mortgage paid down"));
  });

  it("Reset all PUTs every scalar at 0 and an empty mortgage list; the dots vanish", async () => {
    const user = userEvent.setup();
    serverLike(severalChanged());
    renderChips(severalChanged());

    await user.click(screen.getByTestId("assumption-reset-all"));
    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({
        savingsRateBps: 0,
        returnLowBps: 0,
        returnMidBps: 0,
        returnHighBps: 0,
        superRateBps: 0,
        mortgages: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("img", { name: "changed" })).toBeNull());
    expect(screen.queryByTestId("assumption-reset-all")).toBeNull();
  });
});

describe("AssumptionChips — the mortgage popover", () => {
  const loan = (id: string, name: string, type: AccountView["type"] = "home_loan"): AccountView =>
    ({
      id,
      name,
      type,
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      owners: [],
      pool: "shared",
      lastImport: null,
    }) as AccountView;

  const withLoans = () =>
    stored({
      mortgages: [
        {
          accountId: "loan-1",
          countOffset: true,
          annualRatePercent: "6.175",
          monthlyRepaymentCents: 342_100,
        },
      ],
    });

  beforeEach(() => {
    vi.mocked(api.listAccounts).mockResolvedValue([
      loan("loan-1", "35 Hawthorne St"),
      loan("loan-2", "Rear cottage"),
      loan("acc-1", "Everyday", "transaction"),
    ]);
  });

  it("one row per visible home_loan, checkboxes reflecting the stored selection", async () => {
    const user = userEvent.setup();
    renderChips(withLoans());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    const paid1 = await screen.findByRole("checkbox", { name: "35 Hawthorne St paid down" });
    expect((paid1 as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "35 Hawthorne St offset counted" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Rear cottage paid down" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    // The offset box means nothing for a loan that is not paid down.
    expect(
      (screen.getByRole("checkbox", { name: "Rear cottage offset counted" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    // A non-home_loan account never shows.
    expect(screen.queryByRole("checkbox", { name: /Everyday/ })).toBeNull();
  });

  it("toggling a loan paid down PUTs the full list, echoing stored terms for retained loans", async () => {
    const user = userEvent.setup();
    serverLike(withLoans());
    renderChips(withLoans());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Rear cottage paid down" }));

    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 342_100,
          },
          { accountId: "loan-2", countOffset: false },
        ],
      }),
    );
    await waitFor(() =>
      expect(
        within(chip("mortgages")).getByRole("button", {
          name: "Mortgages: 35 Hawthorne St loan paid down, offset counted · Rear cottage loan paid down. Edit",
        }),
      ).toBeDefined(),
    );
    expect(within(chip("mortgages")).getByRole("img", { name: "changed" })).toBeDefined();
  });

  it("toggling the offset PUTs the whole list with the flipped flag", async () => {
    const user = userEvent.setup();
    serverLike(withLoans());
    renderChips(withLoans());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await user.click(
      await screen.findByRole("checkbox", { name: "35 Hawthorne St offset counted" }),
    );

    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: false,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 342_100,
          },
        ],
      }),
    );
  });

  it("carries stored rows for loans that are not in the visible list, so a toggle never deletes them", async () => {
    const user = userEvent.setup();
    const state = stored({
      mortgages: [
        {
          accountId: "loan-1",
          countOffset: true,
          annualRatePercent: "6.175",
          monthlyRepaymentCents: 342_100,
        },
        {
          accountId: "old-loan",
          countOffset: false,
          annualRatePercent: "5.5",
          monthlyRepaymentCents: 200_000,
        },
      ],
    });
    serverLike(state);
    renderChips(state);

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Rear cottage paid down" }));

    // "old-loan" is stored but not a visible account — the wholesale PUT must echo it as-is.
    await waitFor(() =>
      expect(api.upsertForecastAssumptions).toHaveBeenCalledWith({
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 342_100,
          },
          { accountId: "loan-2", countOffset: false },
          {
            accountId: "old-loan",
            countOffset: false,
            annualRatePercent: "5.5",
            monthlyRepaymentCents: 200_000,
          },
        ],
      }),
    );
  });

  it("a failed mortgage PUT alerts and the chip keeps the stored selection", async () => {
    const user = userEvent.setup();
    vi.mocked(api.upsertForecastAssumptions).mockRejectedValue(new Error("not found"));
    renderChips(withLoans());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Rear cottage paid down" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be saved");
    await waitFor(() =>
      expect(chip("mortgages").textContent).toContain(
        "35 Hawthorne St loan paid down, offset counted",
      ),
    );
    // The failed toggle leaves no trace: the checkbox falls back to the stored selection.
    expect(
      (screen.getByRole("checkbox", { name: "Rear cottage paid down" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("a failed accounts fetch says so, instead of claiming there are no home loans", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAccounts).mockRejectedValue(new Error("offline"));
    renderChips(stored());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    const notice = await screen.findByText(/could not be loaded/i);
    expect(notice.textContent).toContain("reload");
    expect(screen.queryByText("No home loans yet")).toBeNull();
  });

  it("closes on Escape and on a click outside the chip", async () => {
    const user = userEvent.setup();
    renderChips(withLoans());

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await screen.findByRole("checkbox", { name: "35 Hawthorne St paid down" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "35 Hawthorne St paid down" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Mortgages:.*Edit/ }));
    await screen.findByRole("checkbox", { name: "35 Hawthorne St paid down" });
    await user.click(screen.getByText("Assumptions"));
    expect(screen.queryByRole("checkbox", { name: "35 Hawthorne St paid down" })).toBeNull();
  });
});

describe("AssumptionChips — a failed PUT", () => {
  it("alerts and the chips keep showing the stored values", async () => {
    const user = userEvent.setup();
    vi.mocked(api.upsertForecastAssumptions).mockRejectedValue(
      new Error("The demo plan is read-only"),
    );
    renderChips(stored());

    await user.click(screen.getByRole("button", { name: "Savings rate: 0%. Edit" }));
    const input = screen.getByLabelText("Savings rate");
    await user.clear(input);
    await user.type(input, "45{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be saved");
    expect(chip("savings").textContent).toBe("Savings rate 0%");
    expect(screen.queryByRole("img", { name: "changed" })).toBeNull();
  });
});
