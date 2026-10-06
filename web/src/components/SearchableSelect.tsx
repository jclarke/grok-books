import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import type { SelectOption } from "./Select";
import { cx } from "../lib/cx";

export interface SearchableSelectProps {
  label?: ReactNode;
  hideLabel?: boolean;
  options: SelectOption[];
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  hint?: ReactNode;
  id?: string;
  value?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  name?: string;
  "aria-label"?: string;
}

interface Section {
  group: string | null;
  options: SelectOption[];
}

/** Loose (ungrouped) options first, then groups in first-seen order: the same order the native Select renders. */
function sections(options: SelectOption[]): Section[] {
  const loose: SelectOption[] = [];
  const groups = new Map<string, SelectOption[]>();
  for (const option of options) {
    if (!option.group) {
      loose.push(option);
      continue;
    }
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  const out: Section[] = loose.length ? [{ group: null, options: loose }] : [];
  for (const [group, list] of groups) out.push({ group, options: list });
  return out;
}

/** Case-insensitive substring match on "Group/Name"; every word must match, in any order. */
export function matchesQuery(option: SelectOption, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = `${option.group ? `${option.group}/` : ""}${option.label}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

const GAP = 4;
const MAX_HEIGHT = 320;

/**
 * Type-to-filter combobox (WAI-ARIA 1.2 combobox + listbox) with the same
 * props as Select, for long option lists like categories. The list is
 * portaled with fixed positioning so scrolling tables and drawers can't clip it.
 */
export function SearchableSelect({
  label,
  hideLabel,
  options,
  onChange,
  size = "md",
  hint,
  id,
  value = "",
  disabled,
  className,
  placeholder,
  name,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-listbox`;
  const labelId = `${inputId}-label`;
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const pointerInPopup = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  const selected = options.find((option) => option.value === value);
  const duplicateLabel = selected ? options.some((option) => option !== selected && option.label === selected.label) : false;
  const selectedText = selected ? (duplicateLabel && selected.group ? `${selected.group} / ${selected.label}` : selected.label) : "";

  const visible = useMemo(
    () => sections(options.filter((option) => matchesQuery(option, query))).filter((section) => section.options.length > 0),
    [options, query],
  );
  const enabled = useMemo(() => visible.flatMap((section) => section.options).filter((option) => !option.disabled), [visible]);
  const optionId = (index: number) => `${inputId}-opt-${index}`;
  const indexOf = useMemo(() => new Map(options.map((option, index) => [option.value, index])), [options]);
  // While typing, the first match is active so Enter picks it.
  const active = activeValue !== null && enabled.some((option) => option.value === activeValue) ? activeValue : query ? (enabled[0]?.value ?? null) : null;

  const place = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewWidth = document.documentElement.clientWidth || window.innerWidth;
    const below = viewHeight - rect.bottom - GAP * 2;
    const above = rect.top - GAP * 2;
    const flip = below < 200 && above > below;
    const width = Math.min(Math.max(rect.width, 240), viewWidth - GAP * 2);
    const left = Math.max(GAP, Math.min(rect.left, viewWidth - width - GAP));
    setPosition({
      left,
      width,
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, flip ? above : below)),
      ...(flip ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    setQuery("");
    setActiveValue(selected && !selected.disabled ? selected.value : null);
    setOpen(true);
  }, [disabled, selected]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    pointerInPopup.current = false;
  }, []);

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    close();
    if (option.value !== value) onChange?.(option.value);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const viewport = window.visualViewport;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open, place]);

  // Click or tap outside closes without choosing.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: Event) => {
      const target = event.target as Node;
      if (inputRef.current?.parentElement?.contains(target) || popupRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("touchstart", onPointer, true);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("touchstart", onPointer, true);
    };
  }, [open, close]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active === null) return;
    const index = indexOf.get(active);
    if (index === undefined) return;
    document.getElementById(optionId(index))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, indexOf]);

  const move = (step: number | "first" | "last") => {
    if (!enabled.length) return;
    const current = active === null ? -1 : enabled.findIndex((option) => option.value === active);
    let next: number;
    if (step === "first") next = 0;
    else if (step === "last") next = enabled.length - 1;
    else if (current < 0) next = step > 0 ? 0 : enabled.length - 1;
    else next = Math.max(0, Math.min(enabled.length - 1, current + step));
    setActiveValue(enabled[next].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else move(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "PageDown":
      case "PageUp":
        if (!open) return;
        event.preventDefault();
        move(event.key === "PageDown" ? 10 : -10);
        break;
      case "Home":
      case "End":
        if (!open) return;
        event.preventDefault();
        move(event.key === "Home" ? "first" : "last");
        break;
      case "Enter": {
        if (!open) return;
        event.preventDefault();
        const option = enabled.find((item) => item.value === active);
        if (option) choose(option);
        else close();
        break;
      }
      case "Escape":
        if (!open) return;
        // Close the list only, not the drawer or dialog around it.
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        if (open) close();
        break;
      default:
    }
  };

  const labelText = typeof label === "string" ? label : ariaLabel;

  const popup = open
    ? createPortal(
        <div
          ref={popupRef}
          className={cx("combo__popup", `combo__popup--${size}`)}
          style={position}
          // Keep focus in the input so a click on an option isn't lost to a blur.
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={() => {
            pointerInPopup.current = true;
          }}
          // The popup lives in a portal; don't let clicks reach a table row through the React tree.
          onClick={(event) => event.stopPropagation()}
        >
          <div role="listbox" id={listId} aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel} className="combo__list">
            {visible.map((section) => {
              const items = section.options.map((option) => {
                const index = indexOf.get(option.value) ?? 0;
                return (
                  <div
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    className={cx("combo__option", option.value === active && "is-active", option.value === value && "is-selected", option.disabled && "is-disabled")}
                    onMouseMove={() => !option.disabled && option.value !== active && setActiveValue(option.value)}
                    onClick={() => {
                      choose(option);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="combo__option-label">{option.label}</span>
                    {option.value === value ? <Icon name="check" size={14} className="combo__check" /> : null}
                  </div>
                );
              });
              return section.group ? (
                <div key={`g:${section.group}`} role="group" aria-label={section.group} className="combo__group">
                  <div className="combo__group-label" role="presentation" aria-hidden="true">
                    {section.group}
                  </div>
                  {items}
                </div>
              ) : (
                <div key="loose" role="presentation">
                  {items}
                </div>
              );
            })}
          </div>
          {visible.length === 0 ? (
            <div className="combo__empty" role="status">
              No matches
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={cx("field", className)}>
      {label ? (
        <label htmlFor={inputId} id={labelId} className={cx("field__label", hideLabel && "sr-only")}>
          {label}
        </label>
      ) : null}
      <div className={cx("select", `select--${size}`, "combo", open && "is-open")}>
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          className="combo__input"
          aria-label={label ? undefined : ariaLabel}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active !== null ? optionId(indexOf.get(active) ?? 0) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          title={selected?.group ? `${selected.group} / ${selected.label}` : selectedText || undefined}
          placeholder={open ? selectedText || placeholder || (labelText ? `Search ${labelText.toLowerCase()}` : "Search") : placeholder}
          value={open ? query : selectedText}
          onChange={(event) => {
            if (!open) setOpen(true);
            setQuery(event.target.value);
            setActiveValue(null);
          }}
          onMouseDown={() => {
            if (!open) openList();
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (pointerInPopup.current) return;
            if (open) close();
          }}
        />
        <Icon name="chevronDown" size={15} className="select__chevron" />
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
      {popup}
    </div>
  );
}
