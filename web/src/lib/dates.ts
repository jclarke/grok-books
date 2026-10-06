export interface DateRange {
  start: string;
  end: string;
}

export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Session calendar day, or the local calendar day while the session is still loading. */
export function calendarToday(sessionToday: string | null | undefined, now = new Date()): string {
  return sessionToday ?? iso(now);
}

export function parseIso(text: string): Date {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isIsoDate(text: string | null | undefined): text is string {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = parseIso(text);
  return iso(d) === text;
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return iso(new Date(y, m, 0));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return iso(d).slice(0, 7);
}

export type PresetKey =
  | "latest-month"
  | "prev-month"
  | "this-quarter"
  | "last-quarter"
  | "ytd"
  | "last-12"
  | "last-year"
  | "all";

export interface Preset {
  key: PresetKey;
  label: string;
  range: DateRange;
}

/**
 * Presets relative to the latest month with data (the books lag the calendar)
 * and to today for year-to-date.
 */
export function presets(today: string, latestMonth: string, firstMonth: string): Preset[] {
  const year = Number(today.slice(0, 4));
  const latestYear = latestMonth.slice(0, 4);
  const q = Math.floor((Number(latestMonth.slice(5, 7)) - 1) / 3);
  const qStart = `${latestYear}-${String(q * 3 + 1).padStart(2, "0")}`;
  const lastQStart = shiftMonth(qStart, -3);
  return [
    { key: "latest-month", label: "Current month", range: { start: monthStart(latestMonth), end: monthEnd(latestMonth) } },
    { key: "prev-month", label: "Last month", range: { start: monthStart(shiftMonth(latestMonth, -1)), end: monthEnd(shiftMonth(latestMonth, -1)) } },
    { key: "this-quarter", label: "Quarter to date", range: { start: monthStart(qStart), end: monthEnd(latestMonth) } },
    { key: "last-quarter", label: "Last quarter", range: { start: monthStart(lastQStart), end: monthEnd(shiftMonth(lastQStart, 2)) } },
    { key: "ytd", label: "Year to date", range: { start: `${year}-01-01`, end: today } },
    { key: "last-12", label: "Last 12 months", range: { start: monthStart(shiftMonth(latestMonth, -11)), end: monthEnd(latestMonth) } },
    { key: "last-year", label: `${year - 1}`, range: { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` } },
    { key: "all", label: "All time", range: { start: monthStart(firstMonth), end: monthEnd(latestMonth) > today ? monthEnd(latestMonth) : today } },
  ];
}

export function matchPreset(list: Preset[], range: DateRange): Preset | undefined {
  return list.find((p) => p.range.start === range.start && p.range.end === range.end);
}

export function isWholeMonth(range: DateRange): boolean {
  return range.start.endsWith("-01") && range.start.slice(0, 7) === range.end.slice(0, 7) && monthEnd(range.start.slice(0, 7)) === range.end;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

/** First month with data through the later of today and the latest month's end. */
export function allTimeRange(months: string[], latestMonth: string, today: string): DateRange {
  const first = months[0] ?? latestMonth;
  const end = monthEnd(latestMonth) > today ? monthEnd(latestMonth) : today;
  return { start: monthStart(first), end };
}
