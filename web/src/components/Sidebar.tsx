import { Link, useLocation } from "react-router-dom";
import { CountBadge } from "./Badge";
import { Icon } from "./Icon";
import { Wordmark } from "./Logo";
import { ModeToggle } from "./ModeToggle";
import { useConfig } from "../hooks/useConfig";
import { withGlobal } from "../hooks/useGlobalFilters";
import { useMode } from "../hooks/useMode";
import { cx } from "../lib/cx";
import { isActive, navFor } from "../lib/nav";

export function Sidebar({
  reviewCount,
  onNavigate,
  company,
  onSignOut,
  signingOut,
}: {
  reviewCount: number;
  onNavigate?: () => void;
  company: string;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  const location = useLocation();
  const { mode } = useMode();
  const { product, features } = useConfig();
  const NAV = navFor(mode, features);
  const home = mode === "personal" ? "/personal" : "/";
  return (
    <nav className="sidebar" aria-label="Main">
      <Link to={withGlobal(home, location.search)} className="sidebar__brand" onClick={onNavigate} aria-label={`${product}, dashboard`}>
        <Wordmark />
      </Link>
      <p className="sidebar__company">{mode === "personal" ? "Personal finances" : company}</p>
      <div className="sidebar__mode">
        <ModeToggle compact />
      </div>
      <ul className="sidebar__list">
        {NAV.map((item, index) => {
          const active = isActive(item, location.pathname);
          const heading = item.section && item.section !== NAV[index - 1]?.section ? item.section : null;
          return (
            <li key={item.to}>
              {heading ? <p className="sidebar__section" id={`nav-section-${heading.toLowerCase()}`}>{heading}</p> : null}
              <Link
                to={withGlobal(item.to, location.search)}
                className={cx("sidebar__link", active && "is-active")}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon name={item.icon} size={18} />
                <span className="sidebar__label">{item.label}</span>
                {item.badge === "review" ? <CountBadge count={reviewCount} label="transactions need review" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="sidebar__foot">
        <span className="sidebar__dot" aria-hidden="true" />
        {onSignOut ? (
          <>
            <span className="sidebar__status">Signed in</span>
            <button type="button" className="sidebar__signout" onClick={onSignOut} disabled={signingOut}>
              Sign out
            </button>
          </>
        ) : (
          <span>Local only · 127.0.0.1</span>
        )}
      </div>
    </nav>
  );
}
