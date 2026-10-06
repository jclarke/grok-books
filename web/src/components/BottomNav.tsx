import { Link, useLocation } from "react-router-dom";
import { CountBadge } from "./Badge";
import { Icon } from "./Icon";
import { useConfig } from "../hooks/useConfig";
import { withGlobal } from "../hooks/useGlobalFilters";
import { useMode } from "../hooks/useMode";
import { cx } from "../lib/cx";
import { isActive, navFor } from "../lib/nav";

/** Phone navigation: four primary destinations plus "More" (opens the full menu). */
export function BottomNav({ reviewCount, onMore, moreOpen }: { reviewCount: number; onMore: () => void; moreOpen: boolean }) {
  const location = useLocation();
  const { mode } = useMode();
  const { features } = useConfig();
  const primary = navFor(mode, features).filter((item) => item.primary);
  const onPrimary = primary.some((item) => isActive(item, location.pathname));
  return (
    <nav className="bottom-nav" aria-label="Main (compact)">
      {primary.map((item) => {
        const active = isActive(item, location.pathname);
        return (
          <Link key={item.to} to={withGlobal(item.to, location.search)} className={cx("bottom-nav__item", active && "is-active")} aria-current={active ? "page" : undefined}>
            <span className="bottom-nav__icon">
              <Icon name={item.icon} size={20} />
              {item.badge === "review" && reviewCount > 0 ? <CountBadge count={reviewCount} label="need review" /> : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className={cx("bottom-nav__item", (moreOpen || !onPrimary) && "is-active")} onClick={onMore} aria-expanded={moreOpen}>
        <span className="bottom-nav__icon">
          <Icon name="menu" size={20} />
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}
