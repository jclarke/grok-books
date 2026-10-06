import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useSearch } from "../api/queries";
import { Icon, type IconName } from "./Icon";
import { Money } from "./MoneyCell";
import { useDebounce } from "../hooks/useDebounce";
import { useConfig } from "../hooks/useConfig";
import { withGlobal } from "../hooks/useGlobalFilters";
import { useSession } from "../hooks/useSession";
import { cx } from "../lib/cx";
import { allTimeRange } from "../lib/dates";
import { formatDate } from "../lib/format";
import { useMode } from "../hooks/useMode";
import { navFor } from "../lib/nav";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: React.ReactNode;
  icon: IconName;
  run: () => void;
}

/** Ctrl/Cmd-K: jump to a page, a transaction, a vendor, or an account. */
export function CommandPalette({ open, onClose, onToggleTheme }: { open: boolean; onClose: () => void; onToggleTheme: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const debounced = useDebounce(query.trim(), 180);
  const { mode } = useMode();
  const personal = mode === "personal";
  const search = useSearch(open ? debounced : "", mode);
  const { data: session } = useSession();
  const { features } = useConfig();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const go = (path: string, extra: Record<string, string> = {}) => {
    navigate(withGlobal(path, location.search, extra));
    onClose();
  };

  const commands = useMemo<Command[]>(() => {
    const needle = query.trim().toLowerCase();
    const pages: Command[] = navFor(mode, features).filter((item) => !needle || (item.paletteLabel ?? item.label).toLowerCase().includes(needle)).map((item) => ({
      id: `nav-${item.to}`,
      group: "Go to",
      label: item.paletteLabel ?? item.label,
      icon: item.icon,
      run: () => go(item.to),
    }));
    const extras: Command[] = [
      ...(personal
        ? []
        : [
            { id: "report-pnl", group: "Go to", label: "Profit & Loss", icon: "reports" as IconName, run: () => go("/reports/pnl") },
            { id: "report-schedc", group: "Go to", label: "Schedule C-style summary", icon: "reports" as IconName, run: () => go("/reports/schedule-c") },
          ]),
      { id: "theme", group: "Actions", label: "Toggle light / dark mode", icon: "moon" as IconName, run: () => { onToggleTheme(); onClose(); } },
    ].filter((item) => !needle || item.label.toLowerCase().includes(needle));
    const results: Command[] = [];
    if (needle.length >= 2 && search.data) {
      for (const account of search.data.accounts) {
        results.push({ id: `acct-${account.id}`, group: "Accounts", label: account.name, icon: "accounts", run: () => go(`${personal ? "/personal" : ""}/accounts/${account.id}`) });
      }
      for (const vendor of search.data.vendors) {
        results.push({
          id: `vendor-${vendor.name}`,
          group: "Vendors",
          label: vendor.name,
          hint: `${vendor.count} txns`,
          icon: "vendors",
          run: () => {
            const range = allTimeRange(session?.months ?? [], session?.latest_month ?? "", session?.today ?? "");
            if (personal) {
              navigate(withGlobal("/personal/transactions", location.search, { search: vendor.name, start: range.start, end: range.end }));
              onClose();
              return;
            }
            navigate(withGlobal("/transactions", location.search, { vendor: vendor.name, search: "", start: range.start, end: range.end }));
            onClose();
          },
        });
      }
      for (const txn of search.data.transactions) {
        results.push({
          id: `txn-${txn.id}`,
          group: "Transactions",
          label: txn.name || txn.id,
          hint: (
            <>
              <span className="muted">{formatDate(txn.date)} · {txn.account_name}</span> <Money cents={txn.amount_cents} />
            </>
          ),
          icon: "transactions",
          run: () => go(personal ? "/personal/transactions" : "/transactions", { txn: txn.id }),
        });
      }
    }
    return [...results, ...pages, ...extras];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, search.data, location.search, mode, features]);

  useEffect(() => {
    setActive(0);
  }, [query, search.data]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(commands.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commands[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return createPortal(
    <div className="dialog-root dialog-root--palette" data-modal-open="true">
      <div className="dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette__input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            role="combobox"
            aria-label="Search"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={commands[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Search transactions, vendors, accounts, or pages…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={100}
          />
          {search.isFetching ? <span className="spinner" aria-label="Searching" /> : <kbd>Esc</kbd>}
        </div>
        <ul className="palette__list" id={listId} role="listbox" aria-label="Results">
          {commands.length === 0 ? (
            <li className="palette__empty">{debounced.length >= 2 ? `No matches for “${debounced}”` : "Type to search"}</li>
          ) : null}
          {commands.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <li key={command.id} role="presentation">
                {header ? <p className="palette__group" role="presentation">{header}</p> : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={cx("palette__item", index === active && "is-active")}
                  onMouseMove={() => setActive(index)}
                  onClick={() => command.run()}
                >
                  <Icon name={command.icon} size={16} />
                  <span className="palette__label">{command.label}</span>
                  {command.hint ? <span className="palette__hint">{command.hint}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
