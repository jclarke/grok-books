import { Link, useLocation } from "react-router-dom";
import { usePnlLines } from "../api/queries";
import type { Business } from "../api/types";
import { TagBadge } from "./Badge";
import { DataTable } from "./DataTable";
import { Drawer } from "./Modal";
import { Money } from "./MoneyCell";
import { withGlobal } from "../hooks/useGlobalFilters";
import { formatMonth, pluralize } from "../lib/format";

export interface Drill {
  label: string;
  month: string | null;
}

/** The transactions behind one P&L figure. */
export function DrilldownDrawer({ drill, start, end, business, categories, onClose }: { drill: Drill | null; start: string; end: string; business: Business; categories: string[]; onClose: () => void }) {
  const location = useLocation();
  const query = usePnlLines(drill ? { start, end, business, label: drill.label, month: drill.month ?? undefined } : null);
  const data = query.data;
  const isCategory = drill ? categories.includes(drill.label) : false;
  return (
    <Drawer
      open={drill !== null}
      onClose={onClose}
      size="lg"
      title={drill?.label ?? ""}
      description={drill ? `${drill.month ? formatMonth(drill.month) : "Whole range"}${data ? ` · ${pluralize(data.rows.length, "transaction")}` : ""}` : undefined}
      footer={
        drill && isCategory ? (
          <Link className="btn btn--secondary btn--md" to={withGlobal("/transactions", location.search, { category: drill.label })} onClick={onClose}>
            Open in Transactions
          </Link>
        ) : null
      }
    >
      {data ? (
        <p className="drill-total">
          Sum of amounts <Money cents={data.total_cents} strong />
          <span className="muted small"> (expenses are negative here; the statement shows them as positive costs)</span>
        </p>
      ) : null}
      <DataTable
        caption="Transactions in this line"
        dense
        loading={query.isPending}
        rows={data?.rows ?? []}
        rowKey={(row) => row.id}
        pageSize={50}
        defaultSort={{ key: "date", dir: "desc" }}
        columns={[
          { key: "date", header: "Date", accessor: (row) => row.date, format: "date", sortable: true },
          { key: "name", header: "Description", accessor: (row) => row.name, sortable: true, cell: (row) => <span className="truncate cell-clip" title={row.name}>{row.name}</span> },
          { key: "account", header: "Account", accessor: (row) => row.account_name, sortable: true, hideOnMobile: true },
          { key: "tag", header: "Business", accessor: (row) => row.business_tag, hideOnMobile: true, cell: (row) => <TagBadge tag={row.business_tag} /> },
          { key: "amount", header: "Amount", accessor: (row) => row.amount_cents, format: "money-signed", sortable: true },
        ]}
        empty="No transactions in this line."
      />
    </Drawer>
  );
}
