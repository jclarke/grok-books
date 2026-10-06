import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../api/client";
import { useRules } from "../api/queries";
import type { Rule } from "../api/types";
import { Badge, TagBadge } from "../components/Badge";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { useToast } from "../components/Toast";
import { invalidateLedger } from "../hooks/useClassify";

function useToggleRule() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => apiPost<{ id: number; active: boolean }>(`/rules/${id}/active`, { active }),
    onMutate: async ({ id, active }) => {
      await client.cancelQueries({ queryKey: ["rules"] });
      const previous = client.getQueryData<Rule[]>(["rules"]);
      client.setQueryData<Rule[]>(["rules"], (rows) => rows?.map((row) => (row.id === id ? { ...row, active } : row)));
      return previous;
    },
    onError: (error, _vars, previous) => {
      if (previous) client.setQueryData(["rules"], previous);
      toast({ tone: "error", title: "Couldn't update the rule", description: error instanceof Error ? error.message : String(error) });
    },
    onSuccess: (result) => {
      invalidateLedger(client, ["rules"]);
      toast({
        tone: "success",
        title: result.active ? `Rule ${result.id} enabled` : `Rule ${result.id} disabled`,
        description: "Existing classifications stay as they are until the next import or reclassify.",
      });
    },
  });
}

export default function RulesPage() {
  const query = useRules();
  const toggle = useToggleRule();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const rows = (query.data ?? []).filter((row) => (status === "all" ? true : status === "active" ? row.active : !row.active));
  const activeCount = (query.data ?? []).filter((row) => row.active).length;

  const columns: Column<Rule>[] = [
    { key: "priority", header: "Priority", accessor: (row) => row.priority, format: "number", sortable: true, width: "90px", hideOnMobile: true },
    { key: "pattern", header: "Pattern", accessor: (row) => row.pattern, sortable: true, cell: (row) => <code className="code-chip" title={row.pattern}>{row.pattern}</code> },
    { key: "tag", header: "Business", accessor: (row) => row.business_tag, sortable: true, cell: (row) => <TagBadge tag={row.business_tag} /> },
    { key: "category", header: "Category", accessor: (row) => row.category, sortable: true, hideOnMobile: true },
    {
      key: "scope",
      header: "Scope",
      accessor: (row) => [row.field, row.account_name, row.amount_sign].filter(Boolean).join(" "),
      hideOnMobile: true,
      cell: (row) => (
        <span className="small muted nowrap">
          {row.field === "any" ? "any field" : row.field}
          {row.account_name ? ` · ${row.account_name}` : ""}
          {row.amount_sign ? ` · money ${row.amount_sign}` : ""}
        </span>
      ),
    },
    { key: "hits", header: "Rows", accessor: (row) => row.hits, format: "number", sortable: true, width: "80px" },
    { key: "created_by", header: "Source", accessor: (row) => row.created_by, sortable: true, hideOnMobile: true, cell: (row) => <Badge tone="neutral">{row.created_by}</Badge> },
    {
      key: "active",
      header: "Active",
      accessor: (row) => (row.active ? 1 : 0),
      sortable: true,
      width: "84px",
      cell: (row) => (
        <label className="switch">
          <input type="checkbox" role="switch" checked={row.active} onChange={(event) => toggle.mutate({ id: row.id, active: event.target.checked })} aria-label={`Rule ${row.id} active`} />
          <span className="switch__track" aria-hidden="true" />
        </label>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader title="Rules" subtitle="Rules classify new imports, lowest priority first. Manual classifications always win." />
      <section className="kpi-grid kpi-grid--3" aria-label="Rule totals">
        <KpiCard label="Rules" display={String(query.data?.length ?? "")} loading={query.isPending} />
        <KpiCard label="Active" display={String(activeCount)} loading={query.isPending} />
        <KpiCard label="Rows classified by rules" display={(query.data ?? []).reduce((acc, row) => acc + row.hits, 0).toLocaleString("en-US")} loading={query.isPending} />
      </section>
      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="rule-filter">Filter rules</label>
          <input id="rule-filter" className="input" type="search" placeholder="Filter by pattern, business, or category" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <SegmentedControl
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          caption="Classification rules"
          columns={columns}
          rows={rows}
          rowKey={(row) => String(row.id)}
          loading={query.isPending}
          filter={text}
          defaultSort={{ key: "priority", dir: "asc" }}
          pageSize={50}
          rowClassName={(row) => (row.active ? undefined : "row--muted")}
          empty={<EmptyState icon="rules" title="No rules match" compact>Create one from any transaction with “Create rule from this”.</EmptyState>}
        />
      )}
    </div>
  );
}
