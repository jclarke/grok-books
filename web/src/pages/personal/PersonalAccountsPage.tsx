import { Link, useLocation } from "react-router-dom";
import { usePersonalAccounts } from "../../api/personal";
import { AccountPayment, useAccountPayments } from "../../components/AccountPayment";
import { Badge } from "../../components/Badge";
import { Card } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { IssuerLogo } from "../../components/IssuerLogo";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { PaymentDrawer, PaymentsPanel } from "../../components/PaymentsPanel";
import { SkeletonCard } from "../../components/Skeleton";
import { Sparkline } from "../../components/charts/Sparkline";
import { CsvLink, NoPersonalData, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { withGlobal } from "../../hooks/useGlobalFilters";
import { formatDate } from "../../lib/format";

export default function PersonalAccountsPage() {
  const query = usePersonalAccounts();
  const location = useLocation();
  const data = query.data;
  const payments = useAccountPayments("personal");
  return (
    <div className="page page--personal">
      <PageHeader title="Personal accounts" eyebrow={PERSONAL_EYEBROW} subtitle="Balances by class; cards and loans show the amount owed" actions={<CsvLink name="accounts" />} />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? (
        <div className="account-grid">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} height={90} />
          ))}
        </div>
      ) : null}
      {data && data.account_count === 0 ? <NoPersonalData /> : null}
      {data?.groups.map((group) => (
        <section className="account-group" aria-label={group.label} key={group.class}>
          <h2 className="section-title">
            {group.label} <span className="muted small"><Money cents={group.total_cents} /></span>
          </h2>
          <div className="account-grid">
            {group.accounts.map((row) => (
              <Card key={row.id} as="article" className="account-card">
                <Link to={withGlobal(`/personal/accounts/${row.id}`, location.search)} className="account-card__link" aria-label={`${row.label} register`}>
                  <div className="account-card__head">
                    <IssuerLogo
                      label={row.label}
                      institution={row.institution}
                      kind={row.class === "loan" ? "loan" : row.liability ? "card" : row.class === "investment" ? "investment" : "cash"}
                      className="account-card__logo"
                    />
                    <div>
                      <h3 className="account-card__name">{row.label}</h3>
                      <p className="muted small">
                        {row.institution}
                        {row.last4 ? ` ···· ${row.last4}` : ""}
                      </p>
                    </div>
                    <Icon name="chevronRight" size={18} className="account-card__chev" />
                  </div>
                  <p className="account-card__balance">
                    <Money cents={row.balance_cents} strong />
                    {row.liability ? <span className="muted small"> owed</span> : null}
                  </p>
                  <Sparkline values={row.spark} label={`${row.label}, last 30 days`} tone={row.liability ? "exp" : "net"} width={160} />
                  <p className="account-card__foot muted small">
                    {row.last_updated ? <>Updated {formatDate(row.last_updated)}</> : "No balance yet"}
                    {row.stale ? <> <Badge tone="warn">stale</Badge></> : null}
                    {!row.included ? <> <Badge tone="neutral">not in net worth</Badge></> : null}
                  </p>
                </Link>
                {row.liability || row.class === "loan" || payments.byId.has(row.id) ? (
                  <AccountPayment row={payments.byId.get(row.id)} pending={payments.pending} onEdit={payments.edit} />
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      ))}
      {data && data.account_count > 0 ? <PaymentsPanel mode="personal" /> : null}
      <PaymentDrawer mode="personal" row={payments.editing} onClose={payments.close} />
    </div>
  );
}
