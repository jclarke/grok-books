import { useState } from "react";
import { useWhmcsReconcile } from "../api/queries";
import type { WhmcsGatewayRow, WhmcsReconcile, WhmcsReconcileMonth, WhmcsReconcileRow } from "../api/types";
import { Badge } from "../components/Badge";
import { Card, CardHeader } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { Select } from "../components/Select";
import { ClientLink, CsvLink, NotSynced, WhmcsEyebrow, WhmcsToolbar, isReady } from "../components/Whmcs";
import { useConfig } from "../hooks/useConfig";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { useUrlState } from "../hooks/useUrlState";
import { formatDate, formatRange } from "../lib/format";
import { gatewaysSubtitle } from "../lib/siteConfig";

type Status = "all" | WhmcsReconcileRow["status"];

const STATUS_LABEL: Record<WhmcsReconcileRow["status"], string> = {
  matched: "Matched",
  whmcs_only: "WHMCS only",
  paypal_only: "PayPal only",
};

export default function WhmcsReconciliationPage() {
  const filters = useGlobalFilters();
  const { whmcs_bank_sides: bankSides } = useConfig();
  const url = useUrlState();
  const matchWindow = ["0", "1", "2", "3", "5", "7"].includes(url.get("window")) ? url.get("window") : "3";
  const [status, setStatus] = useState<Status>("all");
  const [text, setText] = useState("");
  const params = { start: filters.start, end: filters.end, window: matchWindow };
  const query = useWhmcsReconcile(params);
  const raw = query.data;
  const data = isReady<WhmcsReconcile>(raw) ? raw : null;
  const totals = data?.totals;
  const rows = (data?.rows ?? []).filter((row) => status === "all" || row.status === status);
  const clamped = data && (data.start !== data.requested_start || data.end !== data.requested_end);

  const monthColumns: Column<WhmcsReconcileMonth>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, sortable: true },
    { key: "matched", header: "Matched", accessor: (row) => row.matched, format: "number" },
    { key: "whmcs_only", header: "WHMCS only", accessor: (row) => row.whmcs_only, format: "number", cell: (row) => <CountCell count={row.whmcs_only} cents={row.whmcs_only_cents} /> },
    { key: "paypal_only", header: "PayPal only", accessor: (row) => row.paypal_only, format: "number", cell: (row) => <CountCell count={row.paypal_only} cents={row.paypal_only_cents} /> },
    { key: "whmcs", header: "WHMCS net", accessor: (row) => row.whmcs_net_cents, format: "money", hideOnMobile: true },
    { key: "books", header: "PayPal (books)", accessor: (row) => row.books_cents, format: "money", hideOnMobile: true },
    { key: "diff", header: "Difference", accessor: (row) => row.difference_cents, format: "money-signed", sortable: true },
  ];
  const rowColumns: Column<WhmcsReconcileRow>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true, width: "120px" },
    { key: "status", header: "Status", accessor: (row) => row.status, sortable: true, cell: (row) => <Badge tone={row.status === "matched" ? "pos" : "warn"}>{STATUS_LABEL[row.status]}</Badge> },
    { key: "kind", header: "Kind", accessor: (row) => row.kind, sortable: true, hideOnMobile: true },
    { key: "brand", header: "Brand", accessor: (row) => row.brand ?? "", sortable: true, hideOnMobile: true },
    { key: "client", header: "Client", accessor: (row) => row.client_id, cell: (row) => <ClientLink brand={row.brand} id={row.client_id} />, hideOnMobile: true },
    { key: "trans", header: "PayPal id / payer", accessor: (row) => `${row.trans_id} ${row.books_name ?? ""}`, cell: (row) => <span className="truncate small" title={row.trans_id || row.books_name || ""}>{row.trans_id || row.books_name || "—"}</span> },
    { key: "whmcs", header: "WHMCS net", accessor: (row) => row.whmcs_net_cents, format: "money", sortable: true },
    { key: "books", header: "PayPal (books)", accessor: (row) => row.books_cents, format: "money", sortable: true },
    { key: "how", header: "Matched on", accessor: (row) => row.match ?? "", hideOnMobile: true, cell: (row) => (row.match ? <span className="muted small">{row.match}{row.books_date && row.books_date !== row.date ? ` · ${formatDate(row.books_date, { year: false })}` : ""}</span> : <span className="muted">—</span>) },
  ];
  const gatewayColumns: Column<WhmcsGatewayRow>[] = [
    { key: "month", header: "Month", accessor: (row) => row.month, sortable: true },
    { key: "gateway", header: "Gateway", accessor: (row) => row.gateway, sortable: true },
    { key: "count", header: "Count", accessor: (row) => row.count, format: "number", hideOnMobile: true },
    { key: "gross", header: "Gross in", accessor: (row) => row.gross_cents, format: "money", hideOnMobile: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money", hideOnMobile: true },
    { key: "refunds", header: "Refunds", accessor: (row) => row.refunds_cents, format: "money", hideOnMobile: true },
    { key: "net", header: "WHMCS net", accessor: (row) => row.net_cents, format: "money", sortable: true },
    { key: "bank", header: "Bank side", accessor: (row) => row.bank_cents, sortable: true, align: "right", cell: (row) => (row.bank_cents === null ? <span className="muted small">not matched</span> : <Money cents={row.bank_cents} />) },
    { key: "diff", header: "Difference", accessor: (row) => row.difference_cents, sortable: true, align: "right", cell: (row) => (row.difference_cents === null ? <span className="muted">—</span> : <Money cents={row.difference_cents} colorPositive signed />) },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<WhmcsEyebrow />}
        title="PayPal reconciliation"
        subtitle={<>{data ? formatRange(data.start, data.end) : formatRange(filters.start, filters.end)} · all brands · read-only comparison, the ledger is not changed</>}
        actions={
          <div className="export-group" role="group" aria-label="Export">
            <CsvLink table="reconcile" params={params} label="Months CSV" />
            <CsvLink table="reconcile-rows" params={params} label="Rows CSV" />
            <CsvLink table="gateways" params={params} label="Gateways CSV" />
          </div>
        }
      />
      <WhmcsToolbar period={false}>
        <Select
          label="Match window"
          value={matchWindow}
          onChange={(value) => url.patch({ window: value === "3" ? "" : value })}
          options={["0", "1", "2", "3", "5", "7"].map((value) => ({ value, label: `± ${value} day${value === "1" ? "" : "s"}` }))}
        />
      </WhmcsToolbar>
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {raw && !raw.ready ? (
        <NotSynced />
      ) : (
        <>
          {clamped && data ? (
            <p className="notice notice--warn" role="note">
              <Icon name="info" size={16} /> The books hold PayPal activity from {formatDate(data.coverage.books_first)} to {formatDate(data.coverage.books_last)}, so the comparison covers {formatRange(data.start, data.end)}.
            </p>
          ) : null}
          <section className="kpi-grid" aria-label="Reconciliation totals">
            {!totals ? (
              [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
            ) : (
              <>
                <KpiCard label="Matched" display={totals.matched.toLocaleString("en-US")} footer={<span className="muted"><Money cents={totals.matched_books_cents} /> in PayPal</span>} />
                <KpiCard label="WHMCS only" display={totals.whmcs_only.toLocaleString("en-US")} footer={<span className="muted"><Money cents={totals.whmcs_only_cents} /> net, no PayPal row</span>} />
                <KpiCard label="PayPal only" display={totals.paypal_only.toLocaleString("en-US")} footer={<span className="muted"><Money cents={totals.paypal_only_cents} />, no WHMCS payment</span>} />
                <KpiCard label="Difference" cents={totals.difference_cents} footer={<span className="muted">PayPal (books) minus WHMCS net</span>} />
              </>
            )}
          </section>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="By month" subtitle={data?.note} />
            </div>
            <DataTable caption="PayPal reconciliation by month" columns={monthColumns} rows={data?.months ?? []} rowKey={(row) => row.month} loading={!data} defaultSort={{ key: "month", dir: "desc" }} dense />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader
                title="Rows"
                subtitle="WHMCS PayPal payments and refunds beside the PayPal account rows they matched"
                actions={
                  <SegmentedControl
                    label="Status"
                    size="sm"
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: "all", label: "All" },
                      { value: "matched", label: "Matched" },
                      { value: "whmcs_only", label: "WHMCS only" },
                      { value: "paypal_only", label: "PayPal only" },
                    ]}
                  />
                }
              />
              <div className="toolbar__search">
                <Icon name="search" size={16} />
                <label className="sr-only" htmlFor="recon-filter">Filter rows</label>
                <input id="recon-filter" className="input" type="search" placeholder="Filter by transaction id, payer, brand" value={text} onChange={(event) => setText(event.target.value)} />
              </div>
            </div>
            <DataTable caption="Reconciliation rows" columns={rowColumns} rows={rows} rowKey={(row) => row.key} loading={!data} filter={text} defaultSort={{ key: "date", dir: "desc" }} pageSize={50} dense empty="No rows." />
          </Card>

          <Card padded={false} className="table-section">
            <div className="table-section__head">
              <CardHeader title="Other gateways" subtitle={gatewaysSubtitle(bankSides)} />
            </div>
            <DataTable caption="Gateway totals by month" columns={gatewayColumns} rows={data?.gateways ?? []} rowKey={(row) => `${row.month}:${row.gateway}`} loading={!data} defaultSort={{ key: "month", dir: "desc" }} pageSize={36} dense />
          </Card>
        </>
      )}
    </div>
  );
}

function CountCell({ count, cents }: { count: number; cents: number }) {
  if (!count) return <span className="num muted">0</span>;
  return (
    <span className="num">
      {count} · <Money cents={cents} />
    </span>
  );
}
