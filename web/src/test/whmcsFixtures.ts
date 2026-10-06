import type {
  WhmcsChurn,
  WhmcsCustomer,
  WhmcsCustomerHit,
  WhmcsDunning,
  WhmcsMrr,
  WhmcsReconcile,
  WhmcsRefunds,
  WhmcsRevenue,
  WhmcsStatus,
  WhmcsSummary,
} from "../api/types";

// Made-up customers only.

const money = (gross: number, fees: number, refunds: number, payments: number, refundCount: number) => ({
  gross_cents: gross,
  fees_cents: fees,
  refunds_cents: refunds,
  net_cents: gross - fees - refunds,
  payments,
  refund_count: refundCount,
});

export const whmcsStatus: WhmcsStatus = {
  ready: true,
  last_sync: "2026-10-01T06:00:00+00:00",
  brands: [
    { brand: "BrandA", last_run: "2026-10-01T06:00:00+00:00", last_status: "ok", last_error: null, last_ok: "2026-10-01T06:00:00+00:00", rows: { clients: 3, services: 6, invoices: 7, payments: 6 }, first_payment: "2025-02-10", last_payment: "2026-06-10", payments_in_cents: 33200 },
    { brand: "BrandB", last_run: "2026-10-01T06:00:10+00:00", last_status: "error", last_error: "could not open the SSH tunnel", last_ok: null, rows: { clients: 0, services: 0, invoices: 0, payments: 0 }, first_payment: null, last_payment: null, payments_in_cents: 0 },
    { brand: "BrandC", last_run: null, last_status: null, last_error: null, last_ok: null, rows: { clients: 0, services: 0, invoices: 0, payments: 0 }, first_payment: null, last_payment: null, payments_in_cents: 0 },
  ],
  log: [
    { id: 2, started_at: "2026-10-01T06:00:05+00:00", finished_at: "2026-10-01T06:00:10+00:00", brand: "BrandB", status: "error", counts: {}, error: "could not open the SSH tunnel" },
    { id: 1, started_at: "2026-10-01T05:59:50+00:00", finished_at: "2026-10-01T06:00:00+00:00", brand: "BrandA", status: "ok", counts: { clients: 3, services: 6, invoices: 7, payments: 6 }, error: null },
  ],
};

export const whmcsSummary: WhmcsSummary = {
  ready: true,
  mrr_cents: 2200,
  arr_cents: 26400,
  customers: 2,
  last_sync: "2026-10-01T06:00:00+00:00",
  last_status: "ok",
  brands: [{ brand: "BrandA", mrr_cents: 2200, customers: 2 }],
  spark: [4200, 3200, 2200],
};

export const whmcsRevenue: WhmcsRevenue = {
  ready: true,
  start: "2026-01-01",
  end: "2026-10-01",
  brand: "all",
  by: "month",
  ...money(16200, 530, 3000, 2, 1),
  periods: [
    { period: "2026-01", ...money(1200, 65, 0, 1, 0), by_brand: { BrandA: money(1200, 65, 0, 1, 0) } },
    { period: "2026-06", ...money(15000, 465, 3000, 1, 1), by_brand: { BrandA: money(15000, 465, 3000, 1, 1) } },
  ],
  brands: [{ brand: "BrandA", ...money(16200, 530, 3000, 2, 1) }],
  plans: [
    { brand: "BrandA", plan: "Pro Plan", group: "Shared", ...money(12000, 372, 2400, 1, 1) },
    { brand: "BrandA", plan: "Starter Plan", group: "Shared", ...money(1000, 54, 0, 1, 0) },
  ],
  totals: money(16200, 530, 3000, 2, 1),
};

export const whmcsMrr: WhmcsMrr = {
  ready: true,
  today: "2026-10-01",
  brand: "all",
  mrr_cents: 2200,
  arr_cents: 26400,
  customers: 2,
  services: 3,
  arpu_cents: 1100,
  suspended_mrr_cents: 0,
  suspended_services: 0,
  brands: [{ brand: "BrandA", services: 3, customers: 2, mrr_cents: 2200, arr_cents: 26400, arpu_cents: 1100, share_pct: 100 }],
  plans: [
    { brand: "BrandA", plan: "Starter Plan", group: "Shared", services: 1, customers: 1, mrr_cents: 1000, arr_cents: 12000, arpu_cents: 1000, share_pct: 45.45 },
    { brand: "BrandA", plan: "Pro Plan", group: "Shared", services: 1, customers: 1, mrr_cents: 1000, arr_cents: 12000, arpu_cents: 1000, share_pct: 45.45 },
  ],
  cycles: [{ cycle: "Monthly", services: 2, mrr_cents: 1200 }],
  trend: [
    { month: "2026-08", mrr_cents: 2200, customers: 2, services: 3, by_brand: { BrandA: 2200 } },
    { month: "2026-09", mrr_cents: 2200, customers: 2, services: 3, by_brand: { BrandA: 2200 } },
  ],
  trend_note: "Estimate. Month-end MRR is rebuilt from service dates.",
};

const churnMonth = {
  month: "2026-02",
  cancel_requests: 1,
  immediate: 0,
  end_of_period: 1,
  start_customers: 3,
  end_customers: 2,
  new_customers: 0,
  churned_customers: 1,
  net_customer_adds: -1,
  start_services: 5,
  new_services: 0,
  churned_services: 1,
  net_adds: -1,
  start_mrr_cents: 4200,
  new_mrr_cents: 0,
  churned_mrr_cents: 1000,
  end_mrr_cents: 3200,
  logo_churn_pct: 33.33,
  revenue_churn_pct: 23.81,
};

const churnFigures = {
  start_services: 5,
  end_services: 3,
  start_customers: 3,
  new_services: 0,
  churned_services: 2,
  net_adds: -2,
  new_customers: 0,
  churned_customers: 1,
  start_mrr_cents: 4200,
  new_mrr_cents: 0,
  churned_mrr_cents: 2000,
  service_churn_pct: 40,
  logo_churn_pct: 33.33,
  revenue_churn_pct: 47.62,
};

export const whmcsChurn: WhmcsChurn = {
  ready: true,
  start: "2026-01-01",
  end: "2026-09-30",
  brand: "all",
  months: [churnMonth],
  totals: { ...churnFigures, cancel_requests: 2, immediate: 1, end_of_period: 1 },
  brands: [{ brand: "BrandA", ...churnFigures }],
  plans: [{ brand: "BrandA", plan: "Legacy Plan", ...churnFigures, cancel_requests: 1 }],
  reasons: [
    { category: "Price", count: 1, share_pct: 50 },
    { category: "Moved to another provider", count: 1, share_pct: 50 },
  ],
  recent: [{ id: "BrandA:2", date: "2026-03-15", brand: "BrandA", plan: "Legacy Plan", type: "Immediate", category: "Moved to another provider", reason: "Moving to another host, write me at [email]" }],
  note: "A service churns in the month its end date falls.",
};

export const whmcsRefunds: WhmcsRefunds = {
  ready: true,
  start: "2026-01-01",
  end: "2026-10-01",
  brand: "all",
  months: [{ month: "2026-06", refunds_cents: 3000, count: 1, gross_cents: 15000, rate_pct: 20 }],
  brands: [{ brand: "BrandA", refunds_cents: 3000, count: 1, gross_cents: 16200, rate_pct: 18.52 }],
  plans: [{ brand: "BrandA", plan: "Pro Plan", refunds_cents: 2400, count: 1, gross_cents: 12000, rate_pct: 20 }],
  gateways: [{ gateway: "paypal", refunds_cents: 3000, count: 1 }],
  largest: [{ id: "BrandA:6", date: "2026-06-10", brand: "BrandA", client_id: 3, invoice_id: 1003, gateway: "paypal", refund_cents: 3000, plan: "Pro Plan", trans_id: "PPFAKE0003" }],
  totals: { refunds_cents: 3000, count: 1, gross_cents: 16200, rate_pct: 18.52 },
};

export const whmcsDunning: WhmcsDunning = {
  ready: true,
  today: "2026-10-01",
  start: "2026-01-01",
  end: "2026-10-01",
  brand: "all",
  totals: { open_count: 2, open_cents: 4200, overdue_count: 2, overdue_cents: 4200, collectible_overdue_cents: 3000, collectible_overdue_count: 1 },
  aging: [
    { bucket: "Not yet due", count: 0, balance_cents: 0, collectible_cents: 0 },
    { bucket: "1-30 days", count: 1, balance_cents: 3000, collectible_cents: 3000 },
    { bucket: "181-365 days", count: 1, balance_cents: 1200, collectible_cents: 0 },
  ],
  gateways: [{ gateway: "paypal", count: 2, balance_cents: 4200, overdue_count: 2, overdue_cents: 4200 }],
  trend: [{ month: "2026-02", invoices: 1, invoiced_cents: 1200, paid: 0, paid_cents: 0, unpaid: 1, unpaid_cents: 1200, cancelled: 0, cancelled_cents: 0, refunded: 0, capture_failed: 1, unpaid_rate_pct: 100 }],
  trend_gateways: [{ gateway: "paypal", invoices: 1, unpaid_or_cancelled: 1, cents: 1200, unpaid_rate_pct: 100 }],
  collections: [
    { brand: "BrandA", invoice_id: 1006, client_id: 3, client_status: "Active", date: "2026-09-20", due_date: "2026-09-25", days_overdue: 6, bucket: "1-30 days", balance_cents: 3000, total_cents: 3000, payment_method: "paypal", last_capture_attempt: null, live_services: 1, collectible: true },
    { brand: "BrandA", invoice_id: 1004, client_id: 1, client_status: "Closed", date: "2026-02-05", due_date: "2026-02-05", days_overdue: 238, bucket: "181-365 days", balance_cents: 1200, total_cents: 1200, payment_method: "paypal", last_capture_attempt: "2026-02-06 03:00:00", live_services: 0, collectible: false },
  ],
  note: "Collectible means the client still has a live service.",
};

const reconMonth = {
  month: "2026-01",
  matched: 1,
  matched_whmcs_cents: 1135,
  matched_books_cents: 1135,
  whmcs_only: 1,
  whmcs_only_cents: 850,
  paypal_only: 1,
  paypal_only_cents: 1371,
  whmcs_net_cents: 1985,
  books_cents: 2506,
  difference_cents: 521,
};

export const whmcsReconcile: WhmcsReconcile = {
  ready: true,
  start: "2026-01-01",
  end: "2026-09-30",
  requested_start: "2026-01-01",
  requested_end: "2026-10-01",
  window_days: 3,
  coverage: { books_first: "2026-01-01", books_last: "2026-09-30" },
  months: [reconMonth],
  totals: { ...reconMonth, month: undefined } as unknown as WhmcsReconcile["totals"],
  rows: [
    { key: "w:BrandA:1", status: "matched", kind: "payment", date: "2026-01-05", brand: "BrandA", client_id: 1, invoice_id: 1001, trans_id: "PPFAKE0001", whmcs_gross_cents: 1200, whmcs_fees_cents: 65, whmcs_net_cents: 1135, books_id: "pp-1", books_date: "2026-01-06", books_cents: 1135, books_name: null, match: "amount net of fee" },
    { key: "w:BrandA:7", status: "whmcs_only", kind: "payment", date: "2026-01-20", brand: "BrandA", client_id: 1, invoice_id: null, trans_id: "PPFAKE0007", whmcs_gross_cents: 900, whmcs_fees_cents: 50, whmcs_net_cents: 850, books_id: null, books_date: null, books_cents: null, books_name: null, match: null },
    { key: "b:pp-4", status: "paypal_only", kind: "payment", date: "2026-01-25", brand: null, client_id: null, invoice_id: null, trans_id: "", whmcs_gross_cents: null, whmcs_fees_cents: null, whmcs_net_cents: null, books_id: "pp-4", books_date: "2026-01-25", books_cents: 1371, books_name: "Payment from Unmatched Payer", match: null },
  ],
  gateways: [
    { month: "2026-01", gateway: "litle", count: 3, gross_cents: 9000, fees_cents: 0, refunds_cents: 0, net_cents: 9000, bank_cents: 8800, bank_label: "Bank card settlements (Processor A, Processor B)", difference_cents: -200 },
    { month: "2026-01", gateway: "mailin", count: 1, gross_cents: 500, fees_cents: 0, refunds_cents: 0, net_cents: 500, bank_cents: null, bank_label: null, difference_cents: null },
  ],
  note: "Books side: PayPal account rows.",
};

export const whmcsHits: WhmcsCustomerHit[] = [
  { brand: "BrandA", client_id: 1, name: "Alice Example", company: "", email: "alice@example.test", status: "Active", signup_date: "2025-01-05", country: "US", total_paid_cents: 1200, refunds_cents: 0, live_services: 3, mrr_cents: 1200 },
];

export const whmcsCustomer: WhmcsCustomer = {
  brand: "BrandA",
  client_id: 1,
  name: "Alice Example",
  first_name: "Alice",
  last_name: "Example",
  company: "",
  email: "alice@example.test",
  status: "Active",
  signup_date: "2025-01-05",
  country: "US",
  state: "CA",
  currency: "USD",
  default_gateway: "paypal",
  credit_balance_cents: 500,
  totals: { paid_cents: 1200, refunds_cents: 0, fees_cents: 65, net_cents: 1135, unpaid_cents: 1200, mrr_cents: 1200, live_services: 3, first_payment: "2026-01-05", last_payment: "2026-01-05", payments: 1, invoices: 3 },
  services: [
    { kind: "hosting", id: 101, plan: "Starter Plan", group: "Shared", domain: "alice.example.test", status: "Active", billing_cycle: "Monthly", amount_cents: 1000, mrr_cents: 1000, reg_date: "2025-01-05", next_due_date: "2026-10-05", termination_date: null, payment_method: "paypal", server: "web1" },
  ],
  payments: [{ id: 1, date: "2026-01-05 10:00:00", gateway: "paypal", amount_in_cents: 1200, fees_cents: 65, amount_out_cents: 0, trans_id: "PPFAKE0001", invoice_id: 1001, is_refund: false }],
  invoices: [{ id: 1001, number: "", date: "2026-01-05", due_date: "2026-01-05", date_paid: "2026-01-05", status: "Paid", total_cents: 1200, credit_cents: 0, payment_method: "paypal" }],
  cancellations: [{ date: "2026-02-01", service_id: 101, plan: "Starter Plan", domain: "alice.example.test", type: "End of Billing Period", reason: "Too expensive" }],
  credits: [{ date: "2026-01-01", amount_cents: 500 }],
};
