import type { ReactNode } from "react";
import { useEffect } from "react";
import { useConfig } from "../hooks/useConfig";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  const { product } = useConfig();
  useEffect(() => {
    document.title = `${title} · ${product}`;
  }, [title, product]);
  return (
    <div className="page-header">
      <div className="page-header__text">
        {eyebrow ? <div className="page-header__eyebrow">{eyebrow}</div> : null}
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}
