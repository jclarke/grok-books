const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const moneyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Cents to "$1,234.56" or "-$1,234.56". */
export function formatMoney(cents: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const value = cents / 100;
  return (opts.whole ? moneyWhole : money).format(value);
}

/** Short axis labels: "$12.3K". */
export function formatCompact(cents: number): string {
  return compact.format(cents / 100);
}

export function formatSigned(cents: number): string {
  if (cents > 0) return "+" + formatMoney(cents);
  return formatMoney(cents);
}

export function formatPct(value: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = `${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}%`;
  if (opts.signed && value > 0) return "+" + text;
  return text;
}

/** Dollars typed by a person ("1,234.5", "$-12") to integer cents, or null. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === "-" || cleaned === ".") return null;
  return Math.round(Number(cleaned) * 100);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-04" -> "Sep 4, 2026" */
export function formatDate(iso: string | null | undefined, opts: { year?: boolean } = { year: true }): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const base = `${MONTHS[m - 1]} ${d}`;
  return opts.year === false ? base : `${base}, ${y}`;
}

/** "2026-09" -> "Sep 2026" */
export function formatMonth(month: string, opts: { short?: boolean } = {}): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return opts.short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const sy = start.slice(0, 4);
  const ey = end.slice(0, 4);
  if (sy === ey) return `${formatDate(start, { year: false })} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function pluralize(count: number, one: string, many = one + "s"): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
