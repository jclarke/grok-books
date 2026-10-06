import { useState } from "react";
import { useMonthlySummary } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { KpiCard } from "../../components/KpiCard";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SkeletonCard } from "../../components/Skeleton";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { useSession } from "../../hooks/useSession";
import { formatDate, formatMonth, formatPct } from "../../lib/format";

export default function MonthlySummaryPage() {
  const { data: session } = useSession();
  const [month, setMonth] = useState((session?.today ?? "").slice(0, 7));
  const query = useMonthlySummary(month);
  const data = query.data;
  return (
    <div className="page page--personal page--printable">
      <PageHeader
        title="Monthly summary"
        eyebrow={PERSONAL_EYEBROW}
        subtitle={formatMonth(month)}
        actions={
          <>
            <label className="field field--inline">
              <span className="field__label">Month</span>
              <input className="input input--sm" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
            </label>
            <CsvLink name="summary" params={{ month }} />
            <Button size="sm" icon="printer" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? <SkeletonCard height={200} /> : null}
      {data ? (
        <>
          <Card>
            <CardHeader title="In plain English" />
            <ul className="summary-lines">
              {data.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>
          <section className="kpi-grid" aria-label="Month totals">
            <KpiCard label="Income" cents={data.income_cents} delta={data.income_cents - data.prior.income_cents} comparisonLabel="vs prior month" footer={<span className="muted small">12-month average <Money cents={data.average_12.income_cents} /></span>} />
            <KpiCard label="Spending" cents={data.spending_cents} delta={data.spending_cents - data.prior.spending_cents} inverse comparisonLabel="vs prior month" footer={<span className="muted small">12-month average <Money cents={data.average_12.spending_cents} /></span>} />
            <KpiCard label="Savings rate" display={formatPct(data.savings_rate)} footer={<span className="muted small">Without owner draws {formatPct(data.savings_rate_without_draws)}</span>} />
            <KpiCard label="Net worth change" cents={data.net_worth_change_cents} footer={<span className="muted small"><Money cents={data.net_worth_start_cents} /> → <Money cents={data.net_worth_end_cents} /></span>} />
          </section>
          <div className="split-grid">
            <Card>
              <CardHeader title="Biggest category changes" subtitle={`vs ${formatMonth(data.prior_month)}`} />
              {data.category_changes.length ? (
                <ul className="class-list">
                  {data.category_changes.map((item) => (
                    <li key={item.category}>
                      <span>{item.category}</span> <Money cents={item.cents} /> <Money cents={item.delta} signed colorPositive={false} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No spending either month" />
              )}
            </Card>
            <Card>
              <CardHeader title="Biggest transactions" />
              <ul className="class-list">
                {data.biggest.map((row) => (
                  <li key={row.id}>
                    <span>
                      {formatDate(row.date, { year: false })} {row.merchant} {row.from_business ? <Badge tone="info">paid from business account</Badge> : null}
                    </span>
                    <Money cents={row.amount_cents} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Subscriptions" />
              {data.new_subscriptions.length || data.changed_subscriptions.length ? (
                <ul className="class-list">
                  {data.new_subscriptions.map((item) => (
                    <li key={`new-${item.merchant}`}>
                      <span><Badge tone="info">new</Badge> {item.merchant} ({item.cadence})</span> <Money cents={item.typical_cents} />
                    </li>
                  ))}
                  {data.changed_subscriptions.map((item) => (
                    <li key={`chg-${item.merchant}`}>
                      <span><Badge tone="warn">price change</Badge> {item.merchant}</span>
                      <span><Money cents={item.from_cents} /> → <Money cents={item.to_cents} /></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No new or changed subscriptions" />
              )}
            </Card>
            <Card>
              <CardHeader title="Budgets" subtitle={data.budget.rows.length ? `${data.budget.counts.over ?? 0} over · ${data.budget.counts.warning ?? 0} near the limit` : undefined} />
              {data.budget.rows.length ? (
                <ul className="class-list">
                  {data.budget.rows.map((row) => (
                    <li key={row.id}>
                      <span>{row.name} {row.status !== "ok" ? <Badge tone={row.status === "over" ? "neg" : "warn"}>{row.status}</Badge> : null}</span>
                      <span><Money cents={row.spent_cents} /> / <Money cents={row.available_cents} /></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No budgets this month" />
              )}
            </Card>
          </div>
          <Card>
            <CardHeader title="Income sources" />
            <ul className="class-list">
              {Object.entries(data.sources).map(([source, cents]) => (
                <li key={source}>
                  <span>{source}</span> <Money cents={cents} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
