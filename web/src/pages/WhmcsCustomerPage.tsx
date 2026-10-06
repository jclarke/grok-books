import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useWhmcsCustomer } from "../api/queries";
import type { WhmcsCustomer } from "../api/types";
import { Card, CardHeader } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { SkeletonCard } from "../components/Skeleton";
import { NotSynced, StatusBadgeText } from "../components/Whmcs";
import { useConfig } from "../hooks/useConfig";
import { withGlobal } from "../hooks/useGlobalFilters";
import { formatDate } from "../lib/format";

type Service = WhmcsCustomer["services"][number];
type Payment = WhmcsCustomer["payments"][number];
type Invoice = WhmcsCustomer["invoices"][number];
type Cancellation = WhmcsCustomer["cancellations"][number];

export default function WhmcsCustomerPage() {
  const { brand = "", id = "" } = useParams();
  const location = useLocation();
  const { product } = useConfig();
  const query = useWhmcsCustomer(brand, id);
  const raw = query.data;
  const customer = raw && raw.ready ? raw.customer : null;
  // The tab title names the record, not the person.
  useEffect(() => {
    document.title = `Customer ${brand} #${id} · ${product}`;
  }, [brand, id, product]);

  const back = (
    <Link to={withGlobal("/whmcs/customers", location.search)} className="link-quiet">
      <Icon name="chevronLeft" size={14} /> Customers
    </Link>
  );

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="page">
        <div className="page-header"><div className="page-header__text"><div className="page-header__eyebrow">{back}</div><h1 className="page-header__title">Customer not found</h1></div></div>
        {missing ? <EmptyState icon="users" title={`No ${brand} client #${id}`} /> : <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      </div>
    );
  }
  if (raw && !raw.ready) {
    return (
      <div className="page">
        <NotSynced />
      </div>
    );
  }

  const serviceColumns: Column<Service>[] = [
    { key: "plan", header: "Plan", accessor: (row) => row.plan, sortable: true, cell: (row) => <span className="customer-cell"><span className="strong">{row.plan}</span><span className="muted small">{row.domain || row.group}</span></span> },
    { key: "status", header: "Status", accessor: (row) => row.status, sortable: true, cell: (row) => <StatusBadgeText status={row.status} /> },
    { key: "cycle", header: "Cycle", accessor: (row) => row.billing_cycle, sortable: true, hideOnMobile: true },
    { key: "amount", header: "Price", accessor: (row) => row.amount_cents, format: "money", sortable: true },
    { key: "mrr", header: "MRR", accessor: (row) => row.mrr_cents, format: "money", sortable: true, hideOnMobile: true },
    { key: "reg", header: "Since", accessor: (row) => row.reg_date, format: "date", sortable: true, hideOnMobile: true },
    { key: "next", header: "Next due", accessor: (row) => row.next_due_date, format: "date", sortable: true, hideOnMobile: true },
    { key: "end", header: "Ended", accessor: (row) => row.termination_date, format: "date", sortable: true, hideOnMobile: true },
    { key: "server", header: "Server", accessor: (row) => row.server, hideOnMobile: true },
  ];
  const paymentColumns: Column<Payment>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, cell: (row) => <span className="nowrap">{formatDate(row.date.slice(0, 10))}</span>, sortable: true, width: "120px" },
    { key: "kind", header: "Kind", accessor: (row) => (row.is_refund ? "Refund" : "Payment"), sortable: true },
    { key: "gateway", header: "Gateway", accessor: (row) => row.gateway, sortable: true, hideOnMobile: true },
    { key: "invoice", header: "Invoice", accessor: (row) => row.invoice_id, cell: (row) => (row.invoice_id ? <span className="num">{row.invoice_id}</span> : <span className="muted">—</span>), hideOnMobile: true },
    { key: "trans", header: "Transaction", accessor: (row) => row.trans_id, cell: (row) => <span className="truncate small">{row.trans_id || "—"}</span>, hideOnMobile: true },
    { key: "fees", header: "Fees", accessor: (row) => row.fees_cents, format: "money", hideOnMobile: true },
    { key: "amount", header: "Amount", accessor: (row) => row.amount_in_cents - row.amount_out_cents, format: "money-signed", sortable: true },
  ];
  const invoiceColumns: Column<Invoice>[] = [
    { key: "id", header: "Invoice", accessor: (row) => row.id, cell: (row) => <span className="num">{row.number || row.id}</span>, sortable: true },
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true },
    { key: "due", header: "Due", accessor: (row) => row.due_date, format: "date", sortable: true, hideOnMobile: true },
    { key: "paid", header: "Paid", accessor: (row) => row.date_paid, format: "date", sortable: true, hideOnMobile: true },
    { key: "status", header: "Status", accessor: (row) => row.status, sortable: true, cell: (row) => <StatusBadgeText status={row.status} /> },
    { key: "method", header: "Method", accessor: (row) => row.payment_method, hideOnMobile: true },
    { key: "total", header: "Total", accessor: (row) => row.total_cents, format: "money", sortable: true },
  ];
  const cancelColumns: Column<Cancellation>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", width: "120px" },
    { key: "plan", header: "Service", accessor: (row) => row.plan, cell: (row) => <span className="customer-cell"><span>{row.plan}</span><span className="muted small">{row.domain}</span></span> },
    { key: "type", header: "Type", accessor: (row) => row.type, hideOnMobile: true },
    { key: "reason", header: "Reason", accessor: (row) => row.reason, cell: (row) => (row.reason ? <span className="wrap-text">{row.reason}</span> : <span className="muted">No reason given</span>) },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header__text">
          <div className="page-header__eyebrow">{back}</div>
          <h1 className="page-header__title">{customer ? customer.name || customer.company || `Client #${customer.client_id}` : "Customer"}</h1>
          <p className="page-header__subtitle">
            {customer ? (
              <>
                {customer.brand} · client #{customer.client_id} · <StatusBadgeText status={customer.status} />
                {customer.company && customer.name ? <> · {customer.company}</> : null}
              </>
            ) : (
              `${brand} · client #${id}`
            )}
          </p>
        </div>
      </div>

      <section className="kpi-grid" aria-label="Customer totals">
        {!customer ? (
          [0, 1, 2, 3].map((i) => <KpiCard key={i} label="" loading />)
        ) : (
          <>
            <KpiCard label="Total paid" cents={customer.totals.paid_cents} footer={<span className="muted">{customer.totals.payments.toLocaleString("en-US")} payments{customer.totals.first_payment ? ` since ${formatDate(customer.totals.first_payment)}` : ""}</span>} />
            <KpiCard label="Lifetime refunds" cents={customer.totals.refunds_cents} footer={<span className="muted">Net of fees and refunds <Money cents={customer.totals.net_cents} /></span>} />
            <KpiCard label="MRR" cents={customer.totals.mrr_cents} footer={<span className="muted">{customer.totals.live_services} live services</span>} />
            <KpiCard label="Unpaid invoices" cents={customer.totals.unpaid_cents} footer={<span className="muted">Credit balance <Money cents={customer.credit_balance_cents} /></span>} />
          </>
        )}
      </section>

      <div className="whmcs-two">
        <Card>
          <CardHeader title="Profile" subtitle="From WHMCS. Addresses and phone numbers are not copied." />
          {!customer ? (
            <SkeletonCard />
          ) : (
            <dl className="whmcs-facts">
              <div><dt>Email</dt><dd className="truncate">{customer.email || "—"}</dd></div>
              <div><dt>Company</dt><dd>{customer.company || "—"}</dd></div>
              <div><dt>Signed up</dt><dd>{formatDate(customer.signup_date)}</dd></div>
              <div><dt>Location</dt><dd>{[customer.state, customer.country].filter(Boolean).join(", ") || "—"}</dd></div>
              <div><dt>Default gateway</dt><dd>{customer.default_gateway || "—"}</dd></div>
              <div><dt>Last payment</dt><dd>{formatDate(customer.totals.last_payment)}</dd></div>
            </dl>
          )}
        </Card>
        <Card padded={false} className="table-section">
          <div className="table-section__head">
            <CardHeader title="Cancellations" />
          </div>
          <DataTable caption="Cancellation requests" columns={cancelColumns} rows={customer?.cancellations ?? []} rowKey={(row) => `${row.date}:${row.service_id}`} loading={!customer} dense empty="No cancellation requests." />
        </Card>
      </div>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="Services" />
        </div>
        <DataTable caption="Services" columns={serviceColumns} rows={customer?.services ?? []} rowKey={(row) => `${row.kind}:${row.id}`} loading={!customer} dense empty="No services." />
      </Card>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="Payment history" subtitle={customer ? `${customer.payments.length.toLocaleString("en-US")} transactions` : null} />
        </div>
        <DataTable caption="Payment history" columns={paymentColumns} rows={customer?.payments ?? []} rowKey={(row) => String(row.id)} loading={!customer} defaultSort={{ key: "date", dir: "desc" }} pageSize={25} dense empty="No payments." />
      </Card>

      <Card padded={false} className="table-section">
        <div className="table-section__head">
          <CardHeader title="Invoices" subtitle={customer ? `${customer.invoices.length.toLocaleString("en-US")} invoices` : null} />
        </div>
        <DataTable caption="Invoices" columns={invoiceColumns} rows={customer?.invoices ?? []} rowKey={(row) => String(row.id)} loading={!customer} defaultSort={{ key: "date", dir: "desc" }} pageSize={25} dense empty="No invoices." />
      </Card>

      {customer && customer.credits.length > 0 ? (
        <Card padded={false} className="table-section">
          <div className="table-section__head">
            <CardHeader title="Account credit" />
          </div>
          <DataTable
            caption="Account credit"
            columns={[
              { key: "date", header: "Date", accessor: (row) => row.date, format: "date" },
              { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money-signed" },
            ]}
            rows={customer.credits.map((row, index) => ({ ...row, key: index }))}
            rowKey={(row) => String(row.key)}
            pageSize={10}
            dense
          />
        </Card>
      ) : null}
    </div>
  );
}
