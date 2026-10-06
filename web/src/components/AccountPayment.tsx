import { useMemo, useState } from "react";
import { usePayments } from "../api/queries";
import type { PaymentRow } from "../api/types";
import { formatDate, formatMoney, pluralize } from "../lib/format";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { accountName, sourceTooltip, type Mode } from "./PaymentsPanel";
import { Skeleton } from "./Skeleton";

/**
 * Payment rows by account id for the tiles on an Accounts page, plus which one
 * is open in the page's payment drawer. Shares the PaymentsPanel query key, so
 * an edit in either place updates both.
 */
export function useAccountPayments(mode: Mode) {
  const query = usePayments(mode);
  const [editingId, setEditingId] = useState<string | null>(null);
  const byId = useMemo(() => new Map((query.data?.rows ?? []).map((row) => [row.id, row])), [query.data]);
  return {
    pending: query.isPending,
    byId,
    editing: editingId ? (byId.get(editingId) ?? null) : null,
    edit: setEditingId,
    close: () => setEditingId(null),
  };
}

/** "$427" for whole dollars, "$427.50" otherwise. */
function tileMoney(cents: number): string {
  return formatMoney(cents, { whole: cents % 100 === 0 });
}

export type PayTone = "neg" | "warn" | "pos" | "neutral";

/**
 * When a tile's due date falls, relative to today: "today", "tomorrow",
 * "in 18 days", "3 days overdue". Only an overdue row says overdue; a passed
 * estimate (due_soon) is "due now", and a past date on any other status
 * (paid, unknown) gets no chip at all.
 */
export function relativeDue(row: Pick<PaymentRow, "status" | "days_until">): string | null {
  const n = row.days_until;
  if (row.status === "none") return null;
  if (row.status === "overdue") return n === null || n >= 0 ? "overdue" : `${pluralize(-n, "day")} overdue`;
  if (n === null) return null;
  if (n < 0) return row.status === "due_soon" ? "due now" : null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${pluralize(n, "day")}`;
}

/** The tile's status pill and accent color: red overdue, amber due soon, green paid. */
export function paymentStatus(row: Pick<PaymentRow, "status" | "days_until" | "paid_date">): { label: string; tone: PayTone; title?: string } | null {
  switch (row.status) {
    case "overdue":
      return { label: "Overdue", tone: "neg" };
    case "due_soon":
      return { label: row.days_until !== null && row.days_until < 0 ? "Due now" : "Due soon", tone: "warn" };
    case "paid":
      return { label: "Paid", tone: "pos", title: row.paid_date ? `Paid ${formatDate(row.paid_date)}` : undefined };
    case "upcoming":
      return { label: "Upcoming", tone: "neutral" };
    default:
      return null;
  }
}

function EstTag({ title }: { title: string }) {
  return (
    <span className="pay-tag pay-tag--est" title={title}>
      est.
    </span>
  );
}

/**
 * The payment block on an account tile. Lives outside the tile's Link so its
 * buttons never navigate. Renders a placeholder while payments load and
 * nothing when the account has no payment row (or the query failed).
 */
export function AccountPayment({ row, pending, onEdit }: { row: PaymentRow | undefined; pending: boolean; onEdit: (id: string) => void }) {
  if (!row) {
    return pending ? (
      <div className="account-pay account-pay--loading" aria-hidden="true">
        <Skeleton width="45%" />
        <Skeleton width="80%" />
      </div>
    ) : null;
  }
  const name = accountName(row);
  if (!row.has_terms) {
    return (
      <div className="account-pay account-pay--empty" data-testid="account-pay">
        <p className="account-pay__empty">No payment info yet</p>
        <Button size="sm" variant="secondary" icon="plus" className="account-pay__add" onClick={() => onEdit(row.id)} aria-label={`Add payment details for ${name}`}>
          Add payment info
        </Button>
      </div>
    );
  }
  const tip = sourceTooltip(row) || undefined;
  const meta = [row.apr ? `${row.apr} APR` : null, row.autopay === "unknown" ? null : `Autopay ${row.autopay === "yes" ? "on" : "off"}`].filter(Boolean);
  const none = row.status === "none";
  const status = none ? null : paymentStatus(row);
  const tone = none ? "none" : (status?.tone ?? "neutral");
  const chip = relativeDue(row);
  const edit = (
    <Button size="sm" variant="ghost" icon="edit" className="account-pay__edit" onClick={() => onEdit(row.id)} aria-label={`Edit payment details for ${name}`}>
      Edit
    </Button>
  );
  return (
    <div className={`account-pay account-pay--${tone}`} title={tip} data-testid="account-pay">
      <div className="account-pay__head">
        {none ? (
          <p className="account-pay__empty">
            <Icon name="check" size={15} />
            No payment due
          </p>
        ) : (
          <div className="account-pay__pills">
            {status ? (
              <span className={`pay-pill pay-pill--${status.tone}`} title={status.title}>
                {status.label}
              </span>
            ) : (
              <span className="account-pay__kicker">Payment</span>
            )}
            {row.unverified ? (
              <span className="pay-tag pay-tag--warn" title="Not confirmed against a statement">
                unverified
              </span>
            ) : null}
          </div>
        )}
        {edit}
      </div>
      {none ? null : (
        <dl className="account-pay__stats">
          <div className="account-pay__stat">
            <dt>Min due</dt>
            <dd>
              <span className="account-pay__value">{row.min_payment_cents === null ? "—" : tileMoney(row.min_payment_cents)}</span>
              {row.estimated && row.stored_min_cents === null && row.min_payment_cents !== null ? <EstTag title="Estimated minimum payment" /> : null}
            </dd>
          </div>
          <div className="account-pay__stat">
            <dt>{row.status === "paid" ? "Next due" : "Due"}</dt>
            <dd>
              <span className="account-pay__value">{row.effective_due_date ? formatDate(row.effective_due_date, { year: false }) : "—"}</span>
              {row.effective_due_date && (row.rolled || row.estimated) ? <EstTag title="Estimated due date" /> : null}
              {chip && row.effective_due_date ? <span className={`pay-chip pay-chip--${row.status === "paid" ? "neutral" : tone}`}>{chip}</span> : null}
            </dd>
          </div>
        </dl>
      )}
      {meta.length ? <p className="account-pay__meta">{meta.join(" · ")}</p> : null}
    </div>
  );
}
