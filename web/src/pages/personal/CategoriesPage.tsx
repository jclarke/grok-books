import { useEffect, useState } from "react";
import { useMerchants, usePersonalCategories as useCategoryRows, usePersonalRules, usePersonalWrite, useRulePreview, type PCategoryRow } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Select } from "../../components/Select";
import { SkeletonTable } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { CategorySelect, CsvLink, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { useDebounce } from "../../hooks/useDebounce";
import { Money } from "../../components/MoneyCell";
import { formatDate } from "../../lib/format";

type Tab = "categories" | "rules" | "merchants";

function useResult() {
  const toast = useToast();
  return (title: string) => ({
    onSuccess: () => toast.toast({ tone: "success" as const, title }),
    onError: (error: unknown) => toast.toast({ tone: "error" as const, title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
  });
}

export default function CategoriesPage() {
  const [tab, setTab] = useState<Tab>("categories");
  return (
    <div className="page page--personal">
      <PageHeader
        title="Categories & rules"
        eyebrow={PERSONAL_EYEBROW}
        subtitle="Personal categories, the rules that assign them, and merchant clean-up. Business rules are separate."
        actions={<CsvLink name={tab === "rules" ? "rules" : "categories"} />}
      />
      <SegmentedControl
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: "categories", label: "Categories" },
          { value: "rules", label: "Rules" },
          { value: "merchants", label: "Merchants" },
        ]}
      />
      {tab === "categories" ? <CategoriesTab /> : null}
      {tab === "rules" ? <RulesTab /> : null}
      {tab === "merchants" ? <MerchantsTab /> : null}
    </div>
  );
}

function CategoriesTab() {
  const query = useCategoryRows();
  const result = useResult();
  const create = usePersonalWrite<{ name: string; group_name: string; kind: string }>("/categories");
  const update = usePersonalWrite<{ id: number; name?: string; hidden?: boolean; color?: string }>((body) => `/categories/${body.id}`);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [kind, setKind] = useState("expense");
  const [renaming, setRenaming] = useState<Record<number, string>>({});
  const rows = query.data?.rows ?? [];
  return (
    <>
      <Card>
        <CardHeader title="Add a category" />
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            create.mutate({ name, group_name: group || name, kind }, { ...result("Category added"), onSettled: () => setName("") });
          }}
        >
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input input--sm" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Group</span>
            <input className="input input--sm" value={group} maxLength={60} onChange={(event) => setGroup(event.target.value)} list="pgroups" />
            <datalist id="pgroups">
              {Array.from(new Set(rows.map((row) => row.group))).map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
          <Select label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]} />
          <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </Card>
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <Card padded={false}>
        <DataTable<PCategoryRow>
          caption="Personal categories"
          loading={query.isPending}
          rows={rows}
          rowKey={(row) => String(row.id)}
          columns={[
            { key: "group", header: "Group", accessor: (row) => row.group, sortable: true },
            {
              key: "name",
              header: "Category",
              accessor: (row) => row.name,
              sortable: true,
              cell: (row) =>
                row.is_system ? (
                  <span>
                    {row.name} <Badge tone="neutral">system</Badge>
                  </span>
                ) : (
                  <form
                    className="inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = renaming[row.id];
                      if (next && next !== row.name) update.mutate({ id: row.id, name: next }, result("Renamed"));
                    }}
                  >
                    <input
                      className="input input--sm"
                      aria-label={`Name of ${row.name}`}
                      value={renaming[row.id] ?? row.name}
                      onChange={(event) => setRenaming((map) => ({ ...map, [row.id]: event.target.value }))}
                    />
                  </form>
                ),
            },
            { key: "kind", header: "Kind", accessor: (row) => row.kind },
            { key: "count", header: "Transactions", accessor: (row) => row.transaction_count, format: "number", align: "right", sortable: true },
            {
              key: "color",
              header: "Color",
              cell: (row) => (
                <input
                  type="color"
                  aria-label={`Color of ${row.name}`}
                  value={row.color || "#94a3b8"}
                  onChange={(event) => update.mutate({ id: row.id, color: event.target.value }, result("Color saved"))}
                />
              ),
            },
            {
              key: "hidden",
              header: "Shown",
              cell: (row) =>
                row.is_system ? null : (
                  <label className="check">
                    <input type="checkbox" checked={!row.hidden} onChange={(event) => update.mutate({ id: row.id, hidden: !event.target.checked }, result(event.target.checked ? "Shown" : "Hidden"))} />
                    <span className="sr-only">Show {row.name} in pickers</span>
                  </label>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}

function RulesTab() {
  const query = usePersonalRules();
  const result = useResult();
  const create = usePersonalWrite<Record<string, unknown>>("/rules");
  const toggle = usePersonalWrite<{ id: number; active: boolean }>((body) => `/rules/${body.id}/active`);
  const preview = useRulePreview();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [sign, setSign] = useState("");
  const debounced = useDebounce(pattern, 300);
  useEffect(() => {
    if (debounced.trim()) preview.mutate({ pattern: debounced, category_id: category, amount_sign: sign || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, category, sign]);
  return (
    <>
      <Card>
        <CardHeader title="New rule" subtitle="Regular expression, case-insensitive, matched against name and merchant" />
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pattern.trim() || category === null) return;
            create.mutate({ pattern, category_id: category, amount_sign: sign || null }, { ...result("Rule added and applied"), onSettled: () => setPattern("") });
          }}
        >
          <label className="field">
            <span className="field__label">Pattern</span>
            <input className="input input--sm" value={pattern} maxLength={200} onChange={(event) => setPattern(event.target.value)} />
          </label>
          <CategorySelect label="Rule category" hideLabel={false} value={category} placeholder="Category…" onChange={setCategory} />
          <Select label="Direction" size="sm" value={sign} onChange={setSign} options={[{ value: "", label: "Any" }, { value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
          <Button type="submit" size="sm" variant="primary" disabled={!pattern.trim() || category === null} loading={create.isPending}>
            Save rule
          </Button>
        </form>
        {pattern.trim() && preview.data ? (
          <div className="rule-preview" role="status">
            <p>
              <strong>{preview.data.count} matches</strong> in history · {preview.data.would_change} would change category · {preview.data.manual} manual (kept)
            </p>
            <ul className="class-list small">
              {preview.data.sample.map((row) => (
                <li key={row.id}>
                  <span>{formatDate(row.date)} {row.name}</span> <span className="muted">{row.category}</span> <Money cents={row.amount_cents} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview.isError ? <p className="text-neg small" role="alert">{preview.error instanceof Error ? preview.error.message : "Invalid pattern"}</p> : null}
      </Card>
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <Card padded={false}>
        {query.isPending ? <SkeletonTable rows={8} cols={5} /> : null}
        {query.data ? (
          <DataTable
            caption="Personal rules"
            rows={query.data.rows}
            rowKey={(row) => String(row.id)}
            pageSize={50}
            columns={[
              { key: "priority", header: "Priority", accessor: (row) => row.priority, align: "right", sortable: true },
              { key: "pattern", header: "Pattern", accessor: (row) => row.pattern, cell: (row) => <code className="small">{row.pattern}</code> },
              { key: "category", header: "Category", accessor: (row) => `${row.group} / ${row.category}`, sortable: true },
              { key: "sign", header: "Direction", accessor: (row) => row.amount_sign ?? "any", hideOnMobile: true },
              { key: "hits", header: "Hits", accessor: (row) => row.hits, format: "number", align: "right", sortable: true },
              {
                key: "active",
                header: "On",
                cell: (row) => (
                  <label className="check">
                    <input type="checkbox" checked={row.active} onChange={(event) => toggle.mutate({ id: row.id, active: event.target.checked }, result(event.target.checked ? "Rule enabled" : "Rule disabled"))} />
                    <span className="sr-only">Rule {row.id} active</span>
                  </label>
                ),
              },
            ]}
            empty={<EmptyState compact title="No personal rules" />}
          />
        ) : null}
      </Card>
    </>
  );
}

function MerchantsTab() {
  const query = useMerchants();
  const result = useResult();
  const rename = usePersonalWrite<{ key: string; display_name: string }>("/merchants/rename");
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <Card padded={false}>
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <DataTable
        caption="Merchant clean-up: raw spellings to display names"
        loading={query.isPending}
        rows={query.data?.rows ?? []}
        rowKey={(row) => row.key}
        pageSize={50}
        columns={[
          { key: "key", header: "Merchant key", accessor: (row) => row.key, sortable: true, cell: (row) => <code className="small">{row.key}</code> },
          { key: "spellings", header: "Raw spellings", accessor: (row) => row.spellings.join(" · "), hideOnMobile: true, cell: (row) => <span className="muted small">{row.spellings.join(" · ")}</span> },
          { key: "count", header: "Count", accessor: (row) => row.count, format: "number", align: "right", sortable: true },
          {
            key: "display",
            header: "Display name",
            accessor: (row) => row.display_name,
            cell: (row) => (
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = names[row.key];
                  if (next && next !== row.display_name) rename.mutate({ key: row.key, display_name: next }, result("Merchant renamed"));
                }}
              >
                <input className="input input--sm" aria-label={`Display name for ${row.key}`} value={names[row.key] ?? row.display_name} onChange={(event) => setNames((map) => ({ ...map, [row.key]: event.target.value }))} />
                {row.renamed ? <Badge tone="info">renamed</Badge> : null}
              </form>
            ),
          },
        ]}
      />
    </Card>
  );
}
