import { useState } from "react";
import { useBudgetSuggestions, useBudgets, usePersonalWrite, type BudgetRow } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { KpiCard } from "../../components/KpiCard";
import { Modal } from "../../components/Modal";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { SkeletonTable } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { CategorySelect, CsvLink, PERSONAL_EYEBROW, PersonalLoadError, ProgressBar } from "../../components/personal/PersonalKit";
import { useSession } from "../../hooks/useSession";
import { formatMonth, formatPct, parseMoney } from "../../lib/format";

export default function BudgetsPage() {
  const { data: session } = useSession();
  const [month, setMonth] = useState((session?.today ?? "").slice(0, 7) || new Date().toISOString().slice(0, 7));
  const query = useBudgets(month);
  const data = query.data;
  const toast = useToast();
  const save = usePersonalWrite<{ category_id?: number; group_name?: string; month?: string | null; amount_cents: number; rollover: boolean }>("/budgets");
  const remove = usePersonalWrite<{ id: number }>((body) => `/budgets/${body.id}/delete`);
  const copy = usePersonalWrite<{ month: string }>("/budgets/copy");
  const average = usePersonalWrite<{ month: string; category_ids?: number[] }>("/budgets/average");
  const [helper, setHelper] = useState(false);
  const suggestions = useBudgetSuggestions(month, helper);
  const [newCategory, setNewCategory] = useState<number | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [newMonthOnly, setNewMonthOnly] = useState(false);
  const [newRollover, setNewRollover] = useState(false);
  const result = (title: string) => ({
    onSuccess: () => toast.toast({ tone: "success" as const, title }),
    onError: (error: unknown) => toast.toast({ tone: "error" as const, title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
  });
  const newCents = parseMoney(newAmount);
  return (
    <div className="page page--personal">
      <PageHeader
        title="Budgets"
        eyebrow={PERSONAL_EYEBROW}
        subtitle={`${formatMonth(month)} · warning at 80%, over above 100%`}
        actions={
          <>
            <label className="field field--inline">
              <span className="field__label">Month</span>
              <input className="input input--sm" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
            </label>
            <Button size="sm" onClick={() => copy.mutate({ month }, result("Copied last month's budgets"))}>
              Copy last month
            </Button>
            <Button size="sm" onClick={() => setHelper(true)}>
              From 3-month average
            </Button>
            <CsvLink name="budgets" params={{ month }} />
          </>
        }
      />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      {data ? (
        <section className="kpi-grid" aria-label="Budget summary">
          <KpiCard label="Budgeted" cents={data.budgeted_cents} />
          <KpiCard label="Spent (budgeted lines)" cents={data.spent_cents} />
          <KpiCard label="Remaining" cents={data.remaining_cents} />
          <KpiCard label="All spending" cents={data.total_spending_cents} footer={<span className="muted small">{data.counts.over} over · {data.counts.warning} near the limit</span>} />
        </section>
      ) : null}
      {data?.alerts.length ? (
        <div className="callout callout--warn" role="status">
          <strong>Budget alerts:</strong>{" "}
          {data.alerts.map((alert) => `${alert.name} ${alert.status === "over" ? "over" : "at"} ${formatPct(alert.pct_used)}`).join(" · ")}
        </div>
      ) : null}
      <Card>
        <CardHeader title="Add a budget" />
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newCategory === null || newCents === null || newCents < 0) return;
            save.mutate(
              { category_id: newCategory, amount_cents: newCents, month: newMonthOnly ? month : null, rollover: newRollover },
              { ...result("Budget saved"), onSettled: () => setNewAmount("") },
            );
          }}
        >
          <CategorySelect label="Budget category" hideLabel={false} kinds={["expense"]} value={newCategory} placeholder="Category…" onChange={setNewCategory} />
          <label className="field">
            <span className="field__label">Amount per month ($)</span>
            <input className="input input--sm num" inputMode="decimal" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} aria-invalid={newAmount !== "" && newCents === null} />
          </label>
          <label className="check">
            <input type="checkbox" checked={newMonthOnly} onChange={(event) => setNewMonthOnly(event.target.checked)} /> Only {formatMonth(month)}
          </label>
          <label className="check">
            <input type="checkbox" checked={newRollover} onChange={(event) => setNewRollover(event.target.checked)} /> Roll over unspent
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={newCategory === null || newCents === null} loading={save.isPending}>
            Save budget
          </Button>
        </form>
      </Card>
      <Card padded={false}>
        {query.isPending ? <SkeletonTable rows={5} cols={6} /> : null}
        {data && data.rows.length === 0 ? <EmptyState title="No budgets for this month" >Add one above, copy last month, or start from your 3-month average.</EmptyState> : null}
        {data && data.rows.length ? (
          <table className="table budgets">
            <caption className="sr-only">Budgets for {formatMonth(month)}</caption>
            <thead>
              <tr>
                <th scope="col">Budget</th>
                <th scope="col">Progress</th>
                <th scope="col" className="num">Spent</th>
                <th scope="col" className="num">Available</th>
                <th scope="col" className="num">Remaining</th>
                <th scope="col" className="num hide-mobile">Pace</th>
                <th scope="col">Edit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <BudgetLine
                  key={`${row.kind}-${row.category_id ?? row.group_name}`}
                  row={row}
                  month={month}
                  onSave={(amount, rollover, onlyMonth) =>
                    save.mutate(
                      { ...(row.category_id !== null ? { category_id: row.category_id } : { group_name: row.group_name as string }), amount_cents: amount, rollover, month: onlyMonth ? month : null },
                      result("Budget saved"),
                    )
                  }
                  onDelete={() => remove.mutate({ id: row.id }, result("Budget removed"))}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      {data?.unbudgeted.length ? (
        <Card>
          <CardHeader title="Spending without a budget" />
          <ul className="class-list">
            {data.unbudgeted.map((item) => (
              <li key={item.category_id}>
                <span>{item.group} / {item.category}</span> <Money cents={item.cents} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Modal open={helper} onClose={() => setHelper(false)} title="Set budgets from your 3-month average" size="md">
        {suggestions.isPending ? <SkeletonTable rows={4} cols={3} /> : null}
        {suggestions.data?.rows.length === 0 ? <EmptyState compact title="No spending in the last three months" /> : null}
        {suggestions.data?.rows.length ? (
          <>
            <ul className="class-list">
              {suggestions.data.rows.map((item) => (
                <li key={item.category_id}>
                  <span>{item.group} / {item.category}</span> <Money cents={item.average_cents} />
                  <Button size="sm" variant="ghost" onClick={() => average.mutate({ month, category_ids: [item.category_id] }, result(`Set ${item.category}`))}>
                    Use
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="primary" onClick={() => average.mutate({ month }, { ...result("Budgets set from averages"), onSettled: () => setHelper(false) })}>
              Use all for {formatMonth(month)}
            </Button>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function BudgetLine({ row, month, onSave, onDelete }: { row: BudgetRow; month: string; onSave: (amount: number, rollover: boolean, onlyMonth: boolean) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState((row.budget_cents / 100).toFixed(2));
  const [rollover, setRollover] = useState(row.rollover);
  const [onlyMonth, setOnlyMonth] = useState(row.month_specific);
  const cents = parseMoney(amount);
  return (
    <tr className={`budget-row budget-row--${row.status}`}>
      <th scope="row">
        <span>{row.name}</span>
        <span className="muted small"> {row.group !== row.name ? row.group : ""}</span>{" "}
        {row.status === "over" ? <Badge tone="neg">Over</Badge> : row.status === "warning" ? <Badge tone="warn">80%+</Badge> : null}
        {row.rollover ? <Badge tone="neutral" title="Unspent money carries to next month">rollover {row.carry_cents ? <Money cents={row.carry_cents} /> : null}</Badge> : null}
        {!row.month_specific ? <span className="muted small"> every month</span> : null}
      </th>
      <td>
        <ProgressBar pct={row.pct_used} status={row.status} label={`${row.name}: ${formatPct(row.pct_used)} used`} />
        <span className="muted small">{formatPct(row.pct_used)}</span>
      </td>
      <td className="num"><Money cents={row.spent_cents} /></td>
      <td className="num"><Money cents={row.available_cents} /></td>
      <td className="num"><Money cents={row.remaining_cents} /></td>
      <td className="num hide-mobile">
        <Money cents={row.projected_cents} /> {row.projected_over ? <Badge tone="warn">on pace to exceed</Badge> : null}
      </td>
      <td>
        {editing ? (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (cents === null || cents < 0) return;
              onSave(cents, rollover, onlyMonth);
              setEditing(false);
            }}
          >
            <input className="input input--sm num" aria-label={`Budget for ${row.name}`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
            <label className="check">
              <input type="checkbox" checked={rollover} onChange={(event) => setRollover(event.target.checked)} /> Rollover
            </label>
            <label className="check">
              <input type="checkbox" checked={onlyMonth} onChange={(event) => setOnlyMonth(event.target.checked)} /> Only {formatMonth(month)}
            </label>
            <Button type="submit" size="sm" variant="primary" disabled={cents === null}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="row-actions">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit budget ${row.name}`}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete budget ${row.name}`}>
              Delete
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
