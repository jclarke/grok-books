import { useState } from "react";
import { useNetWorth, type NetWorthAccount } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Card, CardHeader } from "../../components/Card";
import { DataTable, type Column } from "../../components/DataTable";
import { KpiCard } from "../../components/KpiCard";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SkeletonCard } from "../../components/Skeleton";
import { AreaChart } from "../../components/charts/AreaChart";
import { CsvLink, NoPersonalData, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { formatDate } from "../../lib/format";

const RANGES = ["3M", "6M", "1Y", "YTD", "ALL"] as const;
type Range = (typeof RANGES)[number];

export default function NetWorthPage() {
  const [range, setRange] = useState<Range>("1Y");
  const query = useNetWorth({ range });
  const data = query.data;
  const columns: Column<NetWorthAccount>[] = [
    {
      key: "label",
      header: "Account",
      accessor: (row) => row.label,
      sortable: true,
      cell: (row) => (
        <span>
          {row.label} {row.last4 ? <span className="muted small">···· {row.last4}</span> : null}{" "}
          {row.stale ? <Badge tone="warn" title="No balance or activity in 7+ days">stale</Badge> : null}{" "}
          {!row.included ? <Badge tone="neutral">not in net worth</Badge> : null}
        </span>
      ),
    },
    { key: "class", header: "Class", accessor: (row) => row.class, hideOnMobile: true },
    { key: "balance", header: "Balance", accessor: (row) => row.balance_cents, format: "money", align: "right", sortable: true },
    { key: "contribution", header: "Net worth effect", accessor: (row) => row.contribution_cents, format: "money-signed", align: "right", sortable: true },
    { key: "change", header: "Change in range", accessor: (row) => row.change_cents, format: "money-signed", align: "right", hideOnMobile: true },
    { key: "updated", header: "Last updated", accessor: (row) => row.last_updated, format: "date", hideOnMobile: true },
  ];
  return (
    <div className="page page--personal">
      <PageHeader
        title="Net worth"
        eyebrow={PERSONAL_EYEBROW}
        subtitle="Assets minus cards, loans, and mortgages, from balance anchors plus activity"
        actions={
          <>
            <SegmentedControl label="Range" value={range} onChange={setRange} options={RANGES.map((value) => ({ value, label: value === "ALL" ? "All" : value }))} size="sm" />
            <CsvLink name="net-worth" params={{ range }} label="Accounts CSV" />
            <CsvLink name="net-worth-history" params={{ range }} label="History CSV" />
          </>
        }
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? <SkeletonCard height={240} /> : null}
      {data && data.accounts.length === 0 ? <NoPersonalData /> : null}
      {data && data.accounts.length ? (
        <>
          <section className="kpi-grid" aria-label="Net worth">
            <KpiCard label="Net worth" cents={data.net_cents} delta={data.change_30_cents} comparisonLabel="30-day change" />
            <KpiCard label="Assets" cents={data.assets_cents} />
            <KpiCard label="Liabilities" cents={data.liabilities_cents} inverse />
            <KpiCard label="90-day change" cents={data.change_90_cents} />
          </section>
          {data.stale_count ? (
            <p className="callout callout--warn" role="status">
              {data.stale_count} account{data.stale_count === 1 ? " has" : "s have"} no balance or activity in the last 7 days, so the figure may be out of date.
            </p>
          ) : null}
          <Card>
            <CardHeader title="History" subtitle={`${data.interval === "week" ? "Weekly" : "Month-end"} · as of ${formatDate(data.as_of)}`} />
            <AreaChart
              points={data.points.map((point) => ({ date: point.date, value: point.net_cents }))}
              label={`Net worth history, ${range}`}
              valueLabel="Net worth"
              axis={data.interval === "week" ? "day" : "month"}
            />
          </Card>
          <Card>
            <CardHeader title="By class" />
            <ul className="class-list">
              {data.by_class.map((item) => (
                <li key={item.class}>
                  <span>{item.label}</span> <span className="muted small">{item.count}</span>{" "}
                  <span className={item.cents < 0 ? "money money--neg num" : "money num"}>{(item.cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card padded={false}>
            <DataTable columns={columns} rows={data.accounts} rowKey={(row) => row.id} caption="Accounts and their effect on net worth" defaultSort={{ key: "contribution", dir: "desc" }} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
