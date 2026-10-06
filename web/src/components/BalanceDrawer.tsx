import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../api/client";
import type { BalanceInfo } from "../api/types";
import { invalidateLedger } from "../hooks/useClassify";
import { useSessionData } from "../hooks/useSession";
import { reconcilePhrase, sourceLabel } from "../lib/balances";
import { formatDate, formatMoney, parseMoney } from "../lib/format";
import { Button } from "./Button";
import { Drawer } from "./Modal";
import { TextField } from "./Select";
import { useToast } from "./Toast";

export function BalanceMeta({
  row,
  owed,
}: {
  row: BalanceInfo;
  /** Liability figures are an amount owed, including the unanchored fallback. */
  owed?: boolean;
}) {
  if (!row.anchored) {
    return <p className="muted small">{owed ? "Imported activity, as amount owed" : "Imported activity"}</p>;
  }
  const phrase = reconcilePhrase(row);
  return (
    <p className="muted small">
      as of {formatDate(row.as_of_date)}
      {row.source ? ` · ${sourceLabel(row.source)}` : ""}
      {row.opening_cents !== null && row.opening_cents !== undefined ? ` · opening ${formatMoney(row.opening_cents)}` : ""}
      {phrase ? ` · ${phrase}` : ""}
    </p>
  );
}

export function useSetBalance() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { account_id: string; balance: string; as_of: string; source: "statement"; note: string }) =>
      apiPost<{ ok: true; balance: BalanceInfo }>("/balances", body),
    onSuccess: (result) => {
      invalidateLedger(client);
      const when = result.balance.as_of_date ? ` as of ${formatDate(result.balance.as_of_date)}` : "";
      toast({ tone: "success", title: `Balance saved${when}` });
    },
    onError: (error) =>
      toast({
        tone: "error",
        title: "Couldn't save the balance",
        description: error instanceof Error ? error.message : String(error),
      }),
  });
}

export function BalanceDrawer({
  open,
  onClose,
  accountId,
  accountName,
  accountType,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  accountName: string;
  accountType: "cash" | "liability";
}) {
  const session = useSessionData();
  const save = useSetBalance();
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(session.today);
  const [note, setNote] = useState("");
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBalance("");
    setAsOf(session.today);
    setNote("");
    setBalanceError(null);
    setDateError(null);
  }, [open, accountId, session.today]);

  function submit() {
    const cents = parseMoney(balance);
    let ok = true;
    if (cents === null) {
      setBalanceError("Enter a dollar amount with at most two decimal places.");
      ok = false;
    } else {
      setBalanceError(null);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      setDateError("Enter a statement date.");
      ok = false;
    } else {
      setDateError(null);
    }
    if (!ok || cents === null) return;
    save.mutate(
      {
        account_id: accountId,
        balance: (cents / 100).toFixed(2),
        as_of: asOf,
        source: "statement",
        note: note.trim(),
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Update balance"
      description={accountName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save balance
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Statement balance"
          inputMode="decimal"
          autoComplete="off"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          error={balanceError}
          hint={
            accountType === "liability"
              ? "Amount owed. A credit balance is negative. Pending charges on this date stay inside the anchor."
              : "Money in the account. Pending charges on this date stay inside the anchor."
          }
        />
        <TextField label="Statement date" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} error={dateError} />
        <TextField label="Note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} hint="Optional. Stored with the anchor." />
      </div>
    </Drawer>
  );
}
