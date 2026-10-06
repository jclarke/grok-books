import { useState } from "react";
import { ChartLegend } from "./Legend";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { formatCompact, formatMoney, formatMonth } from "../../lib/format";
import { cx } from "../../lib/cx";

export interface ComboPoint {
  key: string;
  label: string;
  bars: number[];
  line: number;
}

export interface ComboChartProps {
  points: ComboPoint[];
  barLabels: [string, string];
  barTones: [string, string];
  lineLabel: string;
  lineTone: string;
  height?: number;
  label: string;
  highlightKeys?: string[];
  onSelect?: (key: string) => void;
}

/** Grouped bars per period with a line on top (revenue vs expenses vs net income). */
export function ComboChart({ points, barLabels, barTones, lineLabel, lineTone, height = 280, label, highlightKeys, onSelect }: ComboChartProps) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 12, t: 12, b: 30 };
  const values = points.flatMap((point) => [...point.bars, point.line]);
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const plotW = Math.max(10, width - pad.l - pad.r);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const group = plotW / Math.max(1, points.length);
  const barW = Math.max(4, Math.min(22, group * 0.26));
  const cx0 = (index: number) => pad.l + group * index + group / 2;
  const zero = y(0);
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${cx0(index).toFixed(1)},${y(point.line).toFixed(1)}`).join(" ");
  // Thin the axis labels so long ranges (years of months) stay legible.
  const step = Math.max(width < 480 ? Math.ceil(points.length / 6) : 1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 44))));
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <ChartLegend
        items={[
          { label: barLabels[0], tone: barTones[0] },
          { label: barLabels[1], tone: barTones[1] },
          { label: lineLabel, tone: lineTone, shape: "line" },
        ]}
      />
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
          {points.map((point, index) => {
            const center = cx0(index);
            const dim = highlightKeys && highlightKeys.length > 0 && !highlightKeys.includes(point.key);
            return (
              <g key={point.key} className={cx(dim && "is-dim")}>
                {hover === index ? <rect className="chart-hoverband" x={center - group / 2} y={pad.t} width={group} height={height - pad.t - pad.b} /> : null}
                {point.bars.map((value, barIndex) => {
                  const top = Math.min(y(value), zero);
                  const h = Math.max(1, Math.abs(y(value) - zero));
                  const x = center + (barIndex === 0 ? -barW - 1.5 : 1.5);
                  return <rect key={barIndex} className={`chart-bar tone-${barTones[barIndex]}`} x={x} y={top} width={barW} height={h} rx={2.5} />;
                })}
                {index % step === 0 ? (
                  <text className="chart-axis" x={center} y={height - 10} textAnchor="middle">
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <path className={`chart-line tone-${lineTone}`} d={linePath} fill="none" />
          {points.map((point, index) => (
            <circle key={point.key} className={`chart-dot tone-${lineTone}`} cx={cx0(index)} cy={y(point.line)} r={hover === index ? 4.5 : 3} />
          ))}
          {points.map((point, index) => (
            <rect
              key={`hit-${point.key}`}
              className={cx("chart-hit", onSelect && "is-clickable")}
              x={cx0(index) - group / 2}
              y={pad.t}
              width={group}
              height={height - pad.t - pad.b}
              onMouseEnter={() => setHover(index)}
              onMouseMove={() => setHover(index)}
              onClick={() => onSelect?.(point.key)}
            >
              <title>{`${formatMonth(point.key)}: ${barLabels[0]} ${formatMoney(point.bars[0])}, ${barLabels[1]} ${formatMoney(point.bars[1])}, ${lineLabel} ${formatMoney(point.line)}`}</title>
            </rect>
          ))}
        </svg>
        {active && hover !== null ? (
          <ChartTooltip x={cx0(hover)} y={pad.t} width={width}>
            <p className="chart-tooltip__title">{formatMonth(active.key)}</p>
            <TooltipRow tone={barTones[0]} label={barLabels[0]} value={formatMoney(active.bars[0])} />
            <TooltipRow tone={barTones[1]} label={barLabels[1]} value={formatMoney(active.bars[1])} />
            <TooltipRow tone={lineTone} label={lineLabel} value={formatMoney(active.line)} />
          </ChartTooltip>
        ) : null}
      </div>
      <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{barLabels[0]}</th>
            <th scope="col">{barLabels[1]}</th>
            <th scope="col">{lineLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{formatMonth(point.key)}</th>
              <td>{formatMoney(point.bars[0])}</td>
              <td>{formatMoney(point.bars[1])}</td>
              <td>{formatMoney(point.line)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
