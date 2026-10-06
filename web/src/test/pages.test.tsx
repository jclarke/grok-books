import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CHECKING } from "./fixtures";
import { mockApi } from "./mockApi";
import { renderApp } from "./render";

const PAGES: [string, string, string | RegExp][] = [
  ["/", "Dashboard", "Revenue, expenses & net income"],
  ["/transactions", "Transactions", "ZZZ HOSTING"],
  ["/accounts", "Accounts", "Bank and cash"],
  [`/accounts/${CHECKING}`, "Bank 1111", "ZZZ HOSTING"],
  ["/reports", "Reports", "Schedule C-style summary"],
  ["/reports/pnl", "Profit & Loss", "Net Income"],
  ["/reports/schedule-c", "Schedule C-style summary", "Gross receipts or sales"],
  ["/reports/cash-flow", "Cash flow", "Gross receipts or sales"],
  ["/vendors", "Vendors", "ZZZ SOFTWARE"],
  ["/review", "Review inbox", "ZZZ QUEUE TWO"],
  ["/calendar", "Calendar & bills", "This is an estimate."],
  ["/rules", "Rules", "OLD THING"],
  ["/audit", "Audit log", "reserve_cents"],
  ["/settings", "Settings", "Cash reserve"],
  ["/no-such-page", "Page not found", "There's no page at this address"],
];

describe("page smoke tests", () => {
  beforeEach(() => {
    mockApi();
  });

  it.each(PAGES)("%s renders its heading and data", async (url, heading, content) => {
    renderApp(url);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect((await screen.findAllByText(content)).length).toBeGreaterThan(0);
  });

  it("shows the app shell with a live review badge and the product name", async () => {
    renderApp("/");
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByLabelText("2 transactions need review")).toBeInTheDocument();
    expect(screen.getByText("Books")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search transactions, vendors, and accounts/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Business")).toHaveValue("all");
  });

  it("has no owner-draw KPI or mortgage anywhere on the dashboard", async () => {
    renderApp("/");
    await screen.findByText("Net margin");
    expect(screen.queryByText(/owner draw/i)).toBeNull();
    expect(screen.queryByText(/mortgage/i)).toBeNull();
  });

  it("keeps owner draws below the line in the P&L", async () => {
    renderApp("/reports/pnl");
    await screen.findByText("Below the line");
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const net = rows.findIndex((text) => text.startsWith("Net Income"));
    const draws = rows.findIndex((text) => text.startsWith("Owner Draws"));
    expect(net).toBeGreaterThan(-1);
    expect(draws).toBeGreaterThan(net);
  });

  it("shows an error state when the API fails", async () => {
    mockApi({ "GET /api/dashboard": () => { throw new Error("db locked"); } });
    renderApp("/");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 4000 });
  });
});
