import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { pickOption } from "./combo";
import { session as businessSession } from "./fixtures";
import { MockResponse, mockApi, type Call } from "./mockApi";
import * as px from "./personalFixtures";
import { renderApp } from "./render";

type Handler = (call: Call) => unknown;

const PERSONAL: Record<string, Handler> = {
  "GET /api/session": (call) => (call.query.get("mode") === "personal" ? px.personalSession : businessSession),
  "GET /api/personal/status": () => ({ ok: true, ready: true, account_count: 2, transaction_count: 300, setup_steps: px.personalSession.personal?.setup_steps }),
  "GET /api/personal/accounts": () => px.paccounts,
};

const COLUMNS = ["Account", "Owed", "Min due", "Due date", "APR", "Autopay", "Source"];

function paymentsTable(): HTMLElement {
  return screen.getByRole("table", { name: "Upcoming payments" });
}

/** Account names in table order. */
function accountOrder(): string[] {
  return within(paymentsTable())
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector(".pay-account__name")?.textContent ?? "");
}

function rowFor(name: string): HTMLElement {
  const row = within(paymentsTable())
    .getAllByRole("row")
    .find((item) => item.querySelector(".pay-account__name")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function paymentCalls(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method && call.path.startsWith("/api/payments"));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("payments on the business Accounts page", () => {
  it("renders the columns and asks for business payments", async () => {
    const calls = mockApi();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const headers = within(paymentsTable()).getAllByRole("columnheader").map((th) => th.textContent);
    for (const name of COLUMNS) expect(headers).toContain(name);
    expect(within(paymentsTable()).getAllByRole("button", { name: /^Edit payment info for/ })).toHaveLength(6);
    const get = paymentCalls(calls, "GET")[0];
    expect(get.query.get("mode")).toBe("business");
  });

  it("shows overdue, due-soon, paid, and rolled estimates", async () => {
    mockApi();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });

    const overdue = within(rowFor("Card 2222")).getByText("Overdue · 3 days");
    expect(overdue).toHaveClass("badge", "badge--neg");

    const soon = within(rowFor("Amex Card 4444")).getByText("Due in 3 days");
    expect(soon).toHaveClass("badge", "badge--warn");
    expect(within(rowFor("Amex Card 4444")).getByText("unverified")).toHaveClass("badge");

    const paid = within(rowFor("Capital One Card 5555")).getByText("Paid");
    expect(paid).toHaveClass("badge", "badge--pos");
    expect(paid).toHaveAttribute("title", "Paid Sep 30, 2026");

    const rolled = rowFor("Citi Card 8888");
    expect(within(rolled).getByText("Oct 20, 2026")).toBeInTheDocument();
    expect(within(rolled).getByTitle("Estimated")).toHaveTextContent("est.");
    expect(within(rolled).getByText("paid Sep 18, 2026")).toBeInTheDocument();
    expect(within(rolled).queryByText("Paid")).toBeNull();

    expect(within(rowFor("Office Store Card")).getByText("No payment due")).toHaveClass("muted");
    expect(within(rowFor("Equipment Loan")).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("sorts by due date first and re-sorts on a header click", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    expect(accountOrder()).toEqual(["Card 2222", "Amex Card 4444", "Capital One Card 5555", "Citi Card 8888", "Office Store Card", "Equipment Loan"]);
    expect(within(paymentsTable()).getByRole("columnheader", { name: /Due date/ })).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(paymentsTable()).getByRole("button", { name: "Owed" }));
    expect(accountOrder()).toEqual(["Equipment Loan", "Card 2222", "Amex Card 4444", "Citi Card 8888", "Capital One Card 5555", "Office Store Card"]);
    await user.click(within(paymentsTable()).getByRole("button", { name: "Owed" }));
    expect(accountOrder()[0]).toBe("Office Store Card");
    expect(within(paymentsTable()).getByRole("columnheader", { name: /Owed/ })).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(paymentsTable()).getByRole("button", { name: "Due date" }));
    expect(accountOrder()[0]).toBe("Citi Card 8888");
    await user.click(within(paymentsTable()).getByRole("button", { name: "Due date" }));
    expect(accountOrder()[0]).toBe("Card 2222");
  });

  it("totals the next 30 days, overdue, and each date", async () => {
    mockApi();
    renderApp("/accounts");
    const totals = await screen.findByRole("group", { name: "Payment totals" });
    const next30 = within(totals).getByRole("heading", { name: "Minimums due, next 30 days" }).closest("article") as HTMLElement;
    expect(within(next30).getByText("$145.00")).toBeInTheDocument();
    expect(within(next30).getByText("4 payments")).toBeInTheDocument();
    const overdue = within(totals).getByRole("heading", { name: "Overdue" }).closest("article") as HTMLElement;
    expect(overdue).toHaveClass("kpi--danger");
    expect(within(overdue).getByText("$45.00")).toBeInTheDocument();
    expect(within(overdue).getByText("1 account")).toBeInTheDocument();
    const byDate = within(totals).getByRole("heading", { name: "By date" }).closest("article") as HTMLElement;
    const items = within(byDate).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Sep 28$45.001 payment", "Oct 4$35.001 payment", "Oct 10$25.001 payment", "Oct 20$40.001 payment"]);
    expect(screen.getByText(/1 account without payment info/)).toBeInTheDocument();
  });

  it("explains the source with the as-of date in a tooltip and to screen readers", async () => {
    mockApi();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const source = rowFor("Amex Card 4444").querySelector(".pay-source") as HTMLElement;
    expect(source).toHaveAttribute("title", "As of Sep 10, 2026 · source: sheet · From the bills sheet");
    expect(within(source).getByText("sheet")).toBeInTheDocument();
    expect(source.querySelector(".sr-only")).toHaveTextContent("As of Sep 10, 2026 · source: sheet");
    const inferred = rowFor("Citi Card 8888").querySelector(".pay-source") as HTMLElement;
    expect(inferred).toHaveTextContent(/^inferred/);
    expect(inferred.getAttribute("title")).toContain("source: inferred from payment history");
  });

  it("saves only the changed fields and refreshes the table", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const gets = paymentCalls(calls, "GET").length;
    await user.click(screen.getByRole("button", { name: "Edit payment info for Amex Card 4444" }));
    const dialog = await screen.findByRole("dialog", { name: "Amex Card 4444" });
    const min = within(dialog).getByLabelText("Minimum payment due ($)");
    expect(min).toHaveValue("35.00");
    expect(within(dialog).getByLabelText("Due date")).toHaveValue("2026-10-04");
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("From the bills sheet");

    await user.clear(min);
    await user.type(min, "224.00");
    const due = within(dialog).getByLabelText("Due date");
    await user.clear(due);
    await user.type(due, "2026-10-15");
    const apr = within(dialog).getByLabelText("APR");
    await user.clear(apr);
    await user.type(apr, "18.5%");
    await user.selectOptions(within(dialog).getByLabelText("Autopay"), "no");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = paymentCalls(calls, "PATCH")[0];
    expect(patch.path).toBe("/api/payments/amex");
    expect(patch.query.get("mode")).toBe("business");
    expect(patch.headers["X-CSRF-Token"]).toBe("test-csrf-token-123456");
    expect(patch.body).toEqual({ min_payment: "224.00", due_date: "2026-10-15", apr: "18.5%", autopay: "no" });
    await waitFor(() => expect(paymentCalls(calls, "GET").length).toBeGreaterThan(gets));
    expect(within(rowFor("Amex Card 4444")).getByText("$224.00")).toBeInTheDocument();
    expect(within(rowFor("Amex Card 4444")).getByText("18.5%")).toBeInTheDocument();
  });

  it("shows the server's error inside the drawer", async () => {
    mockApi({ "PATCH /api/payments/card": () => new MockResponse(400, { ok: false, error: "due_date must be YYYY-MM-DD" }) });
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    await user.click(screen.getByRole("button", { name: "Edit payment info for Card 2222" }));
    const dialog = await screen.findByRole("dialog", { name: "Card 2222" });
    await user.type(within(dialog).getByLabelText("Notes"), "call bank");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("due_date must be YYYY-MM-DD");
    expect(screen.getByRole("dialog", { name: "Card 2222" })).toBeInTheDocument();
  });

  it("lists only accounts without payment info in Add payment info", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const add = screen.getByRole("combobox", { name: "Add payment info" });
    await user.click(add);
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Equipment Loan ···· 7777"]);
    await user.keyboard("{Escape}");
    await pickOption(user, add, "Equipment Loan ···· 7777", "equip");
    const dialog = await screen.findByRole("dialog", { name: "Equipment Loan ···· 7777" });
    await user.type(within(dialog).getByLabelText("Minimum payment due ($)"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(paymentCalls(calls, "PATCH")).toHaveLength(1));
    expect(paymentCalls(calls, "PATCH")[0].path).toBe("/api/payments/equip");
    expect(paymentCalls(calls, "PATCH")[0].body).toEqual({ min_payment: "150" });
    // Once it has terms it drops out of the picker; none left hides it.
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Add payment info" })).toBeNull());
  });

  it("shows an error state when payments fail to load", async () => {
    mockApi({ "GET /api/payments": () => new MockResponse(500, { ok: false, error: "payments broke" }) });
    renderApp("/accounts");
    expect(await screen.findByText("payments broke")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bank and cash" })).toBeInTheDocument();
  });
});

describe("payments on the personal Accounts page", () => {
  it("renders the columns for personal accounts with personal mode", async () => {
    const calls = mockApi(PERSONAL);
    renderApp("/personal/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const headers = within(paymentsTable()).getAllByRole("columnheader").map((th) => th.textContent);
    for (const name of COLUMNS) expect(headers).toContain(name);
    expect(paymentCalls(calls, "GET").every((call) => call.query.get("mode") === "personal")).toBe(true);
    expect(accountOrder()).toEqual(["Fake Home Mortgage", "Fake Rewards Visa", "Fake Auto Loan"]);
    expect(within(rowFor("Fake Rewards Visa")).getByText("Due today")).toHaveClass("badge--warn");
    expect(within(rowFor("Fake Home Mortgage")).getByText("Due now (est.)")).toHaveClass("badge--warn");
    expect(within(rowFor("Fake Home Mortgage")).getAllByText("est.").length).toBeGreaterThan(0);
    const overdue = screen.getByRole("heading", { name: "Overdue" }).closest("article") as HTMLElement;
    expect(overdue).not.toHaveClass("kpi--danger");
    expect(within(overdue).getByText("Nothing overdue")).toBeInTheDocument();
  });

  it("marks a payment paid with {paid: true} in personal mode", async () => {
    const calls = mockApi(PERSONAL);
    const user = userEvent.setup();
    renderApp("/personal/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    await user.click(screen.getByRole("button", { name: "Edit payment info for Fake Rewards Visa ···· 3333" }));
    const dialog = await screen.findByRole("dialog", { name: "Fake Rewards Visa ···· 3333" });
    await user.click(within(dialog).getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(paymentCalls(calls, "PATCH")).toHaveLength(1));
    const patch = paymentCalls(calls, "PATCH")[0];
    expect(patch.path).toBe(`/api/payments/${px.CARD}`);
    expect(patch.query.get("mode")).toBe("personal");
    expect(patch.body).toEqual({ paid: true });
    expect(await within(rowFor("Fake Rewards Visa")).findByText("Paid")).toHaveClass("badge--pos");
  });

  it("only offers personal accounts without payment info", async () => {
    mockApi(PERSONAL);
    const user = userEvent.setup();
    renderApp("/personal/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    await user.click(screen.getByRole("combobox", { name: "Add payment info" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Fake Auto Loan ···· 9090"]);
  });

  it("hides Add payment info when every account has terms", async () => {
    mockApi({ ...PERSONAL, "GET /api/payments": () => ({ ...px.ppayments, rows: px.ppayments.rows.filter((row) => row.has_terms) }) });
    renderApp("/personal/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    expect(screen.queryByRole("combobox", { name: "Add payment info" })).toBeNull();
  });
});
