import { vi } from "vitest";
import type { Payments } from "../api/types";
import * as fx from "./fixtures";
import * as mx from "./marginsFixtures";
import * as px from "./personalFixtures";
import * as sx from "./stripeFixtures";
import * as wx from "./whmcsFixtures";

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: Call) => unknown;

/** A non-200 JSON response from the mock API. */
export class MockResponse {
  constructor(
    public status: number,
    public body: unknown,
  ) {}
}

const defaults: Record<string, Handler> = {
  "GET /api/session": () => fx.session,
  "GET /api/config": () => fx.siteConfig,
  "GET /api/dashboard": () => fx.dashboard,
  "GET /api/transactions": () => fx.txnPage,
  "GET /api/accounts": () => fx.accounts,
  "GET /api/pnl": () => fx.pnl,
  "GET /api/pnl/lines": () => fx.pnlLines,
  "GET /api/vendors": () => fx.vendors,
  "GET /api/review": () => fx.review,
  "GET /api/rules": () => fx.rules,
  "GET /api/rules/preview": () => ({ count: 3, manual: 0, sample: [] }),
  "GET /api/calendar": () => fx.calendar,
  "GET /api/settings": () => ({ reserve_cents: 5000 }),
  "GET /api/audit": () => fx.audit,
  "GET /api/search": () => ({ transactions: [], vendors: [{ name: "ZZZ RENT", count: 3, spend_cents: 30000, last_date: "2026-09-01" }], accounts: [] }),
  "GET /api/whmcs/status": () => wx.whmcsStatus,
  "GET /api/whmcs/summary": () => wx.whmcsSummary,
  "GET /api/whmcs/revenue": () => wx.whmcsRevenue,
  "GET /api/whmcs/mrr": () => wx.whmcsMrr,
  "GET /api/whmcs/churn": () => wx.whmcsChurn,
  "GET /api/whmcs/refunds": () => wx.whmcsRefunds,
  "GET /api/whmcs/dunning": () => wx.whmcsDunning,
  "GET /api/whmcs/reconcile": () => wx.whmcsReconcile,
  "POST /api/whmcs/customers/search": (call) => {
    const q = String((call.body as { q?: string }).q ?? "").toLowerCase();
    return { ok: true, ready: true, rows: wx.whmcsHits.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(q) || String(row.client_id) === q) };
  },
  "GET /api/whmcs/customers/BrandA/1": () => ({ ok: true, ready: true, customer: wx.whmcsCustomer }),
  "GET /api/margins": () => mx.margins,
  "GET /api/stripe/summary": () => sx.stripeSummary,
  "GET /api/stripe/payouts": () => sx.stripePayouts,
  "GET /api/stripe/metrics": () => sx.stripeMetrics,
  "GET /api/stripe/metrics/mrr": () => {
    const { mrr, summary, ok, ready, start, end, month, business, account, currency, as_of, accounts, approximations } = sx.stripeMetrics;
    return { ok, ready, start, end, month, business, account, currency, as_of, accounts, approximations, summary: { ...summary, forecast_low_cents: null, forecast_low_date: null }, mrr };
  },
  "POST /api/classify": (call) => {
    const body = call.body as { txn_id: string; tag: string; category: string; note: string; save_rule?: boolean };
    return {
      ok: true,
      applied_others: body.save_rule ? 2 : 0,
      rule_created: Boolean(body.save_rule),
      previous: { business_tag: "needs_review", category: "Uncategorized", source: "rule", rule_id: null, confidence: 0.2, note: "" },
      row: { id: body.txn_id, business_tag: body.tag, category: body.category, source: "manual", confidence: 1, note: body.note },
      review_count: 1,
    };
  },
  "POST /api/classify/bulk": (call) => {
    const body = call.body as { txn_ids: string[]; tag: string; category: string };
    return {
      ok: true,
      count: body.txn_ids.length,
      rows: body.txn_ids.map((id) => ({ id, business_tag: body.tag, category: body.category, source: "manual", confidence: 1, note: "" })),
      previous: body.txn_ids.map((id) => ({ txn_id: id, previous: null })),
      review_count: 0,
    };
  },
  "POST /api/classify/undo": () => ({ ok: true, rows: [], review_count: 2 }),
  "POST /api/settings": (call) => ({ ok: true, reserve_cents: (call.body as { reserve_cents: number }).reserve_cents }),
  "POST /api/rules/2/active": () => ({ ok: true, id: 2, active: true }),
  "POST /api/balances": (call) => {
    const body = call.body as { account_id: string; balance: string; as_of: string; source?: string; note?: string };
    return {
      ok: true,
      balance: {
        id: body.account_id,
        anchored: true,
        display_cents: 8000,
        real_balance_cents: 8000,
        opening_cents: 0,
        as_of_date: body.as_of,
        anchor_cents: 8000,
        source: body.source ?? "statement",
        anchor_note: body.note ?? "",
        drift_cents: null,
        reconcile_cents: 8000,
      },
    };
  },
  "POST /api/vendors/merge": (call) => {
    const body = call.body as { into: string };
    return { ok: true, canonical: body.into, changed: 2, aliases: [] };
  },
  "POST /api/vendors/unmerge": (call) => {
    const body = call.body as { alias: string };
    return { ok: true, alias: body.alias, canonical: "" };
  },
  "POST /api/vendors/rename": (call) => {
    const body = call.body as { name: string };
    return { ok: true, canonical: body.name, changed: 1 };
  },
};

type PaymentModes = Record<"business" | "personal", Payments>;

/** PATCH /api/payments/<id>: apply the change to this test's copy of the rows, like the server. */
function patchPayment(state: PaymentModes, call: Call): unknown {
  const id = decodeURIComponent(call.path.slice("/api/payments/".length));
  const mode = call.query.get("mode") === "personal" ? "personal" : "business";
  const data = state[mode];
  const row = data.rows.find((item) => item.id === id);
  if (!row) return new MockResponse(404, { ok: false, error: "no such account" });
  const body = call.body as { min_payment?: string | null; due_date?: string; apr?: string; autopay?: "yes" | "no" | "unknown"; notes?: string; paid?: boolean };
  const next = { ...row, has_terms: true, source: "manual", as_of: data.summary.today };
  if (body.min_payment !== undefined) {
    next.stored_min_cents = body.min_payment === null ? null : Math.round(Number(body.min_payment) * 100);
    next.min_payment_cents = next.stored_min_cents;
  }
  if (body.due_date !== undefined) {
    next.due_date = body.due_date || null;
    next.effective_due_date = next.due_date;
  }
  if (body.apr !== undefined) next.apr = body.apr;
  if (body.autopay !== undefined) next.autopay = body.autopay;
  if (body.notes !== undefined) next.notes = body.notes;
  if (body.paid) Object.assign(next, { status: "paid", paid_date: data.summary.today, paid_by: "payment" });
  state[mode] = { ...data, rows: data.rows.map((item) => (item.id === id ? next : item)) };
  return { ok: true, row: next, summary: data.summary };
}

/** Replace fetch with an in-memory API. Returns the list of calls for assertions. */
export function mockApi(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  // Classifications saved during the test, so refetched lists reflect them like the real server.
  const saved = new Map<string, { business_tag: string; category: string }>();
  const paymentData: PaymentModes = { business: fx.payments, personal: px.ppayments };
  const stateful: Record<string, Handler> = {
    "GET /api/payments": (call) => paymentData[call.query.get("mode") === "personal" ? "personal" : "business"],
    "GET /api/transactions": () => ({ ...fx.txnPage, rows: fx.txnPage.rows.map((row) => ({ ...row, ...saved.get(row.id) })) }),
    "POST /api/classify": (call) => {
      const body = call.body as { txn_id: string; tag: string; category: string };
      saved.set(body.txn_id, { business_tag: body.tag, category: body.category });
      return defaults["POST /api/classify"](call);
    },
    "POST /api/classify/undo": (call) => {
      for (const item of (call.body as { items: { txn_id: string }[] }).items) saved.delete(item.txn_id);
      return defaults["POST /api/classify/undo"](call);
    },
  };
  const handlers = { ...defaults, ...stateful, ...overrides };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const call: Call = { method, path: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers };
    calls.push(call);
    let handler = handlers[`${method} ${url.pathname}`];
    if (!handler && method === "POST" && url.pathname.startsWith("/api/margins/")) handler = () => ({ ok: true });
    if (!handler && url.pathname.startsWith("/api/accounts/")) handler = () => fx.register;
    if (!handler && method === "PATCH" && url.pathname.startsWith("/api/payments/")) handler = (call) => patchPayment(paymentData, call);
    if (!handler && url.pathname.startsWith("/api/reports/")) handler = () => fx.scheduleC;
    if (!handler && url.pathname.startsWith("/api/transactions/")) handler = () => ({ transaction: { ...fx.txnPage.rows[0], description: "", provider_category: "", suggested_pattern: "ZZZ QUEUE", history: [] } });
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const result = handler(call);
    if (result instanceof MockResponse) {
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}
