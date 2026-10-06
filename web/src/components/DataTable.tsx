import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Money } from "./MoneyCell";
import { SkeletonTable } from "./Skeleton";
import { useHotkeys } from "../hooks/useHotkeys";
import { cx } from "../lib/cx";
import { formatDate, formatPct } from "../lib/format";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Plain value used for sorting, filtering, and default formatting. */
  accessor?: (row: T) => string | number | null | undefined;
  cell?: (row: T, index: number) => ReactNode;
  format?: "money" | "money-signed" | "date" | "number" | "pct" | "text";
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: string;
  className?: string;
  /** Hide below 720px wide. */
  hideOnMobile?: boolean;
  /** Keep empty values at the bottom in both sort directions. */
  nullsLast?: boolean;
}

export interface ServerPagination {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  empty?: ReactNode;
  /** Controlled (server) sort. Omit for client-side sorting. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  defaultSort?: SortState;
  /** Client-side text filter across accessor values. */
  filter?: string;
  /** Client-side page size; ignored when `pagination` is given. */
  pageSize?: number;
  pagination?: ServerPagination;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  /** j/k (and arrows) move a highlight; Enter opens; x toggles selection. */
  keyboard?: boolean;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  dense?: boolean;
  maxHeight?: string;
}

function renderValue<T>(column: Column<T>, row: T, index: number): ReactNode {
  if (column.cell) return column.cell(row, index);
  const value = column.accessor?.(row);
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  switch (column.format) {
    case "money":
      return <Money cents={Number(value)} />;
    case "money-signed":
      return <Money cents={Number(value)} colorPositive signed />;
    case "date":
      return <span className="nowrap">{formatDate(String(value))}</span>;
    case "number":
      return <span className="num">{Number(value).toLocaleString("en-US")}</span>;
    case "pct":
      return <span className="num">{formatPct(Number(value))}</span>;
    default:
      return String(value);
  }
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading,
  empty,
  sort,
  onSortChange,
  defaultSort,
  filter,
  pageSize,
  pagination,
  selectable,
  selected,
  onSelectedChange,
  onRowClick,
  keyboard,
  rowClassName,
  footer,
  dense,
  maxHeight,
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = useState<SortState | undefined>(defaultSort);
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const controlled = sort !== undefined;
  const currentSort = controlled ? sort : localSort;

  const filtered = useMemo(() => {
    const needle = (filter ?? "").trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) => {
        const value = column.accessor?.(row);
        return value !== null && value !== undefined && String(value).toLowerCase().includes(needle);
      }),
    );
  }, [rows, filter, columns]);

  const sorted = useMemo(() => {
    if (controlled || !currentSort) return filtered;
    const column = columns.find((item) => item.key === currentSort.key);
    if (!column?.accessor) return filtered;
    const list = [...filtered];
    const empty = (value: unknown) => value === null || value === undefined || value === "";
    list.sort((a, b) => {
      const left = column.accessor?.(a);
      const right = column.accessor?.(b);
      const result = compare(left, right);
      if (column.nullsLast && (empty(left) || empty(right))) return result;
      return currentSort.dir === "asc" ? result : -result;
    });
    return list;
  }, [filtered, currentSort, columns, controlled]);

  const clientPaged = !pagination && pageSize !== undefined;
  useEffect(() => {
    setPage(0);
  }, [filter, rows]);
  const visible = clientPaged ? sorted.slice(page * pageSize, page * pageSize + pageSize) : sorted;

  useEffect(() => {
    setActive((index) => (index >= visible.length ? visible.length - 1 : index));
  }, [visible.length]);

  const move = (step: number) => {
    if (visible.length === 0) return;
    setActive((index) => {
      const next = Math.min(visible.length - 1, Math.max(0, index + step));
      const row = bodyRef.current?.children[next] as HTMLElement | undefined;
      row?.scrollIntoView?.({ block: "nearest" });
      return next;
    });
  };

  const toggle = (key: string) => {
    if (!onSelectedChange || !selected) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  };

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      arrowdown: () => move(1),
      arrowup: () => move(-1),
      enter: () => {
        const row = visible[active];
        if (row && onRowClick) onRowClick(row);
      },
      x: () => {
        const row = visible[active];
        if (row && selectable) toggle(rowKey(row));
      },
    },
    Boolean(keyboard),
  );

  const onHeaderClick = (column: Column<T>) => {
    if (!column.sortable) return;
    const dir: SortDir = currentSort?.key === column.key && currentSort.dir === "desc" ? "asc" : currentSort?.key === column.key ? "desc" : column.format?.startsWith("money") || column.format === "date" || column.format === "number" ? "desc" : "asc";
    const next = { key: column.key, dir };
    if (controlled) onSortChange?.(next);
    else setLocalSort(next);
  };

  const visibleKeys = visible.map(rowKey);
  const allChecked = selectable && visibleKeys.length > 0 && visibleKeys.every((key) => selected?.has(key));
  const someChecked = selectable && visibleKeys.some((key) => selected?.has(key));

  return (
    <div className={cx("table-card", dense && "table-card--dense")}>
      <div className="table-scroll" style={maxHeight ? { maxHeight } : undefined} role="region" aria-label={caption} tabIndex={0}>
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th className="table__check" scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={Boolean(allChecked)}
                    ref={(node) => {
                      if (node) node.indeterminate = Boolean(someChecked && !allChecked);
                    }}
                    onChange={() => {
                      if (!onSelectedChange) return;
                      const next = new Set(selected);
                      if (allChecked) visibleKeys.forEach((key) => next.delete(key));
                      else visibleKeys.forEach((key) => next.add(key));
                      onSelectedChange(next);
                    }}
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const sorted = currentSort?.key === column.key;
                const align = column.align ?? (column.format?.startsWith("money") || column.format === "number" || column.format === "pct" ? "right" : "left");
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cx(`align-${align}`, column.hideOnMobile && "hide-mobile", column.className)}
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={column.sortable ? (sorted ? (currentSort?.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  >
                    {column.sortable ? (
                      <button type="button" className={cx("th-sort", sorted && "is-sorted")} onClick={() => onHeaderClick(column)}>
                        <span>{column.header}</span>
                        <Icon name={sorted ? (currentSort?.dir === "asc" ? "arrowUp" : "arrowDown") : "sort"} size={13} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {loading ? null : (
            <tbody ref={bodyRef}>
              {visible.map((row, index) => {
                const key = rowKey(row);
                const isSelected = selected?.has(key);
                return (
                  <tr
                    key={key}
                    className={cx(onRowClick && "is-clickable", index === active && "is-active", isSelected && "is-selected", rowClassName?.(row))}
                    onClick={(event) => {
                      setActive(index);
                      if (!onRowClick) return;
                      if ((event.target as HTMLElement).closest("button, a, input, select, label, textarea, [data-no-row-click]")) return;
                      onRowClick(row);
                    }}
                    aria-selected={selectable ? Boolean(isSelected) : undefined}
                  >
                    {selectable ? (
                      <td className="table__check">
                        <input type="checkbox" aria-label={`Select row ${index + 1}`} checked={Boolean(isSelected)} onChange={() => toggle(key)} />
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const align = column.align ?? (column.format?.startsWith("money") || column.format === "number" || column.format === "pct" ? "right" : "left");
                      return (
                        <td key={column.key} className={cx(`align-${align}`, align === "right" && "num", column.hideOnMobile && "hide-mobile", column.className)}>
                          {renderValue(column, row, index)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          )}
          {footer && !loading && visible.length > 0 ? <tfoot>{footer}</tfoot> : null}
        </table>
        {loading ? <SkeletonTable rows={8} cols={Math.min(columns.length, 6)} /> : null}
        {!loading && visible.length === 0 ? <div className="table-empty">{empty ?? "Nothing to show."}</div> : null}
      </div>
      {pagination ? (
        <Pagination {...pagination} />
      ) : clientPaged && sorted.length > pageSize ? (
        <Pagination offset={page * pageSize} limit={pageSize} total={sorted.length} onChange={(offset) => setPage(Math.floor(offset / pageSize))} />
      ) : null}
      {keyboard ? (
        <p className="table-hint">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> open{selectable ? <> · <kbd>x</kbd> select</> : null}
        </p>
      ) : null}
    </div>
  );
}

export function Pagination({ offset, limit, total, onChange, onLimitChange }: ServerPagination) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__info">
        <span className="num">{from.toLocaleString("en-US")}</span>–<span className="num">{to.toLocaleString("en-US")}</span> of{" "}
        <span className="num">{total.toLocaleString("en-US")}</span>
      </span>
      <div className="pagination__controls">
        {onLimitChange ? (
          <label className="pagination__size">
            <span className="sr-only">Rows per page</span>
            <select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
              {[50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="btn btn--secondary btn--sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          <Icon name="chevronLeft" size={15} />
          <span className="hide-mobile">Previous</span>
        </button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>
          <span className="hide-mobile">Next</span>
          <Icon name="chevronRight" size={15} />
        </button>
      </div>
    </nav>
  );
}
