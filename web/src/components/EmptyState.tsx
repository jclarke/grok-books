import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { cx } from "../lib/cx";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  tone?: "neutral" | "success" | "error";
}

export function EmptyState({ icon = "inbox", title, children, action, compact, tone = "neutral" }: EmptyStateProps) {
  return (
    <div className={cx("empty", compact && "empty--compact", `empty--${tone}`)} role={tone === "error" ? "alert" : undefined}>
      <span className="empty__icon">
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <p className="empty__title">{title}</p>
      {children ? <div className="empty__body">{children}</div> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <EmptyState
      icon="alert"
      tone="error"
      compact={compact}
      title="Couldn't load this"
      action={
        onRetry ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
            Try again
          </button>
        ) : null
      }
    >
      {message}
    </EmptyState>
  );
}
