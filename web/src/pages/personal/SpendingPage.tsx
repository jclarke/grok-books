import { useState } from "react";
import { useSpending } from "../../api/personal";
import { Card, CardHeader } from "../../components/Card";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { KpiCard } from "../../components/KpiCard";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SkeletonCard } from "../../components/Skeleton";
import { DonutChart } from "../../components/charts/DonutChart";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError, TxnLink } from "../../components/personal/PersonalKit";
import { useGlobalFilters } from "../../hooks/useGlobalFilters";
import { isWholeMonth, shiftMonth } from "../../lib/dates";
import { formatMonth, formatPct, formatRange } from "../../lib/format";

type View = "categories" | "merchants" | "trend";

export default function SpendingPage() {
  const filters = useGlobalFilters();
  const [view, setView] = useState<View>("categories");
  const [open, setOpen] = useState<string | null>(null);
  const query = useSpending({ start: filters.start, end: filters.end });
  const data = query.data;
  const range = { start: filters.start, end: filters.end };
  const priorLabel = data ? priorHeader(range, data.prior_start, data.prior_end) : "Prior period";
  // Nothing to compare against when last year's same days had no spending.
  const ytdHasPrior = data ? data.ytd.prior_cents > 0 : false;
  return (
    <div className="page page--personal">
      <PageHeader
        title="Spending"
        eyebrow={PERSONAL_EYEBROW}
        subtitle="Excludes transfers and owner draws; refunds net against their category."
        actions={
          <details className="export-menu">
            <summary className="btn btn--secondary btn--sm">
              <Icon name="download" size={15} /> Export
            </summary>
            <div className="export-menu__list">
              <CsvLink name="spending" params={range} label="Categories (CSV)" />
              <CsvLink name="merchants" params={range} label="Merchants (CSV)" />
            </div>
          </details>
        }
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? <SkeletonCard height={220} /> : null}
      {data ? (
        <>
          <section className="kpi-grid kpi-grid--spending" aria-label="Spending totals">
            <KpiCard emphasis="primary" label="Spent" cents={data.total.cents} delta={data.total.delta} pct={data.total.pct} inverse comparisonLabel={`vs ${formatRange(data.prior_start, data.prior_end)}`} />
            <KpiCard emphasis="quiet" label="Same period last year" cents={data.same_period_last_year_cents} />
            <KpiCard emphasis="quiet" label="This year so far" cents={data.ytd.cents} {...(ytdHasPrior ? { delta: data.ytd.delta, pct: data.ytd.pct, inverse: true, comparisonLabel: "vs the same days last year" } : { footer: "No spending the same days last year" })} />
            <KpiCard emphasis="quiet" label="Merchants" display={String(data.merchant_count)} />
          </section>
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "categories", label: "By category" },
              { value: "merchants", label: "By merchant" },
              { value: "trend", label: "Trend" },
            ]}
          />
          {view === "categories" ? (
            data.groups.length ? (
              <div className="spend-cats">
                <Card className="spend-cats__chart">
                  <DonutChart
                    label="Spending by group"
                    size={176}
                    legend={false}
                    slices={data.groups.map((group, index) => ({ key: group.group, label: group.group, cents: group.cents, tone: tone(index) }))}
                  />
                </Card>
                <Card padded={false} className="spend-cats__table">
                  <table className="table">
                    <caption className="sr-only">Spending by group and category</caption>
                    <thead>
                      <tr>
                        <th scope="col">Group / category</th>
                        <th scope="col" className="num">Spent</th>
                        <th scope="col" className="num hide-mobile">{priorLabel}</th>
                        <th scope="col" className="num hide-mobile">Last year</th>
                        <th scope="col" className="num">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.groups.map((group, index) => (
                        <GroupRows key={group.group} group={group} tone={tone(index)} open={open === group.group} onToggle={() => setOpen(open === group.group ? null : group.group)} />
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            ) : (
              <EmptyState title="No spending in this range" />
            )
          ) : null}
          {view === "merchants" ? (
            <Card padded={false}>
              <DataTable
                caption="Top merchants"
                rows={data.merchants}
                rowKey={(row) => row.merchant_key}
                defaultSort={{ key: "cents", dir: "desc" }}
                columns={[
                  { key: "merchant", header: "Merchant", accessor: (row) => row.merchant, sortable: true, cell: (row) => <TxnLink filter={{ search: row.merchant }}>{row.merchant}</TxnLink> },
                  { key: "cents", header: "Spent", accessor: (row) => row.cents, format: "money", align: "right", sortable: true },
                  { key: "count", header: "Count", accessor: (row) => row.count, format: "number", align: "right", sortable: true },
                  { key: "avg", header: "Average", accessor: (row) => row.average_cents, format: "money", align: "right", hideOnMobile: true },
                  { key: "last", header: "Last", accessor: (row) => row.last_date, format: "date", hideOnMobile: true },
                ]}
                empty={<EmptyState compact title="No merchants in this range" />}
              />
            </Card>
          ) : null}
          {view === "trend" ? (
            <Card padded={false}>
              <CardHeader title="Monthly spending · last 12 months" subtitle="Largest groups" />
              <table className="table">
                <caption className="sr-only">Monthly spending, last 12 months, for the largest groups</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    {data.trend_groups.map((group) => (
                      <th key={group} scope="col" className="num">{group}</th>
                    ))}
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend.map((point) => (
                    <tr key={point.month}>
                      <th scope="row">{formatMonth(point.month)}</th>
                      {data.trend_groups.map((group) => (
                        <td key={group} className="num">
                          <Money cents={point.groups[group] ?? 0} />
                        </td>
                      ))}
                      <td className="num">
                        <Money cents={point.total_cents} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Uncategorized has no real group; the transactions page filters it with a flag instead. */
const groupFilter = (name: string): Record<string, string> => (name === "Uncategorized" ? { uncategorized: "1" } : { group: name });

/** "Last month" when a whole-month range is compared with the month right before it. */
function priorHeader(range: { start: string; end: string }, priorStart: string, priorEnd: string): string {
  if (!isWholeMonth({ start: priorStart, end: priorEnd })) return "Prior period";
  if (isWholeMonth(range) && shiftMonth(range.start.slice(0, 7), -1) === priorStart.slice(0, 7)) return "Last month";
  return formatMonth(priorStart.slice(0, 7), { short: true });
}

const tone = (index: number) => `cat-${(index % 10) + 1}`;

function GroupRows({ group, tone, open, onToggle }: { group: NonNullable<ReturnType<typeof useSpending>["data"]>["groups"][number]; tone: string; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="row--group">
        <th scope="row">
          <span className="group-cell">
            <button type="button" className="group-cell__toggle" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${group.group}`} onClick={onToggle}>
              <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            </button>
            <span className={`legend__swatch legend__swatch--square tone-${tone}`} aria-hidden="true" />
            <TxnLink filter={groupFilter(group.group)}>{group.group}</TxnLink>
          </span>
        </th>
        <td className="num"><Money cents={group.cents} strong /></td>
        <td className="num hide-mobile"><Money cents={group.prior_cents} /></td>
        <td className="num hide-mobile"><Money cents={group.last_year_cents} /></td>
        <td className="num">{formatPct(group.share)}</td>
      </tr>
      {open
        ? group.categories.map((cat) => (
            <tr key={cat.category_id} className="row--child">
              <td>
                <TxnLink filter={cat.category === "Uncategorized" ? { uncategorized: "1" } : { category_id: String(cat.category_id) }}>{cat.category}</TxnLink>
              </td>
              <td className="num"><Money cents={cat.cents} /></td>
              <td className="num hide-mobile"><Money cents={cat.prior_cents} /></td>
              <td className="num hide-mobile"><Money cents={cat.last_year_cents} /></td>
              <td className="num">{formatPct(cat.share)}</td>
            </tr>
          ))
        : null}
    </>
  );
}
