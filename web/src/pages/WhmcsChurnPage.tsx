import { useWhmcsChurn } from "../api/queries";
import type { WhmcsChurn, WhmcsChurnMonth } from "../api/types";
import { Card, CardHeader } from "../components/Card";
import { ComboChart } from "../components/charts/ComboChart";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { SkeletonCard } from "../components/Skeleton";
import { CsvLink, NotSynced, WhmcsEyebrow, WhmcsToolbar, isReady, useBrand } from "../components/Whmcs";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { formatPct, formatRange } from "../lib/format";

type PlanRow = WhmcsChurn["plans"][number];
type BrandRow = WhmcsChurn["brands"][number];
type Recent = WhmcsChurn["recent"][number];

export default function WhmcsChurnPage() {
  const filters = useGlobalFilters();
  const [brand, setBrand] = useBrand();
  const params = { start: filters.start, end: filters.end, brand };
  const query = useWhmcsChurn(params);
  const raw = query.data;
  const data = isReady<WhmcsChurn>(raw) ? raw : null;
  const totals = data?.totals;
  const reasonTotal = (data?.reasons ?? []).reduce((sum, row) => sum + row.count, 0);

  const monthColumns: Column<WhmcsChurnMonth>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, sortable: true },
    { key: "requests", header: "Cancel requests", accessor: (row) => row.cancel_requests, format: "number", sortable: true },
    { key: "immediate", header: "Immediate", accessor: (row) => row.immediate, format: "number", hideOnMobile: true },
    { key: "eop", header: "End of period", accessor: (row) => row.end_of_period, format: "number", hideOnMobile: true },
    { key: "new", header: "New services", accessor: (row) => row.new_services, format: "number", hideOnMobile: true },
    { key: "churned", header: "Churned services", accessor: (row) => row.churned_services, format: "number", sortable: true },
    { key: "net", header: "Net adds", accessor: (row) => row.net_adds, format: "number", sortable: true },
    { key: "customers", header: "Churned customers", accessor: (row) => row.churned_customers, format: "number", hideOnMobile: true },
    { key: "logo", header: "Logo churn", accessor: (row) => row.logo_churn_pct, format: "pct", sortable: true },
    { key: "mrr", header: "Churned MRR", accessor: (row) => row.churned_mrr_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "rev", header: "Revenue churn", accessor: (row) => row.revenue_churn_pct, format: "pct", sortable: true },
  ];
  const planColumns: Column<PlanRow>[] = [
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, cell: (row) => <span className="strong">{row.plan}</span> },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true, hideOnMobile: true },
    { key: "start", header: "Services at start", accessor: (row) => row.start_services, format: "number", sortable: true, hideOnMobile: true },
    { key: "new", header: "New", accessor: (row) => row.new_services, format: "number", sortable: true },
    { key: "churned", header: "Churned", accessor: (row) => row.churned_services, format: "number", sortable: true },
    { key: "rate", header: "Churn", accessor: (row) => row.service_churn_pct, format: "pct", sortable: true },
    { key: "mrr", header: "Churned MRR", accessor: (row) => row.churned_mrr_cents, format: "money", sortable: true },
    { key: "requests", header: "Cancel requests", accessor: (row) => row.cancel_requests, format: "number", sortable: true, hideOnMobile: true },
  ];
  const brandColumns: Column<BrandRow>[] = [
    { key: "brand", header: "Brand", accessor: (row) => row.brand },
    { key: "start", header: "Customers at start", accessor: (row) => row.start_customers, format: "number" },
    { key: "churned", header: "Churned customers", accessor: (row) => row.churned_customers, format: "number" },
    { key: "logo", header: "Logo churn", accessor: (row) => row.logo_churn_pct, format: "pct" },
    { key: "mrr", header: "Churned MRR", accessor: (row) => row.churned_mrr_cents, format: "money" },
    { key: "rev", header: "Revenue churn", accessor: (row) => row.revenue_churn_pct, format: "pct" },
    { key: "net", header: "Net adds", accessor: (row) => row.net_adds, format: "number", hideOnMobile: true },
  ];
  const recentColumns: Column<Recent>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true, width: "120px" },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true, hideOnMobile: true },
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, hideOnMobile: true },
    { key: "type", header: "Type", accessor: (row) => row.type, sortable: true, hideOnMobile: true },
    { key: "category", header: "Category", accessor: (row) => row.category, sortable: true },
    { key: "reason", header: "Reason", accessor: (row) => row.reason, cell: (row) => (row.reason ? <span className="wrap-text">{row.reason}</span> : <span className="muted">No reason given</span>) },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="Churn & cancellations"
        subtitle={<>{formatRange(filters.start, filters.end)} · {brand === "all" ? "All brands" : brand}</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="churn" params={params} label="Months CSV" />
            <CsvLink table="churn-plans" params={params} label="Plans CSV" />
          </div>
        }
      />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          <section className="kpi-grid" aria-label="Churn totals">
            {!totals ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Cancellation requests" display={totals.cancel_requests.toLocaleString("en-US")} footer={<span className="muted">{totals.immediate} immediate · {totals.end_of_period} end of period</span>} />
                <KpiCard label="Logo churn" display={formatPct(totals.logo_churn_pct)} footer={<span className="muted">{totals.churned_customers.toLocaleString("en-US")} of {totals.start_customers.toLocaleString("en-US")} customers</span>} />
                <KpiCard label="Revenue churn" display={formatPct(totals.revenue_churn_pct)} footer={<span className="muted">MRR lost (estimate)</span>} />
                <KpiCard label="Net service adds" display={totals.net_adds.toLocaleString("en-US")} footer={<span className="muted">{totals.new_services} new · {totals.churned_services} churned</span>} />
              </>
            )}
          </section>

          <Card>
            <CardHeader title="New versus churned MRR" subtitle="Monthly recurring revenue added and lost each month, with the net change" />
            {!data ? (
              <SkeletonCard height={260} />
            ) : (
              <ComboChart
                label="New MRR and churned MRR by month, net change as a line"
                points={data.months.map((row) => ({ key: row.month, label: row.month.slice(2).replace("-", "/"), bars: [row.new_mrr_cents, row.churned_mrr_cents], line: row.new_mrr_cents - row.churned_mrr_cents }))}
                barLabels={["New MRR", "Churned MRR"]}
                barTones={["rev", "exp"]}
                lineLabel="Net change"
                lineTone="net"
              />
            )}
            {data ? <p className="muted small">{data.note}</p> : null}
          </Card>

          <div className="whmcs-two">
            <Card>
              <CardHeader title="Cancellation reasons" subtitle="Grouped by keywords in the reason the customer gave" />
              {!data ? (
                <SkeletonCard />
              ) : data.reasons.length === 0 ? (
                <EmptyState icon="inbox" title="No cancellation requests in this range" compact />
              ) : (
                <ul className="reason-list" aria-label="Cancellation reasons">
                  {data.reasons.map((row) => (
                    <li key={row.category} className="reason-list__item">
                      <span className="reason-list__label">{row.category}</span>
                      <span className="share-bar">
                        <span className="share-bar__track">
                          <span className="share-bar__fill tone-exp" style={{ width: `${reasonTotal ? Math.max(2, (row.count / reasonTotal) * 100) : 0}%` }} />
                        </span>
                        <span className="num small">{row.count.toLocaleString("en-US")} · {formatPct(row.share_pct)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {brand === "all" ? (
              <Card padded={false} className="table-section">
                <div className="table-section__head">
                  <CardHeader title="By brand" />
                </div>
                <DataTable caption="Churn by brand" columns={brandColumns} rows={data?.brands ?? []} rowKey={(row) => row.brand} loading={!data} dense />
              </Card>
            ) : null}
          </div>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By month" />
            </div>
            <DataTable caption="Churn by month" columns={monthColumns} rows={data?.months ?? []} rowKey={(row) => row.month} loading={!data} defaultSort={{ key: "month", dir: "desc" }} pageSize={24} dense />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By plan" subtitle="Services at the start of the range, added, and ended" />
            </div>
            <DataTable caption="Churn by plan" columns={planColumns} rows={data?.plans ?? []} rowKey={(row) => `${row.brand}:${row.plan}`} loading={!data} defaultSort={{ key: "mrr", dir: "desc" }} pageSize={20} dense />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Recent cancellation requests" subtitle="Newest first. Email addresses in reasons are hidden." />
            </div>
            <DataTable caption="Recent cancellation requests" columns={recentColumns} rows={data?.recent ?? []} rowKey={(row) => row.id} loading={!data} pageSize={20} dense empty="No cancellation requests in this range." />
          </Card>
        </>
      )}
    </div>
  );
}
