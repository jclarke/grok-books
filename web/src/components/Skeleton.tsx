import { cx } from "../lib/cx";

export function Skeleton({ width, height = 14, className, round }: { width?: number | string; height?: number | string; className?: string; round?: boolean }) {
  return <span className={cx("skeleton", round && "skeleton--round", className)} style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-table__row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} width={c === 1 ? "40%" : "70%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div className="card card--padded skeleton-card" role="status" aria-label="Loading">
      <Skeleton width="40%" />
      <Skeleton width="100%" height={height} />
    </div>
  );
}
