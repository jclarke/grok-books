import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiPost } from "../api/client";
import { LEDGER_FAMILIES } from "../api/queries";
import type { BulkResult, Classification, ClassifiedRow, ClassifyResult, Session } from "../api/types";
import { useToast } from "../components/Toast";
import { lockedCategory, tagLabel } from "../lib/labels";
import { sessionKey } from "./useSession";

export interface ClassifyInput {
  txn_id: string;
  tag: string;
  category: string;
  note?: string;
  save_rule?: boolean;
  pattern?: string;
}

type Patch = { business_tag: string; category: string; note?: string; source?: string };
type Snapshot = [readonly unknown[], unknown][];

interface RowLike {
  id: string;
  business_tag: string;
  category: string;
  note?: string;
  source?: string;
}

function patchRows(data: unknown, ids: Set<string>, patch: (row: RowLike) => RowLike): unknown {
  if (!data || typeof data !== "object") return data;
  const value = data as { rows?: RowLike[] };
  if (!Array.isArray(value.rows)) return data;
  let changed = false;
  const rows = value.rows.map((row) => {
    if (!ids.has(row.id)) return row;
    changed = true;
    return patch(row);
  });
  return changed ? { ...value, rows } : data;
}

/** Apply the edit to every cached list right away; return what to roll back to. */
function optimistic(client: QueryClient, ids: string[], patch: Patch): Snapshot {
  const idSet = new Set(ids);
  const snapshot: Snapshot = [];
  for (const family of ["transactions", "register"]) {
    for (const [key, data] of client.getQueriesData({ queryKey: [family] })) {
      snapshot.push([key, data]);
      client.setQueryData(key, patchRows(data, idSet, (row) => ({ ...row, ...patch, source: "manual" })));
    }
  }
  return snapshot;
}

function restore(client: QueryClient, snapshot: Snapshot): void {
  for (const [key, data] of snapshot) client.setQueryData(key, data);
}

function applyServerRows(client: QueryClient, rows: ClassifiedRow[]): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ids = new Set(byId.keys());
  for (const family of ["transactions", "register"]) {
    for (const [key, data] of client.getQueriesData({ queryKey: [family] })) {
      client.setQueryData(key, patchRows(data, ids, (row) => ({ ...row, ...byId.get(row.id) })));
    }
  }
}

function setReviewCount(client: QueryClient, count: number): void {
  client.setQueryData<Session>([...sessionKey, "business"], (session) => (session ? { ...session, review_count: count } : session));
}

export function invalidateLedger(client: QueryClient, except: string[] = []): void {
  for (const family of LEDGER_FAMILIES) {
    if (except.includes(family)) continue;
    void client.invalidateQueries({ queryKey: [family] });
  }
}

/** Single-row classification with an optimistic update and an Undo toast. */
export function useClassify() {
  const client = useQueryClient();
  const { toast } = useToast();
  const undo = useUndo();
  return useMutation({
    mutationFn: (input: ClassifyInput) => apiPost<ClassifyResult>("/classify", { ...input, note: input.note ?? "" }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["transactions"] });
      await client.cancelQueries({ queryKey: ["register"] });
      const category = lockedCategory(input.tag) ?? input.category;
      return optimistic(client, [input.txn_id], { business_tag: input.tag, category, note: input.note });
    },
    onError: (error, _input, snapshot) => {
      if (snapshot) restore(client, snapshot);
      toast({ tone: "error", title: "Couldn't save", description: error instanceof Error ? error.message : String(error) });
    },
    onSuccess: (result, input) => {
      applyServerRows(client, [result.row]);
      setReviewCount(client, result.review_count);
      invalidateLedger(client, ["transactions", "register"]);
      const extra = result.rule_created ? ` Rule created${result.applied_others ? ` and applied to ${result.applied_others} more` : ""}.` : "";
      toast({
        tone: "success",
        title: `Saved as ${tagLabel(result.row.business_tag)} · ${result.row.category}`,
        description: extra.trim() || undefined,
        action: result.rule_created ? undefined : { label: "Undo", onClick: () => undo.mutateAsync([{ txn_id: input.txn_id, previous: result.previous }]).then(() => undefined) },
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["transactions"] });
      void client.invalidateQueries({ queryKey: ["register"] });
    },
  });
}

export interface BulkInput {
  txn_ids: string[];
  tag: string;
  category: string;
  note?: string;
}

export function useBulkClassify() {
  const client = useQueryClient();
  const { toast } = useToast();
  const undo = useUndo();
  return useMutation({
    mutationFn: (input: BulkInput) => apiPost<BulkResult>("/classify/bulk", { ...input, note: input.note ?? "" }),
    onMutate: (input) => optimistic(client, input.txn_ids, { business_tag: input.tag, category: lockedCategory(input.tag) ?? input.category, note: input.note }),
    onError: (error, _input, snapshot) => {
      if (snapshot) restore(client, snapshot);
      toast({ tone: "error", title: "Couldn't classify", description: error instanceof Error ? error.message : String(error) });
    },
    onSuccess: (result) => {
      applyServerRows(client, result.rows);
      setReviewCount(client, result.review_count);
      invalidateLedger(client);
      toast({
        tone: "success",
        title: `Classified ${result.count} transaction${result.count === 1 ? "" : "s"}`,
        action: { label: "Undo", onClick: () => undo.mutateAsync(result.previous).then(() => undefined) },
      });
    },
  });
}

export function useUndo() {
  const client = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (items: { txn_id: string; previous: Classification | null }[]) =>
      apiPost<{ rows: ClassifiedRow[]; review_count: number }>("/classify/undo", { items }),
    onSuccess: (result) => {
      applyServerRows(client, result.rows);
      setReviewCount(client, result.review_count);
      invalidateLedger(client);
      toast({ tone: "info", title: "Change undone" });
    },
    onError: (error) => toast({ tone: "error", title: "Couldn't undo", description: error instanceof Error ? error.message : String(error) }),
  });
}
