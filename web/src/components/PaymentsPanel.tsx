import { useEffect, useMemo, useState } from "react";
import { usePayments, useUpdatePayment } from "../api/queries";
import type { PaymentRow, PaymentUpdate } from "../api/types";
import { centsToInput, formatDate, formatMoney, parseMoney, pluralize } from "../lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { DataTable, type Column } from "./DataTable";
import { EmptyState, ErrorState } from "./EmptyState";
import { KpiCard } from "./KpiCard";
import { Drawer } from "./Modal";
import { Money } from "./MoneyCell";
import { SearchableSelect } from "./SearchableSelect";
import { Select, TextField } from "./Select";
import { SkeletonCard } from "./Skeleton";
import { useToast } from "./Toast";

export type Mode = "business" | "personal";

const SOURCE_LABELS: Record<string, string> = {
  statement: "statement",
  sheet: "sheet",
  "inferred from payment history": "inferred",
  manual: "manual",
  finance: "finance",
};

const AUTOPAY_LABELS: Record<PaymentRow["autopay"], string> = { yes: "Yes", no: "No", unknown: "Unknown" };

const AUTOPAY_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function accountName(row: Pick<PaymentRow, "label" | "last4">): string {
  return row.last4 && !row.label.includes(row.last4) ? `${row.label} ···· ${row.last4}` : row.label;
}

/** "As of Sep 28, 2026 · source: statement · <notes>" */
export function sourceTooltip(row: PaymentRow): string {
  const parts: string[] = [];
  if (row.as_of) parts.push(`As of ${formatDate(row.as_of)}`);
  if (row.source) parts.push(`source: ${row.source}`);
  if (row.notes) parts.push(row.notes);
  return parts.join(" · ");
}

function aprValue(apr: string | null): number | null {
  if (!apr) return null;
  const value = Number.parseFloat(apr.replace(/[^\d.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function days(count: number): string {
  return pluralize(count, "day");
}

function MinDueCell({ row }: { row: PaymentRow }) {
  if (row.status === "none") return <span className="muted">No payment due</span>;
  if (row.min_payment_cents === null) return <span className="muted">—</span>;
  return (
    <span className="pay-cell">
      <Money cents={row.min_payment_cents} />
      {row.estimated && row.stored_min_cents === null ? <span className="pay-est">est.</span> : null}
      {row.unverified ? (
        <Badge tone="warn" title="Not confirmed against a statement">
          unverified
        </Badge>
      ) : null}
    </span>
  );
}

export function StatusBadge({ row }: { row: PaymentRow }) {
  const n = row.days_until;
  switch (row.status) {
    case "overdue":
      return <Badge tone="neg">Overdue{n !== null ? ` · ${days(-n)}` : ""}</Badge>;
    case "due_soon":
      if (n === null) return <Badge tone="warn">Due soon</Badge>;
      if (n < 0) return <Badge tone="warn">Due now (est.)</Badge>;
      return <Badge tone="warn">{n === 0 ? "Due today" : `Due in ${days(n)}`}</Badge>;
    case "upcoming":
      return n !== null ? <span className="muted small">in {days(n)}</span> : null;
    case "paid":
      if (row.rolled) return null;
      return (
        <Badge tone="pos" title={row.paid_date ? `Paid ${formatDate(row.paid_date)}` : undefined}>
          Paid
        </Badge>
      );
    default:
      return null;
  }
}

function DueDateCell({ row }: { row: PaymentRow }) {
  if (!row.effective_due_date) {
    return row.note && row.status !== "none" ? <span className="muted small">{row.note}</span> : <span className="muted">—</span>;
  }
  return (
    <div className="pay-due">
      <span className="pay-cell">
        <span className="nowrap">{formatDate(row.effective_due_date)}</span>
        {row.rolled || row.estimated ? (
          <span className="pay-est" title="Estimated">
            est.
          </span>
        ) : null}
        <StatusBadge row={row} />
      </span>
      {row.rolled ? <span className="muted small">{row.paid_by === "balance" ? "paid (balance dropped)" : `paid ${formatDate(row.paid_date)}`}</span> : null}
    </div>
  );
}

function SourceCell({ row }: { row: PaymentRow }) {
  if (!row.source) return <span className="muted">—</span>;
  const tip = sourceTooltip(row);
  return (
    <span className="pay-source" title={tip}>
      <span aria-hidden="true">{SOURCE_LABELS[row.source] ?? row.source}</span>
      <span className="sr-only">{tip}</span>
    </span>
  );
}

export function PaymentsPanel({ mode }: { mode: Mode }) {
  const query = usePayments(mode);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const editing = rows.find((row) => row.id === editingId) ?? null;
  const missing = rows.filter((row) => !row.has_terms);

  const columns = useMemo<Column<PaymentRow>[]>(
    () => [
      {
        key: "account",
        header: "Account",
        sortable: true,
        accessor: (row) => row.label,
        cell: (row) => (
          <div className="pay-account">
            <span className="pay-account__name">{row.label}</span>
            <span className="muted small">
              {row.institution}
              {row.last4 ? ` ···· ${row.last4}` : ""}
            </span>
          </div>
        ),
      },
      { key: "owed", header: "Owed", sortable: true, format: "money", accessor: (row) => row.balance_cents },
      { key: "min", header: "Min due", sortable: true, nullsLast: true, format: "money", accessor: (row) => row.min_payment_cents, cell: (row) => <MinDueCell row={row} /> },
      { key: "due", header: "Due date", sortable: true, nullsLast: true, format: "date", accessor: (row) => row.effective_due_date, cell: (row) => <DueDateCell row={row} /> },
      { key: "apr", header: "APR", sortable: true, nullsLast: true, align: "right", accessor: (row) => aprValue(row.apr), cell: (row) => (row.apr ? <span className="num">{row.apr}</span> : <span className="muted">—</span>) },
      { key: "autopay", header: "Autopay", accessor: (row) => row.autopay, cell: (row) => (row.autopay === "unknown" ? <span className="muted">Unknown</span> : AUTOPAY_LABELS[row.autopay]) },
      { key: "source", header: "Source", accessor: (row) => row.source, cell: (row) => <SourceCell row={row} /> },
      {
        key: "edit",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (row) => (
          <Button size="sm" variant="secondary" onClick={() => setEditingId(row.id)} aria-label={`Edit payment info for ${accountName(row)}`}>
            Edit
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <section className="payments" aria-labelledby={`payments-title-${mode}`}>
      <h2 className="section-title" id={`payments-title-${mode}`}>
        Payments due
      </h2>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <div className="payments__summary">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} height={90} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState compact icon="card" title="No cards or loans">
          Credit cards and loans show their minimum payment and due date here.
        </EmptyState>
      ) : (
        <>
          {summary ? (
            <div className="payments__summary" aria-label="Payment totals" role="group">
              <KpiCard
                label="Minimums due, next 30 days"
                cents={summary.next30_cents}
                footer={<span className="muted">{pluralize(summary.next30_count, "payment")}</span>}
              />
              <KpiCard
                label="Overdue"
                cents={summary.overdue_cents}
                tone={summary.overdue_count > 0 || summary.overdue_cents > 0 ? "danger" : "default"}
                footer={<span className="muted">{summary.overdue_count > 0 ? pluralize(summary.overdue_count, "account") : "Nothing overdue"}</span>}
              />
              <Card as="article" className="kpi payments__by-date">
                <h3 className="kpi__label">By date</h3>
                {summary.by_date.length ? (
                  <ul className="payments__dates">
                    {summary.by_date.map((item) => (
                      <li key={item.date}>
                        <span className="nowrap">{formatDate(item.date, { year: false })}</span>
                        <Money cents={item.cents} />
                        <span className="muted small">{pluralize(item.count, "payment")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Nothing due in the next 30 days</p>
                )}
              </Card>
            </div>
          ) : null}
          {summary && summary.unverified_count + summary.missing_count > 0 ? (
            <p className="muted small payments__note">
              {[
                summary.missing_count > 0 ? `${pluralize(summary.missing_count, "account")} without payment info` : null,
                summary.unverified_count > 0 ? `${pluralize(summary.unverified_count, "account")} with unverified figures` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <div className="payments__toolbar">
            <h3 className="card__title">Upcoming payments</h3>
            {missing.length ? (
              <SearchableSelect
                className="payments__add"
                label="Add payment info"
                size="sm"
                placeholder="Choose an account"
                value=""
                options={missing.map((row) => ({ value: row.id, label: accountName(row) }))}
                onChange={(id) => setEditingId(id)}
              />
            ) : null}
          </div>
          <DataTable
            caption="Upcoming payments"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            defaultSort={{ key: "due", dir: "asc" }}
            rowClassName={(row) => (row.status === "overdue" ? "row--attention" : undefined)}
          />
        </>
      )}
      <PaymentDrawer mode={mode} row={editing} onClose={() => setEditingId(null)} />
    </section>
  );
}

interface Draft {
  min: string;
  due: string;
  apr: string;
  autopay: PaymentRow["autopay"];
  notes: string;
}

function draftFor(row: PaymentRow | null): Draft {
  const min = row?.stored_min_cents ?? null;
  return {
    min: min === null ? "" : centsToInput(min),
    due: row?.due_date ?? "",
    apr: row?.apr ?? "",
    autopay: row?.autopay ?? "unknown",
    notes: row?.notes ?? "",
  };
}

/** Only the fields the person changed, in the shapes PATCH /api/payments accepts. */
function paymentChanges(before: Draft, after: Draft): PaymentUpdate {
  const changes: PaymentUpdate = {};
  if (after.min.trim() !== before.min.trim()) changes.min_payment = after.min.trim() === "" ? null : after.min.trim();
  if (after.due !== before.due) changes.due_date = after.due;
  if (after.apr.trim() !== before.apr.trim()) changes.apr = after.apr.trim();
  if (after.autopay !== before.autopay) changes.autopay = after.autopay;
  if (after.notes.trim() !== before.notes.trim()) changes.notes = after.notes.trim();
  return changes;
}

export function PaymentDrawer({ mode, row, onClose }: { mode: Mode; row: PaymentRow | null; onClose: () => void }) {
  const update = useUpdatePayment(mode);
  const { toast } = useToast();
  const [initial, setInitial] = useState<Draft>(() => draftFor(row));
  const [draft, setDraft] = useState<Draft>(() => draftFor(row));
  const [minError, setMinError] = useState<string | null>(null);
  const rowId = row?.id ?? null;

  useEffect(() => {
    const next = draftFor(row);
    setInitial(next);
    setDraft(next);
    setMinError(null);
    update.reset();
    // Reset only when a different account opens, not when a refetch replaces the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  if (!row) return null;
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const label = accountName(row);
  const apiError = update.error ? (update.error instanceof Error ? update.error.message : String(update.error)) : null;

  function send(changes: PaymentUpdate, done: string) {
    if (!row) return;
    update.mutate(
      { id: row.id, changes },
      {
        onSuccess: () => {
          toast({ tone: "success", title: done });
          onClose();
        },
      },
    );
  }

  function save() {
    if (draft.min.trim() !== "" && parseMoney(draft.min) === null) {
      setMinError("Enter a dollar amount with at most two decimal places.");
      return;
    }
    setMinError(null);
    const changes = paymentChanges(initial, draft);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    send(changes, `Payment info saved for ${row?.label ?? "account"}`);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={label}
      description={
        <>
          Payment info · owed <Money cents={row.balance_cents} />
          {row.as_of ? <> · as of {formatDate(row.as_of)}</> : null}
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={update.isPending} onClick={() => send({ paid: true }, `${row.label} marked paid`)}>
            Mark paid
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        {apiError ? (
          <p className="field__error" role="alert">
            {apiError}
          </p>
        ) : null}
        <TextField
          label="Minimum payment due ($)"
          inputMode="decimal"
          autoComplete="off"
          value={draft.min}
          onChange={(event) => set({ min: event.target.value })}
          error={minError}
          hint={
            row.stored_min_cents === null && row.min_payment_cents !== null
              ? `Estimated ${formatMoney(row.min_payment_cents)}. Leave blank to keep estimating.`
              : "Leave blank if there's no minimum on file."
          }
        />
        <TextField
          label="Due date"
          type="date"
          value={draft.due}
          onChange={(event) => set({ due: event.target.value })}
          hint={row.rolled && row.effective_due_date ? `Paid; next due date estimated as ${formatDate(row.effective_due_date)}.` : undefined}
        />
        <TextField label="APR" autoComplete="off" placeholder="e.g. 24.99%" value={draft.apr} onChange={(event) => set({ apr: event.target.value })} />
        <Select label="Autopay" options={AUTOPAY_OPTIONS} value={draft.autopay} onChange={(value) => set({ autopay: value as PaymentRow["autopay"] })} />
        <TextField label="Notes" maxLength={500} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} />
      </div>
    </Drawer>
  );
}
