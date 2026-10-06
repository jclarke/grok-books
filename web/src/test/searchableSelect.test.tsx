import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "../components/Modal";
import { SearchableSelect, matchesQuery } from "../components/SearchableSelect";
import type { SelectOption } from "../components/Select";
import { session as businessSession } from "./fixtures";
import { mockApi, type Call } from "./mockApi";
import * as px from "./personalFixtures";
import { renderApp } from "./render";

const OPTIONS: SelectOption[] = [
  { value: "", label: "All categories" },
  { value: "1", label: "Paycheck", group: "Income" },
  { value: "3", label: "Mortgage", group: "Housing" },
  { value: "4", label: "Groceries", group: "Food" },
  { value: "5", label: "Dining out", group: "Food" },
  { value: "9", label: "Closed", group: "Food", disabled: true },
  { value: "10", label: "Other", group: "Housing" },
  { value: "11", label: "Other", group: "Food" },
];

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchableSelect
      label="Category"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** Options in the open SearchableSelect list (native selects elsewhere also have options). */
function optionNames(): string[] {
  const listbox = screen.queryByRole("listbox");
  return listbox ? within(listbox).queryAllByRole("option").map((option) => option.textContent ?? "") : [];
}

describe("SearchableSelect", () => {
  it("matches each word of the query against Group/Name, in any order", () => {
    const dining = OPTIONS[4];
    expect(matchesQuery(dining, "din")).toBe(true);
    expect(matchesQuery(dining, "FOOD")).toBe(true);
    expect(matchesQuery(dining, "out food")).toBe(true);
    expect(matchesQuery(dining, "food/din")).toBe(true);
    expect(matchesQuery(dining, "housing out")).toBe(false);
    expect(matchesQuery(dining, "   ")).toBe(true);
  });

  it("is a labelled combobox that shows the current value while closed", () => {
    render(<Harness initial="4" />);
    const input = screen.getByRole("combobox", { name: "Category" });
    expect(input).toHaveValue("Groceries");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("adds the group when two options share a label", () => {
    render(<Harness initial="11" />);
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Food / Other");
  });

  it("opens with every option under its group heading, empty option first", async () => {
    const user = userEvent.setup();
    render(<Harness initial="4" />);
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "Category" });
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(optionNames()[0]).toBe("All categories");
    const food = screen.getByRole("group", { name: "Food" });
    expect(within(food).getAllByRole("option").map((option) => option.textContent)).toEqual(["Groceries", "Dining out", "Closed", "Other"]);
    expect(screen.getByRole("group", { name: "Income" })).toBeInTheDocument();
    // The selected option is marked and active.
    const groceries = screen.getByRole("option", { name: "Groceries" });
    expect(groceries).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", groceries.id);
    expect(screen.getByRole("option", { name: "Closed" })).toHaveAttribute("aria-disabled", "true");
  });

  it("filters by substring on group and name, hides empty groups, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.type(input, "food");
    expect(optionNames()).toEqual(["Groceries", "Dining out", "Closed", "Other"]);
    expect(screen.queryByRole("group", { name: "Housing" })).toBeNull();
    await user.clear(input);
    await user.type(input, "out din");
    expect(optionNames()).toEqual(["Dining out"]);
    await user.clear(input);
    await user.type(input, "MORT");
    expect(optionNames()).toEqual(["Mortgage"]);
    expect(screen.getByRole("group", { name: "Housing" })).toBeInTheDocument();
    await user.type(input, "zzz");
    expect(optionNames()).toEqual([]);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("moves with the arrow keys, Home and End, skips disabled options, and selects with Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="4" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const activeName = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent;
    expect(activeName()).toBe("Groceries");
    await user.keyboard("{ArrowDown}");
    expect(activeName()).toBe("Dining out");
    await user.keyboard("{ArrowDown}");
    expect(activeName()).toBe("Other");
    await user.keyboard("{Home}");
    expect(activeName()).toBe("All categories");
    await user.keyboard("{End}");
    expect(activeName()).toBe("Other");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(activeName()).toBe("Groceries");
    await user.keyboard("{ArrowUp}");
    expect(activeName()).toBe("Other");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("10");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Housing / Other");
  });

  it("selects the first match with Enter after typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "groc{Enter}");
    expect(onChange).toHaveBeenCalledWith("4");
  });

  it("closes with Escape and restores the value without changing it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="5" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.type(input, "mort");
    expect(input).toHaveValue("mort");
    await user.keyboard("{ArrowDown}{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Dining out");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it("closes on Tab and on a click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness initial="5" />
        <button type="button">elsewhere</button>
      </div>,
    );
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.click(input);
    await user.tab();
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("Dining out");
  });

  it("selects with a click, including the empty option", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="5" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Mortgage" }));
    expect(onChange).toHaveBeenLastCalledWith("3");
    expect(input).toHaveValue("Mortgage");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "All categories" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("All categories");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Closed" }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does nothing when disabled", async () => {
    const user = userEvent.setup();
    render(<SearchableSelect label="Category" value="4" disabled options={OPTIONS} />);
    const input = screen.getByRole("combobox", { name: "Category" });
    expect(input).toBeDisabled();
    await user.click(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes only its list on Escape inside a drawer", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Drawer open onClose={onClose} title="Edit">
        <Harness initial="4" />
      </Drawer>,
    );
    const input = screen.getByRole("combobox", { name: "Category" });
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("searchable category selects in the app", () => {
  type Handler = (call: Call) => unknown;
  const personal: Record<string, Handler> = {
    "GET /api/session": (call) => (call.query.get("mode") === "personal" ? px.personalSession : businessSession),
    "GET /api/personal/status": () => ({ ok: true, ready: true, account_count: 2, transaction_count: 300, setup_steps: [] }),
    "GET /api/personal/transactions": () => px.ptxnPage,
    "POST /api/personal/categorize": () => ({ ok: true, result: {}, review_count: 2 }),
  };

  it("filters personal transactions by a searched category and keeps it selected", async () => {
    const calls = mockApi(personal);
    const user = userEvent.setup();
    renderApp("/personal/transactions?category_id=4");
    await screen.findAllByText("Kroger");
    const filter = screen.getByRole("combobox", { name: "Category" });
    expect(filter).toHaveValue("Groceries");
    await user.click(filter);
    expect(optionNames()[0]).toBe("All categories");
    await user.type(filter, "food din");
    expect(optionNames()).toEqual(["Dining out"]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls.some((call) => call.path === "/api/personal/transactions" && call.query.get("category_id") === "5")).toBe(true));
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Dining out");
  });

  it("assigns a category to a personal transaction from its row", async () => {
    const calls = mockApi(personal);
    const user = userEvent.setup();
    renderApp("/personal/transactions");
    const row = await screen.findByRole("combobox", { name: "Category for Kroger" });
    await user.click(row);
    await user.type(row, "subs");
    expect(screen.getByRole("group", { name: "Subscriptions" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Subscriptions" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/api/personal/categorize")).toBe(true));
    expect(calls.find((call) => call.path === "/api/personal/categorize")?.body).toEqual({ txn_id: "p1", category_id: 6 });
    // Picking an option in a row must not also open the row's drawer.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("picks a category in the business rule drawer", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/transactions");
    await screen.findByText("ZZZ QUEUE ONE");
    await user.click(screen.getByRole("button", { name: "Create rule from ZZZ QUEUE ONE" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a rule" });
    const category = within(dialog).getByRole("combobox", { name: "Category" });
    expect(category).toHaveValue("Office/Other");
    await user.click(category);
    await user.type(category, "operating soft");
    expect(optionNames()).toEqual(["Software & Licenses"]);
    await user.keyboard("{Enter}");
    expect(category).toHaveValue("Software & Licenses");
    expect(screen.getByRole("dialog", { name: "Create a rule" })).toBeInTheDocument();
    await within(dialog).findByText("3 matches");
    await user.click(within(dialog).getByRole("button", { name: /Save rule/ }));
    await waitFor(() => expect(calls.some((call) => call.path === "/api/classify" && call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.path === "/api/classify")?.body).toMatchObject({ save_rule: true, category: "Software & Licenses" });
  });
});
