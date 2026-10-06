import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePersonalCategories, usePersonalTransactions, usePersonalWrite } from "../../api/personal";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { CategorySelect, CsvLink, PERSONAL_EYEBROW, PersonalLoadError, PersonalTxnTable } from "../../components/personal/PersonalKit";
import { useDebounce } from "../../hooks/useDebounce";
import { useGlobalFilters } from "../../hooks/useGlobalFilters";
import { useSession } from "../../hooks/useSession";
import { formatRange } from "../../lib/format";

const LIMIT = 100;
const FILTER_KEYS = ["search", "account", "category_id", "group", "tag", "merchant", "min_amount", "max_amount", "uncategorized", "pending", "transfers", "review", "sort", "dir"] as const;

export default function PersonalTransactionsPage() {
  const filters = useGlobalFilters();
  const [params, setParams] = useSearchParams();
  const { data: session } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const debounced = useDebounce(search, 250);
  const offset = Number(params.get("offset") ?? 0) || 0;
  const values = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const queryParams = useMemo(
    () => ({ ...values, search: debounced, start: filters.start, end: filters.end, sort: values.sort || "date", dir: values.dir || "desc", transfers: values.transfers || "show", offset, limit: LIMIT }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.toString(), debounced, filters.start, filters.end],
  );
  const query = usePersonalTransactions(queryParams);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<number | null>(null);
  const bulk = usePersonalWrite<{ txn_ids: string[]; category_id: number }>("/categorize/bulk");
  const set = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("offset");
      return next;
    });
  const clear = (keys: string[]) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of keys) next.delete(key);
      next.delete("offset");
      return next;
    });
  const categories = usePersonalCategories();
  const categoryName = values.category_id ? (categories.data?.rows.find((cat) => String(cat.id) === values.category_id)?.name ?? `#${values.category_id}`) : "";
  const chips = [
    values.category_id ? { key: "category_id", label: `Category: ${categoryName}`, name: `Clear category filter ${categoryName}` } : null,
    values.uncategorized === "1" ? { key: "uncategorized", label: "Uncategorized", name: "Clear uncategorized filter" } : null,
  ].filter((chip): chip is { key: string; label: string; name: string } => chip !== null);
  const accounts = session?.accounts ?? [];
  const data = query.data;
  const exportParams = { ...queryParams, offset: undefined, limit: undefined };
  return (
    <div className="page page--personal">
      <PageHeader
        title="Personal transactions"
        eyebrow={PERSONAL_EYEBROW}
        subtitle={formatRange(filters.start, filters.end)}
        actions={<CsvLink name="transactions" params={exportParams} />}
      />
      <Card className="filters" aria-label="Filters">
        <div className="filters__row">
          <label className="field">
            <span className="field__label">Search merchant, name, amount, note, tag</span>
            <input
              className="input"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                set("search", event.target.value);
              }}
            />
          </label>
          <Select label="Account" size="sm" value={values.account} onChange={(value) => set("account", value)} options={[{ value: "", label: "All accounts" }, ...accounts.map((acct) => ({ value: acct.id, label: acct.short_name }))]} />
          <CategorySelect label="Category" hideLabel={false} value={values.category_id ? Number(values.category_id) : null} placeholder="All categories" onChange={(id) => set("category_id", String(id))} />
          <Select
            label="Transfers"
            size="sm"
            value={values.transfers || "show"}
            onChange={(value) => set("transfers", value === "show" ? "" : value)}
            options={[
              { value: "show", label: "Shown" },
              { value: "hide", label: "Hidden" },
              { value: "only", label: "Only transfers" },
            ]}
          />
          <Select
            label="Status"
            size="sm"
            value={values.pending}
            onChange={(value) => set("pending", value)}
            options={[
              { value: "", label: "Posted and pending" },
              { value: "0", label: "Posted" },
              { value: "1", label: "Pending" },
            ]}
          />
        </div>
        <div className="filters__row">
          <label className="field">
            <span className="field__label">Tag</span>
            <input className="input input--sm" value={values.tag} onChange={(event) => set("tag", event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Min $</span>
            <input className="input input--sm" inputMode="decimal" value={values.min_amount} onChange={(event) => set("min_amount", event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Max $</span>
            <input className="input input--sm" inputMode="decimal" value={values.max_amount} onChange={(event) => set("max_amount", event.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={values.uncategorized === "1"} onChange={(event) => set("uncategorized", event.target.checked ? "1" : "")} /> Uncategorized only
          </label>
          <label className="check">
            <input type="checkbox" checked={values.review === "1"} onChange={(event) => set("review", event.target.checked ? "1" : "")} /> Needs review
          </label>
          <Select
            label="Sort"
            size="sm"
            value={`${values.sort || "date"}:${values.dir || "desc"}`}
            onChange={(value) => {
              const [sort, dir] = value.split(":");
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("sort", sort);
                next.set("dir", dir);
                return next;
              });
            }}
            options={[
              { value: "date:desc", label: "Newest first" },
              { value: "date:asc", label: "Oldest first" },
              { value: "amount:asc", label: "Largest outflow" },
              { value: "amount:desc", label: "Largest inflow" },
              { value: "merchant:asc", label: "Merchant A–Z" },
              { value: "category:asc", label: "Category A–Z" },
            ]}
          />
        </div>
      </Card>
      {chips.length ? (
        <div className="filter-chips" role="group" aria-label="Active filters">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="filter-chip" aria-label={chip.name} onClick={() => clear([chip.key])}>
              <span className="filter-chip__label">{chip.label}</span>
              <Icon name="close" size={14} />
            </button>
          ))}
          {chips.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => clear(chips.map((chip) => chip.key))}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {selected.size ? (
        <div className="bulk-bar" role="region" aria-label="Bulk categorize">
          <span>{selected.size} selected</span>
          <CategorySelect label="Category for selected" value={bulkCategory} placeholder="Choose a category…" onChange={setBulkCategory} />
          <Button
            variant="primary"
            size="sm"
            disabled={bulkCategory === null}
            loading={bulk.isPending}
            onClick={() =>
              bulkCategory !== null &&
              bulk.mutate(
                { txn_ids: [...selected].filter((id) => !id.startsWith("biz:")), category_id: bulkCategory },
                {
                  onSuccess: () => {
                    toast.toast({ tone: "success", title: `Categorized ${selected.size} transactions` });
                    setSelected(new Set());
                  },
                  onError: (error) => toast.toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
                },
              )
            }
          >
            Categorize {selected.size}
          </Button>
        </div>
      ) : null}
      {data ? (
        <p className="muted small" role="status">
          {data.total} transactions · in <Money cents={data.in_cents} colorPositive /> · out <Money cents={-data.out_cents} />
        </p>
      ) : null}
      <Card padded={false}>
        <PersonalTxnTable
          rows={data?.rows ?? []}
          loading={query.isPending}
          caption="Personal transactions"
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          pagination={data ? { offset, limit: LIMIT, total: data.total, onChange: (next) => set("offset", next ? String(next) : "") } : undefined}
        />
      </Card>
    </div>
  );
}
