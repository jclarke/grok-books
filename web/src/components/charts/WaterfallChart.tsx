import { useState } from "react";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { linear, niceTicks } from "./scale";
import { useMeasure } from "./useMeasure";
import { cx } from "../../lib/cx";
import { formatCompact, formatMoney } from "../../lib/format";

export interface WaterfallStep {
  key: string;
  label: string;
  /** Cents: the level for a total, the change (signed) for a step. */
  cents: number;
  kind: "total" | "step";
  /** Extra tooltip line, e.g. "3 customers". */
  note?: string;
}

/** A bridge: opening level, signed steps floating from the running total, closing level. */
export function WaterfallChart({ steps, label, height = 260 }: { steps: WaterfallStep[]; label: string; height?: number }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 12, t: 22, b: 30 };
  let running = 0;
  const bars = steps.map((step) => {
    if (step.kind === "total") {
      running = step.cents;
      return { ...step, from: 0, to: step.cents };
    }
    const from = running;
    running += step.cents;
    return { ...step, from, to: running };
  });
  const values = bars.flatMap((bar) => [bar.from, bar.to]);
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const plotW = Math.max(10, width - pad.l - pad.r);
  const y = linear([lo, hi], [height - pad.b, pad.t]);
  const group = plotW / Math.max(1, bars.length);
  const barW = Math.max(10, Math.min(56, group * 0.6));
  const cx0 = (index: number) => pad.l + group * index + group / 2;
  const tone = (bar: (typeof bars)[number]) => (bar.kind === "total" ? "net" : bar.cents >= 0 ? "rev" : "exp");
  const active = hover !== null ? bars[hover] : null;

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
          {bars.map((bar, index) => {
            const center = cx0(index);
            const top = Math.min(y(bar.from), y(bar.to));
            const h = Math.max(1.5, Math.abs(y(bar.to) - y(bar.from)));
            const next = bars[index + 1];
            return (
              <g key={bar.key}>
                {hover === index ? <rect className="chart-hoverband" x={center - group / 2} y={pad.t} width={group} height={height - pad.t - pad.b} /> : null}
                <rect className={`chart-bar tone-${tone(bar)}`} x={center - barW / 2} y={top} width={barW} height={h} rx={2.5} />
                {next ? <line className="waterfall-link" x1={center + barW / 2} x2={cx0(index + 1) - barW / 2} y1={y(bar.to)} y2={y(bar.to)} /> : null}
                <text className="chart-axis waterfall-value" x={center} y={top - 6} textAnchor="middle">
                  {bar.kind === "step" && bar.cents > 0 ? "+" : ""}
                  {formatCompact(bar.cents)}
                </text>
                <text className="chart-axis" x={center} y={height - 10} textAnchor="middle">
                  {bar.label}
                </text>
              </g>
            );
          })}
          {bars.map((bar, index) => (
            <rect
              key={`hit-${bar.key}`}
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
            <p className="chart-tooltip__title">{active.label}</p>
            <TooltipRow tone={tone(active)} label={active.kind === "total" ? "MRR" : "Change"} value={formatMoney(active.cents)} />
            {active.note ? <p className="chart-tooltip__note">{active.note}</p> : null}
          </ChartTooltip>
        ) : null}
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key}>
                <th scope="row">{bar.label}</th>
                <td>{formatMoney(bar.cents)}</td>
                <td>{bar.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
