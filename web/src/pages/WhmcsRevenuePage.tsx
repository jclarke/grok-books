import { useState } from "react";
import { useWhmcsRevenue } from "../api/queries";
import type { WhmcsRevenue } from "../api/types";
import { Card, CardHeader } from "../components/Card";
import { ComboChart } from "../components/charts/ComboChart";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SkeletonCard } from "../components/Skeleton";
import { CsvLink, NotSynced, WhmcsEyebrow, WhmcsToolbar, isReady, useBrand } from "../components/Whmcs";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { useUrlState } from "../hooks/useUrlState";
import { formatPct, formatRange } from "../lib/format";

type Period = WhmcsRevenue["periods"][number];
type PlanRow = WhmcsRevenue["plans"][number];
type BrandRow = WhmcsRevenue["brands"][number];

export default function WhmcsRevenuePage() {
  const filters = useGlobalFilters();
  const url = useUrlState();
  const [brand, setBrand] = useBrand();
  const by = (["month", "quarter", "year"].includes(url.get("by")) ? url.get("by") : "month") as "month" | "quarter" | "year";
  const [planFilter, setPlanFilter] = useState("");
  const params = { start: filters.start, end: filters.end, brand, by };
  const query = useWhmcsRevenue(params);
  const raw = query.data;
  const data = isReady<WhmcsRevenue>(raw) ? raw : null;
  const totals = data?.totals;

  const periodColumns: Column<Period>[] = [
    { key: "period", header: periodHeader(by), accessor: (row) => row.period, sortable: true },
    { key: "payments", header: "Payments", accessor: (row) => row.payments, format: "number", sortable: true, hideOnMobile: true },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money", sortable: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", sortable: true },
    { key: "net", header: "Net", accessor: (row) => row.net_cents, format: "money", sortable: true },
  ];
  const brandColumns: Column<BrandRow>[] = [
    { key: "brand", header: "Brand", accessor: (row) => row.brand },
    { key: "payments", header: "Payments", accessor: (row) => row.payments, format: "number" },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money" },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money", hideOnMobile: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", hideOnMobile: true },
    { key: "net", header: "Net", accessor: (row) => row.net_cents, format: "money" },
    { key: "share", header: "Share", accessor: (row) => (totals?.gross_cents ? (row.gross_cents / totals.gross_cents) * 100 : null), format: "pct", hideOnMobile: true },
  ];
  const planColumns: Column<PlanRow>[] = [
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, cell: (row) => <span className="strong">{row.plan}</span> },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true },
    { key: "group", header: "Group", accessor: (row) => row.group, sortable: true, hideOnMobile: true },
    { key: "payments", header: "Payments", accessor: (row) => row.payments, format: "number", sortable: true, hideOnMobile: true },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money", sortable: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "net", header: "Net", accessor: (row) => row.net_cents, format: "money", sortable: true },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="WHMCS revenue"
        subtitle={<>{formatRange(filters.start, filters.end)} · {brand === "all" ? "All brands" : brand} · payments recorded in WHMCS (cash basis)</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="revenue" params={params} label="Periods CSV" />
            <CsvLink table="revenue-plans" params={params} label="Plans CSV" />
          </div>
        }
      />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }}>
        <SegmentedControl
          label="Group by"
          size="sm"
          value={by}
          onChange={(value) => url.patch({ by: value === "month" ? "" : value })}
          options={[
            { value: "month", label: "Month" },
            { value: "quarter", label: "Quarter" },
            { value: "year", label: "Year" },
          ]}
        />
      </WhmcsToolbar>
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          <section className="kpi-grid" aria-label="Revenue totals">
            {!totals ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Gross payments in" cents={totals.gross_cents} footer={<span className="muted">{totals.payments.toLocaleString("en-US")} payments</span>} />
                <KpiCard label="Gateway fees" cents={totals.fees_cents} footer={<span className="muted">{formatPct(totals.gross_cents ? (totals.fees_cents / totals.gross_cents) * 100 : null)} of gross</span>} />
                <KpiCard label="Refunds" cents={totals.refunds_cents} footer={<span className="muted">{totals.refund_count.toLocaleString("en-US")} refunds · {formatPct(totals.gross_cents ? (totals.refunds_cents / totals.gross_cents) * 100 : null)}</span>} />
                <KpiCard label="Net" cents={totals.net_cents} footer={<span className="muted">Gross less fees and refunds</span>} />
              </>
            )}
          </section>

          <Card>
            <CardHeader title={`Revenue by ${by}`} subtitle="Gross payments in and refunds as bars, net as a line" />
            {!data ? (
              <SkeletonCard height={260} />
            ) : (
              <ComboChart
                label={`WHMCS gross payments and refunds by ${by}, with net`}
                points={data.periods.map((row) => ({ key: row.period, label: shortPeriod(row.period, by), bars: [row.gross_cents, row.refunds_cents], line: row.net_cents }))}
                barLabels={["Gross in", "Refunds"]}
                barTones={["rev", "exp"]}
                lineLabel="Net"
                lineTone="net"
              />
            )}
          </Card>

          {brand === "all" ? (
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="By brand" />
              </div>
              <DataTable caption="Revenue by brand" columns={brandColumns} rows={data?.brands ?? []} rowKey={(row) => row.brand} loading={!data} dense />
            </Card>
          ) : null}

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Top plans" subtitle="Each payment is split across the plans on its invoice. Domains, upgrades, and account credit are their own lines." />
              <div className="toolbar__search">
                <Icon name="search" size={16} />
                <label className="sr-only" htmlFor="plan-filter">Filter plans</label>
                <input id="plan-filter" className="input" type="search" placeholder="Filter plans or groups" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} />
              </div>
            </div>
            <DataTable caption="Revenue by plan" columns={planColumns} rows={data?.plans ?? []} rowKey={(row) => `${row.brand}:${row.plan}`} loading={!data} filter={planFilter} defaultSort={{ key: "gross", dir: "desc" }} pageSize={25} dense />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title={`By ${by}`} />
            </div>
            <DataTable caption={`Revenue by ${by}`} columns={periodColumns} rows={data?.periods ?? []} rowKey={(row) => row.period} loading={!data} defaultSort={{ key: "period", dir: "desc" }} pageSize={24} dense />
          </Card>
        </>
      )}
    </div>
  );
}

function periodHeader(by: string): string {
  return by === "year" ? "Year" : by === "quarter" ? "Quarter" : "Month";
}

function shortPeriod(period: string, by: string): string {
  if (by === "month") {
    const [y, m] = period.split("-");
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y.slice(2)}`;
  }
  return period.replace("-", " ");
}
