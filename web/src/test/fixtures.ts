import type { AccountRow, PaymentRow, Payments, CalendarData, Dashboard, Pnl, Register, ReviewRow, Rule, Session, TableReport, TxnPage, Vendors } from "../api/types";
import type { RawSiteConfig } from "../lib/siteConfig";

export const CHECKING = "acct-checking-0001";

export const session: Session = {
  ok: true,
  product: "Example Books",
  company: "Example Co",
  csrf_token: "test-csrf-token-123456",
  requires_login: false,
  authenticated: false,
  today: "2026-10-01",
  months: ["2026-08", "2026-09"],
  latest_month: "2026-09",
  review_count: 2,
  businesses: ["all", "branda", "consulting", "general"],
  tags: ["branda", "consulting", "general", "owner_draw", "transfer", "needs_review"],
  categories: ["Revenue - Hosting", "Revenue - Consulting", "Refunds", "Hosting & Infrastructure", "Software & Licenses", "Office/Other", "Owner Draw", "Transfer", "Uncategorized"],
  category_groups: {
    revenue: ["Revenue - Hosting", "Revenue - Consulting", "Refunds"],
    cogs: ["Hosting & Infrastructure"],
    opex: ["Software & Licenses", "Office/Other"],
    other: ["Owner Draw", "Transfer", "Uncategorized"],
  },
  accounts: [
    { id: CHECKING, name: "Example Bank Checking 1111", short_name: "Bank 1111", type: "cash", last4: "1111", institution: "Example Bank" },
    { id: "card", name: "Sample Card 2222", short_name: "Card 2222", type: "liability", last4: "2222", institution: "Discover" },
  ],
};

/** GET /api/config for the owner's books (signed in). */
export const siteConfig: RawSiteConfig = {
  ok: true,
  product: "Example Books",
  company: "Example Co",
  wordmark: "Example",
  features: { whmcs: true, margins: true },
  businesses: [
    { slug: "branda", label: "Brand A", kind: "brand", color: "#0d9488", color_dark: "#2dd4bf", tone: "brand", revenue_category: "Revenue - Hosting" },
    { slug: "consulting", label: "Consulting", kind: "consulting", color: "#4f46e5", color_dark: "#a5b4fc", tone: "violet", revenue_category: "Revenue - Consulting" },
    { slug: "general", label: "General", kind: "overhead", color: "#64748b", color_dark: "#94a3b8", tone: "neutral", revenue_category: null },
  ],
  default_business: "general",
  accounts: [
    { id: CHECKING, short_name: "Bank 1111", label: "Bank", type: "cash", roles: ["operating"] },
    { id: "paypal", short_name: "PayPal", label: "PayPal", type: "cash", roles: [] },
    { id: "card", short_name: "Card 2222", label: "Card", type: "liability", roles: [] },
  ],
  operating_account: { id: CHECKING, short_name: "Bank 1111", label: "Bank", type: "cash", roles: ["operating"] },
  whmcs_brands: ["BrandA", "BrandB", "BrandC"],
  whmcs_bank_sides: [
    { gateway: "paypal", label: "PayPal account, hosting deposits less refunds" },
    { gateway: "litle", label: "Bank card settlements (Processor A, Processor B)" },
  ],
};

export const dashboard: Dashboard = {
  start: "2026-09-01",
  end: "2026-09-30",
  prior_start: "2026-08-01",
  prior_end: "2026-08-31",
  business: "all",
  kpis: [
    { key: "net_revenue", label: "Net revenue", cents: 10000, prior_cents: 5000, delta: 5000, pct: 100, spark: [5000, 10000] },
    { key: "total_expenses", label: "Expenses", cents: 4000, prior_cents: 3000, delta: 1000, pct: 33.3, spark: [3000, 4000] },
    { key: "net_income", label: "Net income", cents: 6000, prior_cents: 2000, delta: 4000, pct: 200, spark: [2000, 6000] },
  ],
  margin: { pct: 60, prior_pct: 40, delta: 20 },
  plug: -1000,
  points: [
    { month: "2026-08", label: "Aug", revenue: 5000, expenses: 3000, net: 2000 },
    { month: "2026-09", label: "Sep", revenue: 10000, expenses: 4000, net: 6000 },
  ],
  expenses: [
    { category: "Software & Licenses", cents: 3000 },
    { category: "Office/Other", cents: 1000 },
  ],
  revenue_split: [
    { label: "Hosting", business: "branda", cents: 8000 },
    { label: "Consulting", business: "consulting", cents: 2000 },
  ],
  refunds: 0,
  cash: [{ id: CHECKING, name: "Example Bank Checking 1111", short_name: "Bank 1111", type: "cash", balance_cents: 123456, display_cents: 123456, anchored: false, last_date: "2026-09-30" }],
  top_vendors: [{ merchant: "ZZZ RENT", spend_cents: 10000, count: 1, category: "Office/Other", last_seen: "2026-09-01" }],
  upcoming: [
    { merchant: "ZZZ RENT", account_id: CHECKING, account_name: "Bank 1111", direction: "out", count: 3, last_date: "2026-09-01", last_cents: -10000, gap_days: 31, next_date: "2026-10-02", due_date: "2026-10-02", cents: -10000 },
  ],
  review_count: 2,
};

export const txnPage: TxnPage = {
  rows: [
    { id: "q1", date: "2026-09-11", amount_cents: -400, name: "ZZZ QUEUE ONE", merchant_name: "ZZZ QUEUE ONE", account_id: CHECKING, account_name: "Bank 1111", status: "active", pending: false, business_tag: "needs_review", category: "Uncategorized", source: "rule", confidence: 0.2, note: "" },
    { id: "rev", date: "2026-09-04", amount_cents: 10000, name: "ZZZ HOSTING", merchant_name: "ZZZ HOSTING", account_id: CHECKING, account_name: "Bank 1111", status: "active", pending: false, business_tag: "branda", category: "Revenue - Hosting", source: "manual", confidence: 1, note: "" },
  ],
  total: 2,
  offset: 0,
  limit: 100,
  page_in_cents: 10000,
  page_out_cents: 400,
};

export const accounts: { rows: AccountRow[]; start: string; end: string } = {
  start: "2026-09-01",
  end: "2026-09-30",
  rows: [
    { id: CHECKING, name: "Example Bank Checking 1111", short_name: "Bank 1111", type: "cash", last4: "1111", institution: "Example Bank", balance_cents: 123456, display_cents: 123456, anchored: false, active_count: 10, superseded_count: 0, min_date: "2026-08-01", max_date: "2026-09-30", in_cents: 10000, out_cents: 4400, net_cents: 5600 },
    { id: "card", name: "Sample Card 2222", short_name: "Card 2222", type: "liability", last4: "2222", institution: "Discover", balance_cents: -5000, display_cents: 5000, anchored: false, active_count: 3, superseded_count: 1, min_date: "2026-08-01", max_date: "2026-09-20", in_cents: 0, out_cents: 300, net_cents: -300 },
  ],
};

export const register: Register = {
  account: { id: CHECKING, name: "Example Bank Checking 1111", short_name: "Bank 1111", type: "cash", last4: "1111", institution: "Example Bank", notes: null },
  balance_cents: 9600,
  rows: [{ ...txnPage.rows[1], payment_cents: null, deposit_cents: 10000, running_cents: 9600 }],
  total: 1,
  offset: 0,
  limit: 100,
};

export const pnl: Pnl = {
  start: "2026-01-01",
  end: "2026-10-01",
  title: "Example Co — Profit & Loss 2026-01-01 to 2026-10-01 (business: all)",
  generated: "2026-10-01",
  business: "all",
  by: "month",
  columns: ["Sep 2026", "Total"],
  column_keys: ["2026-09", "Total"],
  rows: [
    { label: "Revenue - Hosting", kind: "line", values: [10000, 10000], prior: 0, pct: null },
    { label: "Gross Revenue", kind: "subtotal", values: [10000, 10000], prior: 0, pct: null },
    { label: "Software & Licenses", kind: "line", values: [4000, 4000], prior: 0, pct: null },
    { label: "Total Operating Expenses", kind: "subtotal", values: [4000, 4000], prior: 0, pct: null },
    { label: "Net Income", kind: "total", values: [6000, 6000], prior: 0, pct: null },
    { label: "Owner Draws (below the line)", kind: "line", values: [1000, 1000], prior: 0, pct: null },
    { label: "Net after Owner Draws", kind: "total", values: [5000, 5000], prior: 0, pct: null },
  ],
  net_income_cents: 6000,
  owner_draw_cents: 1000,
  transfer_count: 0,
  transfer_cents: 0,
  prior_start: "2025-01-01",
  prior_end: "2025-10-01",
};

export const pnlLines = {
  label: "Software & Licenses",
  month: "2026-09",
  rows: [{ id: "soft", date: "2026-09-05", account_id: CHECKING, account_name: "Bank 1111", name: "ZZZ SOFTWARE", amount_cents: -4000, business_tag: "general", category: "Software & Licenses" }],
  total_cents: -4000,
};

export const scheduleC: TableReport = {
  name: "schedule-c",
  heading: "Schedule C-style summary",
  title: "Schedule C-style summary 2026-01-01 to 2026-10-01 (business: all)",
  generated: "2026-10-01",
  start: "2026-01-01",
  end: "2026-10-01",
  columns: ["Line", "Description", "Amount"],
  kinds: ["line", "total"],
  rows: [
    [{ text: "1", cents: null }, { text: "Gross receipts or sales", cents: null }, { text: "100.00", cents: 10000 }],
    [{ text: "31", cents: null }, { text: "Net profit (or loss)", cents: null }, { text: "60.00", cents: 6000 }],
  ],
};

export const vendors: Vendors = {
  start: "2026-01-01",
  end: "2026-10-01",
  rows: [
    { merchant: "ZZZ RENT", spend_cents: 30000, count: 3, category: "Office/Other", last_seen: "2026-09-01" },
    { merchant: "ZZZ SOFTWARE", spend_cents: 7000, count: 2, category: "Software & Licenses", last_seen: "2026-09-05" },
  ],
  vendor_count: 2,
  total_spend_cents: 37000,
};

export const review: { rows: ReviewRow[]; count: number } = {
  count: 2,
  rows: [
    { ...txnPage.rows[0], suggestion: { tag: "general", category: "Office/Other", reason: "2 of 2 earlier ZZZ QUEUE ONE rows", confidence: 1, pattern: "ZZZ QUEUE ONE" } },
    { ...txnPage.rows[0], id: "q2", name: "ZZZ QUEUE TWO", amount_cents: -600, suggestion: { tag: "", category: "", reason: "", confidence: 0, pattern: "ZZZ QUEUE TWO" } },
  ],
};

export const rules: { rows: Rule[] } = {
  rows: [
    { id: 1, priority: 10, pattern: "ZZZ RENT", field: "any", account_id: null, account_name: "", amount_sign: null, min_amount: null, max_amount: null, business_tag: "general", category: "Office/Other", confidence: 0.9, note: "", active: true, created_at: "2026-09-01T00:00:00+00:00", created_by: "manual", hits: 3 },
    { id: 2, priority: 12, pattern: "OLD THING", field: "name", account_id: null, account_name: "", amount_sign: "out", min_amount: null, max_amount: null, business_tag: "general", category: "Office/Other", confidence: 0.9, note: "", active: false, created_at: "2026-09-01T00:00:00+00:00", created_by: "rule", hits: 0 },
  ],
};

export const calendar: CalendarData = {
  items: dashboard.upcoming,
  upcoming: dashboard.upcoming,
  reserve_cents: 5000,
  outlook: {
    opening_cents: 50000,
    ending_cents: 30000,
    reserve_cents: 5000,
    after_reserve_cents: 25000,
    estimate: true,
    through: "2026-11-30",
    timeline: [
      { date: "2026-10-01", label: "Opening balance", cents: 0, balance: 50000 },
      { date: "2026-10-02", label: "ZZZ RENT", cents: -10000, balance: 40000 },
    ],
    daily: [
      { date: "2026-10-01", balance: 50000 },
      { date: "2026-10-02", balance: 40000 },
      { date: "2026-10-03", balance: 40000 },
    ],
  },
};

export const audit = {
  rows: [
    { id: 9, ts: "2026-10-01T12:00:00+00:00", txn_id: "q1", rule_id: null, action: "classify", field: "classification", old_value: "needs_review|Uncategorized|rule|", new_value: "general|Office/Other|manual|", actor: "web", note: null },
    { id: 8, ts: "2026-10-01T11:00:00+00:00", txn_id: null, rule_id: null, action: "setting", field: "reserve_cents", old_value: "0", new_value: "5000", actor: "web", note: null },
  ],
};

/** A card or loan payment row with nothing on file; fixtures override what they need. */
export function paymentRow(over: Partial<PaymentRow> & Pick<PaymentRow, "id" | "label">): PaymentRow {
  return {
    last4: "",
    institution: "",
    class: "liability",
    balance_cents: 0,
    has_terms: true,
    due_date: null,
    apr: null,
    autopay: "unknown",
    source: null,
    as_of: null,
    unverified: false,
    notes: null,
    payer_pattern: null,
    statement_balance_cents: null,
    stored_min_cents: null,
    status: "unknown",
    effective_due_date: null,
    days_until: null,
    rolled: false,
    paid_date: null,
    paid_by: null,
    estimated: false,
    min_payment_cents: null,
    note: "",
    ...over,
  };
}

/** Business cards, sorted by effective due date the way the server sends them. today = 2026-10-01. */
export const payments: Payments = {
  ok: true,
  mode: "business",
  rows: [
    paymentRow({ id: "card", label: "Card 2222", last4: "2222", institution: "Discover", balance_cents: 245000, due_date: "2026-09-28", apr: "24.99%", autopay: "no", source: "statement", as_of: "2026-09-03", statement_balance_cents: 210000, stored_min_cents: 4500, min_payment_cents: 4500, status: "overdue", effective_due_date: "2026-09-28", days_until: -3, note: "3 days past due" }),
    paymentRow({ id: "amex", label: "Amex Card 4444", last4: "4444", institution: "American Express", balance_cents: 98000, due_date: "2026-10-04", apr: "19.24%", autopay: "yes", source: "sheet", as_of: "2026-09-10", unverified: true, notes: "From the bills sheet", stored_min_cents: 3500, min_payment_cents: 3500, status: "due_soon", effective_due_date: "2026-10-04", days_until: 3, note: "Due in 3 days" }),
    paymentRow({ id: "capone", label: "Capital One Card 5555", last4: "5555", institution: "Capital One", balance_cents: 12000, due_date: "2026-10-10", apr: "29.99%", autopay: "yes", source: "manual", as_of: "2026-09-25", stored_min_cents: 2500, min_payment_cents: 2500, status: "paid", effective_due_date: "2026-10-10", days_until: 9, paid_date: "2026-09-30", paid_by: "payment", note: "Paid" }),
    paymentRow({ id: "citi", label: "Citi Card 8888", last4: "8888", institution: "Citi", balance_cents: 51000, due_date: "2026-09-20", apr: "21.5%", source: "inferred from payment history", as_of: "2026-08-20", stored_min_cents: null, min_payment_cents: 4000, status: "upcoming", effective_due_date: "2026-10-20", days_until: 19, rolled: true, paid_date: "2026-09-18", paid_by: "payment", estimated: true, note: "in 19 days" }),
    paymentRow({ id: "store", label: "Office Store Card", last4: "0042", institution: "Synchrony", balance_cents: 0, source: "statement", as_of: "2026-09-15", stored_min_cents: 0, min_payment_cents: 0, status: "none", note: "No payment due" }),
    paymentRow({ id: "equip", label: "Equipment Loan", last4: "7777", institution: "Ally", class: "loan", balance_cents: 640000, has_terms: false, status: "unknown", note: "No payment info" }),
  ],
  summary: {
    today: "2026-10-01",
    horizon: "2026-10-31",
    next30_cents: 14500,
    next30_count: 4,
    overdue_cents: 4500,
    overdue_count: 1,
    by_date: [
      { date: "2026-09-28", cents: 4500, count: 1 },
      { date: "2026-10-04", cents: 3500, count: 1 },
      { date: "2026-10-10", cents: 2500, count: 1 },
      { date: "2026-10-20", cents: 4000, count: 1 },
    ],
    unverified_count: 1,
    missing_count: 1,
  },
};
