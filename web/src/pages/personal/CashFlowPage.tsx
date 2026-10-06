import { useCashFlow } from "../../api/personal";
import { Card, CardHeader } from "../../components/Card";
import { DataTable } from "../../components/DataTable";
import { KpiCard } from "../../components/KpiCard";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SkeletonCard } from "../../components/Skeleton";
import { ComboChart } from "../../components/charts/ComboChart";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { useGlobalFilters } from "../../hooks/useGlobalFilters";
import { formatMonth, formatPct } from "../../lib/format";

export default function CashFlowPage() {
  const filters = useGlobalFilters();
  const month = filters.end.slice(0, 7);
  const query = useCashFlow({ month, months: 12 });
  const data = query.data;
  return (
    <div className="page page--personal">
      <PageHeader
        title="Cash flow"
        eyebrow={PERSONAL_EYEBROW}
        subtitle={data ? `${formatMonth(data.start_month)} – ${formatMonth(data.end_month)} · owner draws are their own source, not earned income` : undefined}
        actions={<CsvLink name="cash-flow" params={{ month, months: 12 }} />}
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? <SkeletonCard height={260} /> : null}
      {data ? (
        <>
          <section className="kpi-grid" aria-label="Twelve-month totals">
            <KpiCard label="Income" cents={data.income_cents} footer={<span className="muted small">Earned <Money cents={data.earned_cents} /> · Owner draws <Money cents={data.owner_draws_cents} /></span>} />
            <KpiCard label="Spending" cents={data.spending_cents} />
            <KpiCard label="Net" cents={data.net_cents} />
            <KpiCard label="Savings rate" display={formatPct(data.savings_rate)} footer={<span className="muted small">Without owner draws {formatPct(data.savings_rate_without_draws)}</span>} />
          </section>
          <Card>
            <CardHeader title="Income vs spending" subtitle="Bars are income and spending; the line is net" />
            <ComboChart
              label="Monthly income, spending, and net"
              points={data.months.map((item) => ({ key: item.month, label: formatMonth(item.month).split(" ")[0], bars: [item.income_cents, item.spending_cents], line: item.net_cents }))}
              barLabels={["Income", "Spending"]}
              barTones={["rev", "exp"]}
              lineLabel="Net"
              lineTone="net"
            />
          </Card>
          <div className="split-grid">
            <Card padded={false}>
              <DataTable
                caption="Income sources"
                rows={data.sources}
                rowKey={(row) => row.source}
                columns={[
                  { key: "source", header: "Source", accessor: (row) => row.source },
                  { key: "cents", header: "12 months", accessor: (row) => row.cents, format: "money", align: "right" },
                ]}
              />
            </Card>
            <Card padded={false}>
              <DataTable
                caption="Monthly cash flow"
                rows={[...data.months].reverse()}
                rowKey={(row) => row.month}
                columns={[
                  { key: "month", header: "Month", accessor: (row) => formatMonth(row.month) },
                  { key: "income", header: "Income", accessor: (row) => row.income_cents, format: "money", align: "right" },
                  { key: "draws", header: "Owner draws", accessor: (row) => row.owner_draws_cents, format: "money", align: "right", hideOnMobile: true },
                  { key: "spending", header: "Spending", accessor: (row) => row.spending_cents, format: "money", align: "right" },
                  { key: "net", header: "Net", accessor: (row) => row.net_cents, format: "money-signed", align: "right" },
                  { key: "rate", header: "Savings", accessor: (row) => row.savings_rate, format: "pct", align: "right" },
                  { key: "rate2", header: "w/o draws", accessor: (row) => row.savings_rate_without_draws, format: "pct", align: "right", hideOnMobile: true },
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
