import { cx } from "../../lib/cx";

export interface LegendItem {
  label: string;
  tone: string;
  shape?: "square" | "line" | "dash";
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={`${item.label}-${item.tone}`}>
          <span className={cx("legend__swatch", `legend__swatch--${item.shape ?? "square"}`, `tone-${item.tone}`)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
