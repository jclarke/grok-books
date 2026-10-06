import { useEffect, useState } from "react";
import { useTransaction } from "../api/queries";
import { Badge, TagBadge } from "./Badge";
import { Button } from "./Button";
import { categoryOptions, tagOptions } from "./ClassifyControls";
import { ErrorState } from "./EmptyState";
import { Drawer } from "./Modal";
import { Money } from "./MoneyCell";
import { SearchableSelect } from "./SearchableSelect";
import { Select, TextField } from "./Select";
import { SkeletonText } from "./Skeleton";
import { useClassify } from "../hooks/useClassify";
import { useSessionData } from "../hooks/useSession";
import { formatDate, formatTimestamp } from "../lib/format";
import { lockedCategory, SOURCE_LABELS } from "../lib/labels";
import type { RuleSeed } from "./RuleDrawer";

export function TransactionDrawer({ txnId, onClose, onCreateRule }: { txnId: string | null; onClose: () => void; onCreateRule: (seed: RuleSeed) => void }) {
  const session = useSessionData();
  const query = useTransaction(txnId);
  const classify = useClassify();
  const txn = query.data;
  const [tag, setTag] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!txn) return;
    setTag(txn.business_tag);
    setCategory(txn.category || "Uncategorized");
    setNote(txn.note);
  }, [txn]);
  const locked = lockedCategory(tag);
  const dirty = txn && (tag !== txn.business_tag || (locked ?? category) !== (txn.category || "Uncategorized") || note !== txn.note);

  return (
    <Drawer
      open={txnId !== null}
      onClose={onClose}
      title={txn ? txn.name || "Transaction" : "Transaction"}
      description={txn ? `${formatDate(txn.date)} · ${txn.account_name}` : undefined}
      footer={
        txn ? (
          <>
            <Button
              variant="ghost"
              icon="wand"
              onClick={() => onCreateRule({ txnId: txn.id, name: txn.name, pattern: txn.suggested_pattern, tag, category: locked ?? category, note })}
            >
              Create rule from this
            </Button>
            <Button
              variant="primary"
              disabled={!dirty}
              loading={classify.isPending}
              onClick={() => classify.mutate({ txn_id: txn.id, tag, category: locked ?? category, note }, { onSuccess: onClose })}
            >
              Save
            </Button>
          </>
        ) : null
      }
    >
      {query.isPending ? <SkeletonText lines={6} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} compact /> : null}
      {txn ? (
        <div className="form-stack">
          <div className="txn-hero">
            <Money cents={txn.amount_cents} colorPositive className="txn-hero__amount" />
            <div className="txn-hero__badges">
              <TagBadge tag={txn.business_tag} />
              {txn.source ? <Badge tone="neutral">{SOURCE_LABELS[txn.source] ?? txn.source}</Badge> : null}
              {txn.status !== "active" ? <Badge tone="warn">{txn.status}</Badge> : null}
              {txn.pending ? <Badge tone="warn">Pending</Badge> : null}
            </div>
          </div>
          <div className="form-row">
            <Select label="Business" value={tag} onChange={setTag} options={tagOptions(session)} />
            <SearchableSelect label="Category" value={locked ?? category} onChange={setCategory} disabled={Boolean(locked)} options={categoryOptions(session)} />
          </div>
          <TextField label="Note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          <dl className="details">
            <div><dt>Merchant</dt><dd>{txn.merchant_name || "—"}</dd></div>
            <div><dt>Description</dt><dd>{txn.description || "—"}</dd></div>
            <div><dt>Bank category</dt><dd>{bankCategory(txn.provider_category)}</dd></div>
            <div><dt>ID</dt><dd className="mono">{txn.id}</dd></div>
          </dl>
          {txn.history.length > 0 ? (
            <section>
              <h3 className="section-title">History</h3>
              <ol className="history">
                {txn.history.map((item) => (
                  <li key={item.id}>
                    <span className="history__when">{formatTimestamp(item.ts)}</span>
                    <span className="history__what">
                      {item.action.replace("_", " ")} by {item.actor ?? "—"}
                      {item.new_value ? <span className="muted"> → {item.new_value.split("|").slice(0, 2).join(" · ")}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

/** Provider categories arrive as text or as a small JSON object ({"primary", "detailed", …}). */
function bankCategory(raw: string): string {
  if (!raw) return "—";
  try {
    const value = JSON.parse(raw) as { primary?: string; detailed?: string };
    const parts = [value.primary, value.detailed && value.primary && value.detailed.startsWith(value.primary) ? value.detailed.slice(value.primary.length + 1) : value.detailed]
      .filter(Boolean)
      .map((part) => String(part).replace(/_/g, " ").toLowerCase());
    return parts.length ? parts.join(" › ") : raw;
  } catch {
    return raw;
  }
}
