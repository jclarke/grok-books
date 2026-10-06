import { useEffect, useState } from "react";
import { usePersonalReview, usePersonalWrite, type PTxn } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SkeletonTable } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { CategorySelect, CsvLink, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { useHotkeys } from "../../hooks/useHotkeys";
import { cx } from "../../lib/cx";
import { formatDate, formatPct } from "../../lib/format";

export default function PersonalReviewPage() {
  const query = usePersonalReview();
  const rows = query.data?.rows ?? [];
  const toast = useToast();
  const [active, setActive] = useState(0);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const one = usePersonalWrite<{ txn_id: string; category_id: number }>("/categorize");
  const similar = usePersonalWrite<{ txn_id: string; category_id: number }>("/categorize/similar");
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);
  const pick = (row: PTxn) => choice[row.id] ?? row.suggestion?.category_id ?? null;
  const accept = (row: PTxn | undefined, all = false) => {
    if (!row) return;
    const category = pick(row);
    if (category === null) {
      toast.toast({ tone: "error", title: "Choose a category first" });
      return;
    }
    (all ? similar : one).mutate(
      { txn_id: row.id, category_id: category },
      {
        onSuccess: () => toast.toast({ tone: "success", title: all ? `Applied to every ${row.merchant}` : `${row.merchant} categorized` }),
        onError: (error) => toast.toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
      },
    );
  };
  useHotkeys({
    j: () => setActive((index) => Math.min(rows.length - 1, index + 1)),
    k: () => setActive((index) => Math.max(0, index - 1)),
    enter: () => accept(rows[active]),
    "shift+enter": () => accept(rows[active], true),
  });
  return (
    <div className="page page--personal">
      <PageHeader
        title="Personal review"
        eyebrow={PERSONAL_EYEBROW}
        subtitle="Uncategorized and low-confidence transactions, largest first. j/k to move, Enter to accept, Shift+Enter to apply to every transaction from that merchant."
        actions={<CsvLink name="review" />}
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <Card padded={false}>
        {query.isPending ? <SkeletonTable rows={6} cols={5} /> : null}
        {query.data && rows.length === 0 ? <EmptyState icon="check" tone="success" title="All caught up">Nothing needs review.</EmptyState> : null}
        {rows.length ? (
          <ul className="review-list" aria-label="Transactions to review">
            {rows.map((row, index) => (
              <li key={row.id} className={cx("review-item", index === active && "is-active")} aria-current={index === active ? "true" : undefined} onClick={() => setActive(index)}>
                <div className="review-item__main">
                  <span className="review-item__name">{row.merchant}</span>
                  <span className="muted small">
                    {formatDate(row.date)} · {row.account_label} · {row.name}
                  </span>
                  {row.suggestion ? (
                    <span className="small">
                      Suggested <strong>{row.suggestion.category}</strong> <span className="muted">({row.suggestion.reason}, {formatPct(row.suggestion.confidence * 100)})</span>
                    </span>
                  ) : (
                    <Badge tone="warn">no suggestion</Badge>
                  )}
                </div>
                <Money cents={row.amount_cents} colorPositive signed />
                <CategorySelect label={`Category for ${row.merchant}`} value={pick(row)} placeholder="Category…" onChange={(id) => setChoice((map) => ({ ...map, [row.id]: id }))} />
                <div className="row-actions">
                  <Button size="sm" variant="primary" onClick={() => accept(row)} aria-label={`Accept ${row.merchant}`}>
                    Accept
                  </Button>
                  {row.similar && row.similar > 1 ? (
                    <Button size="sm" onClick={() => accept(row, true)} aria-label={`Apply to all ${row.similar} ${row.merchant}`}>
                      Apply to similar ({row.similar})
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
