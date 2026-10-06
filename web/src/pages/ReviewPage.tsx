import { useEffect, useMemo, useRef, useState } from "react";
import { useReview } from "../api/queries";
import type { ReviewRow } from "../api/types";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { categoryOptions, tagOptions } from "../components/ClassifyControls";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { RuleDrawer, type RuleSeed } from "../components/RuleDrawer";
import { SearchableSelect } from "../components/SearchableSelect";
import { Select } from "../components/Select";
import { SkeletonCard } from "../components/Skeleton";
import { TransactionDrawer } from "../components/TransactionDrawer";
import { useBulkClassify, useClassify } from "../hooks/useClassify";
import { useHotkeys } from "../hooks/useHotkeys";
import { useSessionData } from "../hooks/useSession";
import { useUrlState } from "../hooks/useUrlState";
import { cx } from "../lib/cx";
import { formatDate, pluralize } from "../lib/format";
import { lockedCategory, tagLabel } from "../lib/labels";
import { defaultBusiness, fallbackCategory } from "../lib/siteConfig";
import { BulkBar } from "./TransactionsPage";

interface Draft {
  tag: string;
  category: string;
}

function initialDraft(row: ReviewRow, fallback: string): Draft {
  const s = row.suggestion;
  if (s && s.tag) return { tag: s.tag, category: s.category };
  const category = row.category && row.category !== "Uncategorized" ? row.category : fallback;
  return { tag: defaultBusiness(), category };
}

export default function ReviewPage() {
  const session = useSessionData();
  const url = useUrlState();
  const year = url.get("year");
  const years = Array.from(new Set(session.months.map((month) => month.slice(0, 4))));
  const query = useReview({ year });
  const classify = useClassify();
  const bulk = useBulkClassify();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTxn, setOpenTxn] = useState<string | null>(null);
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => setDone(new Set()), [query.data]);
  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) => !done.has(row.id)), [query.data, done]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);
  useEffect(() => {
    const node = list.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const draftFor = (row: ReviewRow) => drafts[row.id] ?? initialDraft(row, fallbackCategory(session));
  const setDraft = (row: ReviewRow, next: Partial<Draft>) => setDrafts((all) => ({ ...all, [row.id]: { ...draftFor(row), ...next } }));

  const accept = (row: ReviewRow | undefined, withRule = false) => {
    if (!row) return;
    const draft = draftFor(row);
    const category = lockedCategory(draft.tag) ?? draft.category;
    if (withRule) {
      setRuleSeed({ txnId: row.id, name: row.name, pattern: row.suggestion?.pattern ?? "", tag: draft.tag, category, note: row.note });
      return;
    }
    setDone((prev) => new Set(prev).add(row.id));
    classify.mutate(
      { txn_id: row.id, tag: draft.tag, category, note: row.note },
      {
        onError: () =>
          setDone((prev) => {
            const next = new Set(prev);
            next.delete(row.id);
            return next;
          }),
      },
    );
  };

  const busy = Boolean(openTxn || ruleSeed);
  useHotkeys(
    {
      j: () => setActive((index) => Math.min(rows.length - 1, index + 1)),
      arrowdown: () => setActive((index) => Math.min(rows.length - 1, index + 1)),
      k: () => setActive((index) => Math.max(0, index - 1)),
      arrowup: () => setActive((index) => Math.max(0, index - 1)),
      enter: () => accept(rows[active]),
      "shift+enter": () => accept(rows[active], true),
      e: () => {
        const select = list.current?.children[active]?.querySelector("select");
        (select as HTMLSelectElement | null)?.focus();
      },
      o: () => rows[active] && setOpenTxn(rows[active].id),
      x: () => {
        const row = rows[active];
        if (!row) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
      },
    },
    !busy,
  );

  const total = query.data?.count ?? 0;
  const progress = total === 0 ? 100 : Math.round(((total - rows.length) / total) * 100);

  return (
    <div className="page page--review">
      <PageHeader
        title="Review inbox"
        subtitle={query.data ? (rows.length ? `${pluralize(rows.length, "transaction")} to classify, largest first` : "Nothing waiting") : "Loading…"}
        actions={
          <>
            {rows.length ? (
              <span className="kbd-legend hide-mobile" aria-label="Keyboard shortcuts">
                <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> accept · <kbd>⇧ Enter</kbd> + rule · <kbd>e</kbd> edit · <kbd>x</kbd> select · <kbd>o</kbd> details
              </span>
            ) : null}
            <Select
              label="Year"
              hideLabel
              size="sm"
              value={year}
              onChange={(value) => url.patch({ year: value })}
              options={[{ value: "", label: "All years" }, ...years.map((value) => ({ value, label: value }))]}
            />
          </>
        }
      />
      {total > 0 ? (
        <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Review progress">
          <span className="progress__bar" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          busy={bulk.isPending}
          onClear={() => setSelected(new Set())}
          onApply={(tag, category) => {
            const ids = Array.from(selected);
            setDone((prev) => new Set([...prev, ...ids]));
            bulk.mutate({ txn_ids: ids, tag, category }, { onSuccess: () => setSelected(new Set()), onError: () => setDone(new Set()) });
          }}
        />
      ) : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isPending ? (
        <div className="review-list">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} height={70} />
          ))}
        </div>
      ) : rows.length === 0 && !query.isError ? (
        <EmptyState icon="check" tone="success" title="Inbox zero">
          Every transaction has a business and a category. New imports that no rule recognizes will show up here.
        </EmptyState>
      ) : (
        <ol className="review-list" ref={list} aria-label="Transactions to review">
          {rows.map((row, index) => {
            const draft = draftFor(row);
            const locked = lockedCategory(draft.tag);
            const suggestion = row.suggestion && row.suggestion.tag ? row.suggestion : null;
            return (
              <li key={row.id} className={cx("review-card", index === active && "is-active", selected.has(row.id) && "is-selected")} onClick={() => setActive(index)} aria-current={index === active ? "true" : undefined}>
                <div className="review-card__main">
                  <label className="review-card__check">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} aria-label={`Select ${row.name}`} />
                  </label>
                  <div className="review-card__text">
                    <p className="review-card__name" title={row.name}>{row.name || "(no description)"}</p>
                    <p className="review-card__meta muted small">
                      {formatDate(row.date)} · {row.account_name}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                    {suggestion ? (
                      <p className="review-card__suggestion">
                        <Icon name="sparkles" size={14} /> Suggested <strong>{tagLabel(suggestion.tag)} · {suggestion.category}</strong>
                        <span className="muted small"> — {suggestion.reason}</span>
                      </p>
                    ) : (
                      <p className="review-card__suggestion muted small">No suggestion yet. Pick a business and category.</p>
                    )}
                  </div>
                  <Money cents={row.amount_cents} colorPositive className="review-card__amount" />
                </div>
                <div className="review-card__actions">
                  <Select label={`Business for ${row.name}`} hideLabel size="sm" value={draft.tag} onChange={(tag) => setDraft(row, { tag })} options={tagOptions(session, false)} />
                  <SearchableSelect label={`Category for ${row.name}`} hideLabel size="sm" value={locked ?? draft.category} disabled={Boolean(locked)} onChange={(category) => setDraft(row, { category })} options={categoryOptions(session)} />
                  <Button variant="primary" size="sm" icon="check" onClick={() => accept(row)}>
                    Accept
                  </Button>
                  <Button size="sm" icon="wand" onClick={() => accept(row, true)}>
                    <span className="hide-mobile">Accept +</span> rule
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setOpenTxn(row.id)}>
                    Details
                  </Button>
                  {suggestion && suggestion.confidence >= 0.8 ? <Badge tone="pos">Strong match</Badge> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <TransactionDrawer txnId={openTxn} onClose={() => setOpenTxn(null)} onCreateRule={(seed) => { setOpenTxn(null); setRuleSeed(seed); }} />
      <RuleDrawer seed={ruleSeed} onClose={() => setRuleSeed(null)} />
    </div>
  );
}
