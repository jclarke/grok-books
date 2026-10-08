import type { RawSiteConfig } from "../lib/siteConfig";
import type {
  StripeBankDeposit,
  StripeCapital,
  StripeCapitalCost,
  StripeChurnRow,
  StripeFeeFigures,
  StripeFeesSection,
  StripeFigures,
  StripeMetrics,
  StripeMrrMonth,
  StripePayouts,
  StripeRecoveryMonth,
  StripeSummary,
} from "../api/types";
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

/** A $20,000 Capital loan with a $2,000 fee, $9,090.91 of principal repaid. */
export const stripeCapital: StripeCapital = {
  financings: [
    {
      account: "main",
      account_label: "Stripe",
      business: "general",
      key: "flxln_TEST0001",
      financing: "flxln_TEST0001",
      financing_ids: ["flxln_TEST0001"],
      label: "Capital loan 2026",
      terms: true,
      principal_cents: 2000000,
      fee_cents: 200000,
      fee_rate: null,
      proceeds_cents: 2000000,
      opening_principal_cents: null,
      paid_cents: 1000000,
      repaid_principal_cents: 909091,
      fee_booked_cents: 90909,
      fee_remaining_cents: 109091,
      principal_outstanding_cents: 1090909,
      pct_repaid: 45.5,
      loan_account_id: "stripe-main-capital",
      unsplit_cents: 0,
      first_date: "2026-03-02",
      last_date: "2026-09-12",
      warnings: [],
    },
  ],
  loans: [
    { account: "main", account_label: "Stripe", business: "general", loan_account_id: "stripe-main-capital", loan_balance_cents: 1090909, expected_cents: 1090909, conflicts: [] },
  ],
  warnings: [],
  missing_terms: false,
  missing_terms_message: null,
  unsplit_cents: 0,
};

/** Repayments with no [[stripe.capital]] terms: booked whole as transfers. */
export const stripeCapitalNoTerms: StripeCapital = {
  financings: [
    {
      ...stripeCapital.financings[0],
      key: "unsplit:flxln_TEST0001",
      label: "flxln_TEST0001",
      terms: false,
      principal_cents: null,
      fee_cents: null,
      proceeds_cents: 0,
      repaid_principal_cents: null,
      fee_booked_cents: 0,
      fee_remaining_cents: null,
      principal_outstanding_cents: null,
      pct_repaid: null,
      unsplit_cents: 300000,
      warnings: ["Capital fee not split: add [[stripe.capital]] terms ($3,000.00 of repayments booked as transfers in full)"],
    },
  ],
  loans: [],
  warnings: ["Stripe, flxln_TEST0001: Capital fee not split: add [[stripe.capital]] terms"],
  missing_terms: true,
  missing_terms_message: "Capital fee not split: add [[stripe.capital]] terms",
  unsplit_cents: 300000,
};

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
  payouts: { matched: 1, in_transit: 1, unmatched: 1, ambiguous: 0, conflict: 0, failed: 0, skipped: 0, no_bank_history: 1 },
  open_payouts: 1,
  bank_only: 1,
  capital: stripeCapital,
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
  payouts: { matched: 0, in_transit: 0, unmatched: 0, ambiguous: 0, conflict: 0, failed: 0, skipped: 0, no_bank_history: 0 },
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
  no_bank_history: { count: 1, amount_cents: 4000 },
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
    {
      account: "main",
      account_label: "Stripe",
      id: "po_TEST0004",
      amount_cents: 4000,
      currency: "usd",
      created: "2026-01-05",
      arrival_date: "2026-01-07",
      stripe_status: "paid",
      match_status: "no_bank_history",
      match_note: "arrived 2026-01-07, before the imported bank history of the business bank accounts (starts 2026-02-01)",
      bank: null,
    },
  ],
  bank_only: [deposit("txn_TEST0009", "2026-07-15", 2500)],
  totals: {
    count: 4,
    amount_cents: 24000,
    by_status: byStatus([1, 10000], [1, 5000], [1, 5000]),
    bank_only_count: 1,
    bank_only_cents: 2500,
  },
};

// --- Business analytics (GET /api/stripe/metrics): four months, focus month August 2026 ---------
// Synthetic: cus_TEST / prod_TEST ids, "Plan A" names, round amounts.

const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];

function mrrMonth(month: string, opening: number, moves: { new?: number; reactivated?: number; expansion?: number; contraction?: number; churned?: number }, customers: number): StripeMrrMonth {
  const m = { new: 0, reactivated: 0, expansion: 0, contraction: 0, churned: 0, ...moves };
  const closing = opening + m.new + m.reactivated + m.expansion - m.contraction - m.churned;
  return {
    month,
    mrr_cents: closing,
    arr_cents: closing * 12,
    trialing_mrr_cents: 0,
    customers,
    subscriptions: customers,
    free_subscriptions: 0,
    arpa_cents: customers ? Math.round(closing / customers) : null,
    usage_revenue_cents: 0,
    opening_cents: opening,
    new_cents: m.new,
    reactivated_cents: m.reactivated,
    expansion_cents: m.expansion,
    contraction_cents: m.contraction,
    churned_cents: m.churned,
    closing_cents: closing,
    new_customers: m.new ? m.new / 10000 : 0,
    reactivated_customers: m.reactivated ? 1 : 0,
    expansion_customers: m.expansion ? 2 : 0,
    contraction_customers: m.contraction ? 1 : 0,
    churned_customers: m.churned ? 1 : 0,
  };
}

const mrrMonths: StripeMrrMonth[] = [
  mrrMonth("2026-06", 0, { new: 100000 }, 10),
  mrrMonth("2026-07", 100000, { new: 20000 }, 10),
  // The focus month: 120,000 + 30,000 + 5,000 + 10,000 - 5,000 - 10,000 = 150,000.
  mrrMonth("2026-08", 120000, { new: 30000, reactivated: 5000, expansion: 10000, contraction: 5000, churned: 10000 }, 12),
  mrrMonth("2026-09", 150000, {}, 12),
];

function churnRow(month: string, start: number, churned: number, involuntary: number, opening: number, churnedMrr: number, contraction: number, expansion: number): StripeChurnRow {
  const pct = (part: number, whole: number) => (whole ? Math.round((part * 10000) / whole) / 100 : null);
  return {
    month,
    start_customers: start,
    churned_customers: churned,
    voluntary_customers: churned - involuntary,
    involuntary_customers: involuntary,
    customer_churn_pct: pct(churned, start),
    opening_mrr_cents: opening,
    churned_mrr_cents: churnedMrr,
    voluntary_mrr_cents: involuntary ? 0 : churnedMrr,
    involuntary_mrr_cents: involuntary ? churnedMrr : 0,
    contraction_cents: contraction,
    expansion_cents: expansion,
    gross_revenue_churn_pct: pct(churnedMrr + contraction, opening),
    net_revenue_churn_pct: pct(churnedMrr + contraction - expansion, opening),
    nrr_pct: pct(opening + expansion - churnedMrr - contraction, opening),
    grr_pct: pct(opening - churnedMrr - contraction, opening),
  };
}

const churnMonths: StripeChurnRow[] = [
  churnRow("2026-06", 0, 0, 0, 0, 0, 0, 0),
  churnRow("2026-07", 10, 0, 0, 100000, 0, 0, 0),
  churnRow("2026-08", 10, 1, 1, 120000, 10000, 5000, 10000),
  churnRow("2026-09", 12, 0, 0, 150000, 0, 0, 0),
];

const fee = (count: number, gross: number, fees: number): StripeFeeFigures => ({ count, gross_cents: gross, fees_cents: fees, rate_pct: gross ? Math.round((fees * 100000) / gross) / 1000 : null });

const feeMonth = (month: string, card: number, link: number): StripeFeesSection["months"][number] => ({
  month,
  card: fee(card ? 2 : 0, card, Math.round(card * 0.03)),
  link: fee(link ? 4 : 0, link, Math.round(link * 0.03)),
  ach: fee(0, 0, 0),
  other: fee(0, 0, 0),
  total: fee((card ? 2 : 0) + (link ? 4 : 0), card + link, Math.round(card * 0.03) + Math.round(link * 0.03)),
});

const recoveryMonth = (month: string, figures: Partial<StripeRecoveryMonth> = {}): StripeRecoveryMonth => ({
  month,
  failed_charges: 0,
  failed_cents: 0,
  dunning_invoices: 0,
  dunning_cents: 0,
  recovered_invoices: 0,
  recovered_cents: 0,
  lost_invoices: 0,
  lost_cents: 0,
  in_progress_invoices: 0,
  in_progress_cents: 0,
  open_invoices: 0,
  open_cents: 0,
  recovery_rate_pct: null,
  ...figures,
});

// August: two invoices recovered, one lost, one Stripe is still retrying (in progress, not in the rate).
const augustRecovery: Partial<StripeRecoveryMonth> = { failed_charges: 3, failed_cents: 30000, dunning_invoices: 4, dunning_cents: 40000, recovered_invoices: 2, recovered_cents: 20000, lost_invoices: 1, lost_cents: 10000, in_progress_invoices: 1, in_progress_cents: 10000, recovery_rate_pct: 66.67 };
const { month: _totalMonth, ...recoveryTotals } = recoveryMonth("2026-08", augustRecovery);

/** A $20,000 Capital loan with its terms: an 18.4% APR from the repayment timeline. */
export const stripeCapitalCost: StripeCapitalCost = {
  account: "main",
  financing: "flxln_TEST0001",
  label: "Capital loan 2026",
  terms: true,
  principal_cents: 2000000,
  fee_cents: 200000,
  paid_cents: 1000000,
  principal_outstanding_cents: 1090909,
  remaining_cents: 1200000,
  proceeds_date: "2026-03-02",
  last_paydown: "2026-09-12",
  apr_pct: 18.4,
  effective_annual_pct: 20.1,
  projected: true,
  days: 365,
  note: "rest of the repayment projected at the average daily pace so far",
};

const forecastDays = Array.from({ length: 14 }, (_, i) => {
  const day = `2026-10-${String(8 + i).padStart(2, "0")}`;
  // Bills on the 10th take the balance to its low; renewals arrive on the 15th.
  const balance = i < 2 ? 500000 : i < 7 ? 400000 : 520000;
  return { date: day, inflow_cents: i === 7 ? 120000 : 0, outflow_cents: i === 2 ? 100000 : 0, balance_cents: balance, lowest: i === 2 };
});

export const stripeMetrics: StripeMetrics = {
  ok: true,
  ready: true,
  start: "2026-06-01",
  end: "2026-09-30",
  month: "2026-08",
  business: "general",
  account: null,
  currency: "usd",
  as_of: "2026-10-08",
  accounts: ["main"],
  approximations: ["2 past subscription-month(s) use the current items because the invoices for that period were not imported"],
  summary: {
    mrr_cents: 150000,
    arr_cents: 1800000,
    trialing_mrr_cents: 0,
    active_customers: 12,
    free_subscriptions: 0,
    arpa_cents: 12500,
    net_new_mrr_cents: 30000,
    customer_churn_pct: 10.0,
    gross_revenue_churn_pct: 12.5,
    net_revenue_churn_pct: 4.17,
    nrr_t12m_pct: null,
    grr_t12m_pct: null,
    gross_margin_pct: 80.0,
    effective_fee_pct: 3.0,
    ltv_cents: 400000,
    top10_share_pct: 100.0,
    hhi: 2600.0,
    recovery_rate_pct: 66.67,
    at_risk_mrr_cents: 20000,
    forecast_low_cents: 400000,
    forecast_low_date: "2026-10-10",
  },
  mrr: {
    month: "2026-08",
    mrr_cents: 150000,
    arr_cents: 1800000,
    trialing_mrr_cents: 0,
    customers: 12,
    subscriptions: 12,
    free_subscriptions: 0,
    arpa_cents: 12500,
    usage_revenue_cents: 0,
    bridge: { ...mrrMonths[2], reconciles: true },
    by_product: [
      { product: "prod_TESTA", name: "Plan A", mrr_cents: 100000, share_pct: 66.67 },
      { product: "prod_TESTB", name: "Plan B", mrr_cents: 50000, share_pct: 33.33 },
    ],
    months: mrrMonths,
  },
  churn: { month: churnMonths[2], months: churnMonths, nrr_t12m_pct: null, grr_t12m_pct: null },
  cohorts: {
    max_k: 2,
    cohorts: [
      {
        cohort: "2026-06",
        customers: 10,
        retention: [
          { k: 0, month: "2026-06", customers: 10, customers_pct: 100.0, revenue_cents: 100000, revenue_pct: 100.0 },
          { k: 1, month: "2026-07", customers: 10, customers_pct: 100.0, revenue_cents: 120000, revenue_pct: 120.0 },
          { k: 2, month: "2026-08", customers: 8, customers_pct: 80.0, revenue_cents: 90000, revenue_pct: 90.0 },
        ],
      },
      {
        cohort: "2026-08",
        customers: 4,
        retention: [{ k: 0, month: "2026-08", customers: 4, customers_pct: 100.0, revenue_cents: 40000, revenue_pct: 100.0 }],
      },
    ],
  },
  margin: {
    products: [
      { product: "prod_TESTA", name: "Plan A", gross_cents: 300000, fees_cents: 9000, refunds_cents: 20000, disputes_cents: 0, capital_fees_cents: 6000, cogs_cents: 30000, margin_cents: 235000, margin_pct: 78.33, revenue_share_pct: 75.0 },
      { product: "prod_TESTB", name: "Plan B", gross_cents: 100000, fees_cents: 3000, refunds_cents: 0, disputes_cents: 2000, capital_fees_cents: 2000, cogs_cents: 8000, margin_cents: 85000, margin_pct: 85.0, revenue_share_pct: 25.0 },
    ],
    totals: { gross_cents: 400000, fees_cents: 12000, refunds_cents: 20000, disputes_cents: 2000, capital_fees_cents: 8000, cogs_cents: 38000, margin_cents: 320000, margin_pct: 80.0 },
    months: [],
    cogs: [],
    links: { invoice_payment: 10, legacy: 0, heuristic: 0, unlinked: 0 },
  },
  fees: {
    months: [feeMonth("2026-06", 20000, 80000), feeMonth("2026-07", 20000, 80000), feeMonth("2026-08", 20000, 80000), feeMonth("2026-09", 20000, 80000)],
    range: { card: fee(8, 80000, 2400), link: fee(16, 320000, 9600), ach: fee(0, 0, 0), other: fee(0, 0, 0), total: fee(24, 400000, 12000) },
    ach_savings: {
      estimate: true,
      card_link_count: 24,
      card_link_volume_cents: 400000,
      card_link_fees_cents: 12000,
      card_link_rate_pct: 3.0,
      card_rate_pct: 3.0,
      link_rate_pct: 3.0,
      link_share_pct: 80.0,
      ach_history: false,
      ach_rate_pct: 0.8,
      ach_rate_source: "stripe_pricing",
      ach_cap_cents: 500,
      estimated_ach_fees_cents: 3200,
      estimated_savings_cents: 8800,
    },
  },
  capital: {
    financings: [stripeCapitalCost],
    withheld: {
      start_date: "2026-03-02",
      months: [
        { month: "2026-08", gross_cents: 100000, withheld_cents: 10000, share_pct: 10.0 },
        { month: "2026-09", gross_cents: 100000, withheld_cents: 12000, share_pct: 12.0 },
      ],
      active_months: 2,
      days: 20,
      avg_daily_share_pct: 11.0,
      avg_monthly_share_pct: 11.0,
    },
  },
  ltv: {
    arpa_cents: 12500,
    gross_margin_pct: 80.0,
    monthly_revenue_churn_pct: 2.5,
    churn_capped: false,
    lifetime_months: 40.0,
    ltv_cents: 400000,
    cac_cents: null,
    cac_source: null,
    payback_months: null,
    notes: ["payback omitted: set [stripe.metrics] cac or cac_category"],
  },
  concentration: {
    window_start: "2025-09",
    window_end: "2026-08",
    total_cents: 400000,
    customers: 3,
    no_customer_cents: 0,
    top1_pct: 40.0,
    top5_pct: 100.0,
    top10_pct: 100.0,
    hhi: 2600.0,
    top: [
      { rank: 1, customer: "cus_TEST0001", revenue_cents: 160000, share_pct: 40.0 },
      { rank: 2, customer: "cus_TEST0002", revenue_cents: 120000, share_pct: 30.0 },
      { rank: 3, customer: "cus_TEST0003", revenue_cents: 120000, share_pct: 30.0 },
    ],
  },
  recovery: {
    months: [
      recoveryMonth("2026-06"),
      recoveryMonth("2026-07"),
      recoveryMonth("2026-08", augustRecovery),
      recoveryMonth("2026-09"),
    ],
    totals: recoveryTotals,
    at_risk_mrr_cents: 20000,
    at_risk_subscriptions: 2,
    collection_rate_pct: 95.0,
  },
  refunds: {
    months: MONTHS.map((month) => ({ month, gross_cents: 100000, refunds_cents: month === "2026-08" ? 18000 : 500, disputes_cents: 0, refund_rate_pct: month === "2026-08" ? 18.0 : 0.5, dispute_rate_pct: 0 })),
    products: [
      {
        product: "prod_TESTA",
        name: "Plan A",
        months: MONTHS.map((month) => ({
          month,
          gross_cents: 75000,
          refunds_cents: month === "2026-08" ? 18000 : 500,
          disputes_cents: 0,
          refund_rate_pct: month === "2026-08" ? 24.0 : 0.67,
          dispute_rate_pct: 0,
          median_rate_pct: month === "2026-08" ? 0.67 : null,
          spike: month === "2026-08",
        })),
      },
      {
        product: "prod_TESTB",
        name: "Plan B",
        months: MONTHS.map((month) => ({ month, gross_cents: 25000, refunds_cents: 0, disputes_cents: 0, refund_rate_pct: 0, dispute_rate_pct: 0, median_rate_pct: null, spike: false })),
      },
    ],
    spikes: [{ month: "2026-08", product: "prod_TESTA", name: "Plan A", refunds_cents: 18000, refund_rate_pct: 24.0, median_rate_pct: 0.67 }],
    spike_factor: 2,
    spike_min_cents: 5000,
  },
  forecast: {
    estimate: true,
    start: "2026-10-08",
    end: "2026-10-21",
    days: 14,
    opening_cash_cents: 500000,
    closing_cents: 520000,
    lowest: { date: "2026-10-10", balance_cents: 400000 },
    collection_rate_pct: 95.0,
    fee_rate_pct: 3.0,
    withheld_share_pct: 10.0,
    capital_owed_cents: 1200000,
    payout_lag_days: 4,
    totals: { renewals_cents: 130000, capital_withholding_cents: -10000, in_transit_cents: 0, stripe_balance_cents: 0, bills_cents: -100000, cards_cents: 0 },
    daily: forecastDays,
    weekly: [
      { week_start: "2026-10-08", week_end: "2026-10-14", renewals_cents: 0, in_transit_cents: 0, capital_withholding_cents: 0, bills_cents: -100000, cards_cents: 0, inflow_cents: 0, outflow_cents: 100000, closing_cents: 400000, low_cents: 400000 },
      { week_start: "2026-10-15", week_end: "2026-10-21", renewals_cents: 130000, in_transit_cents: 0, capital_withholding_cents: -10000, bills_cents: 0, cards_cents: 0, inflow_cents: 130000, outflow_cents: 10000, closing_cents: 520000, low_cents: 520000 },
    ],
    events: [
      { date: "2026-10-10", kind: "bill", label: "ZZZ RENT", cents: -100000 },
      { date: "2026-10-15", kind: "renewals", label: "Stripe renewals charged 2026-10-11 (12)", cents: 130000 },
      { date: "2026-10-15", kind: "capital_withholding", label: "Stripe Capital withheld from those renewals", cents: -10000 },
    ],
    notes: [],
  },
};

/** Billing objects not imported yet. */
export const stripeMetricsNotReady: StripeMetrics = { ...stripeMetrics, ready: false };
