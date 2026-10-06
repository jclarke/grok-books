import { useState } from "react";
import { Money } from "../MoneyCell";
import { cx } from "../../lib/cx";
import { formatMoney, formatPct } from "../../lib/format";

export interface DonutSlice {
  key: string;
  label: string;
  cents: number;
  tone: string;
}

function arc(cx: number, cy: number, r: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.sin(start);
  const y0 = cy - r * Math.cos(start);
  const x1 = cx + r * Math.sin(end);
  const y1 = cy - r * Math.cos(end);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Share-of-total ring with a legend; hovering a slice shows its value in the middle. */
export function DonutChart({ slices, label, centerLabel = "Total", size = 168, legend = true }: { slices: DonutSlice[]; label: string; centerLabel?: string; size?: number; legend?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const positive = slices.filter((slice) => slice.cents > 0);
  const total = positive.reduce((acc, slice) => acc + slice.cents, 0);
  const r = size / 2 - 12;
  const c = size / 2;
  let angle = 0;
  const active = positive.find((slice) => slice.key === hover);
  return (
    <div className="donut">
      <div className="donut__ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          <circle className="donut__track" cx={c} cy={c} r={r} fill="none" strokeWidth={18} />
          {total > 0
            ? positive.map((slice) => {
                const sweep = (slice.cents / total) * Math.PI * 2;
                const start = angle;
                const end = angle + sweep - (positive.length > 1 ? 0.025 : 0);
                angle += sweep;
                if (positive.length === 1) {
                  return <circle key={slice.key} className={`donut__slice tone-${slice.tone}`} cx={c} cy={c} r={r} fill="none" strokeWidth={18} />;
                }
                return (
                  <path
                    key={slice.key}
                    className={cx("donut__slice", `tone-${slice.tone}`, hover && hover !== slice.key && "is-dim")}
                    d={arc(c, c, r, start, Math.max(start + 0.01, end))}
                    fill="none"
                    strokeWidth={hover === slice.key ? 22 : 18}
                    onMouseEnter={() => setHover(slice.key)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${slice.label}: ${formatMoney(slice.cents)} (${formatPct((slice.cents / total) * 100)})`}</title>
                  </path>
                );
              })
            : null}
        </svg>
        <div className="donut__center" aria-hidden="true">
          <span className="donut__center-label">{active ? active.label : centerLabel}</span>
          <span className="donut__center-value num">{formatMoney(active ? active.cents : total, { whole: true })}</span>
          {active && total > 0 ? <span className="donut__center-share num">{formatPct((active.cents / total) * 100)}</span> : null}
        </div>
      </div>
      {legend ? (
      <ul className="donut__legend">
        {slices.map((slice) => (
          <li key={slice.key} onMouseEnter={() => setHover(slice.key)} onMouseLeave={() => setHover(null)} className={cx(hover === slice.key && "is-active")}>
            <span className={`legend__swatch legend__swatch--square tone-${slice.tone}`} aria-hidden="true" />
            <span className="donut__legend-label">{slice.label}</span>
            <Money cents={slice.cents} />
            <span className="donut__legend-share num">{total > 0 && slice.cents > 0 ? formatPct((slice.cents / total) * 100) : "—"}</span>
          </li>
        ))}
      </ul>
      ) : null}
    </div>
  );
}
