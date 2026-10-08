import { exportUrl } from "../api/client";
import { useStripePayouts, useStripeSummary } from "../api/queries";
import type { StripeAccountSummary, StripeBankDeposit, StripeCapital, StripeCapitalFinancing, StripeMonth, StripePayoutRow, StripePayoutStatus, StripeSummary } from "../api/types";
import { Badge } from "../components/Badge";
import { Card, CardHeader } from "../components/Card";
import { ComboChart } from "../components/charts/ComboChart";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { formatDate, formatMonth, formatRange, pluralize } from "../lib/format";
import { businessLabel, type Tone } from "../lib/labels";

type Params = Record<string, string>;

export const PAYOUT_STATUS: Record<StripePayoutStatus, { label: string; tone: Tone }> = {
  matched: { label: "Matched", tone: "pos" },
  in_transit: { label: "In transit", tone: "info" },
  unmatched: { label: "Unmatched", tone: "warn" },
  ambiguous: { label: "Ambiguous", tone: "warn" },
  conflict: { label: "Conflict", tone: "neg" },
  failed: { label: "Failed", tone: "neg" },
  skipped: { label: "Skipped", tone: "neutral" },
  no_bank_history: { label: "No bank history", tone: "neutral" },
};

/** "4.00% of gross"; fee_pct is null when there was no gross. */
export function feeRateText(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? "No gross in this range" : `${pct.toFixed(2)}% of gross`;
}

export function StripeNotImported({ compact }: { compact?: boolean }) {
  return (
    <EmptyState icon="card" title="Stripe has not been imported yet" compact={compact}>
      Run <code>bin/hpbooks stripe import sync/inbox/YYYY-MM-DD/stripe/</code> on the books machine, or ask Grok Bot to &ldquo;Sync Stripe&rdquo;.
    </EmptyState>
  );
}

function StripeCsvLink({ table, params, label }: { table: string; params: Params; label: string }) {
  return (
    <a className="btn btn--secondary btn--sm" href={exportUrl(`/export/stripe/${table}.csv`, params)} download>
      <Icon name="download" size={15} /> {label}
    </a>
  );
}

function Pct({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  return <span className="num">{value.toFixed(2)}%</span>;
}

function MoneyOrDash({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <span className="muted">—</span>;
  return <Money cents={cents} />;
}

const capitalColumns: Column<StripeCapitalFinancing>[] = [
  {
    key: "label",
    header: "Financing",
    accessor: (row) => row.label,
    cell: (row) => (
      <span>
        {row.label}
        {row.financing && row.financing !== row.label ? <> <code className="code-chip">{row.financing}</code></> : null}
        {!row.terms ? <> <Badge tone="warn">No terms</Badge></> : null}
      </span>
    ),
  },
  { key: "principal", header: "Principal", accessor: (row) => row.principal_cents, cell: (row) => <MoneyOrDash cents={row.principal_cents} />, align: "right" },
  { key: "fee", header: "Fee", accessor: (row) => row.fee_cents, cell: (row) => <MoneyOrDash cents={row.fee_cents} />, align: "right" },
  { key: "repaid", header: "Repaid principal", accessor: (row) => row.repaid_principal_cents, cell: (row) => <MoneyOrDash cents={row.repaid_principal_cents} />, align: "right", hideOnMobile: true },
  { key: "fee_booked", header: "Fee booked", accessor: (row) => row.fee_booked_cents, cell: (row) => <MoneyOrDash cents={row.terms ? row.fee_booked_cents : null} />, align: "right", hideOnMobile: true },
  { key: "outstanding", header: "Outstanding", accessor: (row) => row.principal_outstanding_cents, cell: (row) => <MoneyOrDash cents={row.principal_outstanding_cents} />, align: "right" },
  {
    key: "pct",
    header: "Repaid",
    accessor: (row) => row.pct_repaid,
    cell: (row) => (row.pct_repaid === null ? <span className="muted">—</span> : <span className="num">{row.pct_repaid.toFixed(1)}%</span>),
    align: "right",
  },
];

/** Stripe Capital: lifetime figures per financing, the missing-terms warning, and the range's repayments. */
function CapitalCard({ capital, totals }: { capital: StripeCapital | undefined; totals: StripeSummary["totals"] }) {
  const financings = capital?.financings ?? [];
  const others = (capital?.warnings ?? []).filter((text) => !capital?.missing_terms_message || !text.includes(capital.missing_terms_message));
  return (
    <Card padded={false} className="table-section" as="section" aria-label="Stripe Capital">
      <div className="table-section__head">
        <CardHeader
          title="Stripe Capital"
          subtitle="A loan, not revenue: principal repayments move to the loan account and the fee is booked as interest. Lifetime figures."
        />
      </div>
      {capital?.missing_terms ? (
        <p className="notice notice--warn" role="note">
          <Icon name="info" size={16} /> {capital.missing_terms_message}. <Money cents={capital.unsplit_cents} /> of repayments are booked whole as transfers, so the fee is not in the P&amp;L yet.
        </p>
      ) : null}
      {others.map((text) => (
        <p key={text} className="notice notice--warn" role="note">
          <Icon name="info" size={16} /> {text}
        </p>
      ))}
      {financings.length > 0 ? (
        <DataTable caption="Stripe Capital by financing" columns={capitalColumns} rows={financings} rowKey={(row) => `${row.account}:${row.key}`} dense />
      ) : null}
      <dl className="whmcs-facts">
        <div><dt>Repaid in this range</dt><dd><Money cents={totals.capital_repayments_cents} /></dd></div>
        <div><dt>Proceeds in this range</dt><dd><Money cents={totals.capital_proceeds_cents} /></dd></div>
      </dl>
    </Card>
  );
}

function BankDeposit({ bank }: { bank: StripeBankDeposit }) {
  const account = bank.last4 && !bank.account_label.includes(bank.last4) ? `${bank.account_label} ··${bank.last4}` : bank.account_label;
  return (
    <span className="small">
      <span className="nowrap">{formatDate(bank.date, { year: false })}</span> · {account} · <Money cents={bank.amount_cents} />
    </span>
  );
}

export default function StripePage() {
  const filters = useGlobalFilters();
  const params: Params = { start: filters.start, end: filters.end, business: filters.business };
  const summaryQuery = useStripeSummary(params);
  const summary = summaryQuery.data;
  const notReady = summary !== undefined && !summary.ready;
  const payoutsQuery = useStripePayouts(params, !notReady);
  const payouts = payoutsQuery.data?.ready ? payoutsQuery.data : undefined;
  const totals = summary?.ready ? summary.totals : undefined;
  const range = summary ? formatRange(summary.start, summary.end) : formatRange(filters.start, filters.end);

  const monthColumns: Column<StripeMonth>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, cell: (row) => <span className="nowrap">{formatMonth(row.month)}</span>, sortable: true },
    { key: "gross", header: "Gross", accessor: (row) => row.gross_cents, format: "money", sortable: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", hideOnMobile: true },
    { key: "disputes", header: "Disputes", accessor: (row) => row.disputes_cents, format: "money", hideOnMobile: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money" },
    { key: "net", header: "Net revenue", accessor: (row) => row.net_revenue_cents, format: "money", sortable: true },
    { key: "fee_pct", header: "Fee %", accessor: (row) => row.fee_pct, cell: (row) => <Pct value={row.fee_pct} />, align: "right", hideOnMobile: true },
  ];
  const accountColumns: Column<StripeAccountSummary>[] = [
    { key: "label", header: "Account", accessor: (row) => row.label, sortable: true },
    { key: "business", header: "Business", accessor: (row) => businessLabel(row.business), hideOnMobile: true },
    { key: "gross", header: "Gross", accessor: (row) => row.gross_cents, format: "money", sortable: true },
    { key: "refunds", header: "Refunds + disputes", accessor: (row) => row.refunds_cents + row.disputes_cents, format: "money", hideOnMobile: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money" },
    { key: "net", header: "Net revenue", accessor: (row) => row.net_revenue_cents, format: "money", sortable: true },
    { key: "fee_pct", header: "Fee %", accessor: (row) => row.fee_pct, cell: (row) => <Pct value={row.fee_pct} />, align: "right", hideOnMobile: true },
    { key: "payouts", header: "Paid out", accessor: (row) => row.payouts_cents, format: "money", hideOnMobile: true },
  ];
  const payoutColumns: Column<StripePayoutRow>[] = [
    { key: "arrival", header: "Arrival", accessor: (row) => row.arrival_date, format: "date", sortable: true, width: "120px" },
    { key: "account", header: "Account", accessor: (row) => row.account_label, sortable: true, hideOnMobile: true },
    { key: "id", header: "Payout", accessor: (row) => row.id, cell: (row) => <code className="code-chip" title={row.id}>{row.id}</code> },
    { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money", sortable: true },
    {
      key: "status",
      header: "Status",
      accessor: (row) => row.match_status,
      sortable: true,
      cell: (row) => (
        <Badge tone={PAYOUT_STATUS[row.match_status]?.tone ?? "neutral"} title={row.stripe_status ? `Stripe status: ${row.stripe_status}` : undefined}>
          {PAYOUT_STATUS[row.match_status]?.label ?? row.match_status}
        </Badge>
      ),
    },
    {
      key: "bank",
      header: "Bank deposit",
      accessor: (row) => (row.bank ? `${row.bank.date} ${row.bank.account_label}` : row.match_note),
      cell: (row) => (row.bank ? <BankDeposit bank={row.bank} /> : row.match_note ? <span className="muted small">{row.match_note}</span> : <span className="muted">—</span>),
    },
  ];
  const bankOnlyColumns: Column<StripeBankDeposit>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true, width: "120px" },
    { key: "account", header: "Account", accessor: (row) => row.account_label, sortable: true },
    { key: "name", header: "Description", accessor: (row) => row.name, cell: (row) => <span className="truncate small" title={row.name}>{row.name}</span> },
    { key: "category", header: "Category", accessor: (row) => row.category, hideOnMobile: true },
    { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money", sortable: true },
  ];

  const capitalData = summary?.ready ? summary.capital : undefined;
  const capital = totals && ((capitalData?.financings.length ?? 0) > 0 || totals.capital_repayments_cents !== 0 || totals.capital_proceeds_cents !== 0);
  const needsReview = summary?.ready ? summary.accounts.reduce((acc, row) => acc + (row.needs_review ?? 0), 0) : 0;
  const skippedCurrency = summary?.ready ? summary.accounts.reduce((acc, row) => acc + (row.skipped_currency ?? 0), 0) : 0;

  return (
    <div className="page">
      <PageHeader
        title="Stripe"
        subtitle={<>{range} · {businessLabel(filters.business)} · charges, refunds, fees, and payouts from Stripe, matched to bank deposits</>}
        actions={
          notReady ? null : (
            <div className="export-group" role="group" aria-label="Export">
              <StripeCsvLink table="summary" params={params} label="Months CSV" />
              <StripeCsvLink table="accounts" params={params} label="Accounts CSV" />
              <StripeCsvLink table="payouts" params={params} label="Payouts CSV" />
              <StripeCsvLink table="bank-only" params={params} label="Bank only CSV" />
            </div>
          )
        }
      />
      {summaryQuery.isError ? <ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} /> : null}
      {notReady ? (
        <StripeNotImported />
      ) : (
        <>
          <section className="kpi-grid" aria-label="Stripe totals">
            {!totals ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Gross" cents={totals.gross_cents} footer={<span className="muted">Charges before refunds and fees</span>} />
                <KpiCard
                  label="Refunds + disputes"
                  cents={totals.refunds_cents + totals.disputes_cents}
                  footer={<span className="muted">Refunds <Money cents={totals.refunds_cents} /> · disputes <Money cents={totals.disputes_cents} /></span>}
                />
                <KpiCard label="Fees" cents={totals.fees_cents} footer={<span className="muted">{feeRateText(totals.fee_pct)}</span>} />
                <KpiCard label="Net revenue" cents={totals.net_revenue_cents} emphasis="primary" footer={<span className="muted">Gross less refunds, disputes, and fees</span>} />
              </>
            )}
          </section>

          {needsReview > 0 || skippedCurrency > 0 ? (
            <p className="notice notice--warn" role="note">
              <Icon name="info" size={16} />{" "}
              {needsReview > 0 ? `${pluralize(needsReview, "Stripe row")} need review. ` : ""}
              {skippedCurrency > 0 ? `${pluralize(skippedCurrency, "row")} in another currency were left out.` : ""}
            </p>
          ) : null}

          {capital && totals ? <CapitalCard capital={capitalData} totals={totals} /> : null}

          {summary?.ready && summary.accounts.length > 1 ? (
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="By account" />
              </div>
              <DataTable caption="Stripe figures by account" columns={accountColumns} rows={summary.accounts} rowKey={(row) => row.name} dense />
            </Card>
          ) : null}

          {summary?.ready && summary.months.length > 1 ? (
            <Card>
              <CardHeader title="Gross, deductions & net revenue" subtitle="Refunds, disputes, and fees together, by month" />
              <ComboChart
                label="Gross and deductions as bars, net revenue as a line, by month"
                points={summary.months.map((row, index) => ({
                  key: row.month,
                  label: chartMonthLabel(row.month, index, summary.months),
                  bars: [row.gross_cents, row.refunds_cents + row.disputes_cents + row.fees_cents],
                  line: row.net_revenue_cents,
                }))}
                barLabels={["Gross", "Refunds, disputes & fees"]}
                barTones={["rev", "exp"]}
                lineLabel="Net revenue"
                lineTone="net"
              />
            </Card>
          ) : null}

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By month" />
            </div>
            <DataTable
              caption="Stripe figures by month"
              columns={monthColumns}
              rows={summary?.ready ? summary.months : []}
              rowKey={(row) => row.month}
              loading={!summary}
              defaultSort={{ key: "month", dir: "desc" }}
              dense
              empty="No Stripe activity in this range."
            />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Payouts" subtitle={payoutsSubtitle(summary, payouts?.totals.count, payouts?.totals.amount_cents)} />
            </div>
            {payoutsQuery.isError ? <ErrorState error={payoutsQuery.error} onRetry={() => payoutsQuery.refetch()} compact /> : null}
            <DataTable
              caption="Stripe payouts and the bank deposits they matched"
              columns={payoutColumns}
              rows={payouts?.rows ?? []}
              rowKey={(row) => `${row.account}:${row.id}`}
              loading={!payouts && !payoutsQuery.isError}
              defaultSort={{ key: "arrival", dir: "desc" }}
              pageSize={50}
              dense
              empty="No payouts in this range."
            />
          </Card>

          {payouts && payouts.bank_only.length > 0 ? (
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="Bank only" subtitle="Deposits that look like Stripe transfers but match no payout" />
              </div>
              <DataTable caption="Stripe-looking bank deposits with no payout" columns={bankOnlyColumns} rows={payouts.bank_only} rowKey={(row) => row.txn_id} defaultSort={{ key: "date", dir: "desc" }} dense />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

/** "Jul", as on the dashboard chart; the first month and each January carry the year when the months span years. */
function chartMonthLabel(month: string, index: number, months: StripeMonth[]): string {
  const spansYears = months.length > 0 && months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);
  return spansYears && (index === 0 || month.endsWith("-01")) ? formatMonth(month) : formatMonth(month, { short: true });
}

function payoutsSubtitle(summary: StripeSummary | undefined, count: number | undefined, cents: number | undefined) {
  if (count === undefined || cents === undefined) return undefined;
  const open = summary?.ready ? summary.open_payouts : 0;
  return (
    <>
      {pluralize(count, "payout")} · <Money cents={cents} />
      {open > 0 ? <> · {pluralize(open, "payout")} {open === 1 ? "needs" : "need"} a look</> : null}
    </>
  );
}
