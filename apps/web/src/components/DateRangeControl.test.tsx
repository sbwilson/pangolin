// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DateRange } from "../lib/date-range.ts";
import { DateRangeControl } from "./DateRangeControl.tsx";

afterEach(cleanup);

const TODAY = "2026-10-24";

function setup(range: DateRange) {
  const onChange = vi.fn<(range: DateRange) => void>();
  render(<DateRangeControl range={range} today={TODAY} onChange={onChange} />);
  return onChange;
}

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("DateRangeControl", () => {
  it("presses Quarter for a quarter, steps it, and disables next on the current one", async () => {
    const user = userEvent.setup();
    const onChange = setup({ from: "2026-10-01", to: "2026-12-31" });
    expect(screen.getByTestId("range-label").textContent).toBe("Oct – Dec 2026");
    expect(pressed("Quarter")).toBe("true");
    expect(pressed("FY to date")).toBe("false");
    expect(pressed("Custom")).toBe("false");
    expect(screen.getByRole("button", { name: "Next quarter" }).hasAttribute("disabled")).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Previous quarter" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-07-01", to: "2026-09-30" });
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("presses FY to date for a whole FY and steps it on to the current FY to date", async () => {
    const user = userEvent.setup();
    const onChange = setup({ from: "2025-07-01", to: "2026-06-30" });
    expect(pressed("FY to date")).toBe("true");
    expect(screen.getByTestId("range-label").textContent).toBe("FY2026");
    await user.click(screen.getByRole("button", { name: "Next year" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-07-01", to: TODAY });
  });

  it("emits the current quarter and FY to date from the presets", async () => {
    const user = userEvent.setup();
    const onChange = setup({ from: "2026-02-03", to: "2026-03-14" });
    await user.click(screen.getByRole("button", { name: "Quarter" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-12-31" });
    await user.click(screen.getByRole("button", { name: "FY to date" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-07-01", to: TODAY });
  });

  it("presses Custom for any other range, steps it by its length, and edits From and To", async () => {
    const user = userEvent.setup();
    const onChange = setup({ from: "2026-02-03", to: "2026-03-14" });
    expect(pressed("Custom")).toBe("true");
    expect(screen.getByTestId("range-label").textContent).toBe("3 Feb – 14 Mar 2026");
    await user.click(screen.getByRole("button", { name: "Next period" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-03-15", to: "2026-04-23" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-10" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-01-10", to: "2026-03-14" });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-05-01" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-02-03", to: "2026-05-01" });
    // A cleared or reversed end is not a range.
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens From and To when Custom is pressed on a preset range", async () => {
    const user = userEvent.setup();
    setup({ from: "2026-07-01", to: "2026-09-30" });
    expect(screen.queryByLabelText("From")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(pressed("Custom")).toBe("true");
    expect(pressed("Quarter")).toBe("false");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-07-01");
  });

  it("lets the unit decide again once the range moves after Custom was pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(range: DateRange) => void>();
    const { rerender } = render(
      <DateRangeControl
        range={{ from: "2026-07-01", to: "2026-09-30" }}
        today={TODAY}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom" }));
    expect(pressed("Custom")).toBe("true");
    // A chevron, back/forward or a link moves the range to another preset.
    rerender(
      <DateRangeControl
        range={{ from: "2026-04-01", to: "2026-06-30" }}
        today={TODAY}
        onChange={onChange}
      />,
    );
    expect(pressed("Quarter")).toBe("true");
    expect(pressed("Custom")).toBe("false");
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("gives each control its own From and To ids", () => {
    const onChange = vi.fn<(range: DateRange) => void>();
    const range = { from: "2026-02-03", to: "2026-03-14" };
    render(
      <>
        <DateRangeControl range={range} today={TODAY} onChange={onChange} />
        <DateRangeControl range={range} today={TODAY} onChange={onChange} />
      </>,
    );
    const ids = screen.getAllByLabelText("From").map((input) => input.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
