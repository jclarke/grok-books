import type { Session } from "../api/types";
import { SearchableSelect } from "./SearchableSelect";
import { Select, type SelectOption } from "./Select";
import { useClassify } from "../hooks/useClassify";
import { useSessionData } from "../hooks/useSession";
import { cx } from "../lib/cx";
import { lockedCategory, tagLabel, tagTone } from "../lib/labels";

export function tagOptions(session: Session, includeReview = true): SelectOption[] {
  return session.tags.filter((tag) => includeReview || tag !== "needs_review").map((tag) => ({ value: tag, label: tagLabel(tag) }));
}

export function categoryOptions(session: Session): SelectOption[] {
  const groups: [string, string[]][] = [
    ["Revenue", session.category_groups.revenue],
    ["Cost of revenue", session.category_groups.cogs],
    ["Operating expenses", session.category_groups.opex],
    ["Other", session.category_groups.other],
  ];
  return groups.flatMap(([group, list]) => list.map((category) => ({ value: category, label: category, group })));
}

export interface InlineClassifyProps {
  txnId: string;
  tag: string;
  category: string;
  note?: string;
  label: string;
  /** Show only the tag or only the category control. */
  part?: "tag" | "category" | "both";
}

/**
 * Compact tag/category selects for a table row. A change saves immediately
 * (optimistic) and offers Undo in a toast.
 */
export function InlineClassify({ txnId, tag, category, note, label, part = "both" }: InlineClassifyProps) {
  const session = useSessionData();
  const classify = useClassify();
  const locked = lockedCategory(tag);
  const save = (nextTag: string, nextCategory: string) => {
    const lockedNext = lockedCategory(nextTag);
    let finalCategory = lockedNext ?? nextCategory;
    if (!lockedNext && (finalCategory === "Owner Draw" || finalCategory === "Transfer")) finalCategory = "Uncategorized";
    if (!finalCategory) finalCategory = "Uncategorized";
    classify.mutate({ txn_id: txnId, tag: nextTag, category: finalCategory, note: note ?? "" });
  };
  return (
    <div className={cx("inline-classify", `inline-classify--${part}`)} data-no-row-click>
      {part !== "category" ? (
        <Select
          label={`Business tag for ${label}`}
          hideLabel
          size="sm"
          className={cx("inline-select", `inline-select--${tagTone(tag)}`)}
          value={tag}
          onChange={(value) => save(value, category)}
          options={tagOptions(session)}
        />
      ) : null}
      {part !== "tag" ? (
        <SearchableSelect
          label={`Category for ${label}`}
          hideLabel
          size="sm"
          className="inline-select"
          value={category || "Uncategorized"}
          disabled={Boolean(locked)}
          onChange={(value) => save(tag, value)}
          options={categoryOptions(session)}
        />
      ) : null}
    </div>
  );
}
