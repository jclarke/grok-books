import { useState } from "react";
import { useGoals, usePersonalWrite, type Goal } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Money } from "../../components/MoneyCell";
import { PageHeader } from "../../components/PageHeader";
import { Select } from "../../components/Select";
import { SkeletonCard } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { CsvLink, PERSONAL_EYEBROW, PersonalLoadError, ProgressBar } from "../../components/personal/PersonalKit";
import { useSession } from "../../hooks/useSession";
import { formatDate, formatPct, parseMoney } from "../../lib/format";

const STATUS: Record<Goal["status"], { label: string; tone: "pos" | "warn" | "neutral" | "info" }> = {
  done: { label: "Reached", tone: "pos" },
  on_track: { label: "On track", tone: "pos" },
  behind: { label: "Behind", tone: "warn" },
  no_date: { label: "No target date", tone: "neutral" },
};

export default function GoalsPage() {
  const query = useGoals();
  const { data: session } = useSession();
  const toast = useToast();
  const create = usePersonalWrite<Record<string, unknown>>("/goals");
  const update = usePersonalWrite<Record<string, unknown> & { id: number }>((body) => `/goals/${body.id}`);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [account, setAccount] = useState("");
  const [current, setCurrent] = useState("");
  const [monthly, setMonthly] = useState("");
  const targetCents = parseMoney(target);
  const result = (title: string) => ({
    onSuccess: () => toast.toast({ tone: "success" as const, title }),
    onError: (error: unknown) => toast.toast({ tone: "error" as const, title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
  });
  const accounts = (session?.accounts ?? []).filter((acct) => acct.type !== "liability");
  return (
    <div className="page page--personal">
      <PageHeader title="Goals" eyebrow={PERSONAL_EYEBROW} subtitle="Progress from a linked account's balance, or amounts you enter" actions={<CsvLink name="goals" />} />
      {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
      <Card>
        <CardHeader title="New goal" />
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || targetCents === null || targetCents <= 0) return;
            create.mutate(
              {
                name,
                target_cents: targetCents,
                target_date: date || null,
                account_id: account || null,
                manual_current_cents: parseMoney(current) ?? 0,
                monthly_contribution_cents: parseMoney(monthly) ?? 0,
              },
              { ...result("Goal saved"), onSettled: () => setName("") },
            );
          }}
        >
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input input--sm" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Target ($)</span>
            <input className="input input--sm num" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">By</span>
            <input className="input input--sm" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <Select label="Linked account" size="sm" value={account} onChange={setAccount} options={[{ value: "", label: "None (enter amounts)" }, ...accounts.map((acct) => ({ value: acct.id, label: acct.short_name }))]} />
          {!account ? (
            <label className="field">
              <span className="field__label">Saved so far ($)</span>
              <input className="input input--sm num" inputMode="decimal" value={current} onChange={(event) => setCurrent(event.target.value)} />
            </label>
          ) : null}
          <label className="field">
            <span className="field__label">Planned per month ($)</span>
            <input className="input input--sm num" inputMode="decimal" value={monthly} onChange={(event) => setMonthly(event.target.value)} />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || targetCents === null || targetCents <= 0} loading={create.isPending}>
            Add goal
          </Button>
        </form>
      </Card>
      {query.isPending ? <SkeletonCard height={120} /> : null}
      {query.data && query.data.rows.length === 0 ? <EmptyState title="No goals yet">Add a savings goal above.</EmptyState> : null}
      <div className="goal-grid">
        {query.data?.rows.map((goal) => (
          <Card key={goal.id} as="article" className="goal-card">
            <CardHeader
              title={goal.name}
              subtitle={goal.account_label ? `Linked to ${goal.account_label}` : "Manual"}
              actions={<Badge tone={STATUS[goal.status].tone}>{STATUS[goal.status].label}</Badge>}
            />
            <p>
              <Money cents={goal.current_cents} strong /> of <Money cents={goal.target_cents} /> ({formatPct(goal.progress_pct)})
            </p>
            <ProgressBar pct={goal.progress_pct} status={goal.status} label={`${goal.name} progress`} />
            <dl className="goal-facts small">
              <div>
                <dt>Target date</dt>
                <dd>{goal.target_date ? formatDate(goal.target_date) : "—"}</dd>
              </div>
              <div>
                <dt>Needed per month</dt>
                <dd><Money cents={goal.required_monthly_cents} /></dd>
              </div>
              <div>
                <dt>{goal.monthly_contribution_cents ? "Planned per month" : "Recent pace"}</dt>
                <dd><Money cents={goal.monthly_contribution_cents || goal.observed_monthly_cents} /></dd>
              </div>
            </dl>
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: goal.id, archived: true }, result("Goal archived"))} aria-label={`Archive ${goal.name}`}>
              Archive
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
