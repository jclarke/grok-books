import { useState } from "react";
import { usePersonalWrite, useRecurring, type RecurringItem } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { KpiCard } from "../../components/KpiCard";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Select } from "../../components/Select";
import { SkeletonTable } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { formatDate } from "../../lib/format";

type Filter = "all" | "subscription" | "bill" | "income" | "flagged" | "hidden";
const CADENCES = ["weekly", "biweekly", "monthly", "quarterly", "annual"];

export default function RecurringPage() {
  const query = useRecurring();
  const data = query.data;
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const update = usePersonalWrite<{ series_key: string; status?: string; cadence?: string }>("/recurring/update");
  const refresh = usePersonalWrite<Record<string, never>>("/recurring/refresh");
  const act = (item: RecurringItem, body: { status?: string; cadence?: string }, title: string) =>
    update.mutate(
      { series_key: item.series_key, ...body },
      {
        onSuccess: () => toast.toast({ tone: "success", title }),
        onError: (error) => toast.toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
      },
    );
  const items = (data?.items ?? []).filter((item) => {
    const hidden = item.status === "ignored" || item.status === "cancelled";
    if (filter === "hidden") return hidden;
    if (hidden) return false;
    if (filter === "flagged") return Boolean(item.price_change) || item.may_be_cancelled || item.possible_duplicate || item.new;
    return filter === "all" || item.kind === filter;
  });
  return (
    <div className="page page--personal">
      <PageHeader
        title="Recurring & subscriptions"
        eyebrow={PERSONAL_EYEBROW}
        subtitle="Found from repeating charges; confirm, ignore, mark cancelled, or fix the cadence"
        actions={
          <>
            <Button size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate({}, { onSuccess: () => toast.toast({ tone: "success", title: "Detection refreshed" }) })}>
              Detect again
            </Button>
            <CsvLink name="recurring" />
          </>
        }
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {data ? (
        <section className="kpi-grid" aria-label="Recurring totals">
          <KpiCard label="Subscriptions / month" cents={data.subscription_monthly_cents} />
          <KpiCard label="Subscriptions / year" cents={data.subscription_annual_cents} />
          <KpiCard label="Bills / month" cents={data.bill_monthly_cents} />
          <KpiCard label="Flags" display={String((data.counts.price_changes ?? 0) + (data.counts.may_be_cancelled ?? 0) + (data.counts.possible_duplicates ?? 0))} footer={<span className="muted small">{data.counts.price_changes} price changes · {data.counts.may_be_cancelled} may be cancelled · {data.counts.possible_duplicates} possible duplicates</span>} />
        </section>
      ) : null}
      <SegmentedControl
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "subscription", label: "Subscriptions" },
          { value: "bill", label: "Bills" },
          { value: "income", label: "Income" },
          { value: "flagged", label: "Flagged" },
          { value: "hidden", label: "Ignored / cancelled" },
        ]}
        size="sm"
      />
      <Card padded={false}>
        {query.isPending ? <SkeletonTable rows={6} cols={6} /> : null}
        {data && items.length === 0 ? <EmptyState title="Nothing recurring here" >Recurring charges appear after three monthly (or two yearly) occurrences.</EmptyState> : null}
        {items.length ? (
          <table className="table">
            <caption className="sr-only">Recurring items</caption>
            <thead>
              <tr>
                <th scope="col">Merchant</th>
                <th scope="col">Cadence</th>
                <th scope="col" className="num">Typical</th>
                <th scope="col" className="hide-mobile">Next</th>
                <th scope="col" className="num">Monthly</th>
                <th scope="col" className="num hide-mobile">Yearly</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.series_key}>
                  <th scope="row">
                    <span>{item.merchant}</span> <span className="muted small">{item.category}</span>
                    <span className="flag-list">
                      <Badge tone={item.kind === "income" ? "pos" : item.kind === "subscription" ? "violet" : "neutral"}>{item.kind}</Badge>
                      {item.status === "confirmed" ? <Badge tone="pos">confirmed</Badge> : null}
                      {item.status === "cancelled" ? <Badge tone="neutral">cancelled</Badge> : null}
                      {item.status === "ignored" ? <Badge tone="neutral">ignored</Badge> : null}
                      {item.price_change ? (
                        <Badge tone="warn" title="Latest charge differs from the one before">
                          price {item.price_change.change_cents > 0 ? "up" : "down"} <Money cents={item.price_change.from_cents} /> → <Money cents={item.price_change.to_cents} />
                        </Badge>
                      ) : null}
                      {item.may_be_cancelled ? <Badge tone="warn" title="No charge for more than 1.5 cadences">may be cancelled</Badge> : null}
                      {item.possible_duplicate ? <Badge tone="neg" title="Another active series with this merchant">possible duplicate</Badge> : null}
                      {item.new ? <Badge tone="info">new</Badge> : null}
                    </span>
                  </th>
                  <td>
                    <Select
                      label={`Cadence for ${item.merchant}`}
                      hideLabel
                      size="sm"
                      value={item.cadence}
                      options={CADENCES.map((value) => ({ value, label: value }))}
                      onChange={(cadence) => act(item, { cadence }, "Cadence saved")}
                    />
                  </td>
                  <td className="num"><Money cents={item.typical_cents} /></td>
                  <td className="hide-mobile nowrap">{formatDate(item.next_expected)}</td>
                  <td className="num"><Money cents={item.monthly_cents} /></td>
                  <td className="num hide-mobile"><Money cents={item.annual_cents} /></td>
                  <td>
                    <div className="row-actions">
                      {item.status !== "confirmed" ? (
                        <Button size="sm" variant="ghost" onClick={() => act(item, { status: "confirmed" }, `${item.merchant} confirmed`)} aria-label={`Confirm ${item.merchant}`}>
                          Confirm
                        </Button>
                      ) : null}
                      {item.status === "ignored" || item.status === "cancelled" ? (
                        <Button size="sm" variant="ghost" onClick={() => act(item, { status: "active" }, `${item.merchant} restored`)} aria-label={`Restore ${item.merchant}`}>
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => act(item, { status: "ignored" }, `${item.merchant} ignored`)} aria-label={`Ignore ${item.merchant}`}>
                            Ignore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => act(item, { status: "cancelled" }, `${item.merchant} marked cancelled`)} aria-label={`Mark ${item.merchant} cancelled`}>
                            Cancelled
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
