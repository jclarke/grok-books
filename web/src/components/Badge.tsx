import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { tagLabel, tagTone, type Tone } from "../lib/labels";

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}

export function Badge({ tone = "neutral", children, dot, className, title }: BadgeProps) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)} title={title}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Business tag as a colored pill, in the tone its business is configured with. */
export function TagBadge({ tag }: { tag: string }) {
  return (
    <Badge tone={tagTone(tag)} dot>
      {tagLabel(tag)}
    </Badge>
  );
}

export function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span className={cx("count-badge", count === 0 && "count-badge--zero")} aria-label={`${count} ${label}`}>
      {count > 999 ? "999+" : count}
    </span>
  );
}
