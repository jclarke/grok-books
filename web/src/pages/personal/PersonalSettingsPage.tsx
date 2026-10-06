import { useState } from "react";
import { useAccountSettings, useAccountSettingsWrite, usePersonalWrite, type AccountSetting } from "../../api/personal";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { Select } from "../../components/Select";
import { SkeletonTable } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { PERSONAL_EYEBROW, PersonalLoadError } from "../../components/personal/PersonalKit";
import { useTheme } from "../../hooks/useTheme";

const SCOPES = [
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "excluded", label: "Excluded" },
];
const CLASSES = [
  { value: "cash", label: "Cash" },
  { value: "liability", label: "Credit card" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan / mortgage" },
  { value: "other", label: "Other" },
];

export default function PersonalSettingsPage() {
  const query = useAccountSettings();
  const write = useAccountSettingsWrite();
  const toast = useToast();
  const theme = useTheme();
  const reclassify = usePersonalWrite<Record<string, never>>("/reclassify");
  const [pending, setPending] = useState<{ account: AccountSetting; scope: AccountSetting["scope"] } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const save = (account: AccountSetting, changes: Parameters<typeof write.mutate>[0]["changes"], title: string) =>
    write.mutate(
      { id: account.id, changes },
      {
        onSuccess: (body) =>
          toast.toast({
            tone: "success",
            title,
            description: body.scope_change?.changed ? `${body.scope_change.transactions} transactions moved from ${body.scope_change.old_scope} to ${body.scope_change.scope}.` : undefined,
          }),
        onError: (error) => toast.toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : "" }),
      },
    );
  return (
    <div className="page page--personal">
      <PageHeader title="Settings" eyebrow={PERSONAL_EYEBROW} subtitle="Account scopes and personal preferences" />
      <Card padded={false}>
        <CardHeader
          title="Accounts"
          subtitle="Each account is business, personal, or excluded (in neither mode). Moving one never rewrites ledger rows; reports re-scope."
        />
        {query.isError ? <PersonalLoadError error={query.error} onRetry={() => query.refetch()} /> : null}
        {query.isPending ? <SkeletonTable rows={6} cols={6} /> : null}
        {query.data ? (
          <table className="table">
            <caption className="sr-only">Account settings</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Scope</th>
                <th scope="col">Class</th>
                <th scope="col">Net worth</th>
                <th scope="col">Daily sync</th>
                <th scope="col" className="hide-mobile">Display name</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((account) => (
                <tr key={account.id}>
                  <th scope="row">
                    <span>{account.label}</span>{" "}
                    <span className="muted small">
                      {account.institution} {account.last4 ? `···· ${account.last4}` : ""} · {account.transaction_count} transactions
                    </span>{" "}
                    {account.scope === "excluded" ? <Badge tone="neutral">excluded</Badge> : null}
                  </th>
                  <td>
                    <Select
                      label={`Scope of ${account.label}`}
                      hideLabel
                      size="sm"
                      value={account.scope}
                      options={SCOPES}
                      onChange={(value) => value !== account.scope && setPending({ account, scope: value as AccountSetting["scope"] })}
                    />
                  </td>
                  <td>
                    <Select
                      label={`Class of ${account.label}`}
                      hideLabel
                      size="sm"
                      value={account.class}
                      options={CLASSES}
                      onChange={(value) => save(account, { class: value }, "Class saved")}
                    />
                  </td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={account.include_in_net_worth} onChange={(event) => save(account, { include_in_net_worth: event.target.checked }, "Saved")} />
                      <span className="sr-only">Include {account.label} in net worth</span>
                    </label>
                  </td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={account.sync_enabled} onChange={(event) => save(account, { sync_enabled: event.target.checked }, "Saved")} />
                      <span className="sr-only">Sync {account.label} daily</span>
                    </label>
                  </td>
                  <td className="hide-mobile">
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        save(account, { display_name: names[account.id] ?? account.display_name }, "Name saved");
                      }}
                    >
                      <input
                        className="input input--sm"
                        aria-label={`Display name for ${account.label}`}
                        value={names[account.id] ?? account.display_name}
                        maxLength={120}
                        onChange={(event) => setNames((map) => ({ ...map, [account.id]: event.target.value }))}
                      />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Personal" />
        <div className="row-actions">
          <Button onClick={() => reclassify.mutate({}, { onSuccess: () => toast.toast({ tone: "success", title: "Personal rules re-run" }) })} loading={reclassify.isPending}>
            Re-run personal rules
          </Button>
          <Button onClick={theme.toggle} icon={theme.resolved === "dark" ? "sun" : "moon"}>
            {theme.resolved === "dark" ? "Light mode" : "Dark mode"}
          </Button>
        </div>
        <p className="muted small">Budgets run on calendar months. This browser keeps only the Business/Personal choice and display preferences; no balances or merchants are stored here.</p>
      </Card>
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Move this account?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={write.isPending}
              onClick={() => {
                if (!pending) return;
                save(pending.account, { scope: pending.scope }, "Scope changed");
                setPending(null);
              }}
            >
              Move to {pending?.scope}
            </Button>
          </>
        }
      >
        {pending ? (
          <p>
            {pending.account.transaction_count} transactions from <strong>{pending.account.label}</strong> will move from <strong>{pending.account.scope}</strong> to{" "}
            <strong>{pending.scope}</strong>. {pending.scope === "excluded" ? "Excluded accounts appear in neither mode." : ""} Ledger rows are not changed, and you can move it back.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
