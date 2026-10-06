import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { TextField } from "../components/Select";
import { useSessionData } from "../hooks/useSession";
import { useTheme, type ThemeChoice } from "../hooks/useTheme";
import { centsToInput, formatMoney, parseMoney } from "../lib/format";
import { useSaveReserve } from "./CalendarPage";

export default function SettingsPage() {
  const session = useSessionData();
  const theme = useTheme();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<{ reserve_cents: number }>("/settings") });
  const save = useSaveReserve();
  const [text, setText] = useState("");
  useEffect(() => {
    if (settings.data) setText(centsToInput(settings.data.reserve_cents));
  }, [settings.data]);
  const cents = parseMoney(text);
  const invalid = text.trim() !== "" && (cents === null || cents < 0);
  return (
    <div className="page page--narrow">
      <PageHeader title="Settings" subtitle={`${session.product} for ${session.company}`} />
      <Card>
        <CardHeader title="Appearance" subtitle="Follow the system setting or pick one. Saved in this browser." />
        <SegmentedControl<ThemeChoice>
          label="Color theme"
          value={theme.choice}
          onChange={theme.setChoice}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Cash reserve" subtitle="The cushion the 60-day outlook compares against. Changes are written to the audit log." />
        <form
          className="settings-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (cents !== null && cents >= 0) save.mutate(cents);
          }}
        >
          <TextField label="Reserve (USD)" inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} error={invalid ? "Enter an amount of 0 or more, like 2500.00" : null} hint={settings.data ? `Saved: ${formatMoney(settings.data.reserve_cents)}` : undefined} />
          <Button type="submit" variant="primary" disabled={invalid || cents === null || cents === settings.data?.reserve_cents} loading={save.isPending}>
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Data and privacy" />
        <ul className="plain-list">
          <li>The ledger is an encrypted SQLCipher database on this machine. The key never leaves it and is never sent to this page.</li>
          <li>The server only listens on 127.0.0.1. A tailnet address can reach it through Tailscale and has to sign in; this computer does not. Every edit needs this session's CSRF token and is recorded in the audit log.</li>
          <li>The app loads no fonts, scripts, or images from the internet.</li>
          <li>Saved filters and the theme choice are kept in this browser only.</li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Reference" />
        <dl className="details">
          <div><dt>Accounts</dt><dd>{session.accounts.map((acct) => acct.short_name).join(", ")}</dd></div>
          <div><dt>Months with data</dt><dd>{session.months.length ? `${session.months[0]} to ${session.months[session.months.length - 1]}` : "None yet"}</dd></div>
          <div><dt>Categories</dt><dd>{session.categories.length}</dd></div>
          <div><dt>Keyboard</dt><dd>Press <kbd>?</kbd> anywhere for shortcuts</dd></div>
        </dl>
      </Card>
    </div>
  );
}
