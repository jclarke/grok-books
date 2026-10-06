import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountRow, PaymentRow } from "../api/types";
import { paymentStatus, relativeDue } from "../components/AccountPayment";
import { accounts, paymentRow, payments, session as businessSession } from "./fixtures";
import { MockResponse, mockApi, type Call } from "./mockApi";
import * as px from "./personalFixtures";
import { renderApp } from "./render";

type Handler = (call: Call) => unknown;
type Tile = (typeof px.paccounts.groups)[number]["accounts"][number];

function tile(over: Partial<Tile> & Pick<Tile, "id" | "label" | "class">): Tile {
  return { last4: "", institution: "", liability: false, balance_cents: 0, last_updated: "2026-09-30", stale: false, anchored: true, included: true, spark: [1, 2], transaction_count: 1, ...over };
}

/** paccounts plus an investment group and a Loans group holding the mortgage (terms) and the auto loan (none). */
const paccounts = {
  ...px.paccounts,
  account_count: 5,
  groups: [
    ...px.paccounts.groups,
    { class: "investment", label: "Investments", total_cents: 500000, accounts: [tile({ id: "fake-brokerage", label: "Fake Brokerage", class: "investment", balance_cents: 500000 })] },
    {
      class: "loan",
      label: "Loans",
      total_cents: 41050000,
      accounts: [
        tile({ id: "fake-loan", label: "Fake Home Mortgage", last4: "5555", institution: "Fake Home Loans", class: "loan", liability: true, balance_cents: 39800000 }),
        tile({ id: "fake-auto", label: "Fake Auto Loan", last4: "9090", institution: "Fake Credit Union", class: "loan", liability: true, balance_cents: 1250000 }),
      ],
    },
  ],
};

const PERSONAL: Record<string, Handler> = {
  "GET /api/session": (call) => (call.query.get("mode") === "personal" ? px.personalSession : businessSession),
  "GET /api/personal/status": () => ({ ok: true, ready: true, account_count: 5, transaction_count: 300, setup_steps: px.personalSession.personal?.setup_steps }),
  "GET /api/personal/accounts": () => paccounts,
  [`GET /api/personal/accounts/${px.CARD}/register`]: () => ({ ...px.ptxnPage, account: { id: px.CARD, label: "Fake Rewards Visa", class: "liability", last4: "3333", institution: "Fake Card Co" } }),
};

function card(id: string, short_name: string, last4: string): AccountRow {
  return { ...accounts.rows[1], id, short_name, name: short_name, last4 };
}

/** Business cards: overdue (card), due soon + unverified (amex), paid (capone), rolled estimate (citi). */
const BUSINESS: Record<string, Handler> = {
  "GET /api/accounts": () => ({ ...accounts, rows: [...accounts.rows, card("amex", "Amex Card 4444", "1009"), card("capone", "Capital One Card 5555", "5521"), card("citi", "Citi Card 8888", "8812")] }),
};

function tileFor(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 3, name });
  return heading.closest("article") as HTMLElement;
}

function payBlock(name: string): HTMLElement | null {
  return tileFor(name).querySelector(".account-pay");
}

async function personalPage() {
  const calls = mockApi(PERSONAL);
  renderApp("/personal/accounts");
  await screen.findByRole("table", { name: "Upcoming payments" });
  await waitFor(() => expect(payBlock("Fake Rewards Visa")).toHaveTextContent("Min due"));
  return calls;
}

beforeEach(() => {
  window.localStorage.clear();
});

/** The value (dd) under a stat label (dt) in a payment block. */
function stat(block: HTMLElement, label: string): HTMLElement {
  return within(block).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

describe("payment wording helpers", () => {
  const at = (status: PaymentRow["status"], days_until: number | null) => ({ status, days_until, paid_date: null });

  it("says when the due date falls", () => {
    expect(relativeDue(at("due_soon", 0))).toBe("today");
    expect(relativeDue(at("due_soon", 1))).toBe("tomorrow");
    expect(relativeDue(at("upcoming", 18))).toBe("in 18 days");
    expect(relativeDue(at("overdue", -3))).toBe("3 days overdue");
    expect(relativeDue(at("overdue", -1))).toBe("1 day overdue");
    expect(relativeDue(at("overdue", null))).toBe("overdue");
    expect(relativeDue(at("due_soon", -2))).toBe("due now");
    expect(relativeDue(at("paid", 9))).toBe("in 9 days");
    expect(relativeDue(at("paid", -4))).toBeNull();
    expect(relativeDue(at("unknown", null))).toBeNull();
    expect(relativeDue(at("none", 5))).toBeNull();
  });

  it("maps statuses to pills and tones", () => {
    expect(paymentStatus(at("overdue", -3))).toEqual({ label: "Overdue", tone: "neg" });
    expect(paymentStatus(at("due_soon", 3))).toEqual({ label: "Due soon", tone: "warn" });
    expect(paymentStatus(at("due_soon", -2))).toEqual({ label: "Due now", tone: "warn" });
    expect(paymentStatus({ status: "paid", days_until: 9, paid_date: "2026-09-30" })).toEqual({ label: "Paid", tone: "pos", title: "Paid Sep 30, 2026" });
    expect(paymentStatus(at("upcoming", 19))).toEqual({ label: "Upcoming", tone: "neutral" });
    expect(paymentStatus(at("unknown", null))).toBeNull();
    expect(paymentStatus(at("none", null))).toBeNull();
  });
});

describe("payment info on personal account tiles", () => {
  it("shows the card's min due and due date as stats, a status pill and chip, and APR/autopay, outside the tile link", async () => {
    await personalPage();
    const block = payBlock("Fake Rewards Visa") as HTMLElement;
    expect(block.closest("a")).toBeNull();
    expect(block).toHaveClass("account-pay", "account-pay--warn");
    expect(block.querySelector("dl.account-pay__stats")).not.toBeNull();
    expect(stat(block, "Min due")).toHaveTextContent(/^\$40$/);
    expect(within(stat(block, "Min due")).getByText("$40")).toHaveClass("account-pay__value");
    expect(within(stat(block, "Due")).getByText("Oct 1")).toHaveClass("account-pay__value");
    expect(within(stat(block, "Due")).getByText("today")).toHaveClass("pay-chip", "pay-chip--warn");
    expect(within(block).getByText("Due soon")).toHaveClass("pay-pill", "pay-pill--warn");
    expect(within(block).queryByText("est.")).toBeNull();
    expect(within(block).queryByText("unverified")).toBeNull();
    expect(within(block).getByText("22.49% APR · Autopay off")).toHaveClass("account-pay__meta");
    expect(block).toHaveAttribute("title", "As of Sep 4, 2026 · source: statement");
    const edit = within(block).getByRole("button", { name: "Edit payment details for Fake Rewards Visa ···· 3333" });
    expect(edit).toHaveTextContent("Edit");
    expect(edit.closest(".account-pay__head")).not.toBeNull();
  });

  it("shows the loan tile with est. tags beside the estimated minimum and due date", async () => {
    await personalPage();
    const block = payBlock("Fake Home Mortgage") as HTMLElement;
    expect(within(stat(block, "Min due")).getByText("$2,100")).toBeInTheDocument();
    expect(within(stat(block, "Min due")).getByText("est.")).toHaveAttribute("title", "Estimated minimum payment");
    expect(within(stat(block, "Due")).getByText("Sep 29")).toBeInTheDocument();
    expect(within(stat(block, "Due")).getByText("est.")).toHaveAttribute("title", "Estimated due date");
    expect(within(stat(block, "Due")).getByText("est.")).toHaveClass("pay-tag", "pay-tag--est");
    expect(within(stat(block, "Due")).getByText("due now")).toHaveClass("pay-chip--warn");
    expect(within(block).getByText("Due now")).toHaveClass("pay-pill--warn");
    expect(within(block).getByText("6.125% APR · Autopay on")).toBeInTheDocument();
  });

  it("offers Add payment info on a loan without terms and opens the drawer without navigating", async () => {
    const calls = await personalPage();
    const block = payBlock("Fake Auto Loan") as HTMLElement;
    expect(block).toHaveClass("account-pay--empty");
    expect(within(block).getByText("No payment info yet")).toHaveClass("account-pay__empty");
    expect(block).not.toHaveTextContent("Min due");
    expect(block.querySelector("dl")).toBeNull();
    const add = within(block).getByRole("button", { name: "Add payment details for Fake Auto Loan ···· 9090" });
    expect(add).toHaveTextContent("Add payment info");
    expect(add.closest("a")).toBeNull();
    const user = userEvent.setup();
    await user.click(add);
    const dialog = await screen.findByRole("dialog", { name: "Fake Auto Loan ···· 9090" });
    expect(screen.getByRole("heading", { level: 1, name: "Personal accounts" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Minimum payment due ($)"), "315");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.path).toBe("/api/payments/fake-auto");
    expect(patch?.query.get("mode")).toBe("personal");
    // The tile and the Payments table share the query, so both refresh.
    await waitFor(() => expect(stat(payBlock("Fake Auto Loan") as HTMLElement, "Min due")).toHaveTextContent("$315"));
  });

  it("opens the drawer from Edit, and the tile body still navigates", async () => {
    const calls = await personalPage();
    const user = userEvent.setup();
    const link = within(tileFor("Fake Rewards Visa")).getByRole("link", { name: "Fake Rewards Visa register" });
    expect(link).toHaveAttribute("href", expect.stringContaining(`/personal/accounts/${px.CARD}`));
    await user.click(within(payBlock("Fake Rewards Visa") as HTMLElement).getByRole("button", { name: /^Edit payment details/ }));
    const dialog = await screen.findByRole("dialog", { name: "Fake Rewards Visa ···· 3333" });
    expect(within(dialog).getByLabelText("Minimum payment due ($)")).toHaveValue("40.00");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Personal accounts" })).toBeInTheDocument();
    expect(link).toHaveAttribute("href", expect.stringContaining(`/personal/accounts/${px.CARD}`));

    await user.click(within(link).getByText("Fake Card Co ···· 3333"));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 1, name: "Personal accounts" })).toBeNull());
    expect(calls.some((call) => call.path === `/api/personal/accounts/${px.CARD}/register`)).toBe(true);
  });

  it("leaves cash and investment tiles without a payment block, but gives every tile a badge", async () => {
    await personalPage();
    expect(payBlock("Fake Everyday Checking")).toBeNull();
    expect(payBlock("Fake Brokerage")).toBeNull();
    const badge = (name: string) => tileFor(name).querySelector(".account-card__head .issuer-logo") as HTMLElement;
    expect(badge("Fake Everyday Checking")).toHaveAttribute("data-issuer", "generic");
    expect(badge("Fake Everyday Checking")).toHaveAttribute("data-icon", "cash");
    expect(badge("Fake Brokerage")).toHaveAttribute("data-icon", "trendingUp");
    expect(badge("Fake Home Mortgage")).toHaveAttribute("data-icon", "home");
    expect(badge("Fake Rewards Visa")).toHaveAttribute("data-issuer", "visa");
    expect(badge("Fake Rewards Visa")).toHaveAttribute("aria-hidden", "true");
  });

  it("puts a long APR string on the secondary line", async () => {
    mockApi({
      ...PERSONAL,
      "GET /api/payments": () => ({ ...px.ppayments, rows: px.ppayments.rows.map((row) => (row.id === px.CARD ? { ...row, apr: "22.99% purchase / 28.49% cash", autopay: "unknown" as const } : row)) }),
    });
    renderApp("/personal/accounts");
    const meta = await waitFor(() => within(payBlock("Fake Rewards Visa") as HTMLElement).getByText("22.99% purchase / 28.49% cash APR"));
    expect(meta).toHaveClass("account-pay__meta");
  });

  it("keeps the tiles working when payments fail to load", async () => {
    mockApi({ ...PERSONAL, "GET /api/payments": () => new MockResponse(500, { ok: false, error: "payments broke" }) });
    renderApp("/personal/accounts");
    expect(await screen.findByText("payments broke")).toBeInTheDocument();
    expect(document.querySelector(".account-pay")).toBeNull();
    expect(within(tileFor("Fake Rewards Visa")).getByRole("link")).toHaveAttribute("href", expect.stringContaining(px.CARD));
  });
});

describe("payment info on business account tiles", () => {
  async function businessPage() {
    const calls = mockApi(BUSINESS);
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    await waitFor(() => expect(payBlock("Card 2222")).toHaveTextContent("Min due"));
    return calls;
  }

  it("shows an overdue card above Update balance, and nothing on cash tiles", async () => {
    await businessPage();
    const card = tileFor("Card 2222");
    const block = payBlock("Card 2222") as HTMLElement;
    expect(block.closest("a")).toBeNull();
    expect(block).toHaveClass("account-pay--neg");
    expect(stat(block, "Min due")).toHaveTextContent("$45");
    expect(within(stat(block, "Due")).getByText("Sep 28")).toBeInTheDocument();
    expect(within(stat(block, "Due")).getByText("3 days overdue")).toHaveClass("pay-chip--neg");
    expect(within(block).getByText("Overdue")).toHaveClass("pay-pill", "pay-pill--neg");
    expect(within(block).getByText("24.99% APR · Autopay off")).toBeInTheDocument();
    const actions = card.querySelector(".account-card__actions") as HTMLElement;
    expect(within(actions).getByRole("button", { name: "Update balance" })).toBeInTheDocument();
    expect(block.nextElementSibling).toBe(actions);
    expect(card.querySelector(".issuer-logo")).toHaveAttribute("data-issuer", "discover");
    expect(payBlock("Bank 1111")).toBeNull();
    expect(tileFor("Bank 1111").querySelector(".issuer-logo")).toHaveAttribute("data-issuer", "generic");
    expect(within(tileFor("Bank 1111")).getByRole("button", { name: "Update balance" })).toBeInTheDocument();
  });

  it("shows due-soon, unverified, paid and rolled estimates", async () => {
    await businessPage();
    const amex = payBlock("Amex Card 4444") as HTMLElement;
    expect(within(amex).getByText("Due soon")).toHaveClass("pay-pill--warn");
    expect(within(stat(amex, "Due")).getByText("in 3 days")).toHaveClass("pay-chip--warn");
    const unverified = within(amex).getByText("unverified");
    expect(unverified).toHaveClass("pay-tag", "pay-tag--warn");
    expect(unverified).toHaveAttribute("title", "Not confirmed against a statement");
    expect(unverified.closest(".account-pay__pills")).not.toBeNull();
    expect(within(amex).getByText("19.24% APR · Autopay on")).toBeInTheDocument();
    expect(tileFor("Amex Card 4444").querySelector(".issuer-logo")).toHaveAttribute("data-issuer", "amex");

    const capone = payBlock("Capital One Card 5555") as HTMLElement;
    expect(capone).toHaveClass("account-pay--pos");
    expect(within(capone).getByText("Paid")).toHaveClass("pay-pill--pos");
    expect(within(capone).getByText("Paid")).toHaveAttribute("title", "Paid Sep 30, 2026");
    expect(within(stat(capone, "Next due")).getByText("Oct 10")).toBeInTheDocument();
    expect(within(stat(capone, "Next due")).getByText("in 9 days")).toHaveClass("pay-chip--neutral");

    const citi = payBlock("Citi Card 8888") as HTMLElement;
    expect(within(citi).getByText("Upcoming")).toHaveClass("pay-pill--neutral");
    expect(within(stat(citi, "Min due")).getByText("$40")).toBeInTheDocument();
    expect(within(stat(citi, "Min due")).getByText("est.")).toBeInTheDocument();
    expect(within(stat(citi, "Due")).getByText("Oct 20")).toBeInTheDocument();
    expect(within(stat(citi, "Due")).getByText("est.")).toBeInTheDocument();
    expect(within(stat(citi, "Due")).getByText("in 19 days")).toBeInTheDocument();
    expect(within(citi).getByText("21.5% APR")).toHaveClass("account-pay__meta");
  });

  it("says No payment due calmly when nothing is owed", async () => {
    mockApi({
      ...BUSINESS,
      "GET /api/payments": () => ({ ...payments, rows: [paymentRow({ id: "card", label: "Card 2222", last4: "2222", source: "statement", as_of: "2026-09-15", stored_min_cents: 0, min_payment_cents: 0, status: "none" })] }),
    });
    renderApp("/accounts");
    await screen.findByRole("table", { name: "Upcoming payments" });
    const block = await waitFor(() => payBlock("Card 2222") as HTMLElement);
    expect(block).toHaveClass("account-pay--none");
    expect(within(block).getByText("No payment due")).toHaveClass("account-pay__empty");
    expect(block).not.toHaveTextContent("Min due");
    expect(block.querySelector("dl")).toBeNull();
    expect(within(block).getByRole("button", { name: "Edit payment details for Card 2222" })).toBeInTheDocument();
  });

  it("edits from the tile in business mode and updates the table", async () => {
    const calls = await businessPage();
    const user = userEvent.setup();
    await user.click(within(payBlock("Card 2222") as HTMLElement).getByRole("button", { name: "Edit payment details for Card 2222" }));
    const dialog = await screen.findByRole("dialog", { name: "Card 2222" });
    expect(screen.getByRole("heading", { level: 1, name: "Accounts" })).toBeInTheDocument();
    const apr = within(dialog).getByLabelText("APR");
    await user.clear(apr);
    await user.type(apr, "18.5%");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.path).toBe("/api/payments/card");
    expect(patch?.query.get("mode")).toBe("business");
    expect(patch?.body).toEqual({ apr: "18.5%" });
    await waitFor(() => expect(payBlock("Card 2222")).toHaveTextContent("18.5% APR"));
    const table = screen.getByRole("table", { name: "Upcoming payments" });
    expect(within(table).getByText("18.5%")).toBeInTheDocument();
  });
});
