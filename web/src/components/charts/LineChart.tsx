import { useState } from "react";
import { ChartLegend } from "./Legend";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { cx } from "../../lib/cx";
import { formatCompact, formatMoney, formatMonth } from "../../lib/format";

export interface LineSeries {
  label: string;
  tone: string;
  /** Cents per month; null where the series has no value. */
  values: (number | null)[];
  dashed?: boolean;
}

export interface LineChartProps {
  /** YYYY-MM, one per point. */
  months: string[];
  series: LineSeries[];
  label: string;
  height?: number;
}

/** Several lines over the same months (e.g. two payoff scenarios), year ticks on the x axis. */
export function LineChart({ months, series, label, height = 260 }: LineChartProps) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (months.length === 0) return null;
  const pad = { l: 60, r: 14, t: 14, b: 28 };
  const values = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const x = linear([0, Math.max(1, months.length - 1)], [pad.l, width - pad.r]);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const years = Array.from(new Set(months.map((month) => month.slice(0, 4))));
  const yearEvery = Math.max(1, Math.ceil(years.length / (width < 520 ? 4 : 8)));
  const yearTicks = months
    .map((month, index) => ({ month, index }))
    .filter(({ month, index }) => index > 0 && month.endsWith("-01") && (Number(month.slice(0, 4)) - Number(years[0])) % yearEvery === 0);
  const path = (line: LineSeries) => {
    let out = "";
    let pen = false;
    line.values.forEach((value, index) => {
      if (value === null) {
        pen = false;
        return;
      }
      out += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return out;
  };

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = event.clientX - box.left;
    const index = Math.round(((px - pad.l) / Math.max(1, width - pad.l - pad.r)) * (months.length - 1));
    setHover(Math.max(0, Math.min(months.length - 1, index)));
  };

  return (
    <div className="chart" ref={ref}>
      <ChartLegend items={series.map((line) => ({ label: line.label, tone: line.tone, shape: line.dashed ? "dash" : "line" }))} />
      <div className="chart__canvas" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={cx("chart-grid", tick === 0 && "chart-grid--zero")} x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis" x={pad.l - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatCompact(tick)}
              </text>
            </g>
          ))}
          <text className="chart-axis" x={x(0)} y={height - 8} textAnchor="start">
            {formatMonth(months[0])}
          </text>
          {yearTicks.map(({ month, index }) =>
            x(index) - x(0) > 70 ? (
              <g key={month}>
                <line className="chart-grid" x1={x(index)} x2={x(index)} y1={height - pad.b} y2={height - pad.b + 4} />
                <text className="chart-axis" x={x(index)} y={height - 8} textAnchor="middle">
                  {month.slice(0, 4)}
                </text>
              </g>
            ) : null,
          )}
          {series.map((line, index) => (
            <path key={index} className={cx("chart-line", `tone-${line.tone}`, line.dashed && "chart-line--dashed")} d={path(line)} fill="none" />
          ))}
          {hover !== null ? (
            <g>
              <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
              {series.map((line, index) =>
                line.values[hover] !== null && line.values[hover] !== undefined ? (
                  <circle key={index} className={`chart-dot tone-${line.tone}`} cx={x(hover)} cy={y(line.values[hover] as number)} r={4.5} />
                ) : null,
              )}
            </g>
          ) : null}
          <rect className="chart-hit" x={pad.l} y={pad.t} width={Math.max(1, width - pad.l - pad.r)} height={height - pad.t - pad.b} onMouseMove={onMove} onMouseEnter={onMove} />
        </svg>
        {hover !== null ? (
          <ChartTooltip x={x(hover)} y={pad.t} width={width}>
            <p className="chart-tooltip__title">{formatMonth(months[hover])}</p>
            {series.map((line, index) => (
              <TooltipRow key={index} tone={line.tone} label={line.label} value={formatMoney(line.values[hover] ?? null, { whole: true })} />
            ))}
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
