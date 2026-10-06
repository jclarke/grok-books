import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePnl } from "../api/queries";
import type { PnlRow } from "../api/types";
import { Card } from "../components/Card";
import { DrilldownDrawer, type Drill } from "../components/DrilldownDrawer";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { ExportButtons } from "../components/ExportButtons";
import { Icon } from "../components/Icon";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SkeletonTable } from "../components/Skeleton";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { useSessionData } from "../hooks/useSession";
import { useUrlState } from "../hooks/useUrlState";
import { cx } from "../lib/cx";
import { formatPct, formatRange } from "../lib/format";
import { businessLabel } from "../lib/labels";

function sectionFor(row: PnlRow, index: number, rows: PnlRow[], opex: string[], cogs: string[]): string | null {
  if (index === 0) return "Income";
  if (cogs.includes(row.label) && !cogs.includes(rows[index - 1]?.label ?? "")) return "Cost of revenue";
  if (opex.includes(row.label) && !opex.includes(rows[index - 1]?.label ?? "")) return "Operating expenses";
  if (row.label === "Total Operating Expenses" && !opex.includes(rows[index - 1]?.label ?? "")) return "Operating expenses";
  if (row.label.startsWith("Owner Draws")) return "Below the line";
  if (row.kind === "memo") return "Memo";
  return null;
}

/** For % change, a rise in a cost line is unfavorable. */
function isCostLine(label: string, opex: string[], cogs: string[]): boolean {
  return cogs.includes(label) || label === "Total Operating Expenses" || opex.includes(label) || label.startsWith("Owner Draws");
}

export default function PnlPage() {
  const session = useSessionData();
  const filters = useGlobalFilters();
  const location = useLocation();
  const url = useUrlState();
  const by = url.get("by", "month") === "year" ? "year" : "month";
  const compare = url.get("compare", "1") !== "0";
  const [drill, setDrill] = useState<Drill | null>(null);
  const query = usePnl({ start: filters.start, end: filters.end, business: filters.business, by, compare: compare ? "1" : "0" });
  const data = query.data;
  const opex = session.category_groups.opex;
  const cogs = session.category_groups.cogs ?? [];

  return (
    <div className="page page--report">
      <PageHeader
        eyebrow={<Link to={withGlobal("/reports", location.search)} className="link-quiet"><Icon name="chevronLeft" size={14} /> Reports</Link>}
        title="Profit & Loss"
        subtitle={<>{formatRange(filters.start, filters.end)} · {businessLabel(filters.business)}{data && compare ? <span className="muted"> · prior period {formatRange(data.prior_start, data.prior_end)}</span> : null}</>}
        actions={<ExportButtons base="/export/pnl" params={{ year: filters.start.slice(0, 4), by, business: filters.business, start: filters.start, end: filters.end }} />}
      />
      <div className="toolbar no-print">
        <SegmentedControl
          label="Columns"
          value={by}
          onChange={(value) => url.patch({ by: value === "month" ? "" : value })}
          options={[
            { value: "month", label: "By month" },
            { value: "year", label: "Total only" },
          ]}
        />
        <label className="check">
          <input type="checkbox" checked={compare} onChange={(event) => url.patch({ compare: event.target.checked ? "" : "0" })} /> Compare to prior period
        </label>
        <span className="muted small toolbar__hint">
          <Icon name="info" size={14} /> Click any figure to see the transactions behind it.
        </span>
      </div>
      <Card padded={false} className="statement-card">
        <div className="print-only print-title">
          <h1>{data?.title}</h1>
          <p>Generated {data?.generated}</p>
        </div>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !data ? (
          <SkeletonTable rows={14} cols={5} />
        ) : data.rows.every((row) => row.values.every((v) => v === 0)) ? (
          <EmptyState icon="reports" title="No activity in this range" />
        ) : (
          <div className="table-scroll statement-scroll" role="region" aria-label="Profit and loss statement" tabIndex={0}>
            <table className="table statement statement--pnl">
              <caption className="sr-only">{data.title}</caption>
              <thead>
                <tr>
                  <th scope="col" className="statement__label-col">Line</th>
                  {data.columns.map((column) => (
                    <th scope="col" key={column} className={cx("align-right", column === "Total" && "statement__total-col")}>{column === "Total" ? "Total" : column}</th>
                  ))}
                  {compare ? (
                    <>
                      <th scope="col" className="align-right">Prior</th>
                      <th scope="col" className="align-right">Change</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => {
                  const section = sectionFor(row, index, data.rows, opex, cogs);
                  const colSpan = data.columns.length + 1 + (compare ? 2 : 0);
                  const cost = isCostLine(row.label, opex, cogs);
                  const good = row.pct === null || row.pct === 0 ? null : (row.pct > 0) !== cost;
                  return [
                    section ? (
                      <tr key={`s-${index}`} className="statement__section">
                        <th scope="rowgroup" colSpan={colSpan}>{section}</th>
                      </tr>
                    ) : null,
                    <tr key={row.label} className={cx("statement__row", `statement__row--${row.kind}`)}>
                      <th scope="row" className="statement__label-col">
                        <button type="button" className="drill-link" onClick={() => setDrill({ label: row.label, month: null })}>
                          {row.label}
                        </button>
                      </th>
                      {row.values.map((value, col) => {
                        const key = data.column_keys[col];
                        const month = key && key !== "Total" ? key : null;
                        return (
                          <td key={col} className={cx("num", key === "Total" && "statement__total-col")}>
                            <button type="button" className="drill-link drill-link--num" onClick={() => setDrill({ label: row.label, month })} aria-label={`${row.label}, ${data.columns[col]}: show transactions`}>
                              <Money cents={value} />
                            </button>
                          </td>
                        );
                      })}
                      {compare ? (
                        <>
                          <td className="num muted"><Money cents={row.prior} /></td>
                          <td className={cx("num", good === true && "trend--good", good === false && "trend--bad")}>{formatPct(row.pct, { signed: true })}</td>
                        </>
                      ) : null}
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data ? (
        <p className="muted small statement-note">
          Owner draws sit below the line: they are money taken out, not an expense, and do not reduce net income. Transfers between accounts are excluded and listed as a memo ({data.transfer_count} rows).
        </p>
      ) : null}
      <DrilldownDrawer drill={drill} start={filters.start} end={filters.end} business={filters.business} categories={session.categories} onClose={() => setDrill(null)} />
    </div>
  );
}
