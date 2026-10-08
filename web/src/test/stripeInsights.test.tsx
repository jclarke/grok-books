import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { navFor, routeEnabled } from "../lib/nav";
import { MockResponse, mockApi } from "./mockApi";
import { renderApp } from "./render";
import { stripeCapitalCost, stripeConfig, stripeMetrics, stripeMetricsNotReady } from "./stripeFixtures";

const OFF = { whmcs: true, margins: true };
const ON = { whmcs: true, margins: true, stripe: true };
const URL = "/stripe/insights?start=2026-06-01&end=2026-09-30&business=general";

function metricsCalls(calls: ReturnType<typeof mockApi>) {
  return calls.filter((call) => call.path.startsWith("/api/stripe/metrics"));
}

/** The insights page at a URL; waits for the metrics to load (the focus month picker) unless `loaded` is false. */
async function insights(url = URL, overrides: Parameters<typeof mockApi>[0] = {}, loaded = true) {
  const calls = mockApi({ "GET /api/config": () => stripeConfig, ...overrides });
  renderApp(url);
  expect(await screen.findByRole("heading", { level: 1, name: "Stripe insights" })).toBeInTheDocument();
  if (loaded) await screen.findByLabelText("Focus month");
  return calls;
}

/** The three download links of an export group, by the group's name. */
function exportLinks(name: string) {
  const group = screen.getByRole("group", { name: `Export ${name}` });
  return within(group)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "");
}

describe("Stripe insights: navigation and the feature flag", () => {
  it("lists Insights under Stripe only when Stripe is on", () => {
    expect(navFor("business", OFF).some((item) => item.to === "/stripe/insights")).toBe(false);
    expect(routeEnabled("/stripe/insights", OFF)).toBe(false);
    const nav = navFor("business", ON);
    const index = nav.findIndex((item) => item.to === "/stripe/insights");
    expect(nav[index]).toMatchObject({ label: "Insights", section: "Stripe" });
    expect(nav[index - 1].to).toBe("/stripe");
    expect(routeEnabled("/stripe/insights", ON)).toBe(true);
    expect(navFor("personal", ON).some((item) => item.to === "/stripe/insights")).toBe(false);
  });

  it("is not found, with no nav link and no metrics request, when Stripe is off", async () => {
    const calls = mockApi();
    renderApp("/stripe/insights");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Insights" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(metricsCalls(calls)).toHaveLength(0);
  });

  it("marks only Insights current in the sidebar on the insights page", async () => {
    await insights();
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Stripe" })).not.toHaveAttribute("aria-current");
  });

  it("links to the insights from the Stripe page", async () => {
    mockApi({ "GET /api/config": () => stripeConfig });
    renderApp("/stripe?start=2026-01-01&end=2026-10-08&business=general");
    const link = await screen.findByRole("link", { name: /Open insights/ });
    expect(link.getAttribute("href")).toMatch(/^\/stripe\/insights\?/);
    expect(link.getAttribute("href")).toContain("business=general");
  });
});

describe("Stripe insights page", () => {
  it("asks the API for the range, business, and month, and shows the overview KPIs, bridge, and approximations", async () => {
    const calls = await insights(`${URL}&month=2026-08`);
    const kpis = await screen.findByRole("region", { name: "Stripe insights KPIs" });
    const kpi = (label: string) => within(kpis).getByRole("heading", { name: label }).closest("article") as HTMLElement;
    expect(within(kpi("MRR")).getByText("$1,500.00")).toBeInTheDocument();
    expect(within(kpi("ARR")).getByText("$18,000.00")).toBeInTheDocument();
    expect(within(kpi("Active customers")).getByText("12")).toBeInTheDocument();
    expect(within(kpi("ARPA")).getByText("$125.00")).toBeInTheDocument();
    expect(within(kpi("Customer churn")).getByText("10.0%")).toBeInTheDocument();
    expect(within(kpi("Customer churn")).getByText(/1 of 10 · 0 voluntary, 1 involuntary/)).toBeInTheDocument();
    expect(within(kpi("Revenue churn")).getByText("12.5%")).toBeInTheDocument();
    // No 12-month history: the focus month's NRR, said so.
    expect(within(kpi("NRR")).getByText("95.8%")).toBeInTheDocument();
    expect(within(kpi("NRR")).getByText(/12 months of history/)).toBeInTheDocument();
    expect(within(kpi("At-risk MRR")).getByText("$200.00")).toBeInTheDocument();
    expect(within(kpi("Effective fee rate")).getByText("3.00%")).toBeInTheDocument();
    expect(within(kpi("Capital APR")).getByText("18.4%")).toBeInTheDocument();

    const bridge = screen.getByRole("table", { name: "MRR bridge table, Aug 2026" });
    expect(within(bridge).getByText("Opening MRR").closest("tr")).toHaveTextContent("$1,200.00");
    expect(within(bridge).getByText("+ New").closest("tr")).toHaveTextContent("+$300.00");
    expect(within(bridge).getByText("− Churned").closest("tr")).toHaveTextContent("-$100.00");
    expect(within(bridge).getByText("Closing MRR").closest("tr")).toHaveTextContent("$1,500.00");
    expect(screen.getByRole("img", { name: "MRR bridge for Aug 2026" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Month-end MRR by month" })).toBeInTheDocument();

    const notes = screen.getByRole("complementary", { name: "Approximations" });
    expect(within(notes).getByText(/use the current items because the invoices for that period were not imported/)).toBeInTheDocument();

    const call = metricsCalls(calls).find((item) => item.path === "/api/stripe/metrics");
    expect(call?.query.get("start")).toBe("2026-06-01");
    expect(call?.query.get("end")).toBe("2026-09-30");
    expect(call?.query.get("business")).toBe("general");
    expect(call?.query.get("month")).toBe("2026-08");
  });

  it("wires every table's CSV, XLSX, and PDF links to the metrics export with the page's filters", async () => {
    await insights(`${URL}&tab=profit`);
    await screen.findByRole("table", { name: "Margin by product" });
    const links = exportLinks("margin by product");
    expect(links.map((href) => href.split("?")[0])).toEqual([
      "/api/stripe/metrics/export/margin.csv",
      "/api/stripe/metrics/export/margin.xlsx",
      "/api/stripe/metrics/export/margin.pdf",
    ]);
    for (const href of links) {
      const query = new URLSearchParams(href.split("?")[1]);
      expect(query.get("start")).toBe("2026-06-01");
      expect(query.get("end")).toBe("2026-09-30");
      expect(query.get("business")).toBe("general");
      // The server's focus month, so the file matches the screen.
      expect(query.get("month")).toBe("2026-08");
    }
    for (const [name, table] of [
      ["fees by method", "fees-methods"],
      ["fee rates by month", "fees"],
      ["Capital financings", "capital"],
      ["Capital withheld share", "capital-withheld"],
    ]) {
      expect(exportLinks(name)[0]).toMatch(new RegExp(`^/api/stripe/metrics/export/${table}\\.csv\\?`));
    }
    // The page-level export (with Print) is the KPI summary.
    const page = screen.getByRole("group", { name: "Export" });
    expect(within(page).getAllByRole("link")[0].getAttribute("href")).toMatch(/^\/api\/stripe\/metrics\/export\/summary\.csv\?/);
    expect(within(page).getByRole("button", { name: /Print/ })).toBeInTheDocument();
  });

  it("switches tabs through the URL, and the URL opens a tab", async () => {
    const user = userEvent.setup();
    await insights(`${URL}&tab=growth`);
    const tabs = screen.getByRole("radiogroup", { name: "Insights section" });
    expect(within(tabs).getByRole("radio", { name: "Growth and churn" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("img", { name: /MRR movement by month/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Stripe insights KPIs" })).toBeNull();

    await user.click(within(tabs).getByRole("radio", { name: "Cash and risk" }));
    expect(within(tabs).getByRole("radio", { name: "Cash and risk" })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByRole("table", { name: "Cash forecast by week" })).toBeInTheDocument();

    await user.click(within(tabs).getByRole("radio", { name: "Overview" }));
    expect(await screen.findByRole("region", { name: "Stripe insights KPIs" })).toBeInTheDocument();
  });

  it("shows movement, churn split, and the cohort heatmap with a customers / revenue toggle", async () => {
    const user = userEvent.setup();
    await insights(`${URL}&tab=growth`);
    const movement = screen.getByRole("table", { name: "MRR movement by month" });
    const aug = within(movement).getByText("Aug 2026").closest("tr") as HTMLElement;
    expect(aug).toHaveTextContent("$300.00");
    expect(aug).toHaveTextContent("+$300.00");
    const churn = screen.getByRole("table", { name: "Churn by month" });
    expect(within(churn).getByText("Aug 2026").closest("tr")).toHaveTextContent("10.0%");
    expect(screen.getByRole("img", { name: "Churned customers by month, voluntary and involuntary" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "NRR and GRR by month" })).toBeInTheDocument();

    const cohorts = screen.getByRole("table", { name: "Cohort retention by customers" });
    const june = within(cohorts).getByText("Jun 2026").closest("tr") as HTMLElement;
    const cell = within(june).getByText("80.0%");
    expect(cell).toHaveAttribute("data-heat", "80");
    expect(cell.getAttribute("style")).toContain("--heat: 36%");
    expect(exportLinks("cohorts")[0]).toMatch(/^\/api\/stripe\/metrics\/export\/cohorts\.csv\?/);

    await user.click(screen.getByRole("radio", { name: "Revenue" }));
    const revenue = await screen.findByRole("table", { name: "Cohort retention by revenue" });
    expect(within(within(revenue).getByText("Jun 2026").closest("tr") as HTMLElement).getByText("120%")).toBeInTheDocument();
    expect(exportLinks("cohorts")[0]).toMatch(/^\/api\/stripe\/metrics\/export\/cohort-revenue\.csv\?/);
  });

  it("shows margins per product, fees by method even with no ACH, the ACH estimate, and the Capital cost", async () => {
    await insights(`${URL}&tab=profit`);
    const margin = screen.getByRole("table", { name: "Margin by product" });
    const planA = within(margin).getByText("Plan A").closest("tr") as HTMLElement;
    for (const text of ["$3,000.00", "$90.00", "$200.00", "$60.00", "$300.00", "+$2,350.00", "78.3%"]) expect(planA).toHaveTextContent(text);
    expect(within(margin).getByText("Total").closest("tr")).toHaveTextContent("+$3,200.00");
    expect(screen.getByRole("list", { name: "Margin by product" })).toBeInTheDocument();

    const methods = screen.getByRole("table", { name: "Fees by payment method" });
    expect(within(methods).getByText("Link (card-funded)").closest("tr")).toHaveTextContent("3.00%");
    expect(within(methods).getByText("ACH (us_bank_account)").closest("tr")).toHaveTextContent("No charges");
    expect(screen.getByText(/No ACH \(us_bank_account\) charges in this range/)).toBeInTheDocument();

    const ach = screen.getByRole("region", { name: "Estimated ACH savings" });
    expect(within(ach).getByText("$88.00")).toBeInTheDocument();
    expect(within(ach).getByText("Estimate")).toBeInTheDocument();
    const assumptions = within(ach).getByRole("list", { name: "ACH savings assumptions" });
    expect(assumptions).toHaveTextContent("Link is 80.0% of this volume");
    expect(assumptions).toHaveTextContent("Stripe's list price for ACH Direct Debit (0.8%, at most $5 a charge)");

    const capital = screen.getByRole("region", { name: "Stripe Capital cost" });
    const loan = within(within(capital).getByRole("table", { name: "Stripe Capital financings and their APR" })).getByText("Capital loan 2026").closest("tr") as HTMLElement;
    expect(loan).toHaveTextContent("18.4%");
    expect(within(loan).getByText("Projected")).toBeInTheDocument();
    expect(within(capital).getByText(/monthly average 11.0% over 2 active months/)).toBeInTheDocument();
    expect(within(capital).queryByRole("note")).toBeNull();
  });

  it("warns when a Capital financing has no terms, on the overview and with the financings", async () => {
    const noTerms = { ...stripeCapitalCost, terms: false, apr_pct: null, effective_annual_pct: null, projected: false, remaining_cents: null, note: "APR unknown: add [[stripe.capital]] terms (principal and fee)" };
    const overrides = { "GET /api/stripe/metrics": () => ({ ...stripeMetrics, capital: { ...stripeMetrics.capital, financings: [noTerms] } }) };
    await insights(URL, overrides);
    const kpis = await screen.findByRole("region", { name: "Stripe insights KPIs" });
    const card = within(kpis).getByRole("heading", { name: "Capital APR" }).closest("article") as HTMLElement;
    expect(within(card).getByText("Terms needed")).toBeInTheDocument();
    expect(within(card).getByText(/Add \[\[stripe.capital\]\] terms/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: "Profit and fees" }));
    const capital = await screen.findByRole("region", { name: "Stripe Capital cost" });
    expect(within(capital).getByRole("note")).toHaveTextContent("APR unknown for Capital loan 2026: add [[stripe.capital]] terms (principal and fee)");
    expect(within(capital).getByText("No terms")).toBeInTheDocument();
  });

  it("flags refund spikes with a badge and a highlighted row, and shows recovery with invoices in progress", async () => {
    await insights(`${URL}&tab=cash`);
    const refunds = screen.getByRole("table", { name: "Refunds and disputes by product and month" });
    const badge = within(refunds).getByText("Spike");
    expect(badge).toHaveClass("badge--neg");
    const row = badge.closest("tr") as HTMLElement;
    expect(row).toHaveClass("row--spike");
    expect(row).toHaveTextContent("Aug 2026");
    expect(row).toHaveTextContent("Plan A");
    expect(row).toHaveTextContent("24.0%");
    expect(within(refunds).getAllByText("Spike")).toHaveLength(1);
    expect(screen.getByText(/Refund spike: Plan A, Aug 2026 \(24.0% against a 0.7% median\)/)).toBeInTheDocument();

    const recovery = screen.getByRole("table", { name: "Failed-payment recovery by month" });
    const aug = within(recovery).getByText("Aug 2026").closest("tr") as HTMLElement;
    expect(aug).toHaveTextContent("66.7%");
    expect(within(aug).getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("At-risk MRR now").nextElementSibling).toHaveTextContent("$200.00 · 2 past due or unpaid subscriptions");

    const top = screen.getByRole("list", { name: "Top customers by revenue" });
    expect(within(top).getByText("cus_TEST0001")).toBeInTheDocument();
    expect(screen.getByText("HHI (0–10,000)").nextElementSibling).toHaveTextContent("2,600 highly concentrated");
  });

  it("hides payback with a note when there is no CAC", async () => {
    await insights(`${URL}&tab=cash`);
    const ltv = screen.getByRole("region", { name: "Lifetime value" });
    expect(within(ltv).getByText("$4,000.00")).toBeInTheDocument();
    expect(within(ltv).queryByRole("heading", { name: "CAC payback" })).toBeNull();
    const note = screen.getAllByRole("note").find((item) => item.textContent?.includes("Payback is hidden")) as HTMLElement;
    expect(note).toHaveTextContent("Payback is hidden: there is no customer acquisition cost. Set [stripe.metrics] cac (per new customer) or cac_category in the config.");
  });

  it("shows the payback card when a CAC is configured", async () => {
    const withCac = { ...stripeMetrics, ltv: { ...stripeMetrics.ltv, cac_cents: 50000, cac_source: "config", payback_months: 5.0, notes: [] } };
    await insights(`${URL}&tab=cash`, { "GET /api/stripe/metrics": () => withCac });
    const ltv = screen.getByRole("region", { name: "Lifetime value" });
    const card = within(ltv).getByRole("heading", { name: "CAC payback" }).closest("article") as HTMLElement;
    expect(within(card).getByText("5 months")).toBeInTheDocument();
    expect(screen.queryByText(/Payback is hidden/)).toBeNull();
  });

  it("shows the cash forecast with its low point and the weekly inflows and outflows", async () => {
    await insights(`${URL}&tab=cash`);
    const chart = screen.getByRole("img", { name: /Forecast bank balance by day; lowest \$4,000.00 on Oct 10, 2026/ });
    expect(within(chart).getByText("Low $4,000, Oct 10")).toBeInTheDocument();
    const weekly = screen.getByRole("table", { name: "Cash forecast by week" });
    const first = within(weekly).getByText(/Oct 8 – Oct 14/).closest("tr") as HTMLElement;
    expect(first).toHaveClass("row--attention");
    expect(within(first).getByText("Low")).toBeInTheDocument();
    expect(first).toHaveTextContent("-$1,000.00");
    const second = within(weekly).getByText(/Oct 15 – Oct 21/).closest("tr") as HTMLElement;
    expect(second).toHaveTextContent("$1,300.00");
    expect(second).toHaveTextContent("-$100.00");
    expect(exportLinks("weekly forecast")[0]).toMatch(/^\/api\/stripe\/metrics\/export\/forecast-weekly\.csv\?/);
  });

  it("changes the focus month through the URL", async () => {
    const user = userEvent.setup();
    const calls = await insights();
    await screen.findByRole("region", { name: "Stripe insights KPIs" });
    await user.selectOptions(screen.getByLabelText("Focus month"), "2026-07");
    await waitFor(() => expect(metricsCalls(calls).some((call) => call.query.get("month") === "2026-07")).toBe(true));
  });

  it("asks for the billing objects when none have been imported", async () => {
    await insights(URL, { "GET /api/stripe/metrics": () => stripeMetricsNotReady }, false);
    expect(await screen.findByText("No subscription data yet")).toBeInTheDocument();
    expect(screen.getByText(/Pull subscriptions, invoices and charges/)).toHaveTextContent("see docs/stripe.md");
    expect(screen.queryByRole("group", { name: "Export" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Stripe insights KPIs" })).toBeNull();
  });

  it("shows an error with a retry when the metrics fail", async () => {
    await insights(URL, { "GET /api/stripe/metrics": () => new MockResponse(500, { ok: false, error: "Stripe metrics failed" }) }, false);
    expect(await screen.findByText("Couldn't load this")).toBeInTheDocument();
    expect(screen.getByText("Stripe metrics failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Dashboard Stripe card", () => {
  it("adds the MRR and churn line linking to the insights", async () => {
    const calls = mockApi({ "GET /api/config": () => stripeConfig });
    renderApp("/?start=2026-09-01&end=2026-09-30");
    const details = await screen.findByRole("link", { name: "Stripe details" });
    const card = details.closest("section") as HTMLElement;
    const link = await within(card).findByRole("link", { name: "Insights" });
    expect(link.getAttribute("href")).toMatch(/^\/stripe\/insights\?/);
    const line = link.closest("p") as HTMLElement;
    expect(line).toHaveTextContent("MRR $1,500.00 · Aug 2026");
    expect(line).toHaveTextContent("Customer churn 10.0%");
    expect(line).toHaveTextContent("Net new +$300.00");
    const call = calls.find((item) => item.path === "/api/stripe/metrics/mrr");
    expect(call?.query.get("business")).toBe("all");
    expect(calls.some((item) => item.path === "/api/stripe/metrics")).toBe(false);
  });
});
