import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { Session } from "../api/types";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { Button, IconButton } from "./Button";
import { DateRangePicker } from "./DateRangePicker";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";
import { ModeToggle } from "./ModeToggle";
import { defaultKindFor, useGlobalFilters } from "../hooks/useGlobalFilters";
import { useMode } from "../hooks/useMode";
import { useTheme } from "../hooks/useTheme";
import { presets } from "../lib/dates";

export function Topbar({
  session,
  onOpenPalette,
  onOpenMenu,
  onSignOut,
  signingOut,
}: {
  session: Session;
  onOpenPalette: () => void;
  onOpenMenu: () => void;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  const filters = useGlobalFilters();
  const theme = useTheme();
  const location = useLocation();
  const { mode } = useMode();
  const personal = mode === "personal";
  const list = useMemo(() => presets(session.today, session.latest_month, session.months[0] ?? session.latest_month), [session]);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const defaultLabel = defaultKindFor(location.pathname) === "month" ? "current month" : "year to date";
  return (
    <header className={personal ? "topbar topbar--personal" : "topbar"}>
      <IconButton icon="menu" label="Open menu" className="topbar__menu" onClick={onOpenMenu} />
      <span className="topbar__logo" aria-hidden="true">
        <LogoMark size={26} />
      </span>
      <ModeToggle />
      <button
        type="button"
        className="search-trigger"
        onClick={onOpenPalette}
        aria-label={personal ? "Search personal transactions, merchants, and accounts" : "Search transactions, vendors, and accounts"}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon name="search" size={16} />
        <span className="search-trigger__text">{personal ? "Search personal transactions, merchants…" : "Search transactions, vendors, accounts…"}</span>
        <kbd className="search-trigger__kbd">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="topbar__filters">
        {personal ? null : <BusinessSwitcher value={filters.business} onChange={filters.setBusiness} />}
        <DateRangePicker
          value={{ start: filters.start, end: filters.end }}
          presets={list}
          onChange={filters.setRange}
          isDefault={filters.isDefaultRange}
          defaultLabel={defaultLabel}
        />
      </div>
      {onSignOut ? (
        <Button variant="ghost" size="sm" className="topbar__signout" onClick={onSignOut} loading={signingOut}>
          Sign out
        </Button>
      ) : null}
      <IconButton
        icon={theme.resolved === "dark" ? "sun" : "moon"}
        label={theme.resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={theme.toggle}
        className="topbar__theme"
      />
    </header>
  );
}
