import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useStripeMetrics } from "../api/queries";
import type {
  StripeCapitalCost,
  StripeChurnRow,
  StripeCohort,
  StripeFeeFigures,
  StripeFeeMethod,
  StripeMarginSection,
  StripeMetrics,
  StripeMetricsExportTable,
  StripeMrrMonth,
  StripeRecoveryMonth,
  StripeRefundsSection,
} from "../api/types";
import { Badge } from "../components/Badge";
import { Card, CardHeader } from "../components/Card";
import { AreaChart } from "../components/charts/AreaChart";
import { BarList } from "../components/charts/BarList";
import { DonutChart } from "../components/charts/DonutChart";
import { LineChart } from "../components/charts/LineChart";
import { StackedBarChart } from "../components/charts/StackedBarChart";
import { WaterfallChart } from "../components/charts/WaterfallChart";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { ExportButtons } from "../components/ExportButtons";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { Select } from "../components/Select";
import { SkeletonCard } from "../components/Skeleton";
import { Pct } from "../components/Whmcs";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { useUrlState } from "../hooks/useUrlState";
import { monthEnd } from "../lib/dates";
import { formatDate, formatMoney, formatMonth, formatPct, formatRange, pluralize } from "../lib/format";
import { businessLabel } from "../lib/labels";

type Params = Record<string, string>;
type Tab = "overview" | "growth" | "profit" | "cash";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "growth", label: "Growth and churn" },
  { value: "profit", label: "Profit and fees" },
  { value: "cash", label: "Cash and risk" },
];

const EXPORT_BASE = "/api/stripe/metrics/export";

export const METHOD_LABELS: Record<StripeFeeMethod, string> = {
  card: "Card",
  link: "Link (card-funded)",
  ach: "ACH (us_bank_account)",
  other: "Other",
  total: "Total",
};
const METHOD_TONES: Record<Exclude<StripeFeeMethod, "total">, string> = { card: "cat-2", link: "cat-5", ach: "cat-7", other: "cat-10" };

/** CSV / XLSX / PDF of one metrics table, for the same range, business, and focus month as the page. */
function TableExport({ table, params, label }: { table: StripeMetricsExportTable; params: Params; label: string }) {
  return <ExportButtons base={`${EXPORT_BASE}/${table}`} params={params} label={label} print={false} />;
}

/** Fee rates need two decimals ("2.90%"); the rest of the page uses one. */
function rate(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)}%`;
}

/** "Jul", or "Jul 2025" for the first month and each January when the months span years (as on the Stripe page). */
function monthLabel(month: string, index: number, months: string[]): string {
  const spansYears = months.length > 0 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  return spansYears && (index === 0 || month.endsWith("-01")) ? formatMonth(month) : formatMonth(month, { short: true });
}

export function NoSubscriptionData({ compact }: { compact?: boolean }) {
  return (
    <EmptyState icon="card" title="No subscription data yet" compact={compact}>
      Pull subscriptions, invoices and charges (with invoice payments, customers, prices, products and coupons), then run <code>bin/hpbooks stripe import</code>; see docs/stripe.md, &ldquo;Billing objects&rdquo;.
    </EmptyState>
  );
}

function StripeEyebrow() {
  const location = useLocation();
  return (
    <Link to={withGlobal("/stripe", location.search)} className="link-quiet">
      <Icon name="chevronLeft" size={14} /> Stripe
    </Link>
  );
}

export default function StripeInsightsPage() {
  const filters = useGlobalFilters();
  const url = useUrlState();
  const rawTab = url.get("tab", "overview") as Tab;
  const tab: Tab = TABS.some((item) => item.value === rawTab) ? rawTab : "overview";
  const month = /^\d{4}-\d{2}$/.test(url.get("month")) ? url.get("month") : "";
  const params: Params = { start: filters.start, end: filters.end, business: filters.business, ...(month ? { month } : {}) };
  const query = useStripeMetrics(params);
  const raw = query.data;
  const data = raw?.ready ? raw : undefined;
  const notReady = raw !== undefined && !raw.ready;
  // Exports name the focus month the page shows, so the files match the screen.
  const exportParams: Params = data ? { ...params, month: data.month } : params;

  return (
    <div className="page">
      <PageHeader
        eyebrow={<StripeEyebrow />}
        title="Stripe insights"
        subtitle={
          <>
            {formatRange(filters.start, filters.end)} · {businessLabel(filters.business)}
            {data ? <> · focus month {formatMonth(data.month)}</> : null} · MRR, churn, margins, fees, and the cash forecast from Stripe billing
          </>
        }
        actions={notReady ? null : <ExportButtons base={`${EXPORT_BASE}/summary`} params={exportParams} />}
      />
      <div className="toolbar insights-toolbar no-print">
        <SegmentedControl label="Insights section" value={tab} onChange={(value) => url.patch({ tab: value === "overview" ? "" : value })} options={TABS} />
        {data ? (
          <Select
            label="Focus month"
            size="sm"
            className="insights-month"
            value={data.month}
            onChange={(value) => url.patch({ month: value })}
            options={[...data.mrr.months].reverse().map((row) => ({ value: row.month, label: formatMonth(row.month) }))}
          />
        ) : null}
      </div>
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {notReady ? (
        <NoSubscriptionData />
      ) : !data ? (
        query.isError ? null : (
          <>
            <section className="kpi-grid kpi-grid--5" aria-label="Loading">
              {[0, 1, 2, 3, 4].map((i) => (
                <KpiCard key={i} label="" loading />
              ))}
            </section>
            <SkeletonCard height={240} />
          </>
        )
      ) : tab === "overview" ? (
        <OverviewTab data={data} params={exportParams} />
      ) : tab === "growth" ? (
        <GrowthTab data={data} params={exportParams} />
      ) : tab === "profit" ? (
        <ProfitTab data={data} params={exportParams} />
      ) : (
        <CashTab data={data} params={exportParams} />
      )}
    </div>
  );
}

function hasSubscriptions(data: StripeMetrics): boolean {
  return data.mrr.months.some((row) => row.mrr_cents > 0 || row.trialing_mrr_cents > 0) || data.mrr.mrr_cents > 0;
}

// --- Overview --------------------------------------------------------------------------------------

function capitalKpi(financings: StripeCapitalCost[]): { display: string; footer: ReactNode } {
  if (financings.length === 0) return { display: "None", footer: <span className="muted">No Stripe Capital financing</span> };
  const missing = financings.filter((row) => !row.terms);
  if (missing.length > 0) {
    return { display: "Terms needed", footer: <span className="muted">Add [[stripe.capital]] terms to price {missing.length === 1 ? "the loan" : `${missing.length} loans`}</span> };
  }
  const priced = financings.filter((row) => row.apr_pct !== null);
  if (priced.length === 0) return { display: "—", footer: <span className="muted">{financings[0].note || "APR not known yet"}</span> };
  const top = priced.reduce((a, b) => ((b.apr_pct ?? 0) > (a.apr_pct ?? 0) ? b : a));
  return {
    display: formatPct(top.apr_pct),
    footer: (
      <span className="muted">
        Effective annual {formatPct(top.effective_annual_pct)}
        {top.projected ? " · rest projected" : ""}
        {priced.length > 1 ? ` · highest of ${priced.length}` : ""}
      </span>
    ),
  };
}

function OverviewTab({ data, params }: { data: StripeMetrics; params: Params }) {
  const s = data.summary;
  const churn = data.churn.month;
  const bridge = data.mrr.bridge;
  const capital = capitalKpi(data.capital.financings);
  const total = data.fees.range.total;
  const nrrT12 = s.nrr_t12m_pct !== null;
  const subs = hasSubscriptions(data);
  const bridgeRows = [
    { key: "opening", label: "Opening MRR", cents: bridge.opening_cents, customers: null as number | null },
    { key: "new", label: "+ New", cents: bridge.new_cents, customers: bridge.new_customers },
    { key: "reactivated", label: "+ Reactivated", cents: bridge.reactivated_cents, customers: bridge.reactivated_customers },
    { key: "expansion", label: "+ Expansion", cents: bridge.expansion_cents, customers: bridge.expansion_customers },
    { key: "contraction", label: "− Contraction", cents: -bridge.contraction_cents, customers: bridge.contraction_customers },
    { key: "churned", label: "− Churned", cents: -bridge.churned_cents, customers: bridge.churned_customers },
    { key: "closing", label: "Closing MRR", cents: bridge.closing_cents, customers: null },
  ];
  const product = data.mrr.by_product;

  return (
    <>
      <section className="kpi-grid kpi-grid--5" aria-label="Stripe insights KPIs">
        <KpiCard
          label="MRR"
          cents={s.mrr_cents}
          emphasis="primary"
          spark={data.mrr.months.map((row) => row.mrr_cents)}
          sparkTone="rev"
          footer={<span className="muted">Net new <Money cents={s.net_new_mrr_cents} signed colorPositive /> in {formatMonth(data.month, { short: true })}</span>}
        />
        <KpiCard label="ARR" cents={s.arr_cents} footer={<span className="muted">MRR × 12</span>} />
        <KpiCard
          label="Active customers"
          display={s.active_customers.toLocaleString("en-US")}
          footer={<span className="muted">{s.trialing_mrr_cents > 0 ? <>Trialing MRR <Money cents={s.trialing_mrr_cents} /></> : pluralize(data.mrr.subscriptions, "paying subscription")}</span>}
        />
        <KpiCard label="ARPA" display={formatMoney(s.arpa_cents)} footer={<span className="muted">MRR per customer</span>} />
        <KpiCard
          label="Customer churn"
          display={formatPct(s.customer_churn_pct)}
          footer={
            <span className="muted">
              {churn.churned_customers} of {churn.start_customers} · {churn.voluntary_customers} voluntary, {churn.involuntary_customers} involuntary
            </span>
          }
        />
        <KpiCard label="Revenue churn" display={formatPct(s.gross_revenue_churn_pct)} footer={<span className="muted">Gross · net {formatPct(s.net_revenue_churn_pct)} after expansion</span>} />
        <KpiCard
          label="NRR"
          display={formatPct(nrrT12 ? s.nrr_t12m_pct : churn.nrr_pct)}
          footer={<span className="muted">{nrrT12 ? <>Trailing 12 months · GRR {formatPct(s.grr_t12m_pct)}</> : <>{formatMonth(data.month, { short: true })} only; 12 months of history for the trailing figure</>}</span>}
        />
        <KpiCard
          label="At-risk MRR"
          cents={s.at_risk_mrr_cents}
          tone={s.at_risk_mrr_cents > 0 ? "danger" : "default"}
          footer={<span className="muted">{pluralize(data.recovery.at_risk_subscriptions, "past due or unpaid subscription")}</span>}
        />
        <KpiCard label="Effective fee rate" display={rate(s.effective_fee_pct)} footer={<span className="muted"><Money cents={total.fees_cents} /> on <Money cents={total.gross_cents} /> in the range</span>} />
        <KpiCard label="Capital APR" display={capital.display} footer={capital.footer} />
      </section>

      {!subs ? <NoSubscriptionData compact /> : null}

      {subs ? (
        <Card>
          <CardHeader title="MRR trend" subtitle="Month-end MRR (the current month: today), trials excluded" />
          <AreaChart label="Month-end MRR by month" valueLabel="MRR" tone="rev" axis="month" points={data.mrr.months.map((row) => ({ date: monthEnd(row.month), value: row.mrr_cents }))} />
        </Card>
      ) : null}

      {subs ? (
        <div className="whmcs-two">
          <Card padded={false} className="table-section" aria-label="MRR movement bridge">
            <div className="table-section__head">
              <CardHeader
                title={<>MRR bridge, {formatMonth(data.month)}{bridge.reconciles ? null : <> <Badge tone="warn">Does not add up</Badge></>}</>}
                subtitle="Per customer, month end over month end: opening + new + reactivated + expansion − contraction − churned = closing"
                actions={<TableExport table="movement" params={params} label="MRR movement" />}
              />
              <WaterfallChart
                label={`MRR bridge for ${formatMonth(data.month)}`}
                steps={bridgeRows.map((row) => ({
                  key: row.key,
                  label: row.key === "opening" ? "Opening" : row.key === "closing" ? "Closing" : row.label.slice(2),
                  cents: row.cents,
                  kind: row.customers === null ? "total" : "step",
                  note: row.customers === null ? undefined : pluralize(row.customers, "customer"),
                }))}
              />
            </div>
            <DataTable
              caption={`MRR bridge table, ${formatMonth(data.month)}`}
              columns={[
                { key: "label", header: "", accessor: (row) => row.label, cell: (row) => (row.customers === null ? <span className="strong">{row.label}</span> : row.label) },
                {
                  key: "cents",
                  header: "Amount",
                  accessor: (row) => row.cents,
                  align: "right",
                  cell: (row) => (row.customers === null ? <Money cents={row.cents} strong /> : <Money cents={row.cents} signed colorPositive />),
                },
                { key: "customers", header: "Customers", accessor: (row) => row.customers, format: "number" },
              ]}
              rows={bridgeRows}
              rowKey={(row) => row.key}
              dense
            />
          </Card>
          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="MRR by product" subtitle={`Month end, ${formatMonth(data.month)}`} actions={<TableExport table="mrr-products" params={params} label="MRR by product" />} />
              {product.length > 0 ? (
                <DonutChart
                  label="MRR by product"
                  centerLabel="MRR"
                  slices={product.slice(0, 9).map((row, index) => ({ key: row.product, label: row.name, cents: row.mrr_cents, tone: `cat-${index + 1}` }))}
                />
              ) : (
                <EmptyState icon="pie" title="No MRR in this month" compact />
              )}
            </div>
          </Card>
        </div>
      ) : null}

      <Approximations notes={data.approximations} />
    </>
  );
}

function Approximations({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <aside className="callout callout--muted insights-notes" aria-label="Approximations">
      <Icon name="info" size={16} />
      <div>
        <p className="strong">How these figures are estimated</p>
        <ul>
          {notes.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// --- Growth and churn --------------------------------------------------------------------------

function GrowthTab({ data, params }: { data: StripeMetrics; params: Params }) {
  const months = data.mrr.months.map((row) => row.month);
  const churnMonths = data.churn.months;
  if (!hasSubscriptions(data)) return <NoSubscriptionData />;

  const movementColumns: Column<StripeMrrMonth>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span>, sortable: true },
    { key: "opening", header: "Opening", accessor: (row) => row.opening_cents, format: "money", hideOnMobile: true },
    { key: "new", header: "New", accessor: (row) => row.new_cents, format: "money", sortable: true },
    { key: "reactivated", header: "Reactivated", accessor: (row) => row.reactivated_cents, format: "money", hideOnMobile: true },
    { key: "expansion", header: "Expansion", accessor: (row) => row.expansion_cents, format: "money", sortable: true },
    { key: "contraction", header: "Contraction", accessor: (row) => row.contraction_cents, format: "money", sortable: true },
    { key: "churned", header: "Churned", accessor: (row) => row.churned_cents, format: "money", sortable: true },
    { key: "net", header: "Net new", accessor: (row) => row.closing_cents - row.opening_cents, format: "money-signed", sortable: true },
    { key: "closing", header: "Closing", accessor: (row) => row.closing_cents, format: "money", sortable: true },
  ];
  const churnColumns: Column<StripeChurnRow>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span>, sortable: true },
    { key: "start", header: "Customers at start", accessor: (row) => row.start_customers, format: "number", hideOnMobile: true },
    { key: "churned", header: "Churned", accessor: (row) => row.churned_customers, format: "number", sortable: true },
    { key: "voluntary", header: "Voluntary", accessor: (row) => row.voluntary_customers, format: "number", hideOnMobile: true },
    { key: "involuntary", header: "Involuntary", accessor: (row) => row.involuntary_customers, format: "number", hideOnMobile: true },
    { key: "customer", header: "Customer churn", accessor: (row) => row.customer_churn_pct, format: "pct", sortable: true },
    { key: "invol_mrr", header: "Involuntary MRR", accessor: (row) => row.involuntary_mrr_cents, format: "money", hideOnMobile: true },
    { key: "gross", header: "Revenue churn", accessor: (row) => row.gross_revenue_churn_pct, format: "pct", sortable: true },
    { key: "net", header: "Net revenue churn", accessor: (row) => row.net_revenue_churn_pct, format: "pct", hideOnMobile: true },
    { key: "nrr", header: "NRR", accessor: (row) => row.nrr_pct, format: "pct", sortable: true },
    { key: "grr", header: "GRR", accessor: (row) => row.grr_pct, format: "pct", hideOnMobile: true },
  ];

  return (
    <>
      <Card>
        <CardHeader title="MRR movement by month" subtitle="Gains above zero, losses below, and the net change as a line" />
        <StackedBarChart
          label="MRR movement by month: new, reactivated, and expansion above zero, contraction and churned below, net change as a line"
          series={[
            { label: "New", tone: "rev" },
            { label: "Reactivated", tone: "cat-3" },
            { label: "Expansion", tone: "cat-5" },
            { label: "Contraction", tone: "cat-4" },
            { label: "Churned", tone: "exp" },
          ]}
          lineLabel="Net change"
          lineTone="net"
          points={data.mrr.months.map((row, index) => ({
            key: row.month,
            label: monthLabel(row.month, index, months),
            values: [row.new_cents, row.reactivated_cents, row.expansion_cents, -row.contraction_cents, -row.churned_cents],
            line: row.closing_cents - row.opening_cents,
          }))}
        />
      </Card>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="MRR movement" actions={<TableExport table="movement" params={params} label="MRR movement" />} />
        </div>
        <DataTable caption="MRR movement by month" columns={movementColumns} rows={data.mrr.months} rowKey={(row) => row.month} defaultSort={{ key: "month", dir: "desc" }} dense />
      </Card>

      <div className="whmcs-two">
        <Card>
          <CardHeader title="Churned customers" subtitle="Involuntary: canceled for a failed payment, unpaid, or left with an uncollectible invoice" />
          <StackedBarChart
            label="Churned customers by month, voluntary and involuntary"
            format="number"
            series={[
              { label: "Voluntary", tone: "cat-5" },
              { label: "Involuntary", tone: "exp" },
            ]}
            points={churnMonths.map((row, index) => ({ key: row.month, label: monthLabel(row.month, index, months), values: [row.voluntary_customers, row.involuntary_customers] }))}
          />
        </Card>
        <Card>
          <CardHeader title="Churn rates" subtitle="Customer churn, and revenue churn before (gross) and after (net) expansion" />
          <LineChart
            label="Customer, gross revenue, and net revenue churn by month"
            format="pct"
            months={months}
            series={[
              { label: "Customer churn", tone: "cat-5", values: churnMonths.map((row) => row.customer_churn_pct) },
              { label: "Revenue churn (gross)", tone: "exp", values: churnMonths.map((row) => row.gross_revenue_churn_pct) },
              { label: "Revenue churn (net)", tone: "net", values: churnMonths.map((row) => row.net_revenue_churn_pct), dashed: true },
            ]}
          />
        </Card>
      </div>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="Churn by month" actions={<TableExport table="churn" params={params} label="churn" />} />
        </div>
        <DataTable caption="Churn by month" columns={churnColumns} rows={churnMonths} rowKey={(row) => row.month} defaultSort={{ key: "month", dir: "desc" }} dense />
      </Card>

      <Card>
        <CardHeader
          title="Net and gross revenue retention"
          subtitle={
            <>
              Monthly. Trailing 12 months: NRR {formatPct(data.churn.nrr_t12m_pct)} · GRR {formatPct(data.churn.grr_t12m_pct)}
              {data.churn.nrr_t12m_pct === null ? " (needs 12 months of history)" : ""}
            </>
          }
        />
        <LineChart
          label="NRR and GRR by month"
          format="pct"
          months={months}
          series={[
            { label: "NRR", tone: "rev", values: churnMonths.map((row) => row.nrr_pct) },
            { label: "GRR", tone: "net", values: churnMonths.map((row) => row.grr_pct), dashed: true },
          ]}
        />
      </Card>

      <CohortCard cohorts={data.cohorts.cohorts} maxK={data.cohorts.max_k} params={params} />
    </>
  );
}

/** Sequential, one hue: the cell's share of month 0 sets how much of the teal chart color it takes (capped at 45% so text keeps 4.5:1 contrast in both themes). */
function heatStyle(pct: number | null): CSSProperties | undefined {
  if (pct === null) return undefined;
  const level = Math.max(0, Math.min(100, pct));
  return { "--heat": `${Math.round(level * 0.45)}%` } as CSSProperties;
}

function CohortCard({ cohorts, maxK, params }: { cohorts: StripeCohort[]; maxK: number; params: Params }) {
  const url = useUrlState();
  const mode = url.get("cohort") === "revenue" ? "revenue" : "customers";
  const columns: Column<StripeCohort>[] = [
    { key: "cohort", header: "Cohort", accessor: (row) => row.cohort, cell: (row) => <span className="nowrap strong">{formatMonth(row.cohort)}</span> },
    { key: "size", header: "Customers", accessor: (row) => row.customers, format: "number" },
    ...Array.from({ length: maxK + 1 }, (_, k): Column<StripeCohort> => ({
      key: `m${k}`,
      header: `M${k}`,
      align: "center",
      className: "heat-col",
      accessor: (row) => {
        const cell = row.retention[k];
        return cell ? (mode === "revenue" ? cell.revenue_pct : cell.customers_pct) : null;
      },
      cell: (row) => {
        const cell = row.retention[k];
        if (!cell) return null;
        const pct = mode === "revenue" ? cell.revenue_pct : cell.customers_pct;
        const title = mode === "revenue" ? `${formatMoney(cell.revenue_cents)} paid in ${formatMonth(cell.month)}` : `${cell.customers} of ${row.customers} customers with MRR in ${formatMonth(cell.month)}`;
        return (
          <span className="heat" style={heatStyle(pct)} title={title} data-heat={pct ?? ""}>
            {formatPct(pct)}
          </span>
        );
      },
    })),
  ];
  return (
    <Card padded={false} className="table-section">
      <div className="table-section__head">
        <CardHeader
          title="Cohort retention"
          subtitle={
            mode === "revenue"
              ? "Paid subscription invoice revenue, as a % of the cohort's month 0, by months since signup"
              : "Customers still paying, as a % of the cohort, by months since signup (the month of the first paid invoice)"
          }
          actions={
            <>
              <SegmentedControl
                label="Cohort measure"
                size="sm"
                value={mode}
                onChange={(value) => url.patch({ cohort: value === "customers" ? "" : value })}
                options={[
                  { value: "customers", label: "Customers" },
                  { value: "revenue", label: "Revenue" },
                ]}
              />
              <TableExport table={mode === "revenue" ? "cohort-revenue" : "cohorts"} params={params} label="cohorts" />
            </>
          }
        />
      </div>
      <DataTable caption={`Cohort retention by ${mode}`} columns={columns} rows={cohorts} rowKey={(row) => row.cohort} dense empty="No cohorts in this range." />
    </Card>
  );
}

// --- Profit and fees ---------------------------------------------------------------------------

type MarginRow = StripeMarginSection["products"][number];

function ProfitTab({ data, params }: { data: StripeMetrics; params: Params }) {
  const margin = data.margin;
  const t = margin.totals;
  const columns: Column<MarginRow>[] = [
    {
      key: "product",
      header: "Product",
      accessor: (row) => row.name,
      sortable: true,
      cell: (row) =>
        row.product === "Unattributed" ? (
          <span className="muted" title="Revenue not linked to an invoice line, and Stripe's own fees">Unattributed</span>
        ) : (
          <span className="customer-cell">
            <span className="strong">{row.name}</span>
            {row.name !== row.product ? <code className="code-chip small">{row.product}</code> : null}
          </span>
        ),
    },
    { key: "gross", header: "Revenue", accessor: (row) => row.gross_cents, format: "money", sortable: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money", sortable: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "disputes", header: "Disputes", accessor: (row) => row.disputes_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "capital", header: "Capital fee", accessor: (row) => row.capital_fees_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "cogs", header: "COGS", accessor: (row) => row.cogs_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "margin", header: "Margin", accessor: (row) => row.margin_cents, format: "money-signed", sortable: true },
    { key: "pct", header: "Margin %", accessor: (row) => row.margin_pct, cell: (row) => <Pct value={row.margin_pct} />, align: "right", sortable: true, nullsLast: true },
  ];
  const fees = data.fees;
  const months = fees.months.map((row) => row.month);
  const used = (["card", "link", "ach", "other"] as const).filter((method) => fees.range[method].count > 0);
  const methodRows = (["card", "link", "ach", "other", "total"] as const).map((method) => ({ method, ...fees.range[method] }));
  const methodColumns: Column<StripeFeeFigures & { method: StripeFeeMethod }>[] = [
    { key: "method", header: "Method", accessor: (row) => METHOD_LABELS[row.method], cell: (row) => <span className={row.method === "total" ? "strong" : undefined}>{METHOD_LABELS[row.method]}</span> },
    { key: "count", header: "Charges", accessor: (row) => row.count, format: "number" },
    { key: "gross", header: "Gross", accessor: (row) => row.gross_cents, format: "money" },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money" },
    {
      key: "rate",
      header: "Fee rate",
      accessor: (row) => row.rate_pct,
      align: "right",
      cell: (row) => (row.count === 0 ? <span className="muted">No charges</span> : <span className="num">{rate(row.rate_pct)}</span>),
    },
  ];

  return (
    <>
      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader
            title="True margin by product"
            subtitle="Revenue less Stripe fees, refunds, disputes, the Capital fee, and COGS. Charges follow their invoice lines; anything unlinked is Unattributed."
            actions={<TableExport table="margin" params={params} label="margin by product" />}
          />
        </div>
        <DataTable
          caption="Margin by product"
          columns={columns}
          rows={margin.products}
          rowKey={(row) => row.product}
          defaultSort={{ key: "gross", dir: "desc" }}
          dense
          empty="No Stripe revenue in this range."
          footer={
            margin.products.length > 0 ? (
              <tr>
                <td>Total</td>
                <td className="align-right num"><Money cents={t.gross_cents} /></td>
                <td className="align-right num"><Money cents={t.fees_cents} /></td>
                <td className="align-right num hide-mobile"><Money cents={t.refunds_cents} /></td>
                <td className="align-right num hide-mobile"><Money cents={t.disputes_cents} /></td>
                <td className="align-right num hide-mobile"><Money cents={t.capital_fees_cents} /></td>
                <td className="align-right num hide-mobile"><Money cents={t.cogs_cents} /></td>
                <td className="align-right num"><Money cents={t.margin_cents} signed colorPositive /></td>
                <td className="align-right num"><Pct value={t.margin_pct} /></td>
              </tr>
            ) : null
          }
        />
      </Card>

      <div className="whmcs-two">
        <Card>
          <CardHeader title="Margin by product" subtitle={<>Total margin <Money cents={t.margin_cents} /> ({formatPct(t.margin_pct)} of revenue)</>} />
          {margin.products.length > 0 ? (
            <BarList
              label="Margin by product"
              tone="rev"
              items={[...margin.products].sort((a, b) => b.margin_cents - a.margin_cents).map((row) => ({ key: row.product, label: row.name, cents: row.margin_cents, meta: <Pct value={row.margin_pct} /> }))}
            />
          ) : (
            <EmptyState icon="pie" title="No Stripe revenue in this range" compact />
          )}
        </Card>
        <AchSavingsCard data={data} />
      </div>

      <Card>
        <CardHeader title="Effective fee rate by payment method" subtitle="Stripe fees / gross, by month" actions={<TableExport table="fees" params={params} label="fee rates by month" />} />
        {used.length > 0 ? (
          <LineChart
            label="Effective fee rate by payment method and month"
            format="pct"
            months={months}
            series={[
              ...used.map((method) => ({ label: METHOD_LABELS[method], tone: METHOD_TONES[method], values: fees.months.map((row) => (row[method].count ? row[method].rate_pct : null)) })),
              { label: "All methods", tone: "rev", values: fees.months.map((row) => (row.total.count ? row.total.rate_pct : null)), dashed: true },
            ]}
          />
        ) : (
          <EmptyState icon="card" title="No charges with a known fee in this range" compact />
        )}
      </Card>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader
            title="Fees by payment method"
            subtitle={fees.range.ach.count === 0 ? "No ACH (us_bank_account) charges in this range: the savings estimate uses Stripe's ACH list price." : "Over the whole range"}
            actions={<TableExport table="fees-methods" params={params} label="fees by method" />}
          />
        </div>
        <DataTable caption="Fees by payment method" columns={methodColumns} rows={methodRows} rowKey={(row) => row.method} dense />
      </Card>

      <CapitalCostCard data={data} params={params} />
    </>
  );
}

function AchSavingsCard({ data }: { data: StripeMetrics }) {
  const a = data.fees.ach_savings;
  const range = data.fees.range;
  return (
    <Card aria-label="Estimated ACH savings">
      <CardHeader title={<>Estimated ACH savings <Badge tone="warn">Estimate</Badge></>} subtitle="What the card and Link charges in this range would have cost by ACH Direct Debit" />
      <p className="insights-big num">{formatMoney(a.estimated_savings_cents)}</p>
      <dl className="whmcs-facts">
        <div>
          <dt>Card + Link volume</dt>
          <dd><Money cents={a.card_link_volume_cents} /> · {pluralize(a.card_link_count, "charge")}</dd>
        </div>
        <div>
          <dt>Fees paid on it</dt>
          <dd>
            <Money cents={a.card_link_fees_cents} /> ({rate(a.card_link_rate_pct)})
          </dd>
        </div>
        <div>
          <dt>Card rate · Link rate</dt>
          <dd>
            {range.card.count ? rate(a.card_rate_pct) : "no card charges"} · {range.link.count ? rate(a.link_rate_pct) : "no Link charges"}
          </dd>
        </div>
        <div>
          <dt>ACH rate used</dt>
          <dd>
            {a.ach_rate_pct.toFixed(2)}%, capped at <Money cents={a.ach_cap_cents} /> a charge
          </dd>
        </div>
        <div>
          <dt>Same charges by ACH</dt>
          <dd><Money cents={a.estimated_ach_fees_cents} /></dd>
        </div>
      </dl>
      <ul className="muted small insights-assumptions" aria-label="ACH savings assumptions">
        <li>
          Card + Link means card charges plus Stripe Link, the saved-checkout wallet funded by cards and priced like a card
          {a.link_share_pct !== null && a.link_share_pct > 0 ? ` (Link is ${formatPct(a.link_share_pct)} of this volume)` : ""}.
        </li>
        <li>
          {a.ach_rate_source === "observed"
            ? "ACH rate: your own observed ACH fee rate in this range."
            : "ACH rate: Stripe's list price for ACH Direct Debit (0.8%, at most $5 a charge), since there are no ACH charges in this range to measure."}
        </li>
        <li>Each charge is estimated as min(amount × ACH rate, cap); savings = the fees actually paid less that.</li>
        <li>Assumes every card and Link customer had paid by ACH instead; in practice only some switch, ACH settles more slowly, and a debit can still fail or be disputed.</li>
      </ul>
    </Card>
  );
}

function CapitalCostCard({ data, params }: { data: StripeMetrics; params: Params }) {
  const cap = data.capital;
  const w = cap.withheld;
  const missing = cap.financings.filter((row) => !row.terms);
  if (cap.financings.length === 0 && w.months.length === 0) {
    return (
      <Card aria-label="Stripe Capital cost">
        <CardHeader title="Stripe Capital" />
        <EmptyState icon="cash" title="No Stripe Capital financing" compact />
      </Card>
    );
  }
  const columns: Column<StripeCapitalCost>[] = [
    {
      key: "label",
      header: "Financing",
      accessor: (row) => row.label,
      cell: (row) => (
        <span>
          {row.label}
          {!row.terms ? <> <Badge tone="warn">No terms</Badge></> : null}
        </span>
      ),
    },
    { key: "principal", header: "Principal", accessor: (row) => row.principal_cents, format: "money" },
    { key: "fee", header: "Fee", accessor: (row) => row.fee_cents, format: "money", hideOnMobile: true },
    { key: "proceeds", header: "Proceeds", accessor: (row) => row.proceeds_date, format: "date", hideOnMobile: true },
    { key: "paid", header: "Repaid", accessor: (row) => row.paid_cents, format: "money" },
    { key: "remaining", header: "Remaining", accessor: (row) => row.remaining_cents, format: "money", hideOnMobile: true },
    {
      key: "apr",
      header: "APR",
      accessor: (row) => row.apr_pct,
      align: "right",
      cell: (row) => (
        <span className="nowrap">
          <Pct value={row.apr_pct} />
          {row.projected ? <> <Badge tone="info" title="The unpaid rest is projected at the average daily repayment so far">Projected</Badge></> : null}
        </span>
      ),
    },
    { key: "eff", header: "Effective annual", accessor: (row) => row.effective_annual_pct, cell: (row) => <Pct value={row.effective_annual_pct} />, align: "right", hideOnMobile: true },
    { key: "note", header: "Note", accessor: (row) => row.note, cell: (row) => (row.note ? <span className="muted small wrap-text">{row.note}</span> : null), hideOnMobile: true },
  ];
  return (
    <Card padded={false} className="table-section" aria-label="Stripe Capital cost">
      <div className="table-section__head">
        <CardHeader
          title="Stripe Capital: true cost"
          subtitle="APR from the actual timeline: proceeds in, each repayment out (the IRR, annualized)"
          actions={<TableExport table="capital" params={params} label="Capital financings" />}
        />
      </div>
      {missing.length > 0 ? (
        <p className="notice notice--warn insights-notice" role="note">
          <Icon name="info" size={16} /> APR unknown for {missing.map((row) => row.label).join(", ")}: add [[stripe.capital]] terms (principal and fee) to the config. The withheld share below is still measured.
        </p>
      ) : null}
      {cap.financings.length > 0 ? <DataTable caption="Stripe Capital financings and their APR" columns={columns} rows={cap.financings} rowKey={(row) => `${row.account}:${row.financing ?? row.label}`} dense /> : null}
      <div className="table-section__head">
        <CardHeader
          title="Withheld share of sales"
          subtitle={
            w.start_date ? (
              <>
                From {formatDate(w.start_date)}: monthly average {formatPct(w.avg_monthly_share_pct)} over {pluralize(w.active_months, "active month")} · daily average {formatPct(w.avg_daily_share_pct)}
              </>
            ) : (
              "No repayments yet"
            )
          }
          actions={<TableExport table="capital-withheld" params={params} label="Capital withheld share" />}
        />
      </div>
      <DataTable
        caption="Capital withheld share of sales by month"
        columns={[
          { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span> },
          { key: "gross", header: "Gross charges", accessor: (row) => row.gross_cents, format: "money" },
          { key: "withheld", header: "Withheld", accessor: (row) => row.withheld_cents, format: "money" },
          { key: "share", header: "Share", accessor: (row) => row.share_pct, format: "pct" },
        ]}
        rows={w.months}
        rowKey={(row) => row.month}
        defaultSort={{ key: "month", dir: "desc" }}
        dense
        empty="No Capital repayments in this range."
      />
    </Card>
  );
}

// --- Cash and risk ------------------------------------------------------------------------------

function hhiLabel(hhi: number | null): string {
  if (hhi === null) return "";
  return hhi < 1500 ? "spread out" : hhi <= 2500 ? "moderately concentrated" : "highly concentrated";
}

type RefundRow = StripeRefundsSection["products"][number]["months"][number] & { product: string; name: string };

function CashTab({ data, params }: { data: StripeMetrics; params: Params }) {
  const ltv = data.ltv;
  const c = data.concentration;
  const rec = data.recovery;
  const months = data.refunds.months.map((row) => row.month);
  const otherNotes = ltv.notes.filter((text) => !text.startsWith("payback omitted"));

  const recoveryColumns: Column<StripeRecoveryMonth>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span>, sortable: true },
    { key: "failed", header: "Failed charges", accessor: (row) => row.failed_charges, format: "number", hideOnMobile: true },
    { key: "failed_cents", header: "Failed amount", accessor: (row) => row.failed_cents, format: "money" },
    { key: "recovered", header: "Recovered", accessor: (row) => row.recovered_cents, format: "money" },
    { key: "lost", header: "Lost", accessor: (row) => row.lost_cents, format: "money" },
    {
      key: "progress",
      header: "In progress",
      accessor: (row) => row.in_progress_cents,
      align: "right",
      cell: (row) =>
        row.in_progress_invoices > 0 ? (
          <span className="nowrap" title={`${pluralize(row.in_progress_invoices, "invoice")} Stripe will retry; not in the recovery rate`}>
            <Money cents={row.in_progress_cents} /> <Badge tone="info">In progress</Badge>
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: "open", header: "Still open", accessor: (row) => row.open_cents, format: "money", hideOnMobile: true },
    { key: "rate", header: "Recovery rate", accessor: (row) => row.recovery_rate_pct, format: "pct" },
  ];

  const refundRows: RefundRow[] = data.refunds.products
    .flatMap((p) => p.months.map((row) => ({ ...row, product: p.product, name: p.name })))
    .filter((row) => row.gross_cents || row.refunds_cents || row.disputes_cents);
  const refundColumns: Column<RefundRow>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span>, sortable: true },
    { key: "product", header: "Product", accessor: (row) => row.name, sortable: true },
    { key: "gross", header: "Gross", accessor: (row) => row.gross_cents, format: "money", hideOnMobile: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", sortable: true },
    {
      key: "rate",
      header: "Refund rate",
      accessor: (row) => row.refund_rate_pct,
      align: "right",
      sortable: true,
      cell: (row) => (
        <span className="nowrap">
          {row.spike ? <><Badge tone="neg" title={`More than ${data.refunds.spike_factor}× the 6-month median`}>Spike</Badge> </> : null}
          <span className="num">{formatPct(row.refund_rate_pct)}</span>
        </span>
      ),
    },
    { key: "median", header: "6-month median", accessor: (row) => row.median_rate_pct, format: "pct", hideOnMobile: true },
    { key: "disputes", header: "Disputes", accessor: (row) => row.disputes_cents, format: "money", hideOnMobile: true },
    { key: "drate", header: "Dispute rate", accessor: (row) => row.dispute_rate_pct, format: "pct", sortable: true },
  ];

  return (
    <>
      <div className="insights-section__head">
        <h2 className="section-title">Lifetime value</h2>
        <TableExport table="ltv" params={params} label="lifetime value" />
      </div>
      <section className="kpi-grid" aria-label="Lifetime value">
        <KpiCard
          label="LTV"
          display={formatMoney(ltv.ltv_cents)}
          emphasis="primary"
          footer={<span className="muted">ARPA × margin ÷ revenue churn{ltv.lifetime_months !== null ? ` · ${ltv.lifetime_months} months` : ""}{ltv.churn_capped ? " (capped)" : ""}</span>}
        />
        <KpiCard label="ARPA" display={formatMoney(ltv.arpa_cents)} footer={<span className="muted">MRR per customer, {formatMonth(data.month, { short: true })}</span>} />
        <KpiCard label="Gross margin" display={formatPct(ltv.gross_margin_pct)} footer={<span className="muted">After fees, refunds, disputes, Capital, COGS</span>} />
        {ltv.payback_months !== null ? (
          <KpiCard label="CAC payback" display={`${ltv.payback_months} months`} footer={<span className="muted">CAC <Money cents={ltv.cac_cents} />{ltv.cac_source === "config" ? " (config)" : ltv.cac_source ? ` · ${ltv.cac_source}` : ""}</span>} />
        ) : (
          <KpiCard label="Monthly revenue churn" display={formatPct(ltv.monthly_revenue_churn_pct)} footer={<span className="muted">Gross, last 12 months</span>} />
        )}
      </section>
      {ltv.payback_months === null ? (
        <p className="notice notice--warn" role="note">
          <Icon name="info" size={16} /> Payback is hidden: there is no customer acquisition cost. Set <code>[stripe.metrics] cac</code> (per new customer) or <code>cac_category</code> in the config.
        </p>
      ) : null}
      {otherNotes.length > 0 ? <p className="muted small">{otherNotes.join(" · ")}</p> : null}

      <div className="whmcs-two">
        <Card aria-label="Revenue concentration">
          <CardHeader
            title="Revenue concentration"
            subtitle={`Gross charges, ${formatMonth(c.window_start)} – ${formatMonth(c.window_end)} · ${pluralize(c.customers, "customer")}`}
            actions={<TableExport table="concentration" params={params} label="concentration" />}
          />
          <dl className="whmcs-facts">
            <div><dt>Top customer</dt><dd>{formatPct(c.top1_pct)}</dd></div>
            <div><dt>Top 5</dt><dd>{formatPct(c.top5_pct)}</dd></div>
            <div><dt>Top 10</dt><dd>{formatPct(c.top10_pct)}</dd></div>
            <div><dt>HHI (0–10,000)</dt><dd>{c.hhi === null ? "—" : <>{c.hhi.toLocaleString("en-US")} <span className="muted small">{hhiLabel(c.hhi)}</span></>}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Top customers" subtitle="By Stripe customer id; names are never stored" />
          {c.top.length > 0 ? (
            <BarList label="Top customers by revenue" tone="cat-2" items={c.top.map((row) => ({ key: row.customer, label: row.customer, cents: row.revenue_cents, meta: formatPct(row.share_pct) }))} />
          ) : (
            <EmptyState icon="users" title="No customer revenue in the last 12 months" compact />
          )}
        </Card>
      </div>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader
            title="Failed-payment recovery"
            subtitle="By invoice month. Recovery rate = recovered / (recovered + lost); invoices Stripe is still retrying are in progress and left out."
            actions={<TableExport table="recovery" params={params} label="recovery" />}
          />
          <dl className="whmcs-facts insights-facts">
            <div><dt>At-risk MRR now</dt><dd><Money cents={rec.at_risk_mrr_cents} /> · {pluralize(rec.at_risk_subscriptions, "past due or unpaid subscription")}</dd></div>
            <div><dt>Recovery rate</dt><dd>{formatPct(rec.totals.recovery_rate_pct)}</dd></div>
            <div><dt>In progress</dt><dd><Money cents={rec.totals.in_progress_cents} /> · {pluralize(rec.totals.in_progress_invoices, "invoice")}</dd></div>
            <div><dt>Lost</dt><dd><Money cents={rec.totals.lost_cents} /></dd></div>
          </dl>
        </div>
        <DataTable caption="Failed-payment recovery by month" columns={recoveryColumns} rows={rec.months} rowKey={(row) => row.month} defaultSort={{ key: "month", dir: "desc" }} dense />
      </Card>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader
            title="Refunds and disputes by product"
            subtitle={`A spike: a refund rate more than ${data.refunds.spike_factor}× the previous 6 months' median, with at least ${formatMoney(data.refunds.spike_min_cents)} refunded`}
            actions={<TableExport table="refunds" params={params} label="refunds" />}
          />
          {data.refunds.spikes.length > 0 ? (
            <p className="notice notice--warn insights-spikes" role="note">
              <Icon name="alert" size={16} /> Refund spike{data.refunds.spikes.length > 1 ? "s" : ""}:{" "}
              {data.refunds.spikes.map((s) => `${s.name}, ${formatMonth(s.month)} (${formatPct(s.refund_rate_pct)} against a ${formatPct(s.median_rate_pct)} median)`).join("; ")}
            </p>
          ) : null}
          {months.length > 1 ? (
            <LineChart
              label="Refund and dispute rates by month, all products"
              format="pct"
              months={months}
              series={[
                { label: "Refund rate", tone: "exp", values: data.refunds.months.map((row) => row.refund_rate_pct) },
                { label: "Dispute rate", tone: "cat-4", values: data.refunds.months.map((row) => row.dispute_rate_pct), dashed: true },
              ]}
            />
          ) : null}
        </div>
        <DataTable
          caption="Refunds and disputes by product and month"
          columns={refundColumns}
          rows={refundRows}
          rowKey={(row) => `${row.product}:${row.month}`}
          rowClassName={(row) => (row.spike ? "row--spike" : undefined)}
          defaultSort={{ key: "month", dir: "desc" }}
          pageSize={24}
          dense
          empty="No refunds or disputes in this range."
        />
      </Card>

      <ForecastCards data={data} params={params} />
    </>
  );
}

function ForecastCards({ data, params }: { data: StripeMetrics; params: Params }) {
  const f = data.forecast;
  const low = f.lowest;
  return (
    <>
      <Card aria-label="Cash forecast">
        <CardHeader
          title={<>Cash forecast <Badge tone="warn">Estimate</Badge></>}
          subtitle={
            <>
              Business bank balance, {formatDate(f.start)} – {formatDate(f.end)} · opening <Money cents={f.opening_cash_cents} /> · lowest <Money cents={low.balance_cents} /> on {formatDate(low.date)} · closing{" "}
              <Money cents={f.closing_cents} />
            </>
          }
          actions={<TableExport table="forecast" params={params} label="daily forecast" />}
        />
        <AreaChart
          label={`Forecast bank balance by day; lowest ${formatMoney(low.balance_cents)} on ${formatDate(low.date)}`}
          valueLabel="Balance (estimate)"
          tone={low.balance_cents < 0 ? "exp" : "net"}
          points={f.daily.map((row) => ({ date: row.date, value: row.balance_cents }))}
          highlight={{ date: low.date, label: `Low ${formatMoney(low.balance_cents, { whole: true })}, ${formatDate(low.date, { year: false })}` }}
          threshold={low.balance_cents < 0 ? { value: 0, label: "Zero", tone: "exp" } : undefined}
        />
        <p className="muted small">
          Renewals × {formatPct(f.collection_rate_pct)} expected collection, less {rate(f.fee_rate_pct)} fees, arriving {pluralize(f.payout_lag_days, "day")} after the charge
          {f.withheld_share_pct > 0 ? `; Stripe Capital withholds ${formatPct(f.withheld_share_pct)} while ${formatMoney(f.capital_owed_cents)} is owed` : ""}.
          {f.notes.length > 0 ? ` ${f.notes.map((note) => note.charAt(0).toUpperCase() + note.slice(1)).join(". ")}.` : ""}
        </p>
      </Card>
      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="Forecast by week" subtitle="Inflows: renewals and payouts in transit. Outflows: Capital withholding, bills, and card due dates." actions={<TableExport table="forecast-weekly" params={params} label="weekly forecast" />} />
        </div>
        <DataTable
          caption="Cash forecast by week"
          columns={[
            { key: "week", header: "Week", accessor: (row) => row.week_start, cell: (row) => <span className="nowrap">{formatDate(row.week_start, { year: false })} – {formatDate(row.week_end, { year: false })}</span> },
            { key: "renewals", header: "Renewals", accessor: (row) => row.renewals_cents, format: "money" },
            { key: "transit", header: "Payouts in transit", accessor: (row) => row.in_transit_cents, format: "money", hideOnMobile: true },
            { key: "capital", header: "Capital withholding", accessor: (row) => row.capital_withholding_cents, format: "money", hideOnMobile: true },
            { key: "bills", header: "Bills", accessor: (row) => row.bills_cents, format: "money" },
            { key: "cards", header: "Card due dates", accessor: (row) => row.cards_cents, format: "money", hideOnMobile: true },
            { key: "net", header: "Net", accessor: (row) => row.inflow_cents - row.outflow_cents, format: "money-signed" },
            {
              key: "closing",
              header: "Closing balance",
              accessor: (row) => row.closing_cents,
              align: "right",
              cell: (row) => (
                <span className="nowrap">
                  {row.week_start <= low.date && low.date <= row.week_end ? <><Badge tone="warn">Low</Badge> </> : null}
                  <Money cents={row.closing_cents} />
                </span>
              ),
            },
          ]}
          rows={f.weekly}
          rowKey={(row) => row.week_start}
          rowClassName={(row) => (row.week_start <= low.date && low.date <= row.week_end ? "row--attention" : undefined)}
          dense
        />
      </Card>
    </>
  );
}
