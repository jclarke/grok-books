import { useWhmcsRefunds } from "../api/queries";
import type { WhmcsRefunds } from "../api/types";
import { Card, CardHeader } from "../components/Card";
import { ComboChart } from "../components/charts/ComboChart";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { SkeletonCard } from "../components/Skeleton";
import { ClientLink, CsvLink, NotSynced, WhmcsEyebrow, WhmcsToolbar, isReady, useBrand } from "../components/Whmcs";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { formatPct, formatRange } from "../lib/format";

type MonthRow = WhmcsRefunds["months"][number];
type PlanRow = WhmcsRefunds["plans"][number];
type BrandRow = WhmcsRefunds["brands"][number];
type Largest = WhmcsRefunds["largest"][number];

export default function WhmcsRefundsPage() {
  const filters = useGlobalFilters();
  const [brand, setBrand] = useBrand();
  const params = { start: filters.start, end: filters.end, brand };
  const query = useWhmcsRefunds({ ...params, limit: 50 });
  const raw = query.data;
  const data = isReady<WhmcsRefunds>(raw) ? raw : null;
  const totals = data?.totals;

  const monthColumns: Column<MonthRow>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, sortable: true },
    { key: "count", header: "Refunds", accessor: (row) => row.count, format: "number", sortable: true },
    { key: "refunds", header: "Refunded", accessor: (row) => row.refunds_cents, format: "money", sortable: true },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "rate", header: "Refund rate", accessor: (row) => row.rate_pct, format: "pct", sortable: true },
  ];
  const brandColumns: Column<BrandRow>[] = [
    { key: "brand", header: "Brand", accessor: (row) => row.brand },
    { key: "count", header: "Refunds", accessor: (row) => row.count, format: "number" },
    { key: "refunds", header: "Refunded", accessor: (row) => row.refunds_cents, format: "money" },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money", hideOnMobile: true },
    { key: "rate", header: "Refund rate", accessor: (row) => row.rate_pct, format: "pct" },
  ];
  const planColumns: Column<PlanRow>[] = [
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, cell: (row) => <span className="strong">{row.plan}</span> },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true, hideOnMobile: true },
    { key: "count", header: "Refunds", accessor: (row) => row.count, format: "number", sortable: true },
    { key: "refunds", header: "Refunded", accessor: (row) => row.refunds_cents, format: "money", sortable: true },
    { key: "rate", header: "Rate vs plan gross", accessor: (row) => row.rate_pct, format: "pct", sortable: true, hideOnMobile: true },
  ];
  const largestColumns: Column<Largest>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true, width: "120px" },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true },
    { key: "client", header: "Client", accessor: (row) => row.client_id, cell: (row) => <ClientLink brand={row.brand} id={row.client_id} /> },
    { key: "invoice", header: "Invoice", accessor: (row) => row.invoice_id, cell: (row) => (row.invoice_id ? <span className="num">{row.invoice_id}</span> : <span className="muted">none</span>), hideOnMobile: true },
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, hideOnMobile: true },
    { key: "gateway", header: "Gateway", accessor: (row) => row.gateway, sortable: true, hideOnMobile: true },
    { key: "amount", header: "Refund", accessor: (row) => row.refund_cents, format: "money", sortable: true },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="Refunds"
        subtitle={<>{formatRange(filters.start, filters.end)} · {brand === "all" ? "All brands" : brand}</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="refunds" params={params} label="Months CSV" />
            <CsvLink table="refunds-largest" params={{ ...params, limit: 500 }} label="Largest CSV" />
          </div>
        }
      />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          <section className="kpi-grid kpi-grid--3" aria-label="Refund totals">
            {!totals ? (
              [0, 1, 2].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Refunded" cents={totals.refunds_cents} footer={<span className="muted">{totals.count.toLocaleString("en-US")} refunds</span>} />
                <KpiCard label="Refund rate" display={formatPct(totals.rate_pct)} footer={<span className="muted">Refunds over gross payments in</span>} />
                <KpiCard label="Gross payments in" cents={totals.gross_cents} />
              </>
            )}
          </section>

          <Card>
            <CardHeader title="Refunds by month" subtitle="Gross payments in and refunds as bars, gross less refunds as a line" />
            {!data ? (
              <SkeletonCard height={240} />
            ) : (
              <ComboChart
                label="Refunds and gross payments by month"
                points={data.months.map((row) => ({ key: row.month, label: row.month.slice(2).replace("-", "/"), bars: [row.gross_cents, row.refunds_cents], line: row.gross_cents - row.refunds_cents }))}
                barLabels={["Gross in", "Refunded"]}
                barTones={["rev", "exp"]}
                lineLabel="Gross less refunds"
                lineTone="net"
              />
            )}
          </Card>

          <div className="whmcs-two">
            {brand === "all" ? (
              <Card padded={false} className="table-section">
                <div className="table-section__head">
                  <CardHeader title="By brand" />
                </div>
                <DataTable caption="Refunds by brand" columns={brandColumns} rows={data?.brands ?? []} rowKey={(row) => row.brand} loading={!data} dense />
              </Card>
            ) : null}
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="By gateway" />
              </div>
              <DataTable
                caption="Refunds by gateway"
                columns={[
                  { key: "gateway", header: "Gateway", accessor: (row) => row.gateway },
                  { key: "count", header: "Refunds", accessor: (row) => row.count, format: "number" },
                  { key: "refunds", header: "Refunded", accessor: (row) => row.refunds_cents, format: "money" },
                ]}
                rows={data?.gateways ?? []}
                rowKey={(row) => row.gateway}
                loading={!data}
                dense
                empty="No refunds in this range."
              />
            </Card>
          </div>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Largest refunds" subtitle="Client numbers open the customer page" />
            </div>
            <DataTable caption="Largest refunds" columns={largestColumns} rows={data?.largest ?? []} rowKey={(row) => row.id} loading={!data} defaultSort={{ key: "amount", dir: "desc" }} pageSize={25} dense empty="No refunds in this range." />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By plan" subtitle="Refunds split across the plans on the refunded invoice" />
            </div>
            <DataTable caption="Refunds by plan" columns={planColumns} rows={data?.plans ?? []} rowKey={(row) => `${row.brand}:${row.plan}`} loading={!data} defaultSort={{ key: "refunds", dir: "desc" }} pageSize={20} dense empty="No refunds in this range." />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By month" />
            </div>
            <DataTable caption="Refunds by month" columns={monthColumns} rows={data?.months ?? []} rowKey={(row) => row.month} loading={!data} defaultSort={{ key: "month", dir: "desc" }} pageSize={24} dense />
          </Card>
        </>
      )}
    </div>
  );
}
