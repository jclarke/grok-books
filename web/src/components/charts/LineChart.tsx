import { useState } from "react";
import { ChartLegend } from "./Legend";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { cx } from "../../lib/cx";
import { formatCompact, formatMoney, formatMonth, formatPct } from "../../lib/format";

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
  /** "money" (cents, the default) or "pct" (12.5 = 12.5%). */
  format?: "money" | "pct";
}

/** Several lines over the same months (e.g. two payoff scenarios), year ticks on the x axis. */
export function LineChart({ months, series, label, height = 260, format = "money" }: LineChartProps) {
  const axisText = (value: number) => (format === "pct" ? `${Number(value.toFixed(1))}%` : formatCompact(value));
  const valueText = (value: number | null) => (format === "pct" ? formatPct(value) : formatMoney(value, { whole: true }));
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (months.length === 0) return null;
  const pad = { l: 60, r: 14, t: 14, b: 28 };
  const values = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  // Percent ticks: work in hundredths so niceTicks' integer rounding keeps fractional steps (0.5%).
  const unit = format === "pct" ? 100 : 1;
  const scaled = niceTicks(Math.min(0, ...values) * unit, Math.max(0, ...values) * unit, 4);
  const ticks = scaled.ticks.map((tick) => tick / unit);
  const lo = scaled.lo / unit;
  const hi = scaled.hi / unit;
  const x = linear([0, Math.max(1, months.length - 1)], [pad.l, width - pad.r]);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const years = Array.from(new Set(months.map((month) => month.slice(0, 4))));
  const yearEvery = Math.max(1, Math.ceil(years.length / (width < 520 ? 4 : 8)));
  // Up to two years of months: a tick per month (thinned to fit); longer spans: one per year.
  const short = months.length <= 24;
  const monthEvery = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor((width - pad.l - pad.r) / 48))));
  const yearTicks = months
    .map((month, index) => ({ month, index }))
    .filter(({ month, index }) =>
      short ? index > 0 && index % monthEvery === 0 : index > 0 && month.endsWith("-01") && (Number(month.slice(0, 4)) - Number(years[0])) % yearEvery === 0,
    );
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
                {axisText(tick)}
              </text>
            </g>
          ))}
          <text className="chart-axis" x={x(0)} y={height - 8} textAnchor="start">
            {formatMonth(months[0])}
          </text>
          {yearTicks.map(({ month, index }) =>
            x(index) - x(0) > (short ? 44 : 70) ? (
              <g key={month}>
                <line className="chart-grid" x1={x(index)} x2={x(index)} y1={height - pad.b} y2={height - pad.b + 4} />
                <text className="chart-axis" x={x(index)} y={height - 8} textAnchor="middle">
                  {short ? formatMonth(month, { short: !month.endsWith("-01") }) : month.slice(0, 4)}
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
              <TooltipRow key={index} tone={line.tone} label={line.label} value={valueText(line.values[hover] ?? null)} />
            ))}
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
