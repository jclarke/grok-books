import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { exportUrl } from "../../api/client";
import { usePersonalTransaction, usePersonalWrite, usePersonalStatus, type PTxn } from "../../api/personal";
import type { PersonalCategory } from "../../api/types";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { DataTable, type Column } from "../DataTable";
import { EmptyState, ErrorState } from "../EmptyState";
import { Icon } from "../Icon";
import { Drawer } from "../Modal";
import { Money } from "../MoneyCell";
import { SearchableSelect } from "../SearchableSelect";
import type { SelectOption } from "../Select";
import { SkeletonText } from "../Skeleton";
import { useToast } from "../Toast";
import { withGlobal } from "../../hooks/useGlobalFilters";
import { useSession } from "../../hooks/useSession";
import { cx } from "../../lib/cx";
import { formatDate, formatMoney, formatPct, parseMoney } from "../../lib/format";

/** Personal categories from the session, for selects and labels. */
export function usePersonalCategories(): PersonalCategory[] {
  const { data } = useSession();
  return data?.personal?.categories ?? [];
}

export function categoryOptions(categories: PersonalCategory[], opts: { includeHidden?: boolean; kinds?: string[] } = {}): SelectOption[] {
  return categories
    .filter((cat) => (opts.includeHidden || !cat.hidden) && (!opts.kinds || opts.kinds.includes(cat.kind)))
    .map((cat) => ({ value: String(cat.id), label: cat.name === cat.group ? cat.name : cat.name, group: cat.group }));
}

export function CategorySelect({
  value,
  onChange,
  label,
  hideLabel = true,
  disabled,
  kinds,
  placeholder,
  size = "sm",
}: {
  value: number | null;
  onChange: (id: number) => void;
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  kinds?: string[];
  placeholder?: string;
  size?: "sm" | "md";
}) {
  const categories = usePersonalCategories();
  const options = useMemo(() => {
    const list = categoryOptions(categories, { kinds });
    return placeholder ? [{ value: "", label: placeholder }, ...list] : list;
  }, [categories, kinds, placeholder]);
  return (
    <SearchableSelect
      label={label}
      hideLabel={hideLabel}
      size={size}
      value={value === null ? "" : String(value)}
      options={options}
      disabled={disabled}
      onChange={(next) => next && onChange(Number(next))}
    />
  );
}

/** Personal pages carry a visible mode label so the two modes are never confused. */
export const PERSONAL_EYEBROW = (
  <Badge tone="violet" dot>
    Personal
  </Badge>
);

export function CsvLink({ name, params = {}, label = "CSV" }: { name: string; params?: Record<string, string | number | boolean | null | undefined>; label?: string }) {
  return (
    <a className="btn btn--secondary btn--sm" href={exportUrl(`/export/personal/${name}.csv`, params)} download>
      <Icon name="download" size={15} /> {label}
    </a>
  );
}

export function ProgressBar({ pct, status, label }: { pct: number | null; status?: "ok" | "warning" | "over" | "done" | "on_track" | "behind" | "no_date"; label: string }) {
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div
      className={cx("pbar", status && `pbar--${status}`)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={pct === null ? "no budget" : formatPct(pct)}
    >
      <span className="pbar__fill" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Empty state for personal pages before any personal account exists, with the exact CLI steps. */
export function NoPersonalData({ title = "No personal accounts yet" }: { title?: string }) {
  const status = usePersonalStatus();
  const steps = status.data?.setup_steps ?? [];
  return (
    <EmptyState icon="wallet" title={title}>
      <p>Personal mode reads accounts marked personal. Register them from a saved Finance account list, then import:</p>
      <ol className="setup-steps">
        {steps.map((step) => (
          <li key={step}>
            <code>{step}</code>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Or mark an existing account personal in <Link to="/personal/settings?mode=personal">Settings → Accounts</Link>.
      </p>
    </EmptyState>
  );
}

export function PersonalLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorState error={error} onRetry={onRetry} />;
}

export function KindBadge({ row }: { row: PTxn }) {
  if (row.from_business) return <Badge tone="info" title="Paid from a business account; read-only here">paid from business account</Badge>;
  if (row.kind === "transfer") return <Badge tone="neutral">transfer</Badge>;
  if (row.kind === "funding") return <Badge tone="violet">owner draw</Badge>;
  if (row.pending) return <Badge tone="warn">pending</Badge>;
  return null;
}

/** The personal register table: inline category edits, a details drawer, keyboard rows. */
export function PersonalTxnTable({
  rows,
  loading,
  caption,
  pagination,
  selectable,
  selected,
  onSelectedChange,
  showBalance,
  empty,
}: {
  rows: PTxn[];
  loading?: boolean;
  caption: string;
  pagination?: { offset: number; limit: number; total: number; onChange: (offset: number) => void };
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  showBalance?: boolean;
  empty?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("txn");
  const write = usePersonalWrite<{ txn_id: string; category_id: number }>("/categorize");
  const toast = useToast();
  const open = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("txn", id);
      else next.delete("txn");
      return next;
    });
  const columns: Column<PTxn>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: !pagination, width: "7.5rem" },
    {
      key: "merchant",
      header: "Merchant",
      accessor: (row) => row.merchant,
      sortable: !pagination,
      cell: (row) => (
        <span className="ptxn__merchant">
          <span className="ptxn__name">{row.merchant}</span>
          <span className="ptxn__meta muted small">
            {row.name !== row.merchant ? row.name : ""} <KindBadge row={row} />
            {row.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                #{tag}
              </Badge>
            ))}
          </span>
        </span>
      ),
    },
    { key: "account", header: "Account", accessor: (row) => row.account_label, hideOnMobile: true },
    {
      key: "category",
      header: "Category",
      accessor: (row) => row.category,
      cell: (row) =>
        row.editable && row.splits.length === 0 ? (
          <CategorySelect
            label={`Category for ${row.merchant}`}
            value={row.category_id}
            onChange={(id) =>
              write.mutate(
                { txn_id: row.id, category_id: id },
                {
                  onSuccess: () => toast.toast({ tone: "success", title: "Category saved" }),
                  onError: (error) => toast.toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
                },
              )
            }
          />
        ) : (
          <span>{row.splits.length ? `Split (${row.splits.length})` : row.category}</span>
        ),
    },
    { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money-signed", align: "right", sortable: !pagination },
  ];
  if (showBalance) {
    columns.push({ key: "balance", header: "Balance", accessor: (row) => row.day_end_balance_cents ?? null, format: "money", align: "right", hideOnMobile: true });
  }
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        caption={caption}
        loading={loading}
        pagination={pagination}
        selectable={selectable}
        selected={selected}
        onSelectedChange={onSelectedChange}
        onRowClick={(row) => open(row.id)}
        keyboard
        empty={empty ?? <EmptyState compact title="No transactions match" />}
        rowClassName={(row) => (row.from_business ? "row--business" : undefined)}
      />
      <PersonalTxnDrawer id={openId} onClose={() => open(null)} />
    </>
  );
}

export function PersonalTxnDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = usePersonalTransaction(id);
  const txn = detail.data?.transaction;
  const toast = useToast();
  const categories = usePersonalCategories();
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [rename, setRename] = useState("");
  const [makeRule, setMakeRule] = useState(false);
  const [splits, setSplits] = useState<{ category_id: number | null; amount: string }[]>([]);
  useEffect(() => {
    if (!txn) return;
    setNote(txn.note);
    setTags(txn.tags.join(", "));
    setRename(txn.merchant);
    setMakeRule(false);
    setSplits(txn.splits.map((split) => ({ category_id: split.category_id, amount: (Math.abs(split.amount_cents) / 100).toFixed(2) })));
  }, [txn]);
  const categorize = usePersonalWrite<{ txn_id: string; category_id: number }>("/categorize");
  const saveNote = usePersonalWrite<{ note: string }>(() => `/transactions/${encodeURIComponent(id ?? "")}/note`);
  const saveTags = usePersonalWrite<{ tags: string[] }>(() => `/transactions/${encodeURIComponent(id ?? "")}/tags`);
  const saveSplits = usePersonalWrite<{ splits: { category_id: number; amount_cents: number }[] }>(() => `/transactions/${encodeURIComponent(id ?? "")}/splits`);
  const saveRename = usePersonalWrite<{ display_name: string; create_rule: boolean; category_id?: number | null }>(() => `/transactions/${encodeURIComponent(id ?? "")}/rename`);
  const markTransfer = usePersonalWrite<{ category: string }>(() => `/transactions/${encodeURIComponent(id ?? "")}/transfer`);
  const done = (title: string) => ({
    onSuccess: () => toast.toast({ tone: "success" as const, title }),
    onError: (error: unknown) => toast.toast({ tone: "error" as const, title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
  });
  const sign = txn && txn.amount_cents < 0 ? -1 : 1;
  const splitCents = splits.map((split) => (parseMoney(split.amount) ?? 0) * sign);
  const splitTotal = splitCents.reduce((acc, value) => acc + value, 0);
  const splitOk = txn ? splits.length >= 2 && splitTotal === txn.amount_cents && splits.every((split) => split.category_id !== null) : false;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={txn ? txn.merchant : "Transaction"} description={txn ? `${formatDate(txn.date)} · ${txn.account_label}` : undefined}>
      {detail.isPending ? <SkeletonText lines={6} /> : null}
      {detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} compact /> : null}
      {txn ? (
        <div className="pdrawer">
          <p className="pdrawer__amount">
            <Money cents={txn.amount_cents} colorPositive signed strong />
          </p>
          <dl className="pdrawer__facts">
            <div>
              <dt>Description</dt>
              <dd>{txn.raw_name || txn.name}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>
                {txn.group} / {txn.category} <KindBadge row={txn} />
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{txn.from_business ? "business books (owner draw)" : txn.source || "—"}</dd>
            </div>
          </dl>
          {!txn.editable ? (
            <p className="callout callout--info">
              Paid from a business account. The business books treat it as an owner draw; it is shown here as funding (and the expense it paid). Edit it in Business mode.
            </p>
          ) : (
            <>
              <section className="pdrawer__section" aria-label="Category">
                <CategorySelect
                  label="Category"
                  hideLabel={false}
                  size="md"
                  value={txn.category_id}
                  onChange={(category_id) => categorize.mutate({ txn_id: txn.id, category_id }, done("Category saved"))}
                />
                <Button size="sm" variant="ghost" onClick={() => markTransfer.mutate({ category: "Internal transfer" }, done("Marked as a transfer"))}>
                  Mark as transfer
                </Button>
              </section>
              <section className="pdrawer__section" aria-label="Note and tags">
                <label className="field">
                  <span className="field__label">Note</span>
                  <textarea className="input" rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
                </label>
                <Button size="sm" onClick={() => saveNote.mutate({ note }, done("Note saved"))}>
                  Save note
                </Button>
                <label className="field">
                  <span className="field__label">Tags (comma separated)</span>
                  <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} />
                </label>
                <Button
                  size="sm"
                  onClick={() => saveTags.mutate({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, done("Tags saved"))}
                >
                  Save tags
                </Button>
              </section>
              <section className="pdrawer__section" aria-label="Rename merchant">
                <label className="field">
                  <span className="field__label">Merchant name (applies to every matching transaction)</span>
                  <input className="input" value={rename} maxLength={120} onChange={(event) => setRename(event.target.value)} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={makeRule} onChange={(event) => setMakeRule(event.target.checked)} /> Also create a rule with the current category
                </label>
                <Button
                  size="sm"
                  onClick={() => saveRename.mutate({ display_name: rename, create_rule: makeRule, category_id: txn.category_id }, done("Merchant renamed"))}
                >
                  Rename
                </Button>
              </section>
              <section className="pdrawer__section" aria-label="Split">
                <h3 className="pdrawer__title">Split</h3>
                {splits.map((split, index) => (
                  <div className="split-row" key={index}>
                    <CategorySelect
                      label={`Split ${index + 1} category`}
                      value={split.category_id}
                      placeholder="Category…"
                      onChange={(category_id) => setSplits((list) => list.map((item, i) => (i === index ? { ...item, category_id } : item)))}
                    />
                    <input
                      className="input input--sm num"
                      aria-label={`Split ${index + 1} amount`}
                      value={split.amount}
                      inputMode="decimal"
                      onChange={(event) => setSplits((list) => list.map((item, i) => (i === index ? { ...item, amount: event.target.value } : item)))}
                    />
                    <Button size="sm" variant="ghost" onClick={() => setSplits((list) => list.filter((_, i) => i !== index))}>
                      Remove
                    </Button>
                  </div>
                ))}
                <p className={cx("small", splits.length && !splitOk ? "text-neg" : "muted")} role="status">
                  {splits.length ? `Split total ${formatMoney(splitTotal)} of ${formatMoney(txn.amount_cents)}` : "Not split"}
                </p>
                <div className="row-actions">
                  <Button size="sm" onClick={() => setSplits((list) => [...list, { category_id: null, amount: "" }])}>
                    Add part
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={splits.length > 0 && !splitOk}
                    onClick={() =>
                      saveSplits.mutate(
                        { splits: splits.map((split, index) => ({ category_id: split.category_id as number, amount_cents: splitCents[index] })) },
                        done(splits.length ? "Split saved" : "Split removed"),
                      )
                    }
                  >
                    {splits.length ? "Save split" : "Remove split"}
                  </Button>
                </div>
                {categories.length === 0 ? null : null}
              </section>
              {txn.history.length ? (
                <section className="pdrawer__section" aria-label="History">
                  <h3 className="pdrawer__title">History</h3>
                  <ul className="history">
                    {txn.history.map((item) => (
                      <li key={item.id} className="small">
                        <span className="muted">{item.ts.slice(0, 16).replace("T", " ")}</span> {item.action} {item.new_value ?? ""}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

/** Link to the personal transaction list filtered by a field, keeping the date range. */
export function TxnLink({ children, filter }: { children: ReactNode; filter: Record<string, string> }) {
  const location = useLocation();
  return <Link to={withGlobal("/personal/transactions", location.search, { ...filter, offset: "" })}>{children}</Link>;
}
