import { describe, expect, it } from "vitest";
import { allTimeRange, calendarToday, isIsoDate, iso, matchPreset, monthEnd, presets, shiftMonth } from "../lib/dates";
import { reconcilePhrase, shownCents } from "../lib/balances";
import { formatCompact, formatDate, formatMoney, formatPct, formatRange, parseMoney } from "../lib/format";
import { lockedCategory, tagLabel } from "../lib/labels";
import { buildQuery } from "../api/client";

describe("format", () => {
  it("formats cents as dollars with separators and a minus sign", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-500)).toBe("-$5.00");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(123456, { whole: true })).toBe("$1,235");
  });
  it("formats percentages and compact axis labels", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(150)).toBe("150%");
    expect(formatPct(5, { signed: true })).toBe("+5.0%");
    expect(formatPct(null)).toBe("—");
    expect(formatCompact(1234500)).toBe("$12.3K");
  });
  it("parses typed money", () => {
    expect(parseMoney("1,234.50")).toBe(123450);
    expect(parseMoney("$12")).toBe(1200);
    expect(parseMoney("-3.1")).toBe(-310);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("formats dates and ranges", () => {
    expect(formatDate("2026-09-04")).toBe("Sep 4, 2026");
    expect(formatRange("2026-09-01", "2026-09-30")).toBe("Sep 1 – Sep 30, 2026");
    expect(formatRange("2025-12-01", "2026-01-31")).toBe("Dec 1, 2025 – Jan 31, 2026");
  });
});

describe("balances", () => {
  it("prefers the statement figure and describes a reconciliation gap", () => {
    expect(shownCents({ balance_cents: -5000, display_cents: 4200 })).toBe(4200);
    expect(shownCents({ balance_cents: 100 })).toBe(100);
    expect(reconcilePhrase({ anchored: true, drift_cents: 0, reconcile_cents: 8000 })).toBe("Reconciles to $80.00");
    expect(reconcilePhrase({ anchored: true, drift_cents: 500, anchor_cents: 4000, computed_cents: 3500 })).toBe(
      "Reconciliation difference $5.00 (statement $40.00, computed $35.00)",
    );
    expect(reconcilePhrase({ anchored: false })).toBeNull();
  });
});

describe("dates", () => {
  it("handles month math", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });
  it("falls back to the local calendar day, not the UTC date", () => {
    const evening = new Date(2026, 9, 1, 23, 30, 0);
    expect(calendarToday(undefined, evening)).toBe("2026-10-01");
    expect(calendarToday(null, evening)).toBe(iso(evening));
    expect(calendarToday("2026-09-30", evening)).toBe("2026-09-30");
    const utcDay = evening.toISOString().slice(0, 10);
    if (utcDay !== iso(evening)) expect(calendarToday(undefined, evening)).not.toBe(utcDay);
  });
  it("builds presets from the latest month with data", () => {
    const list = presets("2026-10-01", "2026-09", "2026-01");
    expect(list.find((p) => p.key === "latest-month")?.range).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(list.find((p) => p.key === "ytd")?.range).toEqual({ start: "2026-01-01", end: "2026-10-01" });
    expect(list.find((p) => p.key === "this-quarter")?.range).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(matchPreset(list, { start: "2026-08-01", end: "2026-08-31" })?.key).toBe("prev-month");
    expect(allTimeRange(["2026-01", "2026-09"], "2026-09", "2026-10-01")).toEqual({ start: "2026-01-01", end: "2026-10-01" });
  });
});

describe("labels and query strings", () => {
  it("labels tags and locks owner draw / transfer categories", () => {
    expect(tagLabel("branda")).toBe("Brand A");
    expect(tagLabel(null)).toBe("Needs review");
    expect(lockedCategory("owner_draw")).toBe("Owner Draw");
    expect(lockedCategory("general")).toBeNull();
  });
  it("drops empty params", () => {
    expect(buildQuery({ a: "1", b: "", c: null, d: false, e: true, f: 0 })).toBe("?a=1&e=1&f=0");
    expect(buildQuery({})).toBe("");
  });
});
