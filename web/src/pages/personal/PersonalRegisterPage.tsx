import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { usePersonalRegister } from "../../api/personal";
import { Card } from "../../components/Card";
import { PageHeader } from "../../components/PageHeader";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError, PersonalTxnTable } from "../../components/personal/PersonalKit";
import { useDebounce } from "../../hooks/useDebounce";
import { withGlobal } from "../../hooks/useGlobalFilters";

export default function PersonalRegisterPage() {
  const { accountId = "" } = useParams();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const debounced = useDebounce(search, 200);
  const query = usePersonalRegister(accountId, { search: debounced, offset, limit: 100 });
  const data = query.data;
  return (
    <div className="page page--personal">
      <PageHeader
        title={data?.account.label ?? "Register"}
        eyebrow={PERSONAL_EYEBROW}
        subtitle={
          <>
            <Link to={withGlobal("/personal/accounts", location.search)}>Accounts</Link> · day-end balance from anchors plus activity
          </>
        }
        actions={<CsvLink name="transactions" params={{ account: accountId, search: debounced }} />}
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <label className="field field--inline">
        <span className="field__label">Search</span>
        <input className="input" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
      </label>
      <Card padded={false}>
        <PersonalTxnTable
          rows={data?.rows ?? []}
          loading={query.isPending}
          caption="Account register"
          showBalance
          pagination={data ? { offset, limit: 100, total: data.total, onChange: setOffset } : undefined}
        />
      </Card>
    </div>
  );
}
