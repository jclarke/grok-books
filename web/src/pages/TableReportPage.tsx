import { Link, useLocation, useParams } from "react-router-dom";
import { useReport } from "../api/queries";
import { Card } from "../components/Card";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { ExportButtons } from "../components/ExportButtons";
import { Icon } from "../components/Icon";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { SkeletonTable } from "../components/Skeleton";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { useUrlState } from "../hooks/useUrlState";
import { cx } from "../lib/cx";
import { formatRange } from "../lib/format";
import { businessLabel } from "../lib/labels";
import { reportInfo } from "../lib/reports";
import NotFoundPage from "./NotFoundPage";

export default function TableReportPage() {
  const { name = "" } = useParams();
  const info = reportInfo(name);
  if (!info || name === "pnl") return <NotFoundPage />;
  return <TableReport name={name} />;
}

function TableReport({ name }: { name: string }) {
  const info = reportInfo(name)!;
  const filters = useGlobalFilters();
  const location = useLocation();
  const url = useUrlState();
  const limit = info.hasLimit ? Number(url.get("limit", "25")) || 25 : undefined;
  const params = { start: filters.start, end: filters.end, business: filters.business, limit };
  const query = useReport(name, params);
  const data = query.data;
  const empty = data && data.rows.length <= 1 && data.rows.every((row) => row.every((cell) => !cell.cents));

  return (
    <div className="page page--report">
      <PageHeader
        eyebrow={<Link to={withGlobal("/reports", location.search)} className="link-quiet"><Icon name="chevronLeft" size={14} /> Reports</Link>}
        title={info.title}
        subtitle={
          <>
            {formatRange(filters.start, filters.end)}
            {info.usesBusiness ? ` · ${businessLabel(filters.business)}` : <span className="muted"> · all businesses (this report is company-wide)</span>}
          </>
        }
        actions={<ExportButtons base={`/export/${name}`} params={params} />}
      />
      <p className="report-desc no-print">{info.description}</p>
      {info.hasLimit ? (
        <div className="toolbar no-print">
          <Select
            label="Vendors shown"
            value={String(limit)}
            onChange={(value) => url.patch({ limit: value === "25" ? "" : value })}
            options={["10", "25", "50", "100"].map((value) => ({ value, label: `Top ${value}` }))}
          />
        </div>
      ) : null}
      <Card padded={false} className="statement-card">
        <div className="print-only print-title">
          <h1>{data?.title}</h1>
          <p>Generated {data?.generated}</p>
        </div>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !data ? (
          <SkeletonTable rows={10} cols={4} />
        ) : empty ? (
          <EmptyState icon="reports" title="Nothing to report in this range" />
        ) : (
          <div className="table-scroll statement-scroll" role="region" aria-label={info.title} tabIndex={0}>
            <table className="table statement">
              <caption className="sr-only">{data.title}</caption>
              <thead>
                <tr>
                  {data.columns.map((column, index) => {
                    const numeric = data.rows.some((row) => row[index]?.cents !== null && row[index]?.cents !== undefined);
                    return (
                      <th key={column} scope="col" className={numeric ? "align-right" : undefined}>
                        {column}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={cx("statement__row", `statement__row--${data.kinds[rowIndex] ?? "line"}`)}>
                    {row.map((cell, index) =>
                      cell.cents !== null && cell.cents !== undefined ? (
                        <td key={index} className="num">
                          <Money cents={cell.cents} />
                        </td>
                      ) : index === 0 ? (
                        <th key={index} scope="row" className="statement__first">
                          {cell.text}
                        </th>
                      ) : (
                        <td key={index}>{cell.text}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
