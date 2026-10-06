import { useEffect, useState } from "react";
import { useRulePreview, useTransaction } from "../api/queries";
import { Badge, TagBadge } from "./Badge";
import { Button } from "./Button";
import { categoryOptions, tagOptions } from "./ClassifyControls";
import { Drawer } from "./Modal";
import { Money } from "./MoneyCell";
import { SearchableSelect } from "./SearchableSelect";
import { Select, TextField } from "./Select";
import { useClassify } from "../hooks/useClassify";
import { useDebounce } from "../hooks/useDebounce";
import { useSessionData } from "../hooks/useSession";
import { formatDate, pluralize } from "../lib/format";
import { lockedCategory } from "../lib/labels";
import { defaultBusiness, fallbackCategory } from "../lib/siteConfig";

export interface RuleSeed {
  txnId: string;
  name: string;
  pattern: string;
  tag: string;
  category: string;
  note?: string;
}

/**
 * "Create rule from this": classify the row and save a rule that applies the
 * same tag and category to every matching non-manual transaction.
 */
export function RuleDrawer({ seed, onClose }: { seed: RuleSeed | null; onClose: () => void }) {
  const session = useSessionData();
  const classify = useClassify();
  const [pattern, setPattern] = useState("");
  const [tag, setTag] = useState(defaultBusiness);
  const [category, setCategory] = useState(() => fallbackCategory(session));
  const [note, setNote] = useState("");
  // Without a pattern from the caller, use the server's suggestion (the same one the CLI uses).
  const detail = useTransaction(seed && !seed.pattern ? seed.txnId : null);
  useEffect(() => {
    if (seed && !seed.pattern && detail.data?.id === seed.txnId) setPattern(detail.data.suggested_pattern);
  }, [seed, detail.data]);
  useEffect(() => {
    if (!seed) return;
    setPattern(seed.pattern);
    setTag(seed.tag === "needs_review" ? defaultBusiness() : seed.tag);
    setCategory(seed.category && seed.category !== "Uncategorized" ? seed.category : fallbackCategory(session));
    setNote(seed.note ?? "");
  }, [seed]);
  const debounced = useDebounce(pattern, 250);
  const preview = useRulePreview(seed ? debounced : "");
  const locked = lockedCategory(tag);
  const invalid = preview.isError ? (preview.error instanceof Error ? preview.error.message : "Invalid pattern") : null;

  const submit = () => {
    if (!seed) return;
    classify.mutate(
      { txn_id: seed.txnId, tag, category: locked ?? category, note, save_rule: true, pattern },
      { onSuccess: onClose },
    );
  };

  return (
    <Drawer
      open={seed !== null}
      onClose={onClose}
      title="Create a rule"
      description={seed ? <>From “{seed.name}”. Matching rows get this tag and category; manual edits are never overwritten.</> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="wand" onClick={submit} loading={classify.isPending} disabled={!pattern.trim() || Boolean(invalid)}>
            Save rule{preview.data ? ` · ${pluralize(Math.max(0, preview.data.count - preview.data.manual), "match", "matches")}` : ""}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <TextField
          label="Pattern (case-insensitive regular expression)"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          maxLength={200}
          spellCheck={false}
          className="mono-field"
          error={invalid}
          hint="Matched against the name, merchant, and description."
        />
        <div className="form-row">
          <Select label="Business" value={tag} onChange={setTag} options={tagOptions(session, false)} />
          <SearchableSelect label="Category" value={locked ?? category} onChange={setCategory} disabled={Boolean(locked)} options={categoryOptions(session)} />
        </div>
        <TextField label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        <section className="rule-preview" aria-live="polite">
          <h3 className="rule-preview__title">
            Preview{" "}
            {preview.data ? (
              <Badge tone="info">{pluralize(preview.data.count, "match", "matches")}</Badge>
            ) : null}
            {preview.data && preview.data.manual > 0 ? <Badge tone="neutral">{preview.data.manual} manual, kept as is</Badge> : null}
          </h3>
          {preview.data && preview.data.sample.length > 0 ? (
            <ul className="rule-preview__list">
              {preview.data.sample.map((row) => (
                <li key={row.id}>
                  <span className="rule-preview__name">{row.name}</span>
                  <span className="muted nowrap">{formatDate(row.date)}</span>
                  <TagBadge tag={row.business_tag} />
                  <Money cents={row.amount_cents} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{pattern.trim() ? (preview.isFetching ? "Checking…" : "No transactions match yet.") : "Enter a pattern to see what it matches."}</p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
