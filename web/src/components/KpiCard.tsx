import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Sparkline } from "./charts/Sparkline";
import { Skeleton } from "./Skeleton";
import { cx } from "../lib/cx";
import { formatMoney, formatPct } from "../lib/format";

export interface KpiCardProps {
  label: string;
  /** Integer cents; use `display` for non-money values. */
  cents?: number;
  display?: string;
  /** Change vs the comparison period, in cents or points. */
  delta?: number | null;
  deltaText?: string;
  pct?: number | null;
  /** True when a rise is bad news (expenses). */
  inverse?: boolean;
  comparisonLabel?: string;
  spark?: number[];
  sparkTone?: "rev" | "exp" | "net";
  footer?: ReactNode;
  loading?: boolean;
  href?: string;
  /** "danger" colors the value as bad news (overdue amounts). */
  tone?: "default" | "danger";
  /** "primary" is the page's headline number; "quiet" de-emphasizes supporting figures. */
  emphasis?: "primary" | "quiet";
}

export function KpiCard({
  label,
  cents,
  display,
  delta,
  deltaText,
  pct,
  inverse,
  comparisonLabel,
  spark,
  sparkTone = "net",
  footer,
  loading,
  tone = "default",
  emphasis,
}: KpiCardProps) {
  if (loading) {
    return (
      <article className="card card--padded kpi" aria-busy="true">
        <Skeleton width="45%" />
        <Skeleton width="70%" height={30} />
        <Skeleton width="55%" />
      </article>
    );
  }
  const direction = delta === null || delta === undefined || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good = direction === "flat" ? null : (direction === "up") !== Boolean(inverse);
  const value = display ?? formatMoney(cents ?? 0);
  return (
    <article className={cx("card card--padded kpi", tone === "danger" && "kpi--danger", emphasis && `kpi--${emphasis}`)}>
      <div className="kpi__top">
        <h3 className="kpi__label">{label}</h3>
        {spark && spark.length > 1 ? <Sparkline values={spark} tone={sparkTone} label={`${label} trend`} /> : null}
      </div>
      <p className={cx("kpi__value", "num", cents !== undefined && cents < 0 && "money--neg")}>{value}</p>
      {delta !== undefined ? (
        <p className="kpi__delta">
          <span className={cx("trend", good === true && "trend--good", good === false && "trend--bad", good === null && "trend--flat")}>
            {direction !== "flat" ? <Icon name={direction === "up" ? "arrowUp" : "arrowDown"} size={13} /> : null}
            <span className="num">{pct !== undefined && pct !== null ? formatPct(Math.abs(pct)) : deltaText ?? (delta === null ? "—" : formatMoney(Math.abs(delta)))}</span>
            <span className="sr-only">{good === true ? " (favorable)" : good === false ? " (unfavorable)" : ""}</span>
          </span>
          {comparisonLabel ? <span className="kpi__compare hide-mobile">{comparisonLabel}</span> : null}
        </p>
      ) : null}
      {footer ? <div className="kpi__footer">{footer}</div> : null}
    </article>
  );
}
