import type { BalanceInfo } from "../api/types";
import { formatMoney } from "./format";

/** Real balance when the server sent one; otherwise the raw activity sum. */
export function shownCents(row: { balance_cents?: number | null; display_cents?: number | null }): number {
  if (row.display_cents !== undefined && row.display_cents !== null) return row.display_cents;
  return row.balance_cents ?? 0;
}

export function sourceLabel(source: string | null | undefined): string {
  if (source === "finance") return "Finance";
  if (source === "statement") return "statement";
  return source ?? "";
}

/** "Reconciles to $X" when the latest anchor matches, otherwise the gap. */
export function reconcilePhrase(row: BalanceInfo): string | null {
  if (!row.anchored) return null;
  const target = row.reconcile_cents ?? row.anchor_cents;
  if (row.drift_cents === null || row.drift_cents === undefined || row.drift_cents === 0) {
    if (target === null || target === undefined) return "Reconciles";
    return `Reconciles to ${formatMoney(target)}`;
  }
  const detail =
    row.anchor_cents === null || row.anchor_cents === undefined
      ? ""
      : ` (statement ${formatMoney(row.anchor_cents)}, computed ${formatMoney(row.computed_cents)})`;
  return `Reconciliation difference ${formatMoney(row.drift_cents)}${detail}`;
}
