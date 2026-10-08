import { useState } from "react";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { cx } from "../../lib/cx";
import { formatCompact, formatDate, formatMoney, formatMonth } from "../../lib/format";

export interface AreaPoint {
  date: string;
  value: number;
}

export interface AreaChartProps {
  points: AreaPoint[];
  label: string;
  tone?: string;
  threshold?: { value: number; label: string; tone: string };
  height?: number;
  valueLabel?: string;
  markers?: { date: string; label: string }[];
  /** "month" labels points by month (for month-end series). */
  axis?: "day" | "month";
  /** One point called out with a ring and a label (the forecast's low point). */
  highlight?: { date: string; label: string };
}

/** Balance over time as a filled line, with an optional horizontal threshold (the reserve). */
export function AreaChart({ points, label, tone = "net", threshold, height = 240, valueLabel = "Balance", markers = [], axis = "day", highlight }: AreaChartProps) {
  const axisLabel = (date: string) => (axis === "month" ? formatMonth(date.slice(0, 7)) : formatDate(date, { year: false }));
  const titleLabel = (date: string) => (axis === "month" ? formatMonth(date.slice(0, 7)) : formatDate(date));
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;
  const pad = { l: 60, r: 14, t: 14, b: 28 };
  const values = points.map((p) => p.value).concat(threshold ? [threshold.value] : []);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values), 4);
  const x = linear([0, Math.max(1, points.length - 1)], [pad.l, width - pad.r]);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const base = y(Math.max(lo, Math.min(0, hi)));
  const area = `${line} L${x(points.length - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;
  const labelEvery = Math.max(1, Math.ceil(points.length / (width < 520 ? 4 : 7)));
  const markerIndex = new Map(points.map((p, i) => [p.date, i]));
  const active = hover !== null ? points[hover] : null;

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = event.clientX - box.left;
    const index = Math.round(((px - pad.l) / Math.max(1, width - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, index)));
  };

  return (
    <div className="chart" ref={ref}>
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
          <path className={`chart-area tone-${tone}`} d={area} />
          <path className={`chart-line tone-${tone}`} d={line} fill="none" />
          {threshold ? (
            <g>
              <line className={`chart-threshold tone-${threshold.tone}`} x1={pad.l} x2={width - pad.r} y1={y(threshold.value)} y2={y(threshold.value)} />
              <text className={`chart-threshold-label tone-${threshold.tone}`} x={width - pad.r} y={y(threshold.value) - 6} textAnchor="end">
                {threshold.label}
              </text>
            </g>
          ) : null}
          {markers.map((marker) => {
            const index = markerIndex.get(marker.date);
            if (index === undefined) return null;
            return <circle key={`${marker.date}-${marker.label}`} className={`chart-marker tone-${tone}`} cx={x(index)} cy={y(points[index].value)} r={2.5} />;
          })}
          {highlight && markerIndex.has(highlight.date) ? (() => {
            const index = markerIndex.get(highlight.date) as number;
            const hx = x(index);
            const hy = y(points[index].value);
            const anchor = index > points.length * 0.7 ? "end" : index < points.length * 0.3 ? "start" : "middle";
            return (
              <g className="chart-highlight">
                <circle className={`chart-highlight__ring tone-${tone}`} cx={hx} cy={hy} r={6} />
                <text className="chart-highlight__label" x={hx} y={hy > pad.t + 24 ? hy - 12 : hy + 20} textAnchor={anchor}>
                  {highlight.label}
                </text>
              </g>
            );
          })() : null}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={p.date} className="chart-axis" x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
                {axisLabel(p.date)}
              </text>
            ) : null,
          )}
          {active && hover !== null ? (
            <g>
              <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
              <circle className={`chart-dot tone-${tone}`} cx={x(hover)} cy={y(active.value)} r={4.5} />
            </g>
          ) : null}
          <rect className="chart-hit" x={pad.l} y={pad.t} width={Math.max(1, width - pad.l - pad.r)} height={height - pad.t - pad.b} onMouseMove={onMove} onMouseEnter={onMove} />
        </svg>
        {active && hover !== null ? (
          <ChartTooltip x={x(hover)} y={pad.t} width={width}>
            <p className="chart-tooltip__title">{titleLabel(active.date)}</p>
            <TooltipRow tone={tone} label={valueLabel} value={formatMoney(active.value)} />
            {threshold ? <TooltipRow tone={threshold.tone} label={threshold.label} value={formatMoney(threshold.value)} /> : null}
            {markers
              .filter((marker) => marker.date === active.date)
              .slice(0, 4)
              .map((marker) => (
                <p key={marker.label} className="chart-tooltip__note">
                  {marker.label}
                </p>
              ))}
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
