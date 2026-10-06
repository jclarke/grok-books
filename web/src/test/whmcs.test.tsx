import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { MockResponse, mockApi } from "./mockApi";
import { renderApp } from "./render";

const PAGES: [string, string, string | RegExp][] = [
  ["/whmcs", "WHMCS billing", "could not open the SSH tunnel"],
  ["/whmcs/revenue", "WHMCS revenue", "Pro Plan"],
  ["/whmcs/mrr", "MRR & ARR", "Starter Plan"],
  ["/whmcs/churn", "Churn & cancellations", "Moved to another provider"],
  ["/whmcs/refunds", "Refunds", "Pro Plan"],
  ["/whmcs/collections", "Failed payments & collections", "181-365 days"],
  ["/whmcs/reconciliation", "PayPal reconciliation", "Payment from Unmatched Payer"],
  ["/whmcs/customers", "Customers", "Find a customer"],
];

describe("WHMCS pages", () => {
  beforeEach(() => {
    mockApi();
  });

  it.each(PAGES)("%s renders its heading and data", async (url, heading, content) => {
    renderApp(url);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect((await screen.findAllByText(content)).length).toBeGreaterThan(0);
  });

  it("lists the WHMCS section in the sidebar and marks only the open page", async () => {
    renderApp("/whmcs/revenue");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByText("WHMCS")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Revenue" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Billing overview" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Customers" })).toBeInTheDocument();
  });

  it("shows MRR, customers, and last sync on the dashboard", async () => {
    renderApp("/");
    expect(await screen.findByText("Hosting billing (WHMCS)")).toBeInTheDocument();
    expect((await screen.findAllByText("$22.00")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Last sync/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Billing overview" })).toHaveLength(2);
  });

  it("asks for a sync when nothing has been imported", async () => {
    mockApi({
      "GET /api/whmcs/revenue": () => ({ ok: true, ready: false, brands: [] }),
      "GET /api/whmcs/summary": () => ({ ok: true, ready: false, mrr_cents: 0, arr_cents: 0, customers: 0, last_sync: null, brands: [] }),
    });
    renderApp("/whmcs/revenue");
    expect(await screen.findByText("WHMCS has not been synced yet")).toBeInTheDocument();
  });

  it("sends the brand and grouping to the API and links CSV exports", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/whmcs/revenue");
    await screen.findByText("Pro Plan");
    await user.click(screen.getByRole("radio", { name: "BrandB" }));
    await user.click(screen.getByRole("radio", { name: "Quarter" }));
    await waitFor(() => {
      const last = calls.filter((call) => call.path === "/api/whmcs/revenue").slice(-1)[0];
      expect(last?.query.get("brand")).toBe("BrandB");
      expect(last?.query.get("by")).toBe("quarter");
    });
    const csv = screen.getByRole("link", { name: /Plans CSV/ });
    expect(csv.getAttribute("href")).toMatch(/^\/export\/whmcs\/revenue-plans\.csv\?/);
    expect(csv.getAttribute("href")).toContain("brand=BrandB");
  });

  it("jumps back through WHMCS history with the period shortcuts", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/whmcs/churn");
    await screen.findAllByText("Legacy Plan");
    await user.click(screen.getByRole("radio", { name: "All history" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/api/whmcs/churn").slice(-1)[0]?.query.get("start")).toBe("2008-01-01"));
  });

  it("searches customers with a POST and opens the customer page", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/whmcs/customers");
    await user.type(await screen.findByLabelText("Search customers"), "alice");
    expect(await screen.findByText("Alice Example")).toBeInTheDocument();
    const search = calls.find((call) => call.method === "POST" && call.path === "/api/whmcs/customers/search");
    expect(search?.body).toMatchObject({ q: "alice", brand: "all" });
    expect(search?.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(calls.some((call) => call.query.toString().includes("alice"))).toBe(false);
    await user.click(screen.getByText("Alice Example"));
    expect(await screen.findByRole("heading", { level: 1, name: "Alice Example" })).toBeInTheDocument();
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.getAllByText("Starter Plan").length).toBeGreaterThan(0);
    expect(document.title).not.toContain("Alice");
  });

  it("links client numbers in reports to the customer page", async () => {
    renderApp("/whmcs/collections");
    const link = await screen.findByRole("link", { name: "#3" });
    expect(link.getAttribute("href")).toContain("/whmcs/customers/BrandA/3");
    expect(screen.queryByText("Alice Example")).toBeNull();
  });

  it("shows a not-found state for an unknown customer", async () => {
    mockApi({ "GET /api/whmcs/customers/BrandA/9": () => new MockResponse(404, { ok: false, error: "not found" }) });
    renderApp("/whmcs/customers/BrandA/9");
    expect(await screen.findByText("No BrandA client #9")).toBeInTheDocument();
  });

  it("filters reconciliation rows by status", async () => {
    const user = userEvent.setup();
    renderApp("/whmcs/reconciliation");
    await screen.findByText("Payment from Unmatched Payer");
    await user.click(screen.getByRole("radio", { name: "WHMCS only" }));
    expect(screen.queryByText("Payment from Unmatched Payer")).toBeNull();
    expect(screen.getByText("PPFAKE0007")).toBeInTheDocument();
    expect(screen.getAllByText("not matched").length).toBeGreaterThan(0);
  });
});
