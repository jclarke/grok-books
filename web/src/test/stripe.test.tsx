import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { navFor, routeEnabled } from "../lib/nav";
import { normalizeSiteConfig } from "../lib/siteConfig";
import * as fx from "./fixtures";
import { mockApi } from "./mockApi";
import { renderApp } from "./render";
import { stripeConfig, stripeNotReady, stripePayouts, stripeSummary } from "./stripeFixtures";

const OFF = { whmcs: true, margins: true };
const ON = { whmcs: true, margins: true, stripe: true };

function stripeCalls(calls: ReturnType<typeof mockApi>) {
  return calls.filter((call) => call.path.startsWith("/api/stripe"));
}

describe("Stripe feature flag", () => {
  it("normalizes features.stripe: absent or anything but true is off", () => {
    expect(normalizeSiteConfig({}).features.stripe).toBeUndefined();
    expect(normalizeSiteConfig({ features: { stripe: "yes" as unknown as boolean } }).features.stripe).toBeUndefined();
    expect(normalizeSiteConfig({ features: { stripe: false } }).features.stripe).toBeUndefined();
    expect(normalizeSiteConfig({ features: { stripe: true } }).features.stripe).toBe(true);
  });

  it("keeps stripe accounts only when Stripe is on", () => {
    const accounts = [{ name: "main", label: "Stripe", business: "general" }];
    expect(normalizeSiteConfig({ ...fx.siteConfig, stripe_accounts: accounts }).stripe_accounts).toEqual([]);
    expect(normalizeSiteConfig(fx.siteConfig).stripe_accounts).toEqual([]);
    expect(normalizeSiteConfig(stripeConfig).stripe_accounts).toEqual(accounts);
  });

  it("gates the nav item and the route", () => {
    expect(navFor("business", OFF).some((item) => item.to === "/stripe")).toBe(false);
    expect(navFor("business", { ...OFF, stripe: false }).some((item) => item.to === "/stripe")).toBe(false);
    expect(routeEnabled("/stripe", OFF)).toBe(false);
    expect(navFor("business", ON).find((item) => item.to === "/stripe")).toMatchObject({ label: "Stripe", section: "Stripe" });
    expect(routeEnabled("/stripe", ON)).toBe(true);
    expect(navFor("personal", ON).some((item) => item.to === "/stripe")).toBe(false);
  });
});

describe("Stripe turned off (the default)", () => {
  it("has no nav item, no dashboard card, no palette entry, and never asks the Stripe API", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText("Net margin");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Stripe" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Stripe details" })).toBeNull();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "stripe");
    expect(screen.queryByRole("option", { name: /Stripe revenue, fees, and payouts/ })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stripeCalls(calls)).toHaveLength(0);
  });

  it("answers /stripe with the not-found page", async () => {
    const calls = mockApi();
    renderApp("/stripe");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stripeCalls(calls)).toHaveLength(0);
  });
});

describe("Stripe turned on", () => {
  it("lists Stripe in the sidebar and the command palette", async () => {
    mockApi({ "GET /api/config": () => stripeConfig });
    const user = userEvent.setup();
    renderApp("/stripe");
    expect(await screen.findByRole("heading", { level: 1, name: "Stripe" })).toBeInTheDocument();
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Stripe" })).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "stripe");
    expect(await screen.findByRole("option", { name: /Stripe revenue, fees, and payouts/ })).toBeInTheDocument();
  });

  it("shows KPIs, months, payouts with status badges, bank-only deposits, and CSV links", async () => {
    const calls = mockApi({ "GET /api/config": () => stripeConfig });
    renderApp("/stripe?start=2026-01-01&end=2026-10-08&business=general");
    expect(await screen.findByRole("heading", { level: 1, name: "Stripe" })).toBeInTheDocument();

    const kpis = await screen.findByRole("region", { name: "Stripe totals" });
    expect(within(kpis).getByText("$300.00")).toBeInTheDocument();
    expect(within(kpis).getAllByText("$50.00").length).toBeGreaterThan(0);
    expect(within(kpis).getByText("$12.00")).toBeInTheDocument();
    expect(within(kpis).getByText("4.00% of gross")).toBeInTheDocument();
    expect(within(kpis).getByText("$238.00")).toBeInTheDocument();

    // Capital repayments are nonzero in the fixture.
    expect(screen.getByRole("heading", { name: "Stripe Capital" })).toBeInTheDocument();
    // One account: no per-account table.
    expect(screen.queryByRole("table", { name: "Stripe figures by account" })).toBeNull();

    const months = screen.getByRole("table", { name: "Stripe figures by month" });
    expect(within(months).getByText("Sep 2026")).toBeInTheDocument();
    expect(within(months).getByText("Aug 2026")).toBeInTheDocument();

    const payouts = await screen.findByRole("table", { name: "Stripe payouts and the bank deposits they matched" });
    expect(within(payouts).getByText("po_TEST0001")).toBeInTheDocument();
    expect(within(payouts).getByText("Matched")).toHaveClass("badge--pos");
    expect(within(payouts).getByText("In transit")).toHaveClass("badge--info");
    expect(within(payouts).getByText("Unmatched")).toHaveClass("badge--warn");
    expect(within(payouts).getByText("no bank deposit of $50.00 within 3 days")).toBeInTheDocument();
    const matchedRow = within(payouts).getByText("po_TEST0001").closest("tr") as HTMLElement;
    expect(within(matchedRow).getByText(/Bank 0101/)).toBeInTheDocument();

    const bankOnly = screen.getByRole("table", { name: "Stripe-looking bank deposits with no payout" });
    expect(within(bankOnly).getByText("STRIPE TRANSFER")).toBeInTheDocument();
    expect(within(bankOnly).getByText("$25.00")).toBeInTheDocument();

    for (const [name, table] of [["Months CSV", "summary"], ["Accounts CSV", "accounts"], ["Payouts CSV", "payouts"], ["Bank only CSV", "bank-only"]]) {
      const href = screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href") ?? "";
      expect(href).toMatch(new RegExp(`^/export/stripe/${table}\\.csv\\?`));
      expect(href).toContain("start=2026-01-01");
      expect(href).toContain("end=2026-10-08");
      expect(href).toContain("business=general");
    }

    const summary = calls.find((call) => call.path === "/api/stripe/summary");
    expect(summary?.query.get("start")).toBe("2026-01-01");
    expect(summary?.query.get("end")).toBe("2026-10-08");
    expect(summary?.query.get("business")).toBe("general");
    expect(calls.some((call) => call.path === "/api/stripe/payouts")).toBe(true);
  });

  it("shows a per-account table when there is more than one account", async () => {
    const second = { ...stripeSummary.accounts[0], name: "eu", label: "Stripe EU" };
    mockApi({ "GET /api/config": () => stripeConfig, "GET /api/stripe/summary": () => ({ ...stripeSummary, accounts: [...stripeSummary.accounts, second] }) });
    renderApp("/stripe");
    const table = await screen.findByRole("table", { name: "Stripe figures by account" });
    expect(within(table).getByText("Stripe EU")).toBeInTheDocument();
  });

  it("labels chart months like the dashboard, with the year when the months span years", async () => {
    const months = (list: string[]) => list.map((month) => ({ ...stripeSummary.months[0], month }));
    mockApi({ "GET /api/config": () => stripeConfig });
    const { unmount } = renderApp("/stripe");
    const chart = await screen.findByRole("img", { name: /by month/ });
    expect(within(chart).getByText("Aug")).toBeInTheDocument();
    expect(within(chart).queryByText(/26\//)).toBeNull();
    unmount();

    mockApi({ "GET /api/config": () => stripeConfig, "GET /api/stripe/summary": () => ({ ...stripeSummary, months: months(["2025-12", "2026-01"]) }) });
    renderApp("/stripe");
    const spanning = await screen.findByRole("img", { name: /by month/ });
    expect(within(spanning).getByText("Dec 2025")).toBeInTheDocument();
  });

  it("asks for an import when nothing has been imported", async () => {
    mockApi({ "GET /api/config": () => stripeConfig, "GET /api/stripe/summary": () => stripeNotReady, "GET /api/stripe/payouts": () => ({ ...stripePayouts, ready: false, rows: [], bank_only: [] }) });
    renderApp("/stripe");
    expect(await screen.findByText("Stripe has not been imported yet")).toBeInTheDocument();
    expect(screen.getByText("bin/hpbooks stripe import sync/inbox/YYYY-MM-DD/stripe/")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Payouts CSV/ })).toBeNull();
    expect(screen.queryByRole("table", { name: "Stripe payouts and the bank deposits they matched" })).toBeNull();
  });

  it("shows the Stripe card on the dashboard for the dashboard's range", async () => {
    const calls = mockApi({ "GET /api/config": () => stripeConfig });
    renderApp("/?start=2026-09-01&end=2026-09-30");
    const link = await screen.findByRole("link", { name: "Stripe details" });
    expect(link.getAttribute("href")).toMatch(/^\/stripe\?/);
    const card = link.closest("section") as HTMLElement;
    expect(within(card).getByText("$300.00")).toBeInTheDocument();
    expect(within(card).getByText("$238.00")).toBeInTheDocument();
    expect(within(card).getByText("1 payout unmatched · 1 Stripe-looking deposit not matched")).toBeInTheDocument();
    const summary = calls.find((call) => call.path === "/api/stripe/summary");
    expect(summary?.query.get("start")).toBe("2026-09-01");
    expect(summary?.query.get("end")).toBe("2026-09-30");
  });

  it("leaves zero parts out of the dashboard card's payout note", async () => {
    mockApi({ "GET /api/config": () => stripeConfig, "GET /api/stripe/summary": () => ({ ...stripeSummary, open_payouts: 0, bank_only: 13 }) });
    renderApp("/");
    const link = await screen.findByRole("link", { name: "Stripe details" });
    const card = link.closest("section") as HTMLElement;
    const note = within(card).getByText("13 Stripe-looking deposits not matched");
    expect(note.closest("a")?.getAttribute("href")).toBe(link.getAttribute("href"));
  });

  it("leaves the dashboard card out until something has been imported", async () => {
    const calls = mockApi({ "GET /api/config": () => stripeConfig, "GET /api/stripe/summary": () => stripeNotReady });
    renderApp("/");
    await screen.findByText("Net margin");
    await waitFor(() => expect(calls.some((call) => call.path === "/api/stripe/summary")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("link", { name: "Stripe details" })).toBeNull();
  });
});
