import type { RawSiteConfig } from "../lib/siteConfig";
import type { StripeBankDeposit, StripeFigures, StripePayouts, StripeSummary } from "../api/types";
import { siteConfig } from "./fixtures";

// Synthetic Stripe data only: made-up ids and round amounts.

/** The owner's config with Stripe turned on. */
export const stripeConfig: RawSiteConfig = {
  ...siteConfig,
  features: { ...siteConfig.features, stripe: true },
  stripe_accounts: [{ name: "main", label: "Stripe", business: "general" }],
};

const figures = (gross: number, refunds: number, disputes: number, fees: number, payouts: number, capital = { repay: 0, proceeds: 0 }): StripeFigures => ({
  gross_cents: gross,
  refunds_cents: refunds,
  disputes_cents: disputes,
  fees_cents: fees,
  net_revenue_cents: gross - refunds - disputes - fees,
  fee_pct: gross ? Math.round((fees / gross) * 10000) / 100 : null,
  capital_repayments_cents: capital.repay,
  capital_proceeds_cents: capital.proceeds,
  payouts_cents: payouts,
});

export const stripeSummary: StripeSummary = {
  ok: true,
  ready: true,
  start: "2026-01-01",
  end: "2026-10-08",
  business: "all",
  accounts: [
    { name: "main", label: "Stripe", business: "general", currency: "usd", ledger_account_id: "stripe-main", ...figures(30000, 5000, 0, 1200, 20000, { repay: 1000, proceeds: 0 }), needs_review: 0, skipped_currency: 0 },
  ],
  totals: figures(30000, 5000, 0, 1200, 20000, { repay: 1000, proceeds: 0 }),
  months: [
    { month: "2026-08", ...figures(10000, 0, 0, 400, 10000) },
    { month: "2026-09", ...figures(20000, 5000, 0, 800, 10000, { repay: 1000, proceeds: 0 }) },
  ],
  payouts: { matched: 1, in_transit: 1, unmatched: 1, ambiguous: 0, conflict: 0, failed: 0, skipped: 0 },
  open_payouts: 1,
  bank_only: 1,
};

export const stripeNotReady: StripeSummary = {
  ok: true,
  ready: false,
  start: "2026-01-01",
  end: "2026-10-08",
  business: "all",
  accounts: [],
  totals: figures(0, 0, 0, 0, 0),
  months: [],
  payouts: { matched: 0, in_transit: 0, unmatched: 0, ambiguous: 0, conflict: 0, failed: 0, skipped: 0 },
  open_payouts: 0,
  bank_only: 0,
};

const deposit = (txnId: string, date: string, cents: number): StripeBankDeposit => ({
  txn_id: txnId,
  date,
  account_id: "bank-test",
  account_label: "Bank 0101",
  last4: "0101",
  amount_cents: cents,
  name: "STRIPE TRANSFER",
  business_tag: "transfer",
  category: "Transfer",
});

const byStatus = (matched: [number, number], inTransit: [number, number], unmatched: [number, number]): StripePayouts["totals"]["by_status"] => ({
  matched: { count: matched[0], amount_cents: matched[1] },
  in_transit: { count: inTransit[0], amount_cents: inTransit[1] },
  unmatched: { count: unmatched[0], amount_cents: unmatched[1] },
  ambiguous: { count: 0, amount_cents: 0 },
  conflict: { count: 0, amount_cents: 0 },
  failed: { count: 0, amount_cents: 0 },
  skipped: { count: 0, amount_cents: 0 },
});

export const stripePayouts: StripePayouts = {
  ok: true,
  ready: true,
  start: "2026-01-01",
  end: "2026-10-08",
  rows: [
    {
      account: "main",
      account_label: "Stripe",
      id: "po_TEST0001",
      amount_cents: 10000,
      currency: "usd",
      created: "2026-09-02",
      arrival_date: "2026-09-04",
      stripe_status: "paid",
      match_status: "matched",
      match_note: "bank deposit $100.00 on 2026-09-04",
      bank: deposit("txn_TEST0001", "2026-09-04", 10000),
    },
    {
      account: "main",
      account_label: "Stripe",
      id: "po_TEST0002",
      amount_cents: 5000,
      currency: "usd",
      created: "2026-10-06",
      arrival_date: "2026-10-09",
      stripe_status: "in_transit",
      match_status: "in_transit",
      match_note: "arrives after the last bank import",
      bank: null,
    },
    {
      account: "main",
      account_label: "Stripe",
      id: "po_TEST0003",
      amount_cents: 5000,
      currency: "usd",
      created: "2026-08-10",
      arrival_date: "2026-08-12",
      stripe_status: "paid",
      match_status: "unmatched",
      match_note: "no bank deposit of $50.00 within 3 days",
      bank: null,
    },
  ],
  bank_only: [deposit("txn_TEST0009", "2026-07-15", 2500)],
  totals: {
    count: 3,
    amount_cents: 20000,
    by_status: byStatus([1, 10000], [1, 5000], [1, 5000]),
    bank_only_count: 1,
    bank_only_cents: 2500,
  },
};
