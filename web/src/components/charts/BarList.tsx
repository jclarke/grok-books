import type { ReactNode } from "react";
import { Money } from "../MoneyCell";
import { cx } from "../../lib/cx";
import { formatPct } from "../../lib/format";

export interface BarListItem {
  key: string;
  label: string;
  cents: number;
  tone?: string;
  meta?: ReactNode;
  href?: string;
}

/** Ranked horizontal bars with labels and values (expense breakdown, vendors, cash). */
export function BarList({ items, total, tone = "cat-1", onSelect, showShare, label }: { items: BarListItem[]; total?: number; tone?: string; onSelect?: (item: BarListItem) => void; showShare?: boolean; label: string }) {
  const peak = Math.max(1, ...items.map((item) => Math.abs(item.cents)));
  const sum = total ?? items.reduce((acc, item) => acc + Math.max(0, item.cents), 0);
  return (
    <ul className="barlist" aria-label={label}>
      {items.map((item) => {
        const pct = (Math.abs(item.cents) / peak) * 100;
        const content = (
          <>
            <span className="barlist__label">
              <span className="barlist__name" title={item.label}>
                {item.label}
              </span>
              {item.meta ? <span className="barlist__meta">{item.meta}</span> : null}
            </span>
            <span className="barlist__track" aria-hidden="true">
              <span className={cx("barlist__bar", `tone-${item.tone ?? tone}`, item.cents < 0 && "is-negative")} style={{ width: `${Math.max(1.5, pct)}%` }} />
            </span>
            <span className="barlist__value">
              <Money cents={item.cents} />
              {showShare && sum > 0 ? <span className="barlist__share num">{formatPct((Math.max(0, item.cents) / sum) * 100)}</span> : null}
            </span>
          </>
        );
        return (
          <li key={item.key} className={cx("barlist__item", onSelect && "is-clickable")}>
            {onSelect ? (
              <button type="button" className="barlist__button" onClick={() => onSelect(item)}>
                {content}
              </button>
            ) : (
              <div className="barlist__button">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
