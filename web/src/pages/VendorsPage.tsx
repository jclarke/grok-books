import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import { useVendors } from "../api/queries";
import type { VendorRow } from "../api/types";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Modal } from "../components/Modal";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { TextField } from "../components/Select";
import { useToast } from "../components/Toast";
import { invalidateLedger } from "../hooks/useClassify";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { formatMoney, formatPct, formatRange } from "../lib/format";
import { businessLabel } from "../lib/labels";

export default function VendorsPage() {
  const filters = useGlobalFilters();
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const query = useVendors({ start: filters.start, end: filters.end, business: filters.business, limit: 500 });
  const data = query.data;
  const total = data?.total_spend_cents ?? 0;
  const rows = data?.rows ?? [];
  const picked = rows.filter((row) => selected.has(row.merchant));
  const merge = useVendorMerge();
  const unmerge = useVendorUnmerge();
  const rename = useVendorRename();

  const columns: Column<VendorRow>[] = [
    {
      key: "merchant",
      header: "Vendor",
      accessor: (row) => [row.merchant, ...(row.spellings ?? [])].join(" "),
      sortable: true,
      cell: (row) => (
        <div className="vendor-cell">
          <span className="vendor-cell__name">
            <span className="strong truncate" title={row.merchant}>{row.merchant}</span>
            {(row.alias_count ?? 0) > 1 ? (
              <button
                type="button"
                className="badge-button"
                data-no-row-click
                aria-expanded={expanded.has(row.merchant)}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(row.merchant)) next.delete(row.merchant);
                    else next.add(row.merchant);
                    return next;
                  })
                }
              >
                <Badge tone="info">{row.alias_count} spellings</Badge>
              </button>
            ) : null}
          </span>
          {expanded.has(row.merchant) ? (
            <ul className="vendor-spellings">
              {(row.spellings ?? []).map((spelling) => {
                const alias = (row.aliases ?? []).includes(spelling);
                return (
                  <li key={spelling} className="vendor-spelling">
                    <span className="truncate" title={spelling}>{spelling}</span>
                    {alias ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-no-row-click
                        loading={unmerge.isPending && unmerge.variables === spelling}
                        onClick={() => unmerge.mutate(spelling)}
                      >
                        Unmerge
                      </Button>
                    ) : (
                      <span className="muted small">canonical</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ),
    },
    { key: "category", header: "Usual category", accessor: (row) => row.category, sortable: true, hideOnMobile: true },
    { key: "count", header: "Charges", accessor: (row) => row.count, format: "number", sortable: true, hideOnMobile: true, width: "96px" },
    { key: "last_seen", header: "Last charge", accessor: (row) => row.last_seen, format: "date", sortable: true, hideOnMobile: true, width: "130px" },
    {
      key: "share",
      header: "Share",
      accessor: (row) => row.spend_cents,
      hideOnMobile: true,
      width: "150px",
      cell: (row) => (
        <span className="share-bar" title={formatPct(total ? (row.spend_cents / total) * 100 : 0)}>
          <span className="share-bar__track"><span className="share-bar__fill tone-exp" style={{ width: `${total ? Math.max(1, (row.spend_cents / total) * 100) : 0}%` }} /></span>
          <span className="num small">{formatPct(total ? (row.spend_cents / total) * 100 : 0)}</span>
        </span>
      ),
    },
    { key: "spend", header: "Spend", accessor: (row) => row.spend_cents, format: "money", sortable: true, width: "130px" },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Vendors"
        subtitle={<>Spend by merchant · {formatRange(filters.start, filters.end)} · {businessLabel(filters.business)}</>}
        actions={
          <>
            <Button size="sm" variant="ghost" disabled={picked.length !== 1} onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button size="sm" disabled={picked.length < 2} onClick={() => setMerging(true)}>
              Merge…
            </Button>
          </>
        }
      />
      <section className="kpi-grid kpi-grid--3" aria-label="Vendor totals">
        <KpiCard label="Total spend" cents={total} loading={!data} footer={<span className="muted">Transfers and owner draws excluded</span>} />
        <KpiCard label="Vendors" display={data ? data.vendor_count.toLocaleString("en-US") : ""} loading={!data} />
        <KpiCard label="Largest vendor" display={data?.rows[0]?.merchant ?? "—"} loading={!data} footer={data?.rows[0] ? <span className="muted">{formatPct(total ? (data.rows[0].spend_cents / total) * 100 : 0)} of spend</span> : null} />
      </section>
      {(data?.suggestions?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader title="Possible duplicates" subtitle="Same long token or name prefix, not already merged" />
          <ul className="dup-list">
            {data?.suggestions?.map((item) => (
              <li key={item.names.join("\u0000")} className="dup-row">
                <span>
                  <span className="strong">{item.names.join(" · ")}</span>
                  <span className="muted small"> {item.reason} · {formatMoney(item.spend_cents)}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={merge.isPending && sameNames(merge.variables?.names, item.names)}
                  onClick={() => merge.mutate({ names: item.names, into: item.names[0] })}
                >
                  Merge
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="vendor-filter">Filter vendors</label>
          <input id="vendor-filter" className="input" type="search" placeholder="Filter vendors or categories" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          caption="Vendors by spend"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.merchant}
          loading={query.isPending}
          filter={text}
          defaultSort={{ key: "spend", dir: "desc" }}
          pageSize={50}
          keyboard
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(row) => navigate(withGlobal("/transactions", location.search, { vendor: row.merchant, search: "" }))}
          empty={<EmptyState icon="vendors" title="No vendor spend" compact>Nothing was spent in this range.</EmptyState>}
        />
      )}
      <MergeDialog
        open={merging}
        rows={picked}
        busy={merge.isPending}
        onClose={() => setMerging(false)}
        onMerge={(into) =>
          merge.mutate(
            { names: picked.map((row) => row.merchant), into },
            {
              onSuccess: () => {
                setMerging(false);
                setSelected(new Set());
              },
            },
          )
        }
      />
      <RenameDialog
        open={renaming}
        current={picked[0]?.merchant ?? ""}
        busy={rename.isPending}
        onClose={() => setRenaming(false)}
        onRename={(name) =>
          rename.mutate(
            { canonical: picked[0]?.merchant ?? "", name },
            {
              onSuccess: () => {
                setRenaming(false);
                setSelected(new Set());
              },
            },
          )
        }
      />
    </div>
  );
}

function sameNames(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((name, index) => name === right[index]);
}

function MergeDialog({
  open,
  rows,
  busy,
  onClose,
  onMerge,
}: {
  open: boolean;
  rows: VendorRow[];
  busy: boolean;
  onClose: () => void;
  onMerge: (into: string) => void;
}) {
  const suggested = useMemo(() => [...rows].sort((a, b) => b.spend_cents - a.spend_cents)[0]?.merchant ?? "", [rows]);
  const [into, setInto] = useState(suggested);
  const [error, setError] = useState<string | null>(null);
  const combined = rows.reduce((acc, row) => acc + row.spend_cents, 0);
  // Reset the field when the dialog opens onto a new selection.
  const [seen, setSeen] = useState(suggested);
  if (open && suggested !== seen) {
    setSeen(suggested);
    setInto(suggested);
    setError(null);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Merge vendors"
      description="Ledger rows stay as imported. Reports, search, and the vendor filter use this name."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              if (!into.trim()) {
                setError("Enter a canonical name.");
                return;
              }
              setError(null);
              onMerge(into.trim());
            }}
          >
            Merge vendors
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          Combined spend <Money cents={combined} strong />
        </p>
        <ul className="vendor-spellings">
          {rows.map((row) => (
            <li key={row.merchant} className="vendor-spelling">
              <span>{row.merchant}</span>
              <Money cents={row.spend_cents} />
            </li>
          ))}
        </ul>
        <TextField
          label="Canonical name"
          value={into}
          error={error}
          onChange={(event) => setInto(event.target.value)}
          hint="Pick one of the spellings, or type the name you want to see."
        />
      </div>
    </Modal>
  );
}

function RenameDialog({
  open,
  current,
  busy,
  onClose,
  onRename,
}: {
  open: boolean;
  current: string;
  busy: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(current);
  if (open && current !== seen) {
    setSeen(current);
    setName(current);
    setError(null);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename vendor"
      description={current ? `Canonical name for ${current}` : "Canonical name"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              if (!name.trim()) {
                setError("Enter a name.");
                return;
              }
              setError(null);
              onRename(name.trim());
            }}
          >
            Save name
          </Button>
        </>
      }
    >
      <TextField label="Canonical name" value={name} error={error} onChange={(event) => setName(event.target.value)} />
    </Modal>
  );
}

function useVendorMerge() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { names: string[]; into: string }) => apiPost<{ canonical: string; changed: number }>("/vendors/merge", body),
    onSuccess: (result) => {
      invalidateLedger(client);
      toast({
        tone: "success",
        title: result.changed ? `Merged into ${result.canonical}` : `${result.canonical} is already merged`,
      });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't merge vendors", description: error instanceof Error ? error.message : String(error) }),
  });
}

function useVendorUnmerge() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (alias: string) => apiPost<{ alias: string }>("/vendors/unmerge", { alias }),
    onSuccess: (result) => {
      invalidateLedger(client);
      toast({ tone: "success", title: `Unmerged ${result.alias}` });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't unmerge", description: error instanceof Error ? error.message : String(error) }),
  });
}

function useVendorRename() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { canonical: string; name: string }) => apiPost<{ canonical: string }>("/vendors/rename", body),
    onSuccess: (result) => {
      invalidateLedger(client);
      toast({ tone: "success", title: `Renamed to ${result.canonical}` });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't rename", description: error instanceof Error ? error.message : String(error) }),
  });
}
