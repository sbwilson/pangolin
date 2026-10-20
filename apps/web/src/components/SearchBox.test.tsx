// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox.tsx";

describe("SearchBox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders with initial value and debounces typing", () => {
    const onChange = vi.fn();
    render(<SearchBox value="" resetKey={0} onChange={onChange} />);

    const input = screen.getByLabelText("Search transactions");
    expect(input).toBeDefined();

    fireEvent.change(input, { target: { value: "coffee" } });

    // Has not called yet due to debounce
    expect(onChange).not.toHaveBeenCalled();

    // Fast-forward debounce timer (300ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledWith("coffee");
  });

  it("updates text when value prop changes from outside", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchBox value="initial" resetKey={0} onChange={onChange} />);

    const input = screen.getByLabelText("Search transactions") as HTMLInputElement;
    expect(input.value).toBe("initial");

    rerender(<SearchBox value="external-update" resetKey={0} onChange={onChange} />);
    expect(input.value).toBe("external-update");
  });

  it("resets text when resetKey changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchBox value="" resetKey={0} onChange={onChange} />);

    const input = screen.getByLabelText("Search transactions") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stale typing" } });
    expect(input.value).toBe("stale typing");

    rerender(<SearchBox value="" resetKey={1} onChange={onChange} />);
    expect(input.value).toBe("");
  });

  it("sends undefined when input is cleared", () => {
    const onChange = vi.fn();
    render(<SearchBox value="coffee" resetKey={0} onChange={onChange} />);

    const input = screen.getByLabelText("Search transactions");
    fireEvent.change(input, { target: { value: "" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
