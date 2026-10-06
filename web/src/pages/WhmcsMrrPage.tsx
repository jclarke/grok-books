import { useWhmcsMrr } from "../api/queries";
import type { WhmcsMrr, WhmcsMrrRow } from "../api/types";
import { Badge } from "../components/Badge";
import { Card, CardHeader } from "../components/Card";
import { AreaChart } from "../components/charts/AreaChart";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SkeletonCard } from "../components/Skeleton";
import { CsvLink, NotSynced, WhmcsEyebrow, WhmcsToolbar, isReady, useBrand } from "../components/Whmcs";
import { useUrlState } from "../hooks/useUrlState";
import { monthEnd } from "../lib/dates";
import { formatDate } from "../lib/format";

const SPANS = ["12", "36", "60", "120", "0"];

export default function WhmcsMrrPage() {
  const url = useUrlState();
  const [brand, setBrand] = useBrand();
  const months = SPANS.includes(url.get("months")) ? url.get("months") : "36";
  const params = { brand, months };
  const query = useWhmcsMrr(params);
  const raw = query.data;
  const data = isReady<WhmcsMrr>(raw) ? raw : null;

  const brandColumns: Column<WhmcsMrrRow>[] = [
    { key: "brand", header: "Brand", accessor: (row) => row.brand },
    { key: "services", header: "Services", accessor: (row) => row.services, format: "number", hideOnMobile: true },
    { key: "customers", header: "Customers", accessor: (row) => row.customers, format: "number" },
    { key: "mrr", header: "MRR", accessor: (row) => row.mrr_cents, format: "money" },
    { key: "arr", header: "ARR", accessor: (row) => row.arr_cents, format: "money", hideOnMobile: true },
    { key: "arpu", header: "ARPU", accessor: (row) => row.arpu_cents, format: "money", hideOnMobile: true },
    { key: "share", header: "Share", accessor: (row) => row.share_pct, format: "pct" },
  ];
  const planColumns: Column<WhmcsMrrRow>[] = [
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, cell: (row) => <span className="strong">{row.plan}</span> },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true },
    { key: "group", header: "Group", accessor: (row) => row.group, sortable: true, hideOnMobile: true },
    { key: "services", header: "Services", accessor: (row) => row.services, format: "number", sortable: true, hideOnMobile: true },
    { key: "customers", header: "Customers", accessor: (row) => row.customers, format: "number", sortable: true },
    { key: "mrr", header: "MRR", accessor: (row) => row.mrr_cents, format: "money", sortable: true },
    { key: "arr", header: "ARR", accessor: (row) => row.arr_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "share", header: "Share", accessor: (row) => row.share_pct, format: "pct", sortable: true, hideOnMobile: true },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="MRR & ARR"
        subtitle={<>{brand === "all" ? "All brands" : brand} · Active services today, billing cycles normalized to one month{data ? ` · as of ${formatDate(data.today)}` : ""}</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="mrr" params={params} label="Plans CSV" />
            <CsvLink table="mrr-trend" params={params} label="Trend CSV" />
          </div>
        }
      />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }} period={false} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          <section className="kpi-grid" aria-label="Recurring revenue">
            {!data ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="MRR" cents={data.mrr_cents} footer={<span className="muted">{data.services.toLocaleString("en-US")} active services</span>} />
                <KpiCard label="ARR" cents={data.arr_cents} footer={<span className="muted">MRR × 12</span>} />
                <KpiCard label="Active customers" display={data.customers.toLocaleString("en-US")} footer={<span className="muted">ARPU <Money cents={data.arpu_cents} /></span>} />
                <KpiCard label="Suspended MRR" cents={data.suspended_mrr_cents} footer={<span className="muted">{data.suspended_services.toLocaleString("en-US")} suspended services, not in MRR</span>} />
              </>
            )}
          </section>

          <Card>
            <CardHeader
              title={<>MRR trend <Badge tone="warn">Estimate</Badge></>}
              subtitle="Month-end MRR rebuilt from registration, termination, and cancellation dates"
              actions={
                <SegmentedControl
                  label="Trend length"
                  size="sm"
                  value={months}
                  onChange={(value) => url.patch({ months: value === "36" ? "" : value })}
                  options={[
                    { value: "12", label: "1y" },
                    { value: "36", label: "3y" },
                    { value: "60", label: "5y" },
                    { value: "120", label: "10y" },
                    { value: "0", label: "All" },
                  ]}
                />
              }
            />
            {!data ? (
              <SkeletonCard height={240} />
            ) : (
              <>
                <AreaChart
                  label="Estimated month-end MRR"
                  valueLabel="MRR (estimate)"
                  tone="rev"
                  axis="month"
                  points={data.trend.map((point) => ({ date: monthEnd(point.month), value: point.mrr_cents }))}
                />
                <p className="muted small">{data.trend_note}</p>
              </>
            )}
          </Card>

          {brand === "all" ? (
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="By brand" />
              </div>
              <DataTable caption="MRR by brand" columns={brandColumns} rows={data?.brands ?? []} rowKey={(row) => row.brand} loading={!data} dense />
            </Card>
          ) : null}

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By plan" subtitle="Hosting plans and addons with an active, paid, recurring service" />
            </div>
            <DataTable caption="MRR by plan" columns={planColumns} rows={data?.plans ?? []} rowKey={(row) => `${row.brand}:${row.plan}`} loading={!data} defaultSort={{ key: "mrr", dir: "desc" }} pageSize={25} dense />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By billing cycle" />
            </div>
            <DataTable
              caption="MRR by billing cycle"
              columns={[
                { key: "cycle", header: "Cycle", accessor: (row) => row.cycle },
                { key: "services", header: "Services", accessor: (row) => row.services, format: "number" },
                { key: "mrr", header: "MRR", accessor: (row) => row.mrr_cents, format: "money" },
              ]}
              rows={data?.cycles ?? []}
              rowKey={(row) => row.cycle}
              loading={!data}
              dense
            />
          </Card>
        </>
      )}
    </div>
  );
}
