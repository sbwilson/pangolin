// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategorySummary, LedgerTag } from "../../api.ts";
import { CategoryCombobox } from "./category-combobox.tsx";
import { TagPicker } from "./tag-picker.tsx";

afterEach(cleanup);

const categories: CategorySummary[] = [
  { id: "c1", name: "Groceries", groupId: "g1", groupName: "Food" },
  { id: "c2", name: "Dining out", groupId: "g1", groupName: "Food" },
  { id: "c3", name: "Rent", groupId: "g2", groupName: "Housing" },
];

describe("CategoryCombobox", () => {
  it("filters by what is typed, groups the options, and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryCombobox categories={categories} value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Housing" })).toBeTruthy();
    await user.type(input, "din");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Dining out"]);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("clears the category with Uncategorised and shows the chosen name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryCombobox categories={categories} value="c3" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement;
    expect(input.value).toBe("Rent");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Uncategorised" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("closes on Escape without choosing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryCombobox categories={categories} value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TagPicker", () => {
  const tags: LedgerTag[] = [
    { id: "t1", name: "holiday" },
    { id: "t2", name: "gift" },
  ];

  it("adds and removes tags, reporting the whole set each time", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagPicker available={tags} selected={[tags[0] as LedgerTag]} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Add a tag" }));
    // The tag already on the split is not offered again.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["gift"]);
    await user.click(screen.getByRole("option", { name: "gift" }));
    expect(onChange).toHaveBeenLastCalledWith(["t1", "t2"]);
    await user.click(screen.getByRole("button", { name: "Remove tag holiday" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
