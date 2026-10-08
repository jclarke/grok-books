import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { DebtOffer } from "../api/personal";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "../pages/personal/DebtPayoffPage";
import { mockApi, type Call } from "./mockApi";
import * as px from "./personalFixtures";
import { renderApp } from "./render";

function offer(id: number, patch: Partial<DebtOffer> = {}): DebtOffer {
  return {
    id,
    lender: `Fake Lender ${id}`,
    amount_cents: 1600000,
    amount: 16000,
    apr: 8.5,
    fee_pct: 2,
    fee_from_proceeds: true,
    term_months: 48,
    monthly_payment_cents: null,
    monthly_payment: null,
    source: "manual",
    notes: "",
    expires_on: null,
    expired: false,
    created_at: "2026-09-30T12:00:00+00:00",
    updated_at: "2026-09-30T12:00:00+00:00",
    ...patch,
  };
}

const OFFERS = [
  offer(1, { lender: "Fake Lender A", apr: 7.99, monthly_payment_cents: 35000, monthly_payment: 350, expires_on: "2026-10-31", source: "grok", notes: "Fake prequal" }),
  offer(2, { lender: "Fake Lender B", amount_cents: 1200000, amount: 12000, apr: 11.5, fee_pct: 0, term_months: 36 }),
  offer(3, { lender: "Fake Lender C", apr: 6.5, expires_on: "2026-09-01", expired: true }),
];

/** The mock API with a stateful offers list, like the server. */
function api(data = px.debtPayoff, initial: DebtOffer[] = []) {
  let rows = initial.map((row) => ({ ...row }));
  let next = 100;
  const handlers: Record<string, (call: Call) => unknown> = {
    "GET /api/session": () => px.personalSession,
    "GET /api/personal/status": () => ({ ok: true, ready: true, account_count: 5, transaction_count: 10, setup_steps: [] }),
    "GET /api/personal/debt-payoff": () => data,
    "GET /api/personal/debt-offers": () => ({ ok: true, rows }),
    "POST /api/personal/debt-offers": (call) => {
      const body = call.body as Record<string, unknown>;
      const created = offer(next++, {
        ...(body as Partial<DebtOffer>),
        amount: (body.amount_cents as number) / 100,
        monthly_payment: body.monthly_payment_cents === null ? null : (body.monthly_payment_cents as number) / 100,
        notes: (body.notes as string) ?? "",
      });
      rows = [...rows, created];
      return { ok: true, offer: created, rows };
    },
  };
  for (let id = 1; id < 200; id += 1) {
    handlers[`PATCH /api/personal/debt-offers/${id}`] = (call) => {
      rows = rows.map((row) => (row.id === id ? { ...row, ...(call.body as Partial<DebtOffer>) } : row));
      return { ok: true, offer: rows.find((row) => row.id === id), rows };
    };
    handlers[`DELETE /api/personal/debt-offers/${id}`] = () => {
      rows = rows.filter((row) => row.id !== id);
      return { ok: true, offer: { id, deleted: true }, rows };
    };
  }
  return mockApi(handlers);
}

function row(table: HTMLElement, name: string | RegExp): HTMLElement {
  return within(table).getByText(name).closest("tr") as HTMLElement;
}

function stored(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
}

function chartLines(): number {
  return document.querySelectorAll("path.chart-line").length;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Debt payoff page, no saved offers", () => {
  it("compares keeping on with the custom what-if, selected by default", async () => {
    const calls = api();
    renderApp("/personal/debt-payoff");
    expect(await screen.findByRole("heading", { level: 1, name: "Debt payoff" })).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/api/personal/debt-payoff" && call.query.get("mode") === "personal")).toBe(true);

    const offers = await screen.findByRole("table", { name: "Loan offers to compare" });
    await waitFor(() => expect(calls.some((call) => call.path === "/api/personal/debt-offers" && call.query.get("mode") === "personal")).toBe(true));
    expect(within(offers).getByRole("checkbox", { name: "Compare Custom / what-if" })).toBeChecked();
    expect(within(offers).getByText(/No saved offers yet/)).toBeInTheDocument();

    const compare = await screen.findByRole("table", { name: "Scenario comparison" });
    expect(within(compare).getAllByRole("row")).toHaveLength(3);
    const customRow = row(compare, "Custom / what-if");
    expect(within(customRow).getByText(/\$16,000 at 9\.76% · 60 mo · 3% fee from proceeds/)).toBeInTheDocument();
    expect(within(customRow).getByText("2 of 3")).toBeInTheDocument();
    expect(within(customRow).getByText(/saved$/)).toBeInTheDocument();

    const cards = screen.getByRole("table", { name: "Credit cards" });
    expect(within(cards).getByRole("columnheader", { name: "After Custom / what-if" })).toBeInTheDocument();
    // $16,000 less a 3% fee = $15,520, highest APR first (the unknown APR is assumed 25%).
    expect(within(row(cards, "Fake Rewards Visa")).getByText("Paid off")).toBeInTheDocument();
    expect(within(row(cards, "Fake Store Card")).getByText("Paid off")).toBeInTheDocument();
    expect(within(row(cards, "Fake Cashback Card")).getByText(/Partly paid · \$480 left/)).toBeInTheDocument();
    expect(within(row(cards, "Fake Store Card")).getByText("APR unknown")).toBeInTheDocument();
    expect(within(row(cards, "Fake Store Card")).getByText("est.")).toBeInTheDocument();

    const loans = screen.getByRole("table", { name: "Installment loans" });
    expect(within(loans).getAllByText("Context only")).toHaveLength(2);
    expect(screen.getByText(/Mortgages are not shown/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Total debt remaining by month: keep paying cards, Custom \/ what-if/ })).toBeInTheDocument();
    expect(chartLines()).toBe(2);
    expect(screen.getByText(/real rate, fee, and term are set by the lender after approval/)).toBeInTheDocument();
    expect(screen.getByText(/Add \$500 a month starting Jan 2027/)).toBeInTheDocument();
    expect(screen.getByText(/when Fake Personal Loan ends/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Add \$500 a month/ })).not.toBeChecked();
  });

  it("is in the personal sidebar", async () => {
    api();
    renderApp("/personal/debt-payoff");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Debt payoff" })).toHaveAttribute("aria-current", "page");
  });

  it("follows the checked cards, covers the fee, remembers settings, and resets", async () => {
    api();
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    const cards = await screen.findByRole("table", { name: "Credit cards" });
    await screen.findByRole("table", { name: "Scenario comparison" });
    await user.click(within(row(cards, "Fake Cashback Card")).getByRole("checkbox"));
    expect(within(row(cards, "Fake Cashback Card")).getByText("Not included")).toBeInTheDocument();
    expect(screen.getByText(/\$11,000 at 9\.76%/)).toBeInTheDocument();
    expect(stored().excludedCards).toEqual(["fake-dp-card-b"]);

    await user.click(within(row(cards, "Fake Cashback Card")).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Cover fee: borrow \$16,495/ }));
    expect(within(cards).getAllByText("Paid off")).toHaveLength(3);
    expect(stored().amount).toBe(16494.85);

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(stored()).toEqual({});
    expect(within(row(cards, "Fake Cashback Card")).getByText(/Partly paid/)).toBeInTheDocument();
  });

  it("includes a loan on request and lets an unknown APR be entered", async () => {
    api();
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    const loans = await screen.findByRole("table", { name: "Installment loans" });
    await screen.findByRole("table", { name: "Scenario comparison" });
    await user.click(within(row(loans, "Fake Personal Loan")).getByRole("checkbox"));
    expect(within(row(loans, "Fake Personal Loan")).queryByText("Context only")).toBeNull();
    expect(screen.getByText(/\$17,500 at 9\.76%/)).toBeInTheDocument();

    const cards = screen.getByRole("table", { name: "Credit cards" });
    const apr = within(row(cards, "Fake Store Card")).getByRole("spinbutton", { name: "APR for Fake Store Card" });
    await user.clear(apr);
    await user.type(apr, "12");
    expect(within(row(cards, "Fake Store Card")).queryByText("APR unknown")).toBeNull();
    expect((stored().aprOverrides as Record<string, number>)["fake-dp-card-high"]).toBe(12);
    await user.click(within(row(cards, "Fake Store Card")).getByRole("button", { name: "clear" }));
    expect(within(row(cards, "Fake Store Card")).getByText("APR unknown")).toBeInTheDocument();
  });

  it("says never when minimums cannot beat the interest, and compares with the same money as a budget", async () => {
    // The Visa's $10 minimum never covers its interest; as a $1,010 budget the money freed by the other card clears it.
    api({ ...px.debtPayoff, cards: [{ ...px.debtPayoff.cards[1], minimum_payment_cents: 1000 }, { ...px.debtPayoff.cards[2], minimum_payment_cents: 100000 }], loans: [] });
    renderApp("/personal/debt-payoff");
    const compare = await screen.findByRole("table", { name: "Scenario comparison" });
    expect(within(row(compare, "Keep paying cards")).getByText("Never at this rate")).toBeInTheDocument();
    expect(within(compare).getByText("Payment never covers the interest on Fake Rewards Visa 3333.")).toBeInTheDocument();
    const custom = row(compare, "Custom / what-if");
    expect(within(custom).getByText("Pays off")).toBeInTheDocument();
    expect(within(custom).getByText(/vs paying \$1,010\/mo/)).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Credit cards" })).getByText("below monthly interest")).toBeInTheDocument();
  });

  it("switches to a fixed budget and warns when it is below the minimums", async () => {
    api();
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    await screen.findByRole("table", { name: "Scenario comparison" });
    await user.click(screen.getByRole("radio", { name: "Fixed monthly budget" }));
    const budget = screen.getByRole("spinbutton", { name: "Monthly budget ($)" });
    await user.clear(budget);
    await user.type(budget, "100");
    expect(screen.getByText(/Below the sum of minimums/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/budget is below the minimums/);
  });

  it("saves the custom what-if as an offer and selects it", async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    await screen.findByRole("table", { name: "Scenario comparison" });
    await user.click(screen.getByRole("button", { name: "Save as offer" }));
    const post = await waitFor(() => {
      const found = calls.find((call) => call.method === "POST" && call.path === "/api/personal/debt-offers");
      expect(found).toBeTruthy();
      return found as Call;
    });
    expect(post.query.get("mode")).toBe("personal");
    expect(post.headers["X-CSRF-Token"]).toBeTruthy();
    expect(post.body).toMatchObject({ lender: "What-if 9.76% 60 mo", amount_cents: 1600000, apr: 9.76, fee_pct: 3, fee_from_proceeds: true, term_months: 60, monthly_payment_cents: null });
    const offers = screen.getByRole("table", { name: "Loan offers to compare" });
    expect(await within(offers).findByRole("checkbox", { name: "Compare What-if 9.76% 60 mo" })).toBeChecked();
    const compare = screen.getByRole("table", { name: "Scenario comparison" });
    expect(within(compare).getAllByRole("row")).toHaveLength(4);
  });
});

describe("Debt payoff page with saved offers", () => {
  it("selects the live offers by default and compares them, with a line each", async () => {
    api(px.debtPayoff, OFFERS);
    renderApp("/personal/debt-payoff");
    const offers = await screen.findByRole("table", { name: "Loan offers to compare" });
    await within(offers).findByText("Fake Lender A");
    expect(within(offers).getByRole("checkbox", { name: "Compare Custom / what-if" })).not.toBeChecked();
    expect(within(offers).getByRole("checkbox", { name: "Compare Fake Lender A" })).toBeChecked();
    expect(within(offers).getByRole("checkbox", { name: "Compare Fake Lender B" })).toBeChecked();
    expect(within(offers).getByRole("checkbox", { name: "Compare Fake Lender C" })).not.toBeChecked();
    expect(within(row(offers, "Fake Lender C")).getByText("expired")).toBeInTheDocument();
    expect(within(row(offers, "Fake Lender A")).getByText("grok")).toBeInTheDocument();
    // Quoted $350 vs about $391 computed for $16,000 at 7.99% over 48 months.
    expect(within(row(offers, "Fake Lender A")).getByText(/Quoted \$350 vs computed \$391/)).toBeInTheDocument();
    expect(within(row(offers, "Fake Lender B")).getByText("computed")).toBeInTheDocument();

    const compare = await screen.findByRole("table", { name: "Scenario comparison" });
    expect(within(compare).getAllByRole("row")).toHaveLength(4);
    const a = row(compare, "Fake Lender A");
    expect(within(a).getByText(/Expires Oct 31, 2026/)).toBeInTheDocument();
    expect(within(a).getByText(/Quoted \$350 vs computed \$391/)).toBeInTheDocument();
    expect(within(a).getByText("2 of 3")).toBeInTheDocument();
    // $12,000, no fee: the 27.99% ($8,000) and 25% ($3,000) cards are paid, then $1,000 of the 18.5% one.
    expect(within(row(compare, "Fake Lender B")).getByText("2 of 3")).toBeInTheDocument();
    // The status column follows the first selected offer: $15,680 net leaves $320 on the 18.5% card.
    expect(within(screen.getByRole("table", { name: "Credit cards" })).getByText(/Partly paid · \$320 left/)).toBeInTheDocument();
    expect(within(compare).getAllByText("Lowest cost")).toHaveLength(1);
    expect(chartLines()).toBe(3);
    expect(screen.getByRole("img", { name: /keep paying cards, Fake Lender A, Fake Lender B/ })).toBeInTheDocument();
    expect(document.querySelectorAll("path.chart-line--dashed")).toHaveLength(1);

    const cards = screen.getByRole("table", { name: "Credit cards" });
    expect(within(cards).getByRole("columnheader", { name: "After Fake Lender A" })).toBeInTheDocument();
  });

  it("selection changes the comparison, chart, and status column, and is remembered", async () => {
    api(px.debtPayoff, OFFERS);
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    const offers = await screen.findByRole("table", { name: "Loan offers to compare" });
    await within(offers).findByText("Fake Lender A");
    await user.click(within(offers).getByRole("checkbox", { name: "Compare Fake Lender A" }));
    await user.click(within(offers).getByRole("checkbox", { name: "Compare Custom / what-if" }));
    expect(stored().selected).toEqual(["offer:2", "custom"]);
    const compare = screen.getByRole("table", { name: "Scenario comparison" });
    expect(within(compare).queryByText("Fake Lender A")).toBeNull();
    expect(chartLines()).toBe(3);
    await user.selectOptions(screen.getByRole("combobox", { name: "Show payoff for" }), "custom");
    expect(within(screen.getByRole("table", { name: "Credit cards" })).getByRole("columnheader", { name: "After Custom / what-if" })).toBeInTheDocument();
    expect(stored().statusFor).toBe("custom");
  });

  it("applies the extra payment to every scenario", async () => {
    api(px.debtPayoff, OFFERS);
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    const compare = await screen.findByRole("table", { name: "Scenario comparison" });
    await within(compare).findByText("Fake Lender A");
    const firstPayments = () =>
      within(compare)
        .getAllByRole("row")
        .slice(1)
        .map((tr) => Number((tr.querySelector('[data-label="Month 1 payment"]')?.textContent ?? "").replace(/[$,]/g, "")));
    const before = firstPayments();
    const extra = screen.getByRole("spinbutton", { name: "Extra each month value" });
    await user.clear(extra);
    await user.type(extra, "200");
    const after = firstPayments();
    after.forEach((value, index) => expect(value).toBeCloseTo(before[index] + 200, 2));
  });

  it("adds an offer from the form", async () => {
    const calls = api(px.debtPayoff, OFFERS);
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    await within(await screen.findByRole("table", { name: "Loan offers to compare" })).findByText("Fake Lender A");
    await user.click(screen.getByRole("button", { name: "Add offer" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a loan offer" });
    await user.click(within(dialog).getByRole("button", { name: "Save offer" }));
    expect(within(dialog).getByText("Enter the lender")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Lender"), "Fake Lender D");
    await user.type(within(dialog).getByLabelText("Amount ($)"), "$15,500");
    await user.type(within(dialog).getByLabelText("APR (%)"), "10.25");
    await user.clear(within(dialog).getByLabelText("Origination fee (%)"));
    await user.type(within(dialog).getByLabelText("Origination fee (%)"), "4");
    await user.click(within(dialog).getByRole("switch", { name: /Fee taken from the proceeds/ }));
    await user.clear(within(dialog).getByLabelText("Term (months)"));
    await user.type(within(dialog).getByLabelText("Term (months)"), "36");
    await user.type(within(dialog).getByLabelText(/Quoted monthly payment/), "510");
    await user.type(within(dialog).getByLabelText("Notes (optional)"), "Fake note");
    await user.click(within(dialog).getByRole("button", { name: "Save offer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = calls.find((call) => call.method === "POST" && call.path === "/api/personal/debt-offers");
    expect(post?.body).toEqual({
      lender: "Fake Lender D",
      amount_cents: 1550000,
      apr: 10.25,
      fee_pct: 4,
      fee_from_proceeds: false,
      term_months: 36,
      monthly_payment_cents: 51000,
      notes: "Fake note",
      expires_on: null,
    });
    const offers = screen.getByRole("table", { name: "Loan offers to compare" });
    expect(await within(offers).findByRole("checkbox", { name: "Compare Fake Lender D" })).toBeChecked();
    expect(within(screen.getByRole("table", { name: "Scenario comparison" })).getByText("Fake Lender D")).toBeInTheDocument();
  });

  it("edits an offer", async () => {
    const calls = api(px.debtPayoff, OFFERS);
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    await within(await screen.findByRole("table", { name: "Loan offers to compare" })).findByText("Fake Lender A");
    await user.click(screen.getByRole("button", { name: "Edit Fake Lender B" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Fake Lender B offer" });
    expect(within(dialog).getByLabelText("Amount ($)")).toHaveValue("12000.00");
    const apr = within(dialog).getByLabelText("APR (%)");
    await user.clear(apr);
    await user.type(apr, "9.9");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = calls.find((call) => call.method === "PATCH" && call.path === "/api/personal/debt-offers/2");
    expect(patch?.body).toMatchObject({ lender: "Fake Lender B", apr: 9.9, amount_cents: 1200000, term_months: 36 });
    expect(await within(screen.getByRole("table", { name: "Loan offers to compare" })).findByText("9.9%")).toBeInTheDocument();
  });

  it("asks before deleting an offer", async () => {
    const calls = api(px.debtPayoff, OFFERS);
    const user = userEvent.setup();
    renderApp("/personal/debt-payoff");
    await within(await screen.findByRole("table", { name: "Loan offers to compare" })).findByText("Fake Lender A");
    await user.click(screen.getByRole("button", { name: "Delete Fake Lender A" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this offer?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Delete Fake Lender A" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete this offer?" })).getByRole("button", { name: "Delete offer" }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.path === "/api/personal/debt-offers/1")).toBe(true));
    const del = calls.find((call) => call.method === "DELETE");
    expect(del?.query.get("mode")).toBe("personal");
    expect(del?.headers["X-CSRF-Token"]).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Loan offers to compare" })).queryByText("Fake Lender A")).toBeNull());
    expect(within(screen.getByRole("table", { name: "Scenario comparison" })).queryByText("Fake Lender A")).toBeNull();
  });

  it("carries v1 settings over to the v2 key once", async () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ excludedCards: ["fake-dp-card-b"], apr: 8.5, term: "48" }));
    api(px.debtPayoff, OFFERS);
    renderApp("/personal/debt-payoff");
    const cards = await screen.findByRole("table", { name: "Credit cards" });
    expect(within(row(cards, "Fake Cashback Card")).getByRole("checkbox")).not.toBeChecked();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(stored()).toMatchObject({ excludedCards: ["fake-dp-card-b"], apr: 8.5, term: "48", selected: null });
    const offers = screen.getByRole("table", { name: "Loan offers to compare" });
    expect(within(offers).getByText("8.5%")).toBeInTheDocument();
    expect(await within(offers).findByRole("checkbox", { name: "Compare Fake Lender A" })).toBeChecked();
  });
});
