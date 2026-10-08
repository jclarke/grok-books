/** "all" or a business slug from the site config. */
export type Business = string;

export interface Account {
  id: string;
  name: string;
  short_name: string;
  type: "cash" | "liability";
  last4: string | null;
  institution: string | null;
}

export interface Session {
  ok: true;
  product: string;
  company: string;
  csrf_token: string;
  /** True when this Host is not loopback, so the shell needs a session. */
  requires_login: boolean;
  /** True when this browser holds a valid sign-in session. */
  authenticated: boolean;
  today: string;
  months: string[];
  latest_month: string;
  review_count: number;
  businesses: Business[];
  tags: string[];
  categories: string[];
  category_groups: Record<"revenue" | "cogs" | "opex" | "other", string[]>;
  accounts: Account[];
  /** Present only in personal mode. */
  personal?: PersonalSessionData;
}

export interface PersonalCategory {
  id: number;
  name: string;
  group: string;
  kind: "expense" | "income" | "transfer" | "funding";
  color: string;
  hidden: boolean;
  is_system: boolean;
}

export interface PersonalSessionData {
  has_accounts: boolean;
  categories: PersonalCategory[];
  setup_steps: string[];
}

export interface Kpi {
  key: "net_revenue" | "total_expenses" | "net_income";
  label: string;
  cents: number;
  prior_cents: number;
  delta: number;
  pct: number | null;
  spark: number[];
}

export interface TrendPoint {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  net: number;
}

export interface VendorRow {
  merchant: string;
  spend_cents: number;
  count: number;
  category: string;
  last_seen: string;
  /** Ledger spellings that roll up to this display name. */
  spellings?: string[];
  /** Spellings that have an alias row (the canonical name itself is not one). */
  aliases?: string[];
  alias_count?: number;
}

export interface VendorSuggestion {
  names: string[];
  reason: string;
  spend_cents: number;
}

/** Statement-balance fields. Absent on older payloads; raw balance_cents still stands. */
export interface BalanceInfo {
  anchored?: boolean;
  display_cents?: number | null;
  real_balance_cents?: number | null;
  opening_cents?: number | null;
  as_of_date?: string | null;
  anchor_cents?: number | null;
  source?: string | null;
  anchor_note?: string | null;
  drift_cents?: number | null;
  computed_cents?: number | null;
  reconcile_cents?: number | null;
  activity_cents?: number | null;
}

export interface RecurringItem {
  merchant: string;
  account_id: string;
  account_name: string;
  direction: "in" | "out";
  count: number;
  last_date: string;
  last_cents: number;
  gap_days: number;
  next_date: string;
}

export interface UpcomingBill extends RecurringItem {
  due_date: string;
  cents: number;
}

export interface Dashboard {
  start: string;
  end: string;
  prior_start: string;
  prior_end: string;
  business: Business;
  kpis: Kpi[];
  margin: { pct: number | null; prior_pct: number | null; delta: number | null };
  plug: number;
  points: TrendPoint[];
  expenses: { category: string; cents: number }[];
  revenue_split: { label: string; business: string; cents: number }[];
  refunds: number;
  cash: (BalanceInfo & {
    id: string;
    name: string;
    short_name: string;
    type: string;
    balance_cents: number;
    last_date: string | null;
  })[];
  top_vendors: VendorRow[];
  upcoming: UpcomingBill[];
  review_count: number;
}

export interface Txn {
  id: string;
  date: string;
  amount_cents: number;
  name: string;
  merchant_name: string;
  account_id: string;
  account_name: string;
  status: string;
  pending: boolean;
  business_tag: string;
  category: string;
  source: string;
  confidence: number | null;
  note: string;
}

export interface TxnPage {
  rows: Txn[];
  total: number;
  offset: number;
  limit: number;
  page_in_cents: number;
  page_out_cents: number;
}

export interface AuditRow {
  id: number;
  ts: string;
  txn_id: string | null;
  rule_id: number | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string | null;
  note: string | null;
}

export interface TxnDetail extends Txn {
  description: string;
  provider_category: string;
  suggested_pattern: string;
  history: AuditRow[];
}

export interface Classification {
  business_tag: string;
  category: string;
  source: string;
  rule_id: number | null;
  confidence: number;
  note: string;
}

export interface ClassifiedRow {
  id: string;
  business_tag: string;
  category: string;
  source: string;
  confidence: number | null;
  note: string;
}

export interface ClassifyResult {
  ok: true;
  applied_others: number;
  rule_created: boolean;
  previous: Classification | null;
  row: ClassifiedRow;
  review_count: number;
}

export interface BulkResult {
  ok: true;
  count: number;
  rows: ClassifiedRow[];
  previous: { txn_id: string; previous: Classification | null }[];
  review_count: number;
}

export interface AccountRow extends Account, BalanceInfo {
  balance_cents: number;
  active_count: number;
  superseded_count: number;
  min_date: string | null;
  max_date: string | null;
  in_cents: number;
  out_cents: number;
  net_cents: number;
}

export interface RegisterRow extends Txn {
  payment_cents: number | null;
  deposit_cents: number | null;
  running_cents: number | null;
  /** False when the row is outside the anchored running balance (pending on the anchor day, or before 2026). */
  in_balance?: boolean;
}

export interface Register extends BalanceInfo {
  account: Account & { notes: string | null };
  balance_cents: number;
  rows: RegisterRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface PnlRow {
  label: string;
  kind: "line" | "subtotal" | "total" | "memo";
  values: number[];
  prior: number | null;
  pct: number | null;
}

export interface Pnl {
  start: string;
  end: string;
  title: string;
  generated: string;
  business: Business;
  by: "month" | "year";
  columns: string[];
  column_keys: string[];
  rows: PnlRow[];
  net_income_cents: number;
  owner_draw_cents: number;
  transfer_count: number;
  transfer_cents: number;
  prior_start: string;
  prior_end: string;
}

export interface LineTxn {
  id: string;
  date: string;
  account_id: string;
  account_name: string;
  name: string;
  amount_cents: number;
  business_tag: string;
  category: string;
}

export interface PnlLines {
  label: string;
  month: string | null;
  rows: LineTxn[];
  total_cents: number;
}

export interface TableCell {
  text: string;
  cents: number | null;
}

export interface TableReport {
  name: string;
  heading: string;
  title: string;
  generated: string;
  start: string;
  end: string;
  columns: string[];
  kinds: string[];
  rows: TableCell[][];
}

export interface Vendors {
  start: string;
  end: string;
  rows: VendorRow[];
  vendor_count: number;
  total_spend_cents: number;
  suggestions?: VendorSuggestion[];
}

export interface Suggestion {
  tag: string;
  category: string;
  reason: string;
  confidence: number;
  pattern: string;
}

export interface ReviewRow extends Txn {
  suggestion: Suggestion | null;
}

export interface Rule {
  id: number;
  priority: number;
  pattern: string;
  field: string;
  account_id: string | null;
  account_name: string;
  amount_sign: string | null;
  min_amount: number | null;
  max_amount: number | null;
  business_tag: string;
  category: string;
  confidence: number;
  note: string | null;
  active: boolean;
  created_at: string;
  created_by: string;
  hits: number;
}

export interface RulePreview {
  count: number;
  manual: number;
  sample: { id: string; date: string; amount_cents: number; name: string; business_tag: string; category: string }[];
}

export interface Outlook {
  opening_cents: number;
  ending_cents: number;
  reserve_cents: number;
  after_reserve_cents: number;
  timeline: { date: string; label: string; cents: number; balance: number }[];
  daily: { date: string; balance: number }[];
  estimate: boolean;
  through: string;
}

export interface CalendarData {
  items: RecurringItem[];
  outlook: Outlook;
  upcoming: UpcomingBill[];
  reserve_cents: number;
}

export interface SearchResults {
  transactions: (Pick<Txn, "id" | "date" | "amount_cents" | "name" | "account_id" | "account_name" | "business_tag" | "category">)[];
  vendors: { name: string; count: number; spend_cents: number; last_date: string }[];
  accounts: { id: string; name: string; short_name: string }[];
}

// --- WHMCS billing ---------------------------------------------------------------

/** A WHMCS brand name from the site config (whmcs_brands). */
export type WhmcsBrand = string;

export interface WhmcsNotReady {
  ready: false;
  brands: WhmcsBrand[];
}

export interface WhmcsBrandStatus {
  brand: WhmcsBrand;
  last_run: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  last_ok: string | null;
  rows: Record<string, number>;
  first_payment: string | null;
  last_payment: string | null;
  payments_in_cents: number;
}

export interface WhmcsSyncLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  brand: WhmcsBrand;
  status: "ok" | "error";
  counts: Record<string, number | string | Record<string, number>>;
  error: string | null;
}

export interface WhmcsStatus {
  ready: boolean;
  brands: WhmcsBrandStatus[];
  log: WhmcsSyncLogRow[];
  last_sync: string | null;
}

export interface WhmcsSummary {
  ready: boolean;
  mrr_cents: number;
  arr_cents: number;
  customers: number;
  last_sync: string | null;
  last_status?: "ok" | "error" | null;
  brands: { brand: WhmcsBrand; mrr_cents: number; customers: number }[];
  spark?: number[];
}

export interface WhmcsMoney {
  gross_cents: number;
  fees_cents: number;
  refunds_cents: number;
  net_cents: number;
  payments: number;
  refund_count: number;
}

export interface WhmcsRevenue extends WhmcsMoney {
  ready: true;
  start: string;
  end: string;
  brand: string;
  by: "month" | "quarter" | "year";
  periods: (WhmcsMoney & { period: string; by_brand: Record<string, WhmcsMoney> })[];
  brands: (WhmcsMoney & { brand: WhmcsBrand })[];
  plans: (WhmcsMoney & { brand: WhmcsBrand; plan: string; group: string })[];
  totals: WhmcsMoney;
}

export interface WhmcsMrrRow {
  brand: WhmcsBrand;
  plan?: string;
  group?: string;
  services: number;
  customers: number;
  mrr_cents: number;
  arr_cents: number;
  arpu_cents: number;
  share_pct: number | null;
}

export interface WhmcsMrr {
  ready: true;
  today: string;
  brand: string;
  mrr_cents: number;
  arr_cents: number;
  customers: number;
  services: number;
  arpu_cents: number;
  suspended_mrr_cents: number;
  suspended_services: number;
  brands: WhmcsMrrRow[];
  plans: WhmcsMrrRow[];
  cycles: { cycle: string; services: number; mrr_cents: number }[];
  trend: { month: string; mrr_cents: number; customers: number; services: number; by_brand: Record<string, number> }[];
  trend_note: string;
}

export interface WhmcsChurnMonth {
  month: string;
  cancel_requests: number;
  immediate: number;
  end_of_period: number;
  start_customers: number;
  end_customers: number;
  new_customers: number;
  churned_customers: number;
  net_customer_adds: number;
  start_services: number;
  new_services: number;
  churned_services: number;
  net_adds: number;
  start_mrr_cents: number;
  new_mrr_cents: number;
  churned_mrr_cents: number;
  end_mrr_cents: number;
  logo_churn_pct: number | null;
  revenue_churn_pct: number | null;
}

export interface WhmcsChurnFigures {
  start_services: number;
  end_services: number;
  start_customers: number;
  new_services: number;
  churned_services: number;
  net_adds: number;
  new_customers: number;
  churned_customers: number;
  start_mrr_cents: number;
  new_mrr_cents: number;
  churned_mrr_cents: number;
  service_churn_pct: number | null;
  logo_churn_pct: number | null;
  revenue_churn_pct: number | null;
}

export interface WhmcsChurn {
  ready: true;
  start: string;
  end: string;
  brand: string;
  months: WhmcsChurnMonth[];
  totals: WhmcsChurnFigures & { cancel_requests: number; immediate: number; end_of_period: number };
  brands: (WhmcsChurnFigures & { brand: WhmcsBrand })[];
  plans: (WhmcsChurnFigures & { brand: WhmcsBrand; plan: string; cancel_requests: number })[];
  reasons: { category: string; count: number; share_pct: number | null }[];
  recent: { id: string; date: string; brand: WhmcsBrand; plan: string; type: string; category: string; reason: string }[];
  note: string;
}

export interface WhmcsRefundRow {
  refunds_cents: number;
  count: number;
  gross_cents: number;
  rate_pct: number | null;
}

export interface WhmcsRefunds {
  ready: true;
  start: string;
  end: string;
  brand: string;
  months: (WhmcsRefundRow & { month: string })[];
  brands: (WhmcsRefundRow & { brand: WhmcsBrand })[];
  plans: (WhmcsRefundRow & { brand: WhmcsBrand; plan: string })[];
  gateways: { gateway: string; refunds_cents: number; count: number }[];
  largest: { id: string; date: string; brand: WhmcsBrand; client_id: number | null; invoice_id: number | null; gateway: string; refund_cents: number; plan: string; trans_id: string }[];
  totals: WhmcsRefundRow;
}

export interface WhmcsOpenInvoice {
  brand: WhmcsBrand;
  invoice_id: number;
  client_id: number | null;
  client_status: string;
  date: string | null;
  due_date: string | null;
  days_overdue: number;
  bucket: string;
  balance_cents: number;
  total_cents: number;
  payment_method: string;
  last_capture_attempt: string | null;
  live_services: number;
  collectible: boolean;
}

export interface WhmcsDunning {
  ready: true;
  today: string;
  start: string;
  end: string;
  brand: string;
  totals: { open_count: number; open_cents: number; overdue_count: number; overdue_cents: number; collectible_overdue_cents: number; collectible_overdue_count: number };
  aging: { bucket: string; count: number; balance_cents: number; collectible_cents: number }[];
  gateways: { gateway: string; count: number; balance_cents: number; overdue_count: number; overdue_cents: number }[];
  trend: {
    month: string;
    invoices: number;
    invoiced_cents: number;
    paid: number;
    paid_cents: number;
    unpaid: number;
    unpaid_cents: number;
    cancelled: number;
    cancelled_cents: number;
    refunded: number;
    capture_failed: number;
    unpaid_rate_pct: number | null;
  }[];
  trend_gateways: { gateway: string; invoices: number; unpaid_or_cancelled: number; cents: number; unpaid_rate_pct: number | null }[];
  collections: WhmcsOpenInvoice[];
  note: string;
}

export interface WhmcsReconcileMonth {
  month: string;
  matched: number;
  matched_whmcs_cents: number;
  matched_books_cents: number;
  whmcs_only: number;
  whmcs_only_cents: number;
  paypal_only: number;
  paypal_only_cents: number;
  whmcs_net_cents: number;
  books_cents: number;
  difference_cents: number;
}

export interface WhmcsReconcileRow {
  key: string;
  status: "matched" | "whmcs_only" | "paypal_only";
  kind: "payment" | "refund";
  date: string;
  brand: WhmcsBrand | null;
  client_id: number | null;
  invoice_id: number | null;
  trans_id: string;
  whmcs_gross_cents: number | null;
  whmcs_fees_cents: number | null;
  whmcs_net_cents: number | null;
  books_id: string | null;
  books_date: string | null;
  books_cents: number | null;
  books_name: string | null;
  match: string | null;
}

export interface WhmcsGatewayRow {
  month: string;
  gateway: string;
  count: number;
  gross_cents: number;
  fees_cents: number;
  refunds_cents: number;
  net_cents: number;
  bank_cents: number | null;
  bank_label: string | null;
  difference_cents: number | null;
}

export interface WhmcsReconcile {
  ready: true;
  start: string;
  end: string;
  requested_start: string;
  requested_end: string;
  window_days: number;
  coverage: { books_first: string | null; books_last: string | null };
  months: WhmcsReconcileMonth[];
  totals: Omit<WhmcsReconcileMonth, "month">;
  rows: WhmcsReconcileRow[];
  gateways: WhmcsGatewayRow[];
  note: string;
}

export interface WhmcsCustomerHit {
  brand: WhmcsBrand;
  client_id: number;
  name: string;
  company: string;
  email: string;
  status: string;
  signup_date: string | null;
  country: string;
  total_paid_cents: number;
  refunds_cents: number;
  live_services: number;
  mrr_cents: number;
}

export interface WhmcsCustomer {
  brand: WhmcsBrand;
  client_id: number;
  name: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  status: string;
  signup_date: string | null;
  country: string;
  state: string;
  currency: string;
  default_gateway: string;
  credit_balance_cents: number;
  totals: {
    paid_cents: number;
    refunds_cents: number;
    fees_cents: number;
    net_cents: number;
    unpaid_cents: number;
    mrr_cents: number;
    live_services: number;
    first_payment: string | null;
    last_payment: string | null;
    payments: number;
    invoices: number;
  };
  services: {
    kind: "hosting" | "addon";
    id: number;
    plan: string;
    group: string;
    domain: string;
    status: string;
    billing_cycle: string;
    amount_cents: number;
    mrr_cents: number;
    reg_date: string | null;
    next_due_date: string | null;
    termination_date: string | null;
    payment_method: string;
    server: string;
  }[];
  payments: { id: number; date: string; gateway: string; amount_in_cents: number; fees_cents: number; amount_out_cents: number; trans_id: string; invoice_id: number | null; is_refund: boolean }[];
  invoices: { id: number; number: string; date: string | null; due_date: string | null; date_paid: string | null; status: string; total_cents: number; credit_cents: number; payment_method: string }[];
  cancellations: { date: string; service_id: number; plan: string; domain: string; type: string; reason: string }[];
  credits: { date: string | null; amount_cents: number }[];
}

// --- Server margins (/api/margins; signed-in only, names and labels included) ---

export type MarginServerKind = "dedicated" | "cloud_vm" | "pool" | "overhead";
export type MarginServerStatus = "active" | "retire_candidate" | "retired";
export type MarginRuleType = "service_id" | "domain" | "whmcs_server_id" | "product_group" | "brand";
export type MarginOverheadKind = "shared" | "not_this_business";

export interface MarginComponent {
  id: number;
  component: string;
  monthly_cost_cents: number;
  effective: string;
}

export interface MarginMapping {
  id: number;
  rule_type: MarginRuleType;
  rule_value: string;
  allocation: "direct" | "by_revenue";
  brand_scope: string;
  note: string;
}

export interface MarginServer {
  id: number;
  slug: string;
  label: string;
  vendor: string;
  kind: MarginServerKind;
  status: MarginServerStatus;
  location: string;
  notes: string;
  components: MarginComponent[];
  mappings: MarginMapping[];
  cost_cents: number;
  revenue_cents: number;
  margin_cents: number;
  margin_pct: number | null;
  services: number;
  paying_services: number;
  customers: number;
  paying_customers: number;
  brands: string[];
  flags: ("retire_candidate" | "zero_revenue" | "negative_margin" | "retired")[];
  single_customer: { brand: string; client_id: number; name: string | null } | null;
  shared: boolean;
}

export interface MarginFigures {
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  margin_pct: number | null;
}

export interface MarginOverheadLine {
  id: number;
  label: string;
  vendor: string;
  monthly_cost_cents: number;
  kind: MarginOverheadKind;
  note: string;
}

/** A customer or plan the what-if can reprice; revenue split by server id ("unmapped" for none). */
export interface MarginTarget {
  key: string;
  brand: string;
  client_id?: number;
  name?: string | null;
  plan?: string;
  group?: string;
  revenue_cents: number;
  paying_services: number;
  by_server: Record<string, number>;
}

export interface MarginTotals {
  mrr_cents: number;
  hosting_mrr_cents: number;
  addon_mrr_cents: number;
  mrr_report_cents: number;
  server_cost_cents: number;
  contribution_cents: number;
  contribution_pct: number | null;
  overhead_cents: number;
  overhead_excluded_cents: number;
  infrastructure_cents: number;
  blended_margin_cents: number;
  blended_margin_pct: number | null;
  active_services: number;
  mapped_services: number;
  unmapped_services: number;
  unmapped_cents: number;
  retire_candidate_cents: number;
}

export interface Margins {
  ok: true;
  ready: true;
  seeded: boolean;
  totals: MarginTotals;
  servers: MarginServer[];
  brands: (MarginFigures & { brand: string; services: number; unmapped_cents: number })[];
  single_customers: (MarginFigures & { server_id: number; server: string; brand: string; client_id: number; name: string | null })[];
  customer_rollups: (MarginFigures & { brand: string; client_id: number; name: string | null; services: number; servers: string[] })[];
  plan_groups: (MarginFigures & { server_id: number; server: string; group: string; services: number; paying_services: number; even_cost_cents: number; even_margin_cents: number })[];
  unmapped: {
    groups: { brand: string; group: string; cycle: string; services: number; paying_services: number; revenue_cents: number }[];
    top: { brand: string; kind: string; service_id: number; client_id: number | null; name: string | null; domain: string | null; plan: string; group: string; cycle: string; whmcs_server_id: number | null; reason: string; revenue_cents: number }[];
  };
  overhead: MarginOverheadLine[];
  whatif: { merge_default: [number, number] | null; customers: MarginTarget[]; plans: MarginTarget[] };
  notes: string[];
}

// --- Card and loan payments (minimum due, due date, APR) ---------------------

export type PaymentStatus = "overdue" | "due_soon" | "upcoming" | "paid" | "none" | "unknown";

export interface PaymentRow {
  id: string;
  label: string;
  last4: string;
  institution: string;
  class: "liability" | "loan";
  /** Amount owed. */
  balance_cents: number;
  has_terms: boolean;
  /** Stored due date; show effective_due_date instead. */
  due_date: string | null;
  apr: string | null;
  autopay: "yes" | "no" | "unknown";
  /** "manual" | "statement" | "sheet" | "inferred from payment history" | "finance" | … */
  source: string | null;
  as_of: string | null;
  unverified: boolean;
  notes: string | null;
  payer_pattern: string | null;
  statement_balance_cents: number | null;
  stored_min_cents: number | null;
  status: PaymentStatus;
  /** The date to show; already rolled to the next cycle when a payment was found. */
  effective_due_date: string | null;
  /** Negative means days past due. */
  days_until: number | null;
  /** The stored date passed and a payment was found; effective_due_date estimates the next cycle. */
  rolled: boolean;
  paid_date: string | null;
  paid_by: "payment" | "balance" | null;
  estimated: boolean;
  min_payment_cents: number | null;
  note: string;
}

export interface PaymentSummary {
  today: string;
  horizon: string;
  next30_cents: number;
  next30_count: number;
  overdue_cents: number;
  overdue_count: number;
  by_date: { date: string; cents: number; count: number }[];
  unverified_count: number;
  missing_count: number;
}

export interface Payments {
  ok: true;
  mode: "business" | "personal";
  rows: PaymentRow[];
  summary: PaymentSummary;
}

export interface PaymentUpdate {
  min_payment?: string | number | null;
  due_date?: string;
  apr?: string;
  autopay?: "yes" | "no" | "unknown";
  notes?: string;
  paid?: true;
  paid_on?: string;
  unverified?: boolean;
}

// --- Stripe (read-only; refreshed by `hpbooks stripe import`) ---------------------

/** Money figures shared by Stripe accounts, totals, and months. Refunds, disputes, and fees are positive amounts that reduce revenue. */
export interface StripeFigures {
  gross_cents: number;
  refunds_cents: number;
  disputes_cents: number;
  fees_cents: number;
  net_revenue_cents: number;
  /** Fees as a percent of gross; null when there is no gross. */
  fee_pct: number | null;
  capital_repayments_cents: number;
  capital_proceeds_cents: number;
  payouts_cents: number;
}

export interface StripeAccountSummary extends StripeFigures {
  name: string;
  label: string;
  business: string;
  currency: string;
  ledger_account_id: string;
  needs_review: number;
  skipped_currency: number;
}

export interface StripeMonth extends StripeFigures {
  month: string;
}

export type StripePayoutStatus = "matched" | "in_transit" | "unmatched" | "ambiguous" | "conflict" | "failed" | "skipped" | "no_bank_history";

/** One Stripe Capital financing (lifetime figures, not the date range). Money is cents; null when not known (no terms). */
export interface StripeCapitalFinancing {
  account: string;
  account_label: string;
  business: string;
  key: string;
  financing: string | null;
  financing_ids: string[];
  label: string;
  /** false: no [[stripe.capital]] terms, so repayments are not split into principal and fee */
  terms: boolean;
  principal_cents: number | null;
  fee_cents: number | null;
  fee_rate: number | null;
  proceeds_cents: number;
  opening_principal_cents: number | null;
  paid_cents: number;
  repaid_principal_cents: number | null;
  fee_booked_cents: number;
  fee_remaining_cents: number | null;
  principal_outstanding_cents: number | null;
  pct_repaid: number | null;
  loan_account_id: string;
  unsplit_cents: number;
  first_date: string | null;
  last_date: string | null;
  warnings: string[];
}

export interface StripeCapital {
  financings: StripeCapitalFinancing[];
  loans: {
    account: string;
    account_label: string;
    business: string;
    loan_account_id: string;
    /** Amount owed on the loan account; null before it exists. */
    loan_balance_cents: number | null;
    expected_cents: number;
    conflicts: { balance_transaction: string; reason: string }[];
  }[];
  warnings: string[];
  missing_terms: boolean;
  missing_terms_message: string | null;
  /** Repayments booked whole as transfers because no terms are configured */
  unsplit_cents: number;
}

export interface StripeSummary {
  ok: true;
  ready: boolean;
  start: string;
  end: string;
  business: string;
  accounts: StripeAccountSummary[];
  totals: StripeFigures & Partial<Pick<StripeAccountSummary, "needs_review" | "skipped_currency">>;
  months: StripeMonth[];
  payouts: Record<StripePayoutStatus, number>;
  /** unmatched + ambiguous + conflict */
  open_payouts: number;
  bank_only: number;
  /** Stripe Capital per financing; absent from older servers */
  capital?: StripeCapital;
}

export interface StripeBankDeposit {
  txn_id: string;
  date: string;
  account_id: string;
  account_label: string;
  last4: string;
  amount_cents: number;
  name: string;
  business_tag: string;
  category: string;
}

export interface StripePayoutRow {
  account: string;
  account_label: string;
  id: string;
  amount_cents: number;
  currency: string;
  created: string;
  arrival_date: string;
  stripe_status: string | null;
  match_status: StripePayoutStatus;
  match_note: string;
  bank: StripeBankDeposit | null;
}

export interface StripePayouts {
  ok: true;
  ready: boolean;
  start: string;
  end: string;
  rows: StripePayoutRow[];
  bank_only: StripeBankDeposit[];
  totals: {
    count: number;
    amount_cents: number;
    by_status: Record<StripePayoutStatus, { count: number; amount_cents: number }>;
    bank_only_count: number;
    bank_only_cents: number;
  };
}

// --- Stripe business analytics (GET /api/stripe/metrics; read-only) -----------------
// Money is integer cents in the books currency; *_pct are percentages (12.5 = 12.5%) or null when undefined.

export type StripeMetricsSection =
  | "mrr" | "churn" | "cohorts" | "margin" | "fees" | "capital" | "ltv" | "concentration" | "recovery" | "refunds" | "forecast";

export interface StripeMetricsSummary {
  mrr_cents: number;
  arr_cents: number;
  trialing_mrr_cents: number;
  active_customers: number;
  /** Subscriptions a forever coupon takes to zero: not paying customers */
  free_subscriptions: number;
  arpa_cents: number | null;
  net_new_mrr_cents: number;
  customer_churn_pct: number | null;
  gross_revenue_churn_pct: number | null;
  net_revenue_churn_pct: number | null;
  nrr_t12m_pct: number | null;
  grr_t12m_pct: number | null;
  gross_margin_pct: number | null;
  effective_fee_pct: number | null;
  ltv_cents: number | null;
  top10_share_pct: number | null;
  hhi: number | null;
  recovery_rate_pct: number | null;
  at_risk_mrr_cents: number;
  forecast_low_cents: number | null;
  forecast_low_date: string | null;
}

/** Customer-level MRR movement; opening + new + reactivated + expansion - contraction - churned = closing exactly. */
export interface StripeMrrMovement {
  opening_cents: number;
  new_cents: number;
  reactivated_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churned_cents: number;
  closing_cents: number;
  new_customers: number;
  reactivated_customers: number;
  expansion_customers: number;
  contraction_customers: number;
  churned_customers: number;
}

export interface StripeMrrMonth extends StripeMrrMovement {
  month: string;
  mrr_cents: number;
  arr_cents: number;
  trialing_mrr_cents: number;
  customers: number;
  subscriptions: number;
  free_subscriptions: number;
  arpa_cents: number | null;
  /** Invoiced metered (usage) revenue, not part of MRR */
  usage_revenue_cents: number;
}

export interface StripeMrrSection {
  month: string;
  mrr_cents: number;
  arr_cents: number;
  trialing_mrr_cents: number;
  customers: number;
  subscriptions: number;
  free_subscriptions: number;
  arpa_cents: number | null;
  usage_revenue_cents: number;
  bridge: StripeMrrMovement & { month: string; reconciles: boolean };
  by_product: { product: string; name: string; mrr_cents: number; share_pct: number | null }[];
  months: StripeMrrMonth[];
}

export interface StripeChurnRow {
  month: string;
  start_customers: number;
  churned_customers: number;
  voluntary_customers: number;
  involuntary_customers: number;
  customer_churn_pct: number | null;
  opening_mrr_cents: number;
  churned_mrr_cents: number;
  voluntary_mrr_cents: number;
  involuntary_mrr_cents: number;
  contraction_cents: number;
  expansion_cents: number;
  gross_revenue_churn_pct: number | null;
  net_revenue_churn_pct: number | null;
  nrr_pct: number | null;
  grr_pct: number | null;
}

export interface StripeChurnSection {
  month: StripeChurnRow;
  months: StripeChurnRow[];
  nrr_t12m_pct: number | null;
  grr_t12m_pct: number | null;
}

export interface StripeCohort {
  cohort: string;
  customers: number;
  retention: { k: number; month: string; customers: number; customers_pct: number | null; revenue_cents: number; revenue_pct: number | null }[];
}

export interface StripeMarginFigures {
  gross_cents: number;
  fees_cents: number;
  refunds_cents: number;
  disputes_cents: number;
  capital_fees_cents: number;
  cogs_cents: number;
  margin_cents: number;
  margin_pct: number | null;
}

export interface StripeMarginSection {
  /** product is a prod_ id or "Unattributed" */
  products: (StripeMarginFigures & { product: string; name: string; revenue_share_pct: number | null })[];
  totals: StripeMarginFigures;
  months: (StripeMarginFigures & { month: string })[];
  cogs: { month: string; category: string; cents: number; products: string[] }[];
  links: { invoice_payment: number; legacy: number; heuristic: number; unlinked: number };
}

export interface StripeFeeFigures {
  count: number;
  gross_cents: number;
  fees_cents: number;
  rate_pct: number | null;
}

export type StripeFeeMethod = "card" | "link" | "ach" | "other" | "total";

export interface StripeFeesSection {
  months: ({ month: string } & Record<StripeFeeMethod, StripeFeeFigures>)[];
  range: Record<StripeFeeMethod, StripeFeeFigures>;
  ach_savings: {
    estimate: true;
    card_link_count: number;
    card_link_volume_cents: number;
    card_link_fees_cents: number;
    card_link_rate_pct: number | null;
    /** Card and Link apart: Link is card-funded and priced like a card */
    card_rate_pct: number | null;
    link_rate_pct: number | null;
    /** Link's share of the card + Link volume */
    link_share_pct: number | null;
    /** false: no ACH (us_bank_account) charges in the range, so the ACH rate is Stripe's list price */
    ach_history: boolean;
    ach_rate_pct: number;
    ach_rate_source: "observed" | "stripe_pricing";
    ach_cap_cents: number;
    estimated_ach_fees_cents: number;
    estimated_savings_cents: number;
  };
}

export interface StripeCapitalCost {
  account: string;
  financing: string | null;
  label: string;
  terms: boolean;
  principal_cents: number | null;
  fee_cents: number | null;
  paid_cents: number;
  principal_outstanding_cents: number | null;
  remaining_cents: number | null;
  proceeds_date: string | null;
  last_paydown: string | null;
  /** Daily IRR x 365 */
  apr_pct: number | null;
  /** (1 + daily IRR) ^ 365 - 1 */
  effective_annual_pct: number | null;
  /** true: the unpaid rest was projected at the average daily repayment so far */
  projected: boolean;
  days?: number;
  note: string;
}

export interface StripeCapitalSection {
  financings: StripeCapitalCost[];
  withheld: {
    /** The loan's start (first proceeds or repayment); months before it are left out. null: no Capital activity */
    start_date: string | null;
    months: { month: string; gross_cents: number; withheld_cents: number; share_pct: number | null }[];
    /** Months from the start with sales; the monthly average is over these */
    active_months: number;
    days: number;
    avg_daily_share_pct: number | null;
    avg_monthly_share_pct: number | null;
  };
}

export interface StripeLtvSection {
  arpa_cents: number | null;
  gross_margin_pct: number | null;
  monthly_revenue_churn_pct: number | null;
  /** true: churn was about zero, lifetime capped at 60 months */
  churn_capped: boolean;
  lifetime_months: number | null;
  ltv_cents: number | null;
  cac_cents: number | null;
  cac_source: string | null;
  payback_months: number | null;
  notes: string[];
}

export interface StripeConcentrationSection {
  window_start: string;
  window_end: string;
  total_cents: number;
  customers: number;
  no_customer_cents: number;
  top1_pct: number | null;
  top5_pct: number | null;
  top10_pct: number | null;
  hhi: number | null;
  /** Customer ids only (cus_...), never names */
  top: { rank: number; customer: string; revenue_cents: number; share_pct: number | null }[];
}

export interface StripeRecoveryMonth {
  month: string;
  failed_charges: number;
  failed_cents: number;
  dunning_invoices: number;
  dunning_cents: number;
  recovered_invoices: number;
  recovered_cents: number;
  lost_invoices: number;
  lost_cents: number;
  /** Open with a retry scheduled (still in dunning): neither recovered nor lost, not in the rate */
  in_progress_invoices: number;
  in_progress_cents: number;
  /** Open with no retry left and not lost */
  open_invoices: number;
  open_cents: number;
  recovery_rate_pct: number | null;
}

export interface StripeRecoverySection {
  months: StripeRecoveryMonth[];
  totals: Omit<StripeRecoveryMonth, "month">;
  at_risk_mrr_cents: number;
  at_risk_subscriptions: number;
  collection_rate_pct: number | null;
}

export interface StripeRefundMonth {
  month: string;
  gross_cents: number;
  refunds_cents: number;
  disputes_cents: number;
  refund_rate_pct: number | null;
  dispute_rate_pct: number | null;
}

export interface StripeRefundsSection {
  months: StripeRefundMonth[];
  products: { product: string; name: string; months: (StripeRefundMonth & { median_rate_pct: number | null; spike: boolean })[] }[];
  spikes: { month: string; product: string; name: string; refunds_cents: number; refund_rate_pct: number | null; median_rate_pct: number | null }[];
  spike_factor: number;
  spike_min_cents: number;
}

export type StripeForecastKind = "renewals" | "capital_withholding" | "payout_in_transit" | "stripe_balance" | "bill" | "card_due";

export interface StripeForecastSection {
  estimate: true;
  start: string;
  end: string;
  days: number;
  opening_cash_cents: number;
  closing_cents: number;
  lowest: { date: string; balance_cents: number };
  collection_rate_pct: number;
  fee_rate_pct: number;
  withheld_share_pct: number;
  capital_owed_cents: number;
  payout_lag_days: number;
  totals: Record<"renewals_cents" | "capital_withholding_cents" | "in_transit_cents" | "stripe_balance_cents" | "bills_cents" | "cards_cents", number>;
  daily: { date: string; inflow_cents: number; outflow_cents: number; balance_cents: number; lowest: boolean }[];
  /** Per week; the *_cents by kind are signed (inflows positive) and add up to inflow - outflow */
  weekly: {
    week_start: string;
    week_end: string;
    renewals_cents: number;
    /** Payouts in transit and the Stripe balance not yet paid out */
    in_transit_cents: number;
    capital_withholding_cents: number;
    bills_cents: number;
    cards_cents: number;
    inflow_cents: number;
    outflow_cents: number;
    closing_cents: number;
    low_cents: number;
  }[];
  /** Signed: inflows positive, outflows negative */
  events: { date: string; kind: StripeForecastKind; label: string; cents: number }[];
  notes: string[];
}

export interface StripeMetricsMeta {
  ok: true;
  ready: boolean;
  start: string;
  end: string;
  /** Focus month (YYYY-MM): KPIs and the MRR bridge */
  month: string;
  business: string;
  account: string | null;
  currency: string;
  as_of: string;
  accounts: string[];
  /** What was estimated and why, one sentence each */
  approximations: string[];
}

export interface StripeMetrics extends StripeMetricsMeta {
  summary: StripeMetricsSummary;
  mrr: StripeMrrSection;
  churn: StripeChurnSection;
  cohorts: { cohorts: StripeCohort[]; max_k: number };
  margin: StripeMarginSection;
  fees: StripeFeesSection;
  capital: StripeCapitalSection;
  ltv: StripeLtvSection;
  concentration: StripeConcentrationSection;
  recovery: StripeRecoverySection;
  refunds: StripeRefundsSection;
  forecast: StripeForecastSection;
}

/** GET /api/stripe/metrics/<section>: the meta fields, the summary KPIs (forecast_* null unless the section is forecast), and that one section. */
export type StripeMetricsSectionResponse<S extends StripeMetricsSection> = StripeMetricsMeta & Pick<StripeMetrics, "summary" | S>;

/** Tables for GET /api/stripe/metrics/export/<table>.<csv|xlsx|pdf> */
export type StripeMetricsExportTable =
  | "summary" | "mrr" | "movement" | "mrr-products" | "churn" | "cohorts" | "cohort-revenue" | "margin" | "margin-months"
  | "fees" | "fees-methods" | "capital" | "capital-withheld" | "ltv" | "concentration" | "recovery" | "refunds" | "forecast" | "forecast-weekly" | "forecast-events";
