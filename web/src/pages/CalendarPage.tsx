import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost } from "../api/client";
import { useCalendar } from "../api/queries";
import type { RecurringItem } from "../api/types";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { AreaChart } from "../components/charts/AreaChart";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { KpiCard } from "../components/KpiCard";
import { Money } from "../components/MoneyCell";
import { PageHeader } from "../components/PageHeader";
import { SkeletonCard } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useConfig } from "../hooks/useConfig";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { useSessionData } from "../hooks/useSession";
import { cx } from "../lib/cx";
import { allTimeRange } from "../lib/dates";
import { centsToInput, formatDate, formatMoney, parseMoney } from "../lib/format";
import { businessLabel } from "../lib/labels";

export function useSaveReserve() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (cents: number) => apiPost<{ reserve_cents: number }>("/settings", { reserve_cents: cents }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["calendar"] });
      void client.invalidateQueries({ queryKey: ["settings"] });
      void client.invalidateQueries({ queryKey: ["audit"] });
      toast({ tone: "success", title: `Reserve saved: ${formatMoney(result.reserve_cents)}` });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't save the reserve", description: error instanceof Error ? error.message : String(error) }),
  });
}

export default function CalendarPage() {
  const filters = useGlobalFilters();
  // The outlook follows the operating account; the copy names it when the config does.
  const operating = useConfig().operating_account;
  const opShort = operating?.short_name ?? "operating account";
  const opLabel = operating?.label ?? "operating account";
  const session = useSessionData();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useCalendar({ business: filters.business });
  const save = useSaveReserve();
  const data = query.data;
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (data) {
      setDraft(data.reserve_cents);
      setText(centsToInput(data.reserve_cents));
    }
  }, [data?.reserve_cents]); // eslint-disable-line react-hooks/exhaustive-deps

  const reserve = draft ?? data?.reserve_cents ?? 0;
  const sliderMax = useMemo(() => {
    if (!data) return 5_000_000;
    const peak = Math.max(...data.outlook.daily.map((d) => d.balance), data.reserve_cents, 0);
    const step = 100_000;
    return Math.max(step * 10, Math.ceil((peak * 1.2) / step) * step);
  }, [data]);
  const afterReserve = data ? data.outlook.ending_cents - reserve : 0;
  const lowPoint = data ? Math.min(...data.outlook.daily.map((d) => d.balance)) : 0;
  const dirty = data ? reserve !== data.reserve_cents : false;

  const columns: Column<RecurringItem>[] = [
    { key: "merchant", header: "Merchant", accessor: (row) => row.merchant, sortable: true, cell: (row) => <span className="strong truncate" title={row.merchant}>{row.merchant}</span> },
    { key: "account", header: "Account", accessor: (row) => row.account_name, sortable: true, hideOnMobile: true },
    { key: "direction", header: "Type", accessor: (row) => row.direction, sortable: true, hideOnMobile: true, cell: (row) => <Badge tone={row.direction === "in" ? "pos" : "neutral"}>{row.direction === "in" ? "Deposit" : "Bill"}</Badge> },
    { key: "gap", header: "Every", accessor: (row) => row.gap_days, sortable: true, hideOnMobile: true, cell: (row) => `~${row.gap_days} days` },
    { key: "last", header: "Last", accessor: (row) => row.last_date, format: "date", sortable: true, hideOnMobile: true },
    { key: "next", header: "Next expected", accessor: (row) => row.next_date, format: "date", sortable: true },
    { key: "amount", header: "Last amount", accessor: (row) => row.last_cents, format: "money-signed", sortable: true },
  ];

  return (
    <div className="page">
      <PageHeader title="Calendar & bills" subtitle={<>Recurring charges and a 60-day {operating ? `${operating.label} ` : ""}cash outlook · {businessLabel(filters.business)}</>} />
      <div className="callout callout--info" role="note">
        <Icon name="info" size={18} />
        <span>
          <strong>This is an estimate.</strong> Recurring items are merchants with at least three charges about a month apart. The outlook starts from the imported {opShort} balance and projects only recurring {opLabel} deposits and withdrawals. Card charges leave {operating ? operating.label : "the operating account"} when the card is paid, so they are not subtracted again.
        </span>
      </div>
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      <section className="kpi-grid" aria-label="Outlook">
        <KpiCard label={operating ? `${operating.short_name} today` : "Operating account today"} cents={data?.outlook.opening_cents ?? 0} loading={!data} />
        <KpiCard label="Projected in 60 days" cents={data?.outlook.ending_cents ?? 0} loading={!data} footer={data ? <span className="muted">Through {formatDate(data.outlook.through)} <Badge tone="warn">Estimate</Badge></span> : null} />
        <KpiCard label="Lowest projected" cents={lowPoint} loading={!data} footer={<span className="muted">Minimum daily balance</span>} />
        <KpiCard label="After reserve" cents={afterReserve} loading={!data} footer={<span className={cx("muted", afterReserve < 0 && "money--neg")}>{afterReserve < 0 ? "Below your reserve" : "Above your reserve"}</span>} />
      </section>

      <Card>
        <CardHeader title="60-day cash outlook" subtitle={<>Projected {operating ? `${operating.label} ` : ""}balance with your reserve line <Badge tone="warn">Estimate</Badge></>} />
        {!data ? (
          <SkeletonCard height={220} />
        ) : (
          <>
            <AreaChart
              label={`Projected ${opShort} balance over the next 60 days, with the reserve as a horizontal line`}
              points={data.outlook.daily.map((d) => ({ date: d.date, value: d.balance }))}
              threshold={{ value: reserve, label: `Reserve ${formatMoney(reserve, { whole: true })}`, tone: "reserve" }}
              markers={data.outlook.timeline.filter((t) => t.cents !== 0).map((t) => ({ date: t.date, label: `${t.label}: ${formatMoney(t.cents)}` }))}
              valueLabel="Projected balance"
            />
            <form
              className="reserve"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(reserve);
              }}
            >
              <label className="reserve__label" htmlFor="reserve-slider">
                Cash reserve
              </label>
              <input
                id="reserve-slider"
                className="reserve__slider"
                type="range"
                min={0}
                max={sliderMax}
                step={10_000}
                value={Math.min(reserve, sliderMax)}
                onChange={(event) => {
                  const cents = Number(event.target.value);
                  setDraft(cents);
                  setText(centsToInput(cents));
                }}
                aria-valuetext={formatMoney(reserve)}
              />
              <div className="reserve__input">
                <span aria-hidden="true">$</span>
                <label htmlFor="reserve-amount" className="sr-only">Reserve amount in dollars</label>
                <input
                  id="reserve-amount"
                  className="input input--sm"
                  inputMode="decimal"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    const cents = parseMoney(event.target.value);
                    if (cents !== null && cents >= 0) setDraft(cents);
                  }}
                />
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={save.isPending}>
                Save reserve
              </Button>
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => { setDraft(data.reserve_cents); setText(centsToInput(data.reserve_cents)); }}>
                  Reset
                </Button>
              ) : null}
            </form>
          </>
        )}
      </Card>

      <div className="split-2">
        <Card>
          <CardHeader title="Bills due in the next 60 days" subtitle="All accounts, by expected date" />
          {!data ? (
            <SkeletonCard />
          ) : data.upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="No bills expected" compact />
          ) : (
            <ol className="timeline" tabIndex={0} aria-label="Bills due in the next 60 days">
              {data.upcoming.map((bill) => (
                <li key={`${bill.merchant}-${bill.account_id}-${bill.due_date}`} className="timeline__item">
                  <span className="timeline__date">{formatDate(bill.due_date, { year: false })}</span>
                  <span className="timeline__dot" aria-hidden="true" />
                  <span className="timeline__what">
                    <span className="truncate" title={bill.merchant}>{bill.merchant}</span>
                    <span className="muted small">{bill.account_name}</span>
                  </span>
                  <Money cents={bill.cents} />
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader title={operating ? `Projected ${operating.label} activity` : "Projected activity"} subtitle="What moves the outlook line" />
          {!data ? (
            <SkeletonCard />
          ) : (
            <ol className="timeline" tabIndex={0} aria-label={operating ? `Projected ${operating.label} activity` : "Projected activity"}>
              {data.outlook.timeline.map((row, index) => (
                <li key={`${row.date}-${index}`} className="timeline__item">
                  <span className="timeline__date">{formatDate(row.date, { year: false })}</span>
                  <span className="timeline__dot" aria-hidden="true" />
                  <span className="timeline__what">
                    <span className="truncate" title={row.label}>{row.label}</span>
                    <span className="muted small">Balance <Money cents={row.balance} /></span>
                  </span>
                  {row.cents ? <Money cents={row.cents} colorPositive /> : <span />}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <section>
        <h2 className="section-title">Recurring merchants</h2>
        <DataTable
          caption="Recurring merchants"
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => `${row.merchant}|${row.account_id}|${row.direction}`}
          loading={query.isPending}
          defaultSort={{ key: "next", dir: "asc" }}
          pageSize={25}
          onRowClick={(row) => {
            const range = allTimeRange(session.months, session.latest_month, session.today);
            navigate(withGlobal("/transactions", location.search, { search: row.merchant, start: range.start, end: range.end }));
          }}
          empty={<EmptyState icon="calendar" title="No monthly cadence found" compact />}
        />
      </section>
    </div>
  );
}
