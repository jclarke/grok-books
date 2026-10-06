import { useCallback, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { Business } from "../api/types";
import { calendarToday, isIsoDate, monthEnd, monthStart, type DateRange } from "../lib/dates";
import { useConfig } from "./useConfig";
import { useSession } from "./useSession";

export const GLOBAL_KEYS = ["business", "start", "end", "mode"] as const;

export type RangeDefault = "month" | "ytd";

/** Pages that look at one month by default; everything else opens on year to date. */
export function defaultKindFor(pathname: string): RangeDefault {
  if (pathname === "/" || pathname.startsWith("/transactions") || pathname.startsWith("/accounts")) return "month";
  if (pathname === "/personal" || pathname.startsWith("/personal/transactions") || pathname.startsWith("/personal/spending")) return "month";
  return "ytd";
}

export function defaultRange(kind: RangeDefault, today: string, latestMonth: string): DateRange {
  if (kind === "month") return { start: monthStart(latestMonth), end: monthEnd(latestMonth) };
  const year = latestMonth.slice(0, 4);
  const end = today.startsWith(year) ? today : `${year}-12-31`;
  return { start: `${year}-01-01`, end };
}

export interface GlobalFilters {
  business: Business;
  start: string;
  end: string;
  /** True when the URL has no explicit range and the page default is in use. */
  isDefaultRange: boolean;
  setBusiness: (business: Business) => void;
  setRange: (range: DateRange | null) => void;
}

/**
 * The business filter and date range live in the URL (?business=&start=&end=)
 * so reloads, links, and the back button keep them.
 */
export function useGlobalFilters(): GlobalFilters {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { data: session } = useSession();
  const config = useConfig();
  const businesses: Business[] = ["all", ...config.businesses.map((row) => row.slug)];
  // Local calendar day. toISOString() is UTC and shifts the date in the evening
  // for anyone west of UTC. The session value wins once it has loaded.
  const today = calendarToday(session?.today);
  const latest = session?.latest_month ?? today.slice(0, 7);

  const rawBusiness = params.get("business") as Business | null;
  const business: Business = rawBusiness && businesses.includes(rawBusiness) ? rawBusiness : "all";
  const rawStart = params.get("start");
  const rawEnd = params.get("end");
  const explicit = isIsoDate(rawStart) && isIsoDate(rawEnd) && rawStart <= rawEnd;
  const fallback = useMemo(() => defaultRange(defaultKindFor(location.pathname), today, latest), [location.pathname, today, latest]);
  const start = explicit ? (rawStart as string) : fallback.start;
  const end = explicit ? (rawEnd as string) : fallback.end;

  const setBusiness = useCallback(
    (next: Business) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next === "all") copy.delete("business");
          else copy.set("business", next);
          copy.delete("offset");
          return copy;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const setRange = useCallback(
    (range: DateRange | null) => {
      setParams((prev) => {
        const copy = new URLSearchParams(prev);
        if (range) {
          copy.set("start", range.start);
          copy.set("end", range.end);
        } else {
          copy.delete("start");
          copy.delete("end");
        }
        copy.delete("offset");
        return copy;
      });
    },
    [setParams],
  );

  return { business, start, end, isDefaultRange: !explicit, setBusiness, setRange };
}

/** Carry the global filters onto an in-app link. */
export function withGlobal(path: string, search: URLSearchParams | string, extra: Record<string, string> = {}): string {
  const current = typeof search === "string" ? new URLSearchParams(search) : search;
  const [base, query = ""] = path.split("?");
  const next = new URLSearchParams(query);
  for (const key of GLOBAL_KEYS) {
    const value = current.get(key);
    if (value && !next.has(key)) next.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const text = next.toString();
  return text ? `${base}?${text}` : base;
}
