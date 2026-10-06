import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useRegister } from "../api/queries";
import type { RegisterRow } from "../api/types";
import { Badge } from "../components/Badge";
import { BalanceDrawer, BalanceMeta } from "../components/BalanceDrawer";
import { Button } from "../components/Button";
import { InlineClassify } from "../components/ClassifyControls";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { RuleDrawer, type RuleSeed } from "../components/RuleDrawer";
import { Select } from "../components/Select";
import { TransactionDrawer } from "../components/TransactionDrawer";
import { useDebounce } from "../hooks/useDebounce";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { useUrlState } from "../hooks/useUrlState";
import { shownCents } from "../lib/balances";
import { formatRange, pluralize } from "../lib/format";

export default function RegisterPage() {
  const { accountId = "" } = useParams();
  const filters = useGlobalFilters();
  const location = useLocation();
  const url = useUrlState();
  const [searchText, setSearchText] = useState(url.get("search"));
  const debounced = useDebounce(searchText, 300);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | null>(null);
  const [editingBalance, setEditingBalance] = useState(false);
  useEffect(() => {
    if (debounced !== url.get("search")) url.patch({ search: debounced }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const offset = Number(url.get("offset", "0")) || 0;
  const limit = Number(url.get("limit", "100")) || 100;
  const allDates = url.get("all") === "1";
  const query = useRegister(accountId, {
    start: allDates ? undefined : filters.start,
    end: allDates ? undefined : filters.end,
    search: url.get("search"),
    status: url.get("status", "active"),
    offset,
    limit,
  });
  const data = query.data;
  const txnId = url.get("txn") || null;

  const columns: Column<RegisterRow>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", width: "112px" },
    {
      key: "name",
      header: "Description",
      accessor: (row) => row.name,
      cell: (row) => (
        <div className="txn-desc">
          <span className="txn-desc__name" title={row.name}>{row.name}</span>
          <span className="txn-desc__meta">
            {row.note ? <span>{row.note}</span> : null}
            {row.status !== "active" ? <Badge tone="neutral">{row.status}</Badge> : null}
          </span>
        </div>
      ),
    },
    { key: "tag", header: "Business", width: "160px", hideOnMobile: true, cell: (row) => <InlineClassify txnId={row.id} tag={row.business_tag} category={row.category} note={row.note} label={row.name} part="tag" /> },
    { key: "category", header: "Category", width: "200px", hideOnMobile: true, cell: (row) => <InlineClassify txnId={row.id} tag={row.business_tag} category={row.category} note={row.note} label={row.name} part="category" /> },
    { key: "payment", header: "Payment", align: "right", width: "112px", hideOnMobile: true, cell: (row) => (row.payment_cents !== null ? <Money cents={row.payment_cents} /> : null) },
    { key: "deposit", header: "Deposit", align: "right", width: "112px", hideOnMobile: true, cell: (row) => (row.deposit_cents !== null ? <Money cents={row.deposit_cents} colorPositive /> : null) },
    { key: "amount", header: "Amount", align: "right", className: "show-mobile-cell", cell: (row) => <Money cents={row.amount_cents} colorPositive /> },
    {
      key: "running",
      header: "Balance",
      align: "right",
      width: "124px",
      cell: (row) =>
        row.running_cents == null ? (
          <span className="muted" title="Outside the statement balance">
            —
          </span>
        ) : (
          <Money cents={row.running_cents} strong />
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <Link to={withGlobal("/accounts", location.search)} className="link-quiet">
            <Icon name="chevronLeft" size={14} /> Accounts
          </Link>
        }
        title={data?.account.short_name ?? "Register"}
        subtitle={data ? <>{data.account.name}{data.account.notes ? <span className="muted"> · {data.account.notes}</span> : null}</> : undefined}
        actions={
          data ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingBalance(true)}>
              Update balance
            </Button>
          ) : null
        }
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <section className="kpi-grid kpi-grid--3" aria-label="Account totals">
            <KpiCard
              label={data?.anchored ? "Balance" : "Imported activity"}
              cents={data ? (data.anchored ? (data.real_balance_cents ?? shownCents(data)) : shownCents(data)) : 0}
              loading={!data}
              footer={data ? <BalanceMeta row={data} owed={data.account.type === "liability"} /> : null}
            />
            <KpiCard
              label={data?.anchored ? "Opening balance" : "Rows shown"}
              cents={data?.anchored ? (data.opening_cents ?? 0) : undefined}
              display={!data?.anchored && data ? pluralize(data.total, "transaction") : undefined}
              loading={!data}
              footer={<span className="muted">{data?.anchored ? "Implied on Jan 1, 2026" : allDates ? "All dates" : formatRange(filters.start, filters.end)}</span>}
            />
            <KpiCard label="Type" display={data ? (data.account.type === "cash" ? "Cash" : "Credit card") : ""} loading={!data} footer={<span className="muted">{data?.account.institution}</span>} />
          </section>
          <div className="toolbar" role="search">
            <div className="toolbar__search">
              <Icon name="search" size={16} />
              <label className="sr-only" htmlFor="reg-search">Search this register</label>
              <input id="reg-search" className="input" type="search" placeholder="Search description, category, or id" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={200} />
            </div>
            <Select
              label="Status"
              hideLabel
              value={url.get("status", "active")}
              onChange={(value) => url.patch({ status: value === "active" ? "" : value })}
              options={[
                { value: "active", label: "Active" },
                { value: "superseded", label: "Superseded" },
                { value: "all", label: "All statuses" },
              ]}
            />
            <label className="check">
              <input type="checkbox" checked={allDates} onChange={(event) => url.patch({ all: event.target.checked ? "1" : "" })} /> All dates
            </label>
          </div>
          <DataTable
            caption="Account register"
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(row) => row.id}
            loading={query.isPending}
            keyboard={!txnId && !ruleSeed}
            onRowClick={(row) => url.patch({ txn: row.id }, { resetOffset: false })}
            pagination={data ? { offset, limit, total: data.total, onChange: (next) => url.patch({ offset: next || null }), onLimitChange: (next) => url.patch({ limit: next === 100 ? null : next }) } : undefined}
            empty={<EmptyState icon="accounts" title="No activity" compact>Nothing in this range. Tick “All dates” to see the full register.</EmptyState>}
          />
        </>
      )}
      <BalanceDrawer
        open={editingBalance}
        onClose={() => setEditingBalance(false)}
        accountId={data?.account.id ?? accountId}
        accountName={data?.account.short_name ?? "Account"}
        accountType={data?.account.type ?? "cash"}
      />
      <TransactionDrawer txnId={txnId} onClose={() => url.patch({ txn: null }, { resetOffset: false })} onCreateRule={(seed) => { url.patch({ txn: null }, { resetOffset: false }); setRuleSeed(seed); }} />
      <RuleDrawer seed={ruleSeed} onClose={() => setRuleSeed(null)} />
    </div>
  );
}

