import { useEffect, useMemo, useState } from "react";
import { useTransactions } from "../api/queries";
import { exportUrl } from "../api/client";
import type { Txn } from "../api/types";
import { Badge, TagBadge } from "../components/Badge";
import { Button, IconButton } from "../components/Button";
import { categoryOptions, InlineClassify, tagOptions } from "../components/ClassifyControls";
import { DataTable, type Column, type SortState } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { Popover } from "../components/Popover";
import { RuleDrawer, type RuleSeed } from "../components/RuleDrawer";
import { SavedViews } from "../components/SavedViews";
import { SearchableSelect } from "../components/SearchableSelect";
import { Select, TextField } from "../components/Select";
import { TransactionDrawer } from "../components/TransactionDrawer";
import { useBulkClassify } from "../hooks/useClassify";
import { useDebounce } from "../hooks/useDebounce";
import { useGlobalFilters } from "../hooks/useGlobalFilters";
import { useSessionData } from "../hooks/useSession";
import { useUrlState } from "../hooks/useUrlState";
import { formatDate, formatRange, pluralize } from "../lib/format";
import { businessLabel, lockedCategory } from "../lib/labels";
import { defaultBusiness, fallbackCategory } from "../lib/siteConfig";

const FILTER_KEYS = ["search", "vendor", "account", "tag", "category", "status", "min_amount", "max_amount", "needs_review", "sort", "dir"];

export default function TransactionsPage() {
  const session = useSessionData();
  const filters = useGlobalFilters();
  const url = useUrlState();
  const [searchText, setSearchText] = useState(url.get("search"));
  const debouncedSearch = useDebounce(searchText, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleSeed, setRuleSeed] = useState<RuleSeed | null>(null);

  useEffect(() => {
    if (debouncedSearch !== url.get("search")) url.patch({ search: debouncedSearch }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  useEffect(() => {
    setSearchText(url.get("search"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.params.get("search")]);

  const sort: SortState = { key: url.get("sort", "date"), dir: (url.get("dir", "desc") as "asc" | "desc") };
  const limit = Number(url.get("limit", "100")) || 100;
  const offset = Number(url.get("offset", "0")) || 0;
  const apiParams = {
    start: filters.start,
    end: filters.end,
    business: filters.business,
    search: url.get("search"),
    vendor: url.get("vendor"),
    account: url.get("account"),
    tag: url.get("tag"),
    category: url.get("category"),
    status: url.get("status", "active"),
    min_amount: url.get("min_amount"),
    max_amount: url.get("max_amount"),
    needs_review: url.get("needs_review") === "1",
    sort: sort.key,
    dir: sort.dir,
    offset,
    limit,
  };
  const query = useTransactions(apiParams);
  const bulk = useBulkClassify();
  const txnId = url.get("txn") || null;

  useEffect(() => setSelected(new Set()), [filters.start, filters.end, filters.business, url.params.toString().replace(/(&|^)txn=[^&]*/, "")]);

  const activeFilters = FILTER_KEYS.filter((key) => key !== "sort" && key !== "dir" && url.get(key)).length;
  const filterQuery = useMemo(() => {
    const out = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = url.get(key);
      if (value) out.set(key, value);
    }
    return out.toString();
  }, [url]);

  const columns: Column<Txn>[] = [
    { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true, width: "112px", hideOnMobile: true },
    {
      key: "name",
      header: "Description",
      accessor: (row) => row.name,
      sortable: true,
      cell: (row) => (
        <div className="txn-desc">
          <span className="txn-desc__name" title={row.name}>
            {row.name || <span className="muted">(no description)</span>}
          </span>
          <span className="txn-desc__meta">
            <span className="show-mobile">{formatDate(row.date, { year: false })} · {row.account_name}</span>
            <span className="show-mobile">
              <TagBadge tag={row.business_tag} />
            </span>
            {row.note ? <span title={row.note}>{row.note}</span> : null}
            {row.pending ? <Badge tone="warn">Pending</Badge> : null}
            {row.status !== "active" ? <Badge tone="neutral">{row.status}</Badge> : null}
          </span>
        </div>
      ),
    },
    { key: "account", header: "Account", accessor: (row) => row.account_name, sortable: true, hideOnMobile: true, width: "104px", className: "hide-narrow" },
    {
      key: "tag",
      header: "Business",
      accessor: (row) => row.business_tag,
      sortable: true,
      width: "160px",
      hideOnMobile: true,
      cell: (row) => <InlineClassify txnId={row.id} tag={row.business_tag} category={row.category} note={row.note} label={row.name} part="tag" />,
    },
    {
      key: "category",
      header: "Category",
      accessor: (row) => row.category,
      sortable: true,
      width: "200px",
      hideOnMobile: true,
      cell: (row) => <InlineClassify txnId={row.id} tag={row.business_tag} category={row.category} note={row.note} label={row.name} part="category" />,
    },
    { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money-signed", sortable: true, width: "120px" },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      align: "right",
      cell: (row) => (
        <IconButton
          icon="wand"
          size="sm"
          label={`Create rule from ${row.name}`}
          onClick={() =>
            setRuleSeed({ txnId: row.id, name: row.name, pattern: "", tag: row.business_tag, category: row.category, note: row.note })
          }
        />
      ),
    },
  ];

  const data = query.data;
  return (
    <div className="page">
      <PageHeader
        title="Transactions"
        subtitle={
          <>
            {formatRange(filters.start, filters.end)} · {businessLabel(filters.business)}
            {data ? <span className="muted"> · {pluralize(data.total, "transaction")}</span> : null}
          </>
        }
        actions={
          <>
            <SavedViews storageKey="hpb-saved-transactions" currentQuery={filterQuery} onApply={(saved) => {
              const values = new URLSearchParams(saved);
              url.patch(Object.fromEntries(FILTER_KEYS.map((key) => [key, values.get(key)])));
              setSearchText(values.get("search") ?? "");
            }} />
            <a
              className="btn btn--secondary btn--md"
              href={exportUrl("/export/transactions.csv", { ...apiParams, offset: undefined, limit: undefined, needs_review: apiParams.needs_review ? "1" : undefined })}
              download
            >
              <Icon name="download" size={17} /> <span className="hide-mobile">Export CSV</span>
            </a>
          </>
        }
      />

      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="txn-search">
            Search transactions
          </label>
          <input
            id="txn-search"
            className="input"
            type="search"
            placeholder="Search name, merchant, or id"
            value={searchText}
            maxLength={200}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <Select
          label="Account"
          hideLabel
          value={url.get("account")}
          onChange={(value) => url.patch({ account: value })}
          options={[{ value: "", label: "All accounts" }, ...session.accounts.map((acct) => ({ value: acct.id, label: acct.short_name }))]}
        />
        <Select
          label="Business tag"
          hideLabel
          value={url.get("tag")}
          onChange={(value) => url.patch({ tag: value })}
          options={[{ value: "", label: "All tags" }, ...tagOptions(session)]}
        />
        <SearchableSelect
          label="Category"
          hideLabel
          value={url.get("category")}
          onChange={(value) => url.patch({ category: value })}
          options={[{ value: "", label: "All categories" }, ...categoryOptions(session)]}
        />
        <MoreFilters
          values={{ status: url.get("status", "active"), min: url.get("min_amount"), max: url.get("max_amount"), review: url.get("needs_review") === "1" }}
          onApply={(next) => url.patch({ status: next.status === "active" ? "" : next.status, min_amount: next.min, max_amount: next.max, needs_review: next.review ? "1" : "" })}
        />
        {activeFilters > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              url.patch(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "sort" && k !== "dir").map((key) => [key, null])));
              setSearchText("");
            }}
          >
            Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
          </Button>
        ) : null}
        {url.get("vendor") ? (
          <Badge tone="info">
            Vendor {url.get("vendor")}
          </Badge>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          busy={bulk.isPending}
          onClear={() => setSelected(new Set())}
          onApply={(tag, category) =>
            bulk.mutate({ txn_ids: Array.from(selected), tag, category }, { onSuccess: () => setSelected(new Set()) })
          }
        />
      ) : null}

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          caption="Transactions"
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.id}
          loading={query.isPending}
          sort={sort}
          onSortChange={(next) => url.patch({ sort: next.key === "date" && next.dir === "desc" ? "" : next.key, dir: next.key === "date" && next.dir === "desc" ? "" : next.dir })}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(row) => url.patch({ txn: row.id }, { resetOffset: false })}
          keyboard={!txnId && !ruleSeed}
          rowClassName={(row) => (row.business_tag === "needs_review" ? "row--attention" : undefined)}
          pagination={data ? { offset, limit, total: data.total, onChange: (next) => url.patch({ offset: next || null }), onLimitChange: (next) => url.patch({ limit: next === 100 ? null : next }) } : undefined}
          empty={
            <EmptyState icon="search" title="No transactions match" compact action={activeFilters ? <Button size="sm" onClick={() => { url.patch(Object.fromEntries(FILTER_KEYS.map((key) => [key, null]))); setSearchText(""); }}>Clear filters</Button> : undefined}>
              Try a wider date range or fewer filters.
            </EmptyState>
          }
          footer={
            data && data.rows.length > 0 ? (
              <tr className="table__summary">
                <td colSpan={columns.length + 1}>
                  <div className="table__summary-row">
                    <span>This page · {pluralize(data.rows.length, "row")}</span>
                    <span className="num">
                      In <Money cents={data.page_in_cents} colorPositive /> · Out <Money cents={-data.page_out_cents} /> · Net{" "}
                      <Money cents={data.page_in_cents - data.page_out_cents} colorPositive signed />
                    </span>
                  </div>
                </td>
              </tr>
            ) : undefined
          }
        />
      )}

      <TransactionDrawer
        txnId={txnId}
        onClose={() => url.patch({ txn: null }, { resetOffset: false })}
        onCreateRule={(seed) => {
          url.patch({ txn: null }, { resetOffset: false });
          setRuleSeed(seed);
        }}
      />
      <RuleDrawer seed={ruleSeed} onClose={() => setRuleSeed(null)} />
    </div>
  );
}

function MoreFilters({ values, onApply }: { values: { status: string; min: string; max: string; review: boolean }; onApply: (next: { status: string; min: string; max: string; review: boolean }) => void }) {
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [values.status, values.min, values.max, values.review]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (values.status !== "active" ? 1 : 0) + (values.min ? 1 : 0) + (values.max ? 1 : 0) + (values.review ? 1 : 0);
  return (
    <Popover
      label="More filters"
      align="right"
      trigger={({ open, toggle, ref }) => (
        <Button ref={ref} icon="filter" aria-expanded={open} onClick={toggle}>
          More{count ? <span className="pill-count">{count}</span> : null}
        </Button>
      )}
    >
      {(close) => (
        <form
          className="more-filters"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draft);
            close();
          }}
        >
          <Select
            label="Status"
            value={draft.status}
            onChange={(status) => setDraft({ ...draft, status })}
            options={[
              { value: "active", label: "Active" },
              { value: "superseded", label: "Superseded" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="form-row">
            <TextField label="Min amount" inputMode="decimal" placeholder="-500.00" value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} inputSize="sm" />
            <TextField label="Max amount" inputMode="decimal" placeholder="0.00" value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} inputSize="sm" />
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.review} onChange={(event) => setDraft({ ...draft, review: event.target.checked })} /> Needs review only
          </label>
          <p className="muted small">Money out is negative. “-50 to 0” finds small charges.</p>
          <div className="more-filters__actions">
            <Button variant="ghost" size="sm" onClick={() => setDraft({ status: "active", min: "", max: "", review: false })}>
              Reset
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Apply
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}

export function BulkBar({ count, busy, onApply, onClear }: { count: number; busy: boolean; onApply: (tag: string, category: string) => void; onClear: () => void }) {
  const session = useSessionData();
  const [tag, setTag] = useState(defaultBusiness);
  const [category, setCategory] = useState(() => fallbackCategory(session));
  const locked = lockedCategory(tag);
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk classify">
      <span className="bulk-bar__count">
        <strong>{count}</strong> selected
      </span>
      <Select label="Business for selected" hideLabel size="sm" value={tag} onChange={setTag} options={tagOptions(session, false)} />
      <SearchableSelect label="Category for selected" hideLabel size="sm" value={locked ?? category} onChange={setCategory} disabled={Boolean(locked)} options={categoryOptions(session)} />
      <Button variant="primary" size="sm" icon="check" loading={busy} onClick={() => onApply(tag, locked ?? category)}>
        Classify {count}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

