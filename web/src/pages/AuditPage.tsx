import { useState } from "react";
import { useAudit } from "../api/queries";
import type { AuditRow } from "../api/types";
import { Badge } from "../components/Badge";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { formatTimestamp } from "../lib/format";
import type { Tone } from "../lib/labels";

const ACTION_TONES: Record<string, Tone> = {
  classify: "brand",
  classify_undo: "warn",
  rule_create: "violet",
  rule_disable: "neutral",
  rule_enable: "pos",
  setting: "info",
  margins_seed: "info",
  margin_server_update: "warn",
  margin_cost_add: "brand",
  margin_cost_update: "brand",
  margin_cost_delete: "warn",
  margin_mapping_add: "violet",
  margin_mapping_delete: "warn",
  margin_overhead_add: "brand",
  margin_overhead_update: "brand",
};

function snapshot(value: string | null): string {
  if (!value) return "—";
  const parts = value.split("|");
  if (parts.length >= 3) return parts.filter(Boolean).slice(0, 3).join(" · ");
  return value;
}

export default function AuditPage() {
  const [limit, setLimit] = useState("200");
  const [text, setText] = useState("");
  const query = useAudit({ limit });
  const columns: Column<AuditRow>[] = [
    { key: "ts", header: "When", accessor: (row) => row.ts, sortable: true, width: "180px", cell: (row) => <span className="nowrap">{formatTimestamp(row.ts)}</span> },
    { key: "action", header: "Action", accessor: (row) => row.action, sortable: true, cell: (row) => <Badge tone={ACTION_TONES[row.action] ?? "neutral"}>{row.action.replace(/_/g, " ")}</Badge> },
    {
      key: "target",
      header: "Target",
      accessor: (row) => row.txn_id ?? (row.rule_id !== null ? `rule ${row.rule_id}` : row.field ?? ""),
      cell: (row) => (row.txn_id ? <code className="code-chip" title={row.txn_id}>{row.txn_id.slice(0, 14)}</code> : row.rule_id !== null ? `Rule ${row.rule_id}` : row.field ?? "—"),
    },
    {
      key: "change",
      header: "Change",
      accessor: (row) => `${row.old_value ?? ""} ${row.new_value ?? ""} ${row.note ?? ""}`,
      cell: (row) => (
        <span className="audit-change">
          <span className="muted">{snapshot(row.old_value)}</span>
          <Icon name="arrowRight" size={13} />
          <span>{snapshot(row.new_value)}</span>
          {row.note ? <span className="muted small"> — {row.note}</span> : null}
        </span>
      ),
    },
    { key: "actor", header: "By", accessor: (row) => row.actor, sortable: true, hideOnMobile: true, width: "90px" },
  ];
  return (
    <div className="page">
      <PageHeader title="Audit log" subtitle="Every classification, rule change, undo, and setting change, newest first." />
      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="audit-filter">Filter the audit log</label>
          <input id="audit-filter" className="input" type="search" placeholder="Filter by action, id, or value" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <Select label="Entries" hideLabel value={limit} onChange={setLimit} options={["100", "200", "500", "1000"].map((value) => ({ value, label: `Last ${value}` }))} />
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          caption="Audit log"
          columns={columns}
          rows={query.data ?? []}
          rowKey={(row) => String(row.id)}
          loading={query.isPending}
          filter={text}
          pageSize={50}
          empty={<EmptyState icon="audit" title="No audit entries" compact />}
        />
      )}
    </div>
  );
}
