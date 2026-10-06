import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWhmcsCustomerSearch } from "../api/queries";
import type { WhmcsCustomerHit } from "../api/types";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { NotSynced, StatusBadgeText, WhmcsEyebrow, WhmcsToolbar, useBrand } from "../components/Whmcs";
import { useDebounce } from "../hooks/useDebounce";
import { withGlobal } from "../hooks/useGlobalFilters";

// The last search, kept in memory only so Back from a customer returns to the results.
// It is never put in the URL (browser history) or in storage.
let lastSearch = "";

export default function WhmcsCustomersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [brand, setBrand] = useBrand();
  const [text, setText] = useState(lastSearch);
  const debounced = useDebounce(text.trim(), 250);
  useEffect(() => {
    lastSearch = debounced;
  }, [debounced]);
  const query = useWhmcsCustomerSearch(debounced, brand);
  const raw = query.data;
  const searching = debounced.length >= 2 || /^\d+$/.test(debounced);
  const rows = raw && raw.ready ? raw.rows : [];
  const open = (row: WhmcsCustomerHit) => navigate(withGlobal(`/whmcs/customers/${row.brand}/${row.client_id}`, location.search));

  const columns: Column<WhmcsCustomerHit>[] = [
    {
      key: "name",
      header: "Customer",
      accessor: (row) => `${row.name} ${row.company} ${row.email}`,
      cell: (row) => (
        <span className="customer-cell">
          <span className="strong">{row.name || row.company || "(no name)"}</span>
          <span className="muted small">{[row.company && row.name ? row.company : "", row.email].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { key: "brand", header: "Brand", accessor: (row) => row.brand, hideOnMobile: true },
    { key: "id", header: "Client", accessor: (row) => row.client_id, cell: (row) => <span className="num">#{row.client_id}</span>, hideOnMobile: true },
    { key: "status", header: "Status", accessor: (row) => row.status, cell: (row) => <StatusBadgeText status={row.status} /> },
    { key: "services", header: "Live services", accessor: (row) => row.live_services, format: "number", hideOnMobile: true },
    { key: "mrr", header: "MRR", accessor: (row) => row.mrr_cents, format: "money", hideOnMobile: true },
    { key: "paid", header: "Total paid", accessor: (row) => row.total_paid_cents, format: "money" },
  ];

  return (
    <div className="page">
      <PageHeader eyebrow={<WhmcsEyebrow />} title="Customers" subtitle="Search by name, email, company, domain, or client number across brands." />
      <WhmcsToolbar brand={{ value: brand, onChange: setBrand }} period={false} />
      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            className="input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Name, email, company, domain, or client #"
            maxLength={100}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : raw && !raw.ready ? (
        <NotSynced />
      ) : !searching ? (
        <EmptyState icon="users" title="Find a customer">
          Type at least two characters, or a client number.
        </EmptyState>
      ) : (
        <DataTable
          caption="Customer search results"
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.brand}:${row.client_id}`}
          loading={query.isPending}
          onRowClick={open}
          keyboard
          empty={<EmptyState icon="users" title="No customers match" compact>Try part of the email address or the domain.</EmptyState>}
        />
      )}
    </div>
  );
}
