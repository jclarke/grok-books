import { useState } from "react";
import { ChartLegend } from "./Legend";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { cx } from "../../lib/cx";
import { formatCompact, formatMoney, formatMonth } from "../../lib/format";

export interface StackedSeries {
  label: string;
  tone: string;
}

export interface StackedPoint {
  /** YYYY-MM */
  key: string;
  label: string;
  /** One value per series; positives stack up from zero, negatives stack down. */
  values: number[];
  line?: number;
}

export interface StackedBarChartProps {
  points: StackedPoint[];
  series: StackedSeries[];
  /** A line on the same axis (the net change), when given. */
  lineLabel?: string;
  lineTone?: string;
  label: string;
  height?: number;
  /** "money" values are cents; "number" values are counts. */
  format?: "money" | "number";
}

/** Stacked bars per month, gains above zero and losses below, with an optional net line on the same axis. */
export function StackedBarChart({ points, series, lineLabel, lineTone = "net", label, height = 280, format = "money" }: StackedBarChartProps) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const show = (value: number) => (format === "money" ? formatMoney(value) : value.toLocaleString("en-US"));
  const axis = (value: number) => (format === "money" ? formatCompact(value) : value.toLocaleString("en-US"));
  const hasLine = lineLabel !== undefined && points.some((point) => point.line !== undefined);
  const pad = { l: 56, r: 12, t: 12, b: 30 };
  const up = points.map((point) => point.values.reduce((acc, value) => acc + Math.max(0, value), 0));
  const down = points.map((point) => point.values.reduce((acc, value) => acc + Math.min(0, value), 0));
  const lines = hasLine ? points.map((point) => point.line ?? 0) : [];
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...down, ...lines), Math.max(0, ...up, ...lines), 4);
  const plotW = Math.max(10, width - pad.l - pad.r);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const group = plotW / Math.max(1, points.length);
  const barW = Math.max(6, Math.min(34, group * 0.56));
  const cx0 = (index: number) => pad.l + group * index + group / 2;
  const step = Math.max(width < 480 ? Math.ceil(points.length / 6) : 1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 44))));
  const linePath = hasLine ? points.map((point, index) => `${index === 0 ? "M" : "L"}${cx0(index).toFixed(1)},${y(point.line ?? 0).toFixed(1)}`).join(" ") : "";
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <ChartLegend items={[...series.map((item) => ({ label: item.label, tone: item.tone })), ...(hasLine ? [{ label: lineLabel as string, tone: lineTone, shape: "line" as const }] : [])]} />
      <div className="chart__canvas" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={cx("chart-grid", tick === 0 && "chart-grid--zero")} x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis" x={pad.l - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {axis(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) => {
            const center = cx0(index);
            let above = 0;
            let below = 0;
            return (
              <g key={point.key}>
                {hover === index ? <rect className="chart-hoverband" x={center - group / 2} y={pad.t} width={group} height={height - pad.t - pad.b} /> : null}
                {point.values.map((value, seriesIndex) => {
                  if (!value) return null;
                  const from = value > 0 ? above : below;
                  const to = from + value;
                  if (value > 0) above = to;
                  else below = to;
                  const top = Math.min(y(from), y(to));
                  const h = Math.max(1, Math.abs(y(to) - y(from)));
                  return <rect key={seriesIndex} className={`chart-bar chart-bar--stacked tone-${series[seriesIndex].tone}`} x={center - barW / 2} y={top} width={barW} height={h} rx={2} />;
                })}
                {index % step === 0 ? (
                  <text className="chart-axis" x={center} y={height - 10} textAnchor="middle">
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {hasLine ? (
            <>
              <path className={`chart-line tone-${lineTone}`} d={linePath} fill="none" />
              {points.map((point, index) => (
                <circle key={point.key} className={`chart-dot tone-${lineTone}`} cx={cx0(index)} cy={y(point.line ?? 0)} r={hover === index ? 4.5 : 3} />
              ))}
            </>
          ) : null}
          {points.map((point, index) => (
            <rect
              key={`hit-${point.key}`}
              className="chart-hit"
              x={cx0(index) - group / 2}
              y={pad.t}
              width={group}
              height={height - pad.t - pad.b}
              onMouseEnter={() => setHover(index)}
              onMouseMove={() => setHover(index)}
            />
          ))}
        </svg>
        {active && hover !== null ? (
          <ChartTooltip x={cx0(hover)} y={pad.t} width={width}>
            <p className="chart-tooltip__title">{formatMonth(active.key)}</p>
            {series.map((item, index) => (
              <TooltipRow key={item.label} tone={item.tone} label={item.label} value={show(active.values[index] ?? 0)} />
            ))}
            {hasLine ? <TooltipRow tone={lineTone} label={lineLabel as string} value={show(active.line ?? 0)} /> : null}
          </ChartTooltip>
        ) : null}
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {series.map((item) => (
                <th key={item.label} scope="col">{item.label}</th>
              ))}
              {hasLine ? <th scope="col">{lineLabel}</th> : null}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{formatMonth(point.key)}</th>
                {series.map((item, index) => (
                  <td key={item.label}>{show(point.values[index] ?? 0)}</td>
                ))}
                {hasLine ? <td>{show(point.line ?? 0)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
