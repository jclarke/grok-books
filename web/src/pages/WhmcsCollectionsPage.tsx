import { useState } from "react";
import { useWhmcsDunning } from "../api/queries";
import type { WhmcsDunning, WhmcsOpenInvoice } from "../api/types";
import { Badge } from "../components/Badge";
import { Card, CardHeader } from "../components/Card";
import { ComboChart } from "../components/charts/ComboChart";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SkeletonCard } from "../components/Skeleton";
import { ClientLink, CsvLink, NotSynced, StatusBadgeText, WhmcsEyebrow, WhmcsToolbar, isReady, useBrand } from "../components/Whmcs";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { formatDate, formatPct, formatRange } from "../lib/format";

type Aging = WhmcsDunning["aging"][number];
type Trend = WhmcsDunning["trend"][number];

export default function WhmcsCollectionsPage() {
  const filters = useGlobalFilters();
  const [brand, setBrand] = useBrand();
  const [show, setShow] = useState<"collectible" | "all">("collectible");
  const [text, setText] = useState("");
  const params = { start: filters.start, end: filters.end, brand };
  const query = useWhmcsDunning(params);
  const raw = query.data;
  const data = isReady<WhmcsDunning>(raw) ? raw : null;
  const totals = data?.totals;
  const rows = (data?.collections ?? []).filter((row) => show === "all" || row.collectible);
  const failed = (data?.trend ?? []).reduce((sum, row) => sum + row.capture_failed, 0);
  const agingTotal = (data?.aging ?? []).reduce((sum, row) => sum + row.balance_cents, 0);

  const agingColumns: Column<Aging>[] = [
    { key: "bucket", header: "Days past due", accessor: (row) => row.bucket },
    { key: "count", header: "Invoices", accessor: (row) => row.count, format: "number" },
    { key: "balance", header: "Balance", accessor: (row) => row.balance_cents, format: "money" },
    { key: "collectible", header: "Collectible", accessor: (row) => row.collectible_cents, format: "money", hideOnMobile: true },
    {
      key: "share",
      header: "Share",
      accessor: (row) => row.balance_cents,
      hideOnMobile: true,
      width: "150px",
      cell: (row) => (
        <span className="share-bar">
          <span className="share-bar__track"><span className="share-bar__fill tone-exp" style={{ width: `${agingTotal ? Math.max(1, (row.balance_cents / agingTotal) * 100) : 0}%` }} /></span>
          <span className="num small">{formatPct(agingTotal ? (row.balance_cents / agingTotal) * 100 : 0)}</span>
        </span>
      ),
    },
  ];
  const trendColumns: Column<Trend>[] = [
    { key: "month", header: "Due month", accessor: (row) => row.month, sortable: true },
    { key: "invoices", header: "Invoices", accessor: (row) => row.invoices, format: "number", sortable: true },
    { key: "paid", header: "Paid", accessor: (row) => row.paid, format: "number", hideOnMobile: true },
    { key: "unpaid", header: "Unpaid", accessor: (row) => row.unpaid, format: "number", sortable: true },
    { key: "cancelled", header: "Cancelled", accessor: (row) => row.cancelled, format: "number", hideOnMobile: true },
    { key: "failed", header: "Failed captures", accessor: (row) => row.capture_failed, format: "number", sortable: true, hideOnMobile: true },
    { key: "unpaid_cents", header: "Unpaid amount", accessor: (row) => row.unpaid_cents, format: "money", sortable: true },
    { key: "rate", header: "Unpaid rate", accessor: (row) => row.unpaid_rate_pct, format: "pct", sortable: true },
  ];
  const collectionColumns: Column<WhmcsOpenInvoice>[] = [
    { key: "due", header: "Due", accessor: (row) => row.due_date, format: "date", sortable: true, width: "120px" },
    { key: "days", header: "Days late", accessor: (row) => row.days_overdue, format: "number", sortable: true },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, sortable: true, hideOnMobile: true },
    { key: "invoice", header: "Invoice", accessor: (row) => row.invoice_id, cell: (row) => <span className="num">{row.invoice_id}</span>, sortable: true, hideOnMobile: true },
    { key: "client", header: "Client", accessor: (row) => row.client_id, cell: (row) => <ClientLink brand={row.brand} id={row.client_id} /> },
    { key: "status", header: "Client status", accessor: (row) => row.client_status, cell: (row) => <StatusBadgeText status={row.client_status} />, sortable: true, hideOnMobile: true },
    { key: "services", header: "Live services", accessor: (row) => row.live_services, format: "number", sortable: true, hideOnMobile: true },
    { key: "method", header: "Method", accessor: (row) => row.payment_method, sortable: true, hideOnMobile: true },
    { key: "attempt", header: "Last capture", accessor: (row) => row.last_capture_attempt, cell: (row) => (row.last_capture_attempt ? <Badge tone="warn">{formatDate(row.last_capture_attempt.slice(0, 10))}</Badge> : <span className="muted">—</span>), hideOnMobile: true },
    { key: "balance", header: "Balance", accessor: (row) => row.balance_cents, format: "money", sortable: true },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="Failed payments & collections"
        subtitle={<>{brand === "all" ? "All brands" : brand} · open invoices today · trend {formatRange(filters.start, filters.end)}</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="dunning" params={params} label="Collections CSV" />
            <CsvLink table="dunning-aging" params={params} label="Aging CSV" />
          </div>
        }
      />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          <section className="kpi-grid" aria-label="Open invoices">
            {!totals ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Open balance" cents={totals.open_cents} footer={<span className="muted">{totals.open_count.toLocaleString("en-US")} unpaid invoices</span>} />
                <KpiCard label="Overdue" cents={totals.overdue_cents} footer={<span className="muted">{totals.overdue_count.toLocaleString("en-US")} invoices past due</span>} />
                <KpiCard label="Collectible overdue" cents={totals.collectible_overdue_cents} footer={<span className="muted">{totals.collectible_overdue_count.toLocaleString("en-US")} with a live service</span>} />
                <KpiCard label="Failed captures" display={failed.toLocaleString("en-US")} footer={<span className="muted">Unpaid or cancelled after a capture attempt, in range</span>} />
              </>
            )}
          </section>

          <div className="whmcs-two">
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="Aging" subtitle="Unpaid balance by days past the due date" />
              </div>
              <DataTable caption="Aging buckets" columns={agingColumns} rows={data?.aging ?? []} rowKey={(row) => row.bucket} loading={!data} dense />
            </Card>
            <Card padded={false} className="table-section">
              <div className="table-section__head">
                <CardHeader title="By gateway" subtitle="Open invoices by payment method" />
              </div>
              <DataTable
                caption="Open invoices by gateway"
                columns={[
                  { key: "gateway", header: "Gateway", accessor: (row) => row.gateway },
                  { key: "count", header: "Open", accessor: (row) => row.count, format: "number" },
                  { key: "balance", header: "Balance", accessor: (row) => row.balance_cents, format: "money" },
                  { key: "overdue", header: "Overdue", accessor: (row) => row.overdue_cents, format: "money", hideOnMobile: true },
                ]}
                rows={data?.gateways ?? []}
                rowKey={(row) => row.gateway}
                loading={!data}
                dense
              />
            </Card>
          </div>

          <Card>
            <CardHeader title="Unpaid trend" subtitle="Invoices by due month: paid versus unpaid or cancelled, with the unpaid amount" />
            {!data ? (
              <SkeletonCard height={240} />
            ) : (
              <ComboChart
                label="Paid and unpaid invoice amounts by due month"
                points={data.trend.map((row) => ({ key: row.month, label: row.month.slice(2).replace("-", "/"), bars: [row.paid_cents, row.unpaid_cents + row.cancelled_cents], line: row.unpaid_cents }))}
                barLabels={["Paid", "Unpaid or cancelled"]}
                barTones={["rev", "exp"]}
                lineLabel="Still unpaid"
                lineTone="net"
              />
            )}
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader
                title="Collections list"
                subtitle={data ? <>Overdue invoices, newest first. Collectible means the client still has an Active or Suspended service. <Money cents={rows.reduce((sum, row) => sum + row.balance_cents, 0)} /> shown.</> : null}
                actions={
                  <SegmentedControl
                    label="Show"
                    size="sm"
                    value={show}
                    onChange={setShow}
                    options={[
                      { value: "collectible", label: "Collectible" },
                      { value: "all", label: "All overdue" },
                    ]}
                  />
                }
              />
              <div className="toolbar__search">
                <Icon name="search" size={16} />
                <label className="sr-only" htmlFor="collections-filter">Filter the collections list</label>
                <input id="collections-filter" className="input" type="search" placeholder="Filter by brand, client, invoice, or method" value={text} onChange={(event) => setText(event.target.value)} />
              </div>
            </div>
            <DataTable caption="Collections list" columns={collectionColumns} rows={rows} rowKey={(row) => `${row.brand}:${row.invoice_id}`} loading={!data} filter={text} defaultSort={{ key: "due", dir: "desc" }} pageSize={50} dense empty="Nothing overdue." />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Unpaid rate by month" subtitle={data?.note} />
            </div>
            <DataTable caption="Unpaid invoices by due month" columns={trendColumns} rows={data?.trend ?? []} rowKey={(row) => row.month} loading={!data} defaultSort={{ key: "month", dir: "desc" }} pageSize={24} dense />
          </Card>
        </>
      )}
    </div>
  );
}
