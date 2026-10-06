import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div";
  padded?: boolean;
}

export function Card({ as: Tag = "section", padded = true, className, children, ...rest }: CardProps) {
  return (
    <Tag className={cx("card", padded && "card--padded", className)} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
}

export function CardHeader({ title, subtitle, actions, id }: CardHeaderProps) {
  return (
    <header className="card__header">
      <div className="card__titles">
        <h2 className="card__title" id={id}>
          {title}
        </h2>
        {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </header>
  );
}
