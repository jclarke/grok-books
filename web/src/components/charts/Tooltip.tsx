import type { ReactNode } from "react";

/** Floating chart tooltip, positioned in the chart container's pixel space. */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width * 0.62;
  return (
    <div className="chart-tooltip" role="status" style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(4, y) }}>
      {children}
    </div>
  );
}

export function TooltipRow({ tone, label, value }: { tone: string; label: string; value: ReactNode }) {
  return (
    <div className="chart-tooltip__row">
      <span className={`legend__swatch legend__swatch--square tone-${tone}`} aria-hidden="true" />
      <span className="chart-tooltip__label">{label}</span>
      <span className="chart-tooltip__value num">{value}</span>
    </div>
  );
}
