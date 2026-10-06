import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccounts } from "../api/queries";
import type { AccountRow, PaymentRow } from "../api/types";
import { AccountPayment, useAccountPayments } from "../components/AccountPayment";
import { Badge } from "../components/Badge";
import { BalanceDrawer, BalanceMeta } from "../components/BalanceDrawer";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { IssuerLogo } from "../components/IssuerLogo";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { PaymentDrawer, PaymentsPanel } from "../components/PaymentsPanel";
import { SkeletonCard } from "../components/Skeleton";
import { useConfig } from "../hooks/useConfig";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { shownCents } from "../lib/balances";
import { formatDate, formatRange, pluralize } from "../lib/format";
import { joinList } from "../lib/siteConfig";

export default function AccountsPage() {
  const filters = useGlobalFilters();
  const location = useLocation();
  const query = useAccounts({ start: filters.start, end: filters.end });
  const rows = query.data?.rows ?? [];
  const cash = rows.filter((row) => row.type === "cash");
  const cards = rows.filter((row) => row.type === "liability");
  const cashTotal = cash.reduce((acc, row) => acc + shownCents(row), 0);
  const owed = cards.reduce((acc, row) => acc + shownCents(row), 0);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const payments = useAccountPayments("business");
  const cashLabels = [...new Set(useConfig().accounts.filter((account) => account.type === "cash").map((account) => account.label))];
  const cashFooter = cashLabels.length ? `Money in ${joinList(cashLabels)}` : "Money in cash accounts";

  return (
    <div className="page">
      <PageHeader title="Accounts" subtitle={<>Balances and activity · {formatRange(filters.start, filters.end)}</>} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      <section className="kpi-grid kpi-grid--3" aria-label="Totals">
        <KpiCard label="Cash" cents={cashTotal} loading={query.isPending} footer={<span className="muted">{cashFooter}</span>} />
        <KpiCard label="Cards owed" cents={owed} loading={query.isPending} footer={<span className="muted">Amount owed on credit cards</span>} />
        <KpiCard label="Net" cents={cashTotal - owed} loading={query.isPending} footer={<span className="muted">Cash minus cards owed</span>} />
      </section>
      {query.isPending ? (
        <div className="account-grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} height={90} />
          ))}
        </div>
      ) : (
        <>
          <AccountGroup title="Bank and cash" rows={cash} search={location.search} onEdit={setEditing} />
          <AccountGroup
            title="Credit cards"
            rows={cards}
            search={location.search}
            onEdit={setEditing}
            payments={{ byId: payments.byId, pending: payments.pending, onEdit: payments.edit }}
          />
        </>
      )}
      <PaymentsPanel mode="business" />
      <PaymentDrawer mode="business" row={payments.editing} onClose={payments.close} />
      <BalanceDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        accountId={editing?.id ?? ""}
        accountName={editing?.short_name ?? ""}
        accountType={editing?.type ?? "cash"}
      />
    </div>
  );
}

function AccountGroup({
  title,
  rows,
  search,
  onEdit,
  payments,
}: {
  title: string;
  rows: AccountRow[];
  search: string;
  onEdit: (row: AccountRow) => void;
  /** Card tiles only: the payment block above the actions row. */
  payments?: { byId: Map<string, PaymentRow>; pending: boolean; onEdit: (id: string) => void };
}) {
  return (
    <section className="account-group" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <div className="account-grid">
        {rows.map((row) => (
          <Card key={row.id} as="article" className="account-card">
            <Link to={withGlobal(`/accounts/${row.id}`, search)} className="account-card__link">
              <div className="account-card__head">
                <IssuerLogo label={row.short_name} institution={row.institution} kind={row.type === "cash" ? "cash" : "card"} className="account-card__logo" />
                <div>
                  <h3 className="account-card__name">{row.short_name}</h3>
                  <p className="muted small">
                    {row.institution}
                    {row.last4 ? ` ···· ${row.last4}` : ""}
                  </p>
                </div>
                <Icon name="chevronRight" size={18} className="account-card__chev" />
              </div>
              <p className="account-card__balance">
                <Money cents={shownCents(row)} strong />
              </p>
              <BalanceMeta row={row} owed={row.type === "liability"} />
              <dl className="account-card__stats">
                <div>
                  <dt>In</dt>
                  <dd>
                    <Money cents={row.in_cents} colorPositive />
                  </dd>
                </div>
                <div>
                  <dt>Out</dt>
                  <dd>
                    <Money cents={-row.out_cents} />
                  </dd>
                </div>
                <div>
                  <dt>Net</dt>
                  <dd>
                    <Money cents={row.net_cents} colorPositive signed />
                  </dd>
                </div>
              </dl>
              <p className="account-card__foot muted small">
                {row.max_date ? <>Last activity {formatDate(row.max_date)}</> : "No activity"} · {pluralize(row.active_count, "transaction")}
                {row.superseded_count ? <Badge tone="neutral">{row.superseded_count} superseded</Badge> : null}
              </p>
            </Link>
            {payments ? <AccountPayment row={payments.byId.get(row.id)} pending={payments.pending} onEdit={payments.onEdit} /> : null}
            <div className="account-card__actions">
              <Button size="sm" variant="secondary" onClick={() => onEdit(row)}>
                Update balance
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
