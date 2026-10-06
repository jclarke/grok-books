import { useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { useLocalStorage } from "../hooks/useLocalStorage";

export interface SavedView {
  name: string;
  query: string;
}

/** Named filter sets kept in this browser (localStorage). */
export function SavedViews({ storageKey, currentQuery, onApply }: { storageKey: string; currentQuery: string; onApply: (query: string) => void }) {
  const [views, setViews] = useLocalStorage<SavedView[]>(storageKey, []);
  const [name, setName] = useState("");
  return (
    <Popover
      label="Saved filters"
      align="right"
      trigger={({ open, toggle, ref }) => (
        <Button ref={ref} icon="bookmark" aria-expanded={open} onClick={toggle}>
          <span className="hide-mobile">Saved filters</span>
          {views.length ? <span className="pill-count">{views.length}</span> : null}
        </Button>
      )}
    >
      {(close) => (
        <div className="saved-views">
          {views.length === 0 ? <p className="muted small">No saved filters yet. Set filters, name them, and save.</p> : null}
          <ul className="saved-views__list">
            {views.map((view) => (
              <li key={view.name}>
                <button
                  type="button"
                  className="saved-views__apply"
                  onClick={() => {
                    onApply(view.query);
                    close();
                  }}
                >
                  <Icon name="filter" size={14} /> {view.name}
                </button>
                <button type="button" className="saved-views__delete" aria-label={`Delete saved filter ${view.name}`} onClick={() => setViews(views.filter((item) => item.name !== view.name))}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="saved-views__form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              setViews([...views.filter((item) => item.name !== trimmed), { name: trimmed, query: currentQuery }].slice(-20));
              setName("");
            }}
          >
            <label className="sr-only" htmlFor={`${storageKey}-name`}>
              Name for the current filters
            </label>
            <input id={`${storageKey}-name`} className="input input--sm" placeholder="Name current filters…" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
            <button type="submit" className="btn btn--primary btn--sm" disabled={!name.trim()}>
              Save
            </button>
          </form>
        </div>
      )}
    </Popover>
  );
}
