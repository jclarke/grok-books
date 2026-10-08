"""Stripe business analytics: MRR, churn, cohorts, margins, fees, Capital, LTV,
concentration, failed-payment recovery, refund trends, and a cash forecast. Read-only.

Everything comes from the imported Stripe objects (stripe_objects) and balance
transactions (stripe), in the books currency, by month in the [stripe]
timezone. Money is integer cents; MRR is computed in fractional cents per
subscription and rounded once per customer, so every MRR total and the
movement bridge add up exactly. Definitions (also in docs/stripe.md, Business
analytics):

- MRR at month end (for the current month: today) counts subscriptions that
  had started and not ended, excluding trials (reported as trialing MRR) and,
  today, unpaid / paused / incomplete ones. An item is unit_amount x quantity
  per month (year / 12, week x 52 / 12, day x 365 / 12, / interval_count) less
  recurring discounts; metered prices are usage revenue, not MRR. Past months
  take the amounts of the subscription's invoice lines for that period
  (subscription_create / cycle / update invoices, prorations excluded), else
  the current items (listed in `approximations`).
- Discounts apply while start <= T < end (no end: forever; `repeating` without
  an end: start + duration_in_months); `once` coupons never count. A coupon
  saved as an id only is resolved through stripe_coupons (GetCoupons); one
  that is not imported falls back to the paid invoice's discounted share. An
  amount_off is per billing period, made monthly with the interval, and never
  takes MRR below zero. A subscription that a forever coupon takes to zero is
  "free": not a paying customer (ARPA, churn, cohorts), counted as
  free_subscriptions.
- Movement per customer, month over month (as whmcs_reports): new (first MRR
  ever), reactivated (MRR again after some month at zero), expansion,
  contraction, churned (MRR to zero). opening + new + reactivated + expansion
  - contraction - churned = closing, exactly.
- Churn: customer churn = churned customers / customers at the start of the
  month; gross revenue churn = (churned + contraction) / opening MRR; net
  revenue churn = (churned + contraction - expansion) / opening MRR. NRR =
  (opening + expansion - contraction - churned) / opening; GRR the same
  without expansion; trailing 12 months over the customers who had MRR 12
  months earlier.
- Revenue attribution: a revenue balance transaction -> its charge -> the
  invoice (through invoice payments, else legacy fields, else the same
  customer and amount paid within 2 days) -> the invoice lines' products, the
  charge prorated by line amount. Anything unlinked is "Unattributed".
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

from hpbooks.config import StripeAccount, StripeConfig, get_config
from hpbooks.db import HpbooksError, _table_exists, format_money
from hpbooks.reports import months_covering, prev_month, require_date
from hpbooks.stripe import settings

SECTIONS = ("mrr", "churn", "cohorts", "margin", "fees", "capital", "ltv", "concentration", "recovery", "refunds", "forecast")
UNATTRIBUTED = "Unattributed"
METHODS = ("card", "link", "ach", "other")
METHOD_LABELS = {"card": "Card", "link": "Link (card-funded)", "ach": "ACH (us_bank_account)", "other": "Other", "total": "Total"}
ACH_RATE = 0.008  # Stripe ACH Direct Debit list price: 0.8%, capped at $5 per charge
ACH_CAP_CENTS = 500
LTV_MAX_MONTHS = 60  # LTV lifetime cap when revenue churn is about zero
HEURISTIC_DAYS = 2
DEFAULT_AVAILABLE_DAYS = 2
DEFAULT_ARRIVAL_DAYS = 2
SUB_REASONS = ("subscription_create", "subscription_cycle", "subscription_update", "subscription")
INVOICE_LIVE = ("paid", "open", "uncollectible")
MAX_MONTHS = 120
_CHARGE_RE = re.compile(r"\b((?:ch|py)_[A-Za-z0-9]+)\b")


# --- small helpers -----------------------------------------------------------------------


def _pct(part, whole, digits: int = 2) -> float | None:
    if not whole:
        return None
    return round(part * 100.0 / whole, digits)


def _next_month(month: str) -> str:
    year, num = int(month[:4]), int(month[5:7])
    return f"{year + 1:04d}-01" if num == 12 else f"{year:04d}-{num + 1:02d}"


def _add_months(month: str, n: int) -> str:
    idx = int(month[:4]) * 12 + int(month[5:7]) - 1 + n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _month_diff(a: str, b: str) -> int:
    """Months from a to b."""
    return (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))


def _span(first: str, last: str) -> list[str]:
    out, month = [], first
    while month <= last:
        out.append(month)
        month = _next_month(month)
    return out


def monthly_amount(amount: float, interval: str | None, count: int | None) -> float | None:
    """A recurring amount per month: month / count, year / 12, week x 52 / 12, day x 365 / 12."""
    count = count or 1
    if interval == "month":
        return amount / count
    if interval == "year":
        return amount / (12 * count)
    if interval == "week":
        return amount * 52 / 12 / count
    if interval == "day":
        return amount * 365 / 12 / count
    return None


def allocate(total: int, weights: list[tuple[str, float]]) -> dict[str, int]:
    """Split integer cents by weights (may be negative); the parts add up to `total` exactly."""
    whole = sum(w for _k, w in weights)
    if not weights or not whole:
        return {UNATTRIBUTED: total}
    out: dict[str, int] = defaultdict(int)
    running = 0.0
    given = 0
    for key, weight in weights:
        running += weight
        upto = int(round(total * running / whole))
        out[key] += upto - given
        given = upto
    return dict(out)


def method_bucket(method: str | None) -> str:
    if method in ("card", "card_present"):
        return "card"
    if method == "link":
        return "link"
    if method == "us_bank_account":
        return "ach"
    return "other"


class Clock:
    """Unix times and books-time-zone dates. `now_ts` is the start of tomorrow."""

    def __init__(self, tz: str, today: date):
        self.tz = ZoneInfo(tz)
        self.today = today
        self.now_ts = self.day_ts(today + timedelta(days=1))
        self.current_month = today.isoformat()[:7]
        self._days: dict[int, str] = {}

    def day_ts(self, day: date) -> int:
        return int(datetime(day.year, day.month, day.day, tzinfo=self.tz).timestamp())

    def month_start_ts(self, month: str) -> int:
        return self.day_ts(date(int(month[:4]), int(month[5:7]), 1))

    def month_T(self, month: str) -> int:
        """The instant a month-end snapshot is taken: the end of the month, or today for the current month."""
        return min(self.month_start_ts(_next_month(month)), self.now_ts)

    def day(self, ts: int) -> str:
        key = int(ts) // 60
        if key not in self._days:
            self._days[key] = datetime.fromtimestamp(int(ts), self.tz).date().isoformat()
        return self._days[key]

    def month(self, ts: int) -> str:
        return self.day(ts)[:7]


class Notes:
    """Approximations, each listed once; "{n}" in a text becomes the number of distinct keys it was noted for."""

    def __init__(self):
        self.keys: dict[str, set] = {}

    def add(self, text: str, key=None) -> None:
        self.keys.setdefault(text, set()).add(key)

    def list(self) -> list[str]:
        return [text.replace("{n}", str(len(keys))) for text, keys in self.keys.items()]


# --- loading ------------------------------------------------------------------------------


def _rows(conn, sql: str, names: list[str], extra: tuple = ()) -> list[dict]:
    marks = ", ".join("?" for _ in names)
    return [dict(row) for row in conn.execute(sql.format(marks=marks), (*names, *extra))]


class Data:
    """Everything the metrics read, for the selected Stripe accounts."""

    def __init__(self, conn, cfg: StripeConfig, accounts: list[StripeAccount], clock: Clock):
        self.cfg = cfg
        self.accounts = accounts
        self.clock = clock
        self.currency = cfg.books_currency
        self.notes = Notes()
        names = [a.name for a in accounts]
        self.ready = bool(names) and _table_exists(conn, "stripe_subscriptions")
        empty = not self.ready
        q = (lambda sql, extra=(): [] if empty else _rows(conn, sql, names, extra))
        self.products = {r["id"]: r for r in q("SELECT * FROM stripe_products WHERE account IN ({marks})")}
        self.prices = {r["id"]: r for r in q("SELECT * FROM stripe_prices WHERE account IN ({marks})")}
        self.customers = {r["id"]: r for r in q("SELECT * FROM stripe_customers WHERE account IN ({marks})")}
        self.coupons = {} if empty or not _table_exists(conn, "stripe_coupons") else {
            r["id"]: r for r in q("SELECT * FROM stripe_coupons WHERE account IN ({marks})")}
        items = defaultdict(list)
        for row in q("SELECT * FROM stripe_subscription_items WHERE account IN ({marks}) ORDER BY id"):
            row["discounts"] = self._resolve(json.loads(row["discounts_json"] or "[]"))
            items[row["subscription"]].append(row)
        self.subs = []
        other_currency = 0
        for row in q("SELECT * FROM stripe_subscriptions WHERE account IN ({marks}) ORDER BY start_ts, id"):
            row["items"] = items.get(row["id"], [])
            row["discounts"] = self._resolve(json.loads(row["discounts_json"] or "[]"))
            row["cust"] = row["customer"] or row["id"]
            currency = row["currency"] or next((i["currency"] for i in row["items"] if i["currency"]), None)
            if currency and currency != self.currency:
                other_currency += 1
                continue
            self.subs.append(row)
        if other_currency:
            self.notes.add(f"{other_currency} subscription(s) in another currency than the books are left out of MRR")
        self.subs_by_id = {s["id"]: s for s in self.subs}
        lines = defaultdict(list)
        for row in q("SELECT * FROM stripe_invoice_lines WHERE account IN ({marks}) ORDER BY invoice, line"):
            lines[row["invoice"]].append(row)
        self.invoices = {}
        for row in q("SELECT * FROM stripe_invoices WHERE account IN ({marks}) ORDER BY created_ts, id"):
            if row["currency"] and row["currency"] != self.currency:
                continue
            row["lines"] = lines.get(row["id"], [])
            self.invoices[row["id"]] = row
        self.invoices_by_sub: dict[str, list[dict]] = defaultdict(list)
        for inv in self.invoices.values():
            if inv["subscription"]:
                self.invoices_by_sub[inv["subscription"]].append(inv)
        self.inv_payments = q("SELECT * FROM stripe_invoice_payments WHERE account IN ({marks}) ORDER BY created_ts, id")
        self.charges = {r["id"]: r for r in q("SELECT * FROM stripe_charges WHERE account IN ({marks}) ORDER BY created_ts, id")}
        for row in self.charges.values():
            row["refunds"] = json.loads(row["refunds_json"] or "[]")
        has_btx = bool(names) and _table_exists(conn, "stripe_balance_transactions")
        self.btx = [] if not has_btx else _rows(
            conn,
            "SELECT account, id, type, booking, amount_cents, fee_cents, currency, created, created_ts, available_on, "
            "source_id, description FROM stripe_balance_transactions WHERE account IN ({marks}) "
            "AND booking IN ('revenue', 'refund', 'dispute', 'fee', 'capital') ORDER BY created_ts, id",
            names,
        )
        self.payouts = [] if not has_btx else _rows(conn, "SELECT * FROM stripe_payouts WHERE account IN ({marks})", names)
        ledger_ids = [f"stripe:{n}:%:capfee" for n in names]
        self.capfee = []
        for pattern in ledger_ids:
            self.capfee.extend(
                dict(r) for r in conn.execute(
                    "SELECT date, amount_cents FROM transactions WHERE id LIKE ? AND status = 'active'", (pattern,)
                )
            )
        # Price facts for invoice lines: the prices file, else the subscription items.
        self.price_meta: dict[str, dict] = {}
        for sub in self.subs:
            for item in sub["items"]:
                if item["price"]:
                    self.price_meta.setdefault(item["price"], item)
        for price_id, row in self.prices.items():
            self.price_meta[price_id] = row

    def _resolve(self, discounts: list[dict]) -> list[dict]:
        """Coupon terms for discounts whose coupon is only an id (from stripe_coupons), and the end of a
        `repeating` coupon without one. An amount_off in another currency is left out (listed)."""
        out = []
        for disc in discounts:
            coupon = self.coupons.get(disc.get("coupon") or "") if disc.get("id_only") else None
            if coupon is not None:
                disc = {key: value for key, value in disc.items() if key != "id_only"}
                disc.update({key: coupon[key] for key in ("percent_off", "amount_off", "currency", "duration", "duration_in_months")})
            if disc.get("id_only"):
                out.append(disc)
                continue
            if disc.get("duration") == "repeating" and disc.get("end") is None and disc.get("start") is not None and disc.get("duration_in_months"):
                disc = {**disc, "end": _add_interval(disc["start"], "month", disc["duration_in_months"], self.clock.tz)}
            if disc.get("amount_off") and not disc.get("percent_off") and disc.get("currency") and disc["currency"] != self.currency:
                self.notes.add("{n} amount-off coupon(s) in another currency than the books are not applied", disc.get("coupon"))
                continue
            out.append(disc)
        return out

    def product_name(self, product: str) -> str:
        if product == UNATTRIBUTED:
            return UNATTRIBUTED
        row = self.products.get(product)
        return (row or {}).get("name") or product

    def line_product(self, line: dict) -> str:
        if line["product"]:
            return line["product"]
        meta = self.price_meta.get(line["price"] or "")
        return (meta or {}).get("product") or UNATTRIBUTED


# --- MRR ------------------------------------------------------------------------------------


def _discount_active(disc: dict, T: int) -> bool:
    if disc.get("id_only") or disc.get("duration") == "once":
        return False
    if disc.get("start") is not None and disc["start"] > T:
        return False
    return disc.get("end") is None or disc["end"] > T


ID_ONLY = (
    "{n} subscription(s) have discounts whose coupon is not imported (discount or coupon saved as an id only) and no paid invoice "
    "to measure them by; those discounts are not applied"
)
ID_ONLY_RATIO = (
    "{n} subscription(s) have discounts whose coupon is not imported (discount or coupon saved as an id only): their current-items MRR "
    "and renewals use the discounted share of the most recent paid invoice, (line amount - discount) / line amount; pull GetSubscriptions "
    "with expand data.discounts and GetCoupons to apply the coupon terms"
)


def _has_id_only(sub: dict) -> bool:
    return any(d.get("id_only") for d in sub["discounts"]) or any(d.get("id_only") for i in sub["items"] for d in i["discounts"])


def _apply_discounts(values: dict[str, float], discounts: list[dict], T: int, interval, count, notes: Notes, key) -> dict[str, float]:
    """MRR by product less the recurring discounts active at T (percent, or amount_off per billing interval)."""
    for disc in discounts:
        if disc.get("id_only"):
            notes.add(ID_ONLY, key)
            continue
        if not _discount_active(disc, T):
            continue
        subtotal = sum(values.values())
        if subtotal <= 0:
            break
        if disc.get("percent_off"):
            factor = max(0.0, 1 - float(disc["percent_off"]) / 100)
        elif disc.get("amount_off"):
            off = monthly_amount(disc["amount_off"], interval, count) or 0.0
            factor = max(0.0, subtotal - off) / subtotal
        else:
            continue
        values = {key: value * factor for key, value in values.items()}
    return values


class Mrr:
    """Per-subscription MRR at any instant, by product, from invoice history or the current items."""

    def __init__(self, data: Data):
        self.data = data
        self.notes = data.notes
        self._ratios: dict[str, dict | None] = {}
        self.ends = {s["id"]: self._effective_end(s) for s in data.subs}
        self.segments = {s["id"]: self._segments(s) for s in data.subs}
        self.current_from = {}
        for sub in data.subs:
            starts = [i["current_period_start_ts"] for i in sub["items"] if i["current_period_start_ts"] is not None]
            self.current_from[sub["id"]] = min(starts) if starts else (sub["current_period_start_ts"] or 0)

    # The end of a subscription's paying life, or None while it lasts.
    def _effective_end(self, sub: dict) -> int | None:
        status = sub["status"]
        if sub["ended_ts"]:
            return sub["ended_ts"]
        if status == "canceled":
            return sub["canceled_ts"] or sub["current_period_end_ts"] or sub["start_ts"]
        if status == "unpaid":
            run = []
            for inv in sorted(self.data.invoices_by_sub.get(sub["id"], []), key=lambda i: i["created_ts"] or 0, reverse=True):
                if inv["status"] in ("open", "uncollectible") and inv["attempt_count"] > 0:
                    run.append(inv["created_ts"])
                else:
                    break
            self.notes.add("{n} unpaid subscription(s) leave MRR when their unpaid invoices began (Stripe does not say when the status changed)", sub["id"])
            return min(run) if run else (sub["current_period_start_ts"] or sub["start_ts"])
        if status == "paused":
            return sub["trial_end_ts"] or sub["current_period_start_ts"] or sub["start_ts"]
        return None

    def _line_monthly(self, line: dict) -> float | None:
        meta = self.data.price_meta.get(line["price"] or "") or {}
        if meta.get("usage_type") == "metered":
            return None
        interval, count = meta.get("interval"), meta.get("interval_count")
        if not interval:
            if line["period_start_ts"] is None or line["period_end_ts"] is None:
                return None
            days = (line["period_end_ts"] - line["period_start_ts"]) / 86400
            interval, count = "month", max(1, int(round(days / 30.44)))
        return monthly_amount(line["amount"] - line["discount"], interval, count)

    def _segments(self, sub: dict) -> list[tuple[int, int, dict[str, float]]]:
        """(start, end, MRR by product) per billed period, from the subscription's invoices."""
        out = []
        for inv in self.data.invoices_by_sub.get(sub["id"], []):
            if inv["status"] not in INVOICE_LIVE or inv["billing_reason"] not in SUB_REASONS:
                continue
            values: dict[str, float] = defaultdict(float)
            starts, ends = [], []
            for line in inv["lines"]:
                if line["proration"]:
                    continue
                value = self._line_monthly(line)
                if value is None:
                    continue
                values[self.data.line_product(line)] += value
                if line["period_start_ts"] is not None:
                    starts.append(line["period_start_ts"])
                if line["period_end_ts"] is not None:
                    ends.append(line["period_end_ts"])
            if not starts or not ends:
                continue
            out.append((min(starts), max(ends), dict(values)))
        out.sort(key=lambda seg: seg[0])
        return out

    def paid_ratios(self, sub: dict) -> dict[str | None, float] | None:
        """For discounts saved as ids only: the discounted share, (amount - discount) / amount, of the
        subscription's most recent paid invoice, by price (None: the whole invoice). None without one."""
        if sub["id"] in self._ratios:
            return self._ratios[sub["id"]]
        found = None
        paid = [inv for inv in self.data.invoices_by_sub.get(sub["id"], []) if inv["status"] == "paid"]
        for inv in sorted(paid, key=lambda i: (i["paid_ts"] or i["created_ts"] or 0, i["id"]), reverse=True):
            lines = [line for line in inv["lines"] if not line["proration"] and line["amount"] > 0]
            if not lines:
                continue
            by_price: dict[str | None, list[int]] = defaultdict(lambda: [0, 0])
            for line in lines:
                for key in (line["price"], None):
                    by_price[key][0] += line["amount"] - line["discount"]
                    by_price[key][1] += line["amount"]
            found = {key: max(0.0, net / gross) for key, (net, gross) in by_price.items() if gross > 0}
            break
        self._ratios[sub["id"]] = found
        return found

    def current(self, sub: dict, T: int) -> dict[str, float]:
        values: dict[str, float] = defaultdict(float)
        main = (None, None)
        ratios = None
        if _has_id_only(sub):
            ratios = self.paid_ratios(sub)
            if ratios is not None:
                self.notes.add(ID_ONLY_RATIO, sub["id"])
        for item in sub["items"]:
            if item["usage_type"] == "metered":
                continue
            if item["unit_amount"] is None:
                self.notes.add("{n} subscription item(s) have no unit amount (tiered or custom pricing) and count as zero MRR", item["id"])
                continue
            value = monthly_amount(item["unit_amount"] * (item["quantity"] or 0), item["interval"], item["interval_count"])
            if value is None:
                continue
            if main[0] is None:
                main = (item["interval"], item["interval_count"])
            product = item["product"] or (self.data.price_meta.get(item["price"] or "") or {}).get("product") or UNATTRIBUTED
            if ratios is not None:
                # The paid invoice's lines already carry every discount (item and subscription level).
                values[product] += value * ratios.get(item["price"], ratios[None])
                continue
            one = _apply_discounts({product: value}, item["discounts"], T, item["interval"], item["interval_count"], self.notes, sub["id"])
            values[product] += one[product]
        if ratios is not None:
            return dict(values)
        return _apply_discounts(dict(values), sub["discounts"], T, main[0], main[1], self.notes, sub["id"])

    def free(self, sub: dict, T: int) -> bool:
        """A forever coupon (100% off, or an amount_off as large as the price) takes a priced subscription to zero at T."""
        forever = [d for d in sub["discounts"] + [d for i in sub["items"] for d in i["discounts"]]
                   if d.get("duration") == "forever" and _discount_active(d, T) and (d.get("percent_off") or d.get("amount_off"))]
        if not forever:
            return False
        gross = sum(
            monthly_amount(i["unit_amount"] * (i["quantity"] or 0), i["interval"], i["interval_count"]) or 0
            for i in sub["items"] if i["usage_type"] != "metered" and i["unit_amount"] is not None
        )
        return gross > 0 and sum(self.current(sub, T).values()) <= 0

    def state(self, sub: dict, T: int, is_now: bool) -> str | None:
        """'active', 'trialing', or None at instant T."""
        status = sub["status"]
        if status in ("incomplete", "incomplete_expired"):
            return None
        start = sub["start_ts"]
        if start is None or start >= T:
            return None
        end = self.ends[sub["id"]]
        if end is not None and end < T:
            return None
        if is_now:
            if status in ("unpaid", "paused"):
                return None
            if status == "trialing":
                return "trialing"
        trial_end = sub["trial_end_ts"]
        if trial_end and (sub["trial_start_ts"] or start) <= T < trial_end:
            return "trialing"
        return "active"

    def value(self, sub: dict, T: int) -> dict[str, float]:
        """MRR by product just before T: the current items from their current period on, else
        the invoiced period that covers that instant."""
        at = T - 1
        if at >= self.current_from[sub["id"]]:
            return self.current(sub, T)
        covering = [seg for seg in self.segments[sub["id"]] if seg[0] <= at < seg[1]]
        if covering:
            return covering[-1][2]
        self.notes.add("{n} past subscription-month(s) use the current items because the invoices for that period were not imported", (sub["id"], T))
        return self.current(sub, T)


def _series(data: Data, mrr: Mrr, months: list[str]) -> dict:
    """Per month: MRR by customer (rounded cents), trialing MRR, MRR by product, active subscriptions."""
    clock = data.clock
    out = {}
    for month in months:
        T = clock.month_T(month)
        is_now = T == clock.now_ts
        by_customer: dict[str, float] = defaultdict(float)
        by_product: dict[str, float] = defaultdict(float)
        trialing = 0.0
        active_subs = free_subs = 0
        for sub in data.subs:
            state = mrr.state(sub, T, is_now)
            if state is None:
                continue
            if state == "trialing":
                trialing += sum(mrr.current(sub, T).values())
                continue
            values = mrr.value(sub, T)
            total = sum(values.values())
            if total <= 0:
                free_subs += int(mrr.free(sub, T))
                continue
            active_subs += 1
            by_customer[sub["cust"]] += total
            for product, value in values.items():
                by_product[product] += value
        customers = {cust: int(round(value)) for cust, value in by_customer.items() if int(round(value)) > 0}
        out[month] = {
            "T": T,
            "customers": customers,
            "mrr": sum(customers.values()),
            "trialing": int(round(trialing)),
            "by_product": {p: int(round(v)) for p, v in by_product.items()},
            "subscriptions": active_subs,
            "free_subscriptions": free_subs,
        }
    return out


def _involuntary(data: Data, sub: dict) -> bool:
    if sub["cancel_reason"] == "payment_failed" or sub["status"] in ("unpaid", "incomplete_expired"):
        return True
    invoices = data.invoices_by_sub.get(sub["id"], [])
    if invoices:
        last = max(invoices, key=lambda inv: (inv["created_ts"] or 0, inv["id"]))
        return last["status"] == "uncollectible" and last["attempt_count"] > 0
    return False


def _movement(data: Data, mrr: Mrr, series: dict, months: list[str]) -> dict[str, dict]:
    subs_by_customer = defaultdict(list)
    for sub in data.subs:
        subs_by_customer[sub["cust"]].append(sub)
    ever: set[str] = set()
    out = {}
    previous: dict[str, int] = {}
    prev_T = None
    for month in months:
        snap = series[month]
        now = snap["customers"]
        row = {key: 0 for key in (
            "opening_cents", "new_cents", "reactivated_cents", "expansion_cents", "contraction_cents", "churned_cents", "closing_cents",
            "new_customers", "reactivated_customers", "expansion_customers", "contraction_customers", "churned_customers",
            "start_customers", "voluntary_customers", "involuntary_customers", "voluntary_mrr_cents", "involuntary_mrr_cents",
        )}
        row["opening_cents"] = sum(previous.values())
        row["start_customers"] = len(previous)
        for cust in set(previous) | set(now):
            before, after = previous.get(cust, 0), now.get(cust, 0)
            if before == 0 and after > 0:
                kind = "reactivated" if cust in ever else "new"
                row[f"{kind}_cents"] += after
                row[f"{kind}_customers"] += 1
            elif before > 0 and after == 0:
                row["churned_cents"] += before
                row["churned_customers"] += 1
                ended = [s for s in subs_by_customer.get(cust, []) if mrr.ends[s["id"]] is not None and (prev_T or 0) <= mrr.ends[s["id"]] < snap["T"]]
                way = "involuntary" if any(_involuntary(data, s) for s in ended) else "voluntary"
                row[f"{way}_customers"] += 1
                row[f"{way}_mrr_cents"] += before
            elif after > before:
                row["expansion_cents"] += after - before
                row["expansion_customers"] += 1
            elif after < before:
                row["contraction_cents"] += before - after
                row["contraction_customers"] += 1
        row["closing_cents"] = snap["mrr"]
        row["reconciles"] = (
            row["opening_cents"] + row["new_cents"] + row["reactivated_cents"] + row["expansion_cents"]
            - row["contraction_cents"] - row["churned_cents"] == row["closing_cents"]
        )
        ever.update(now)
        previous = now
        prev_T = snap["T"]
        out[month] = row
    return out


def _churn_row(month: str, mv: dict) -> dict:
    opening = mv["opening_cents"]
    lost = mv["churned_cents"] + mv["contraction_cents"]
    return {
        "month": month,
        "start_customers": mv["start_customers"],
        "churned_customers": mv["churned_customers"],
        "voluntary_customers": mv["voluntary_customers"],
        "involuntary_customers": mv["involuntary_customers"],
        "customer_churn_pct": _pct(mv["churned_customers"], mv["start_customers"]),
        "opening_mrr_cents": opening,
        "churned_mrr_cents": mv["churned_cents"],
        "voluntary_mrr_cents": mv["voluntary_mrr_cents"],
        "involuntary_mrr_cents": mv["involuntary_mrr_cents"],
        "contraction_cents": mv["contraction_cents"],
        "expansion_cents": mv["expansion_cents"],
        "gross_revenue_churn_pct": _pct(lost, opening),
        "net_revenue_churn_pct": _pct(lost - mv["expansion_cents"], opening),
        "nrr_pct": _pct(opening + mv["expansion_cents"] - lost, opening),
        "grr_pct": _pct(opening - lost, opening),
    }


def _retention_t12m(series: dict, month: str) -> tuple[float | None, float | None]:
    """(NRR, GRR) over the customers who had MRR 12 months before `month`."""
    base_month = _add_months(month, -12)
    if base_month not in series or month not in series:
        return None, None
    then = series[base_month]["customers"]
    now = series[month]["customers"]
    base = sum(then.values())
    if not base:
        return None, None
    kept = sum(now.get(cust, 0) for cust in then)
    floor = sum(min(now.get(cust, 0), value) for cust, value in then.items())
    return _pct(kept, base), _pct(floor, base)


# --- linking and revenue attribution ----------------------------------------------------------


class Revenue:
    """Revenue, fees, refunds, and disputes by month and product, from balance transactions
    (and charges whose balance transaction is not imported)."""

    def __init__(self, data: Data):
        self.data = data
        clock = data.clock
        self.links = {"invoice_payment": 0, "legacy": 0, "heuristic": 0, "unlinked": 0}
        self.charge_invoice = self._link_invoices()
        self.btx_ids = {b["id"] for b in data.btx}
        self.capfee_month: dict[str, int] = defaultdict(int)
        self.charge_by_btx = {c["balance_transaction"]: c for c in data.charges.values() if c["balance_transaction"]}
        # (month, product) -> figures
        self.cells: dict[tuple[str, str], dict] = defaultdict(lambda: {"gross": 0, "fees": 0, "refunds": 0, "disputes": 0, "capfee": 0, "cogs": 0})
        self.events = []  # revenue events: {"month", "day", "gross", "fee", "charge", "customer", "method"}
        no_fee = 0
        for btx in data.btx:
            if btx["currency"] != data.currency:
                continue
            month = btx["created"][:7]
            booking = btx["booking"]
            if booking == "revenue":
                charge = self.charge_by_btx.get(btx["id"]) or data.charges.get(btx["source_id"] or "")
                shares = self.shares(charge)
                self._spread(month, "gross", int(btx["amount_cents"]), shares)
                self._spread(month, "fees", int(btx["fee_cents"]), shares)
                self.events.append({
                    "month": month, "day": btx["created"], "gross": int(btx["amount_cents"]), "fee": int(btx["fee_cents"]),
                    "charge": charge, "customer": (charge or {}).get("customer"), "method": (charge or {}).get("method"),
                })
            elif booking == "refund":
                charge = self._refund_charge(btx)
                shares = self.shares(charge)
                self._spread(month, "refunds", -int(btx["amount_cents"]), shares)
                self._spread(month, "fees", int(btx["fee_cents"]), shares)
            elif booking == "dispute":
                charge = self._dispute_charge(btx)
                shares = self.shares(charge)
                self._spread(month, "disputes", -int(btx["amount_cents"]), shares)
                self._spread(month, "fees", int(btx["fee_cents"]), shares)
            elif booking == "fee":
                self._spread(month, "fees", -int(btx["amount_cents"]) + int(btx["fee_cents"]), [(UNATTRIBUTED, 1.0)])
        for charge in data.charges.values():
            if charge["status"] != "succeeded" or charge["created_ts"] is None:
                continue
            if charge["balance_transaction"] and charge["balance_transaction"] in self.btx_ids:
                continue
            if charge["currency"] != data.currency:
                continue
            month = clock.month(charge["created_ts"])
            self._spread(month, "gross", charge["amount"], self.shares(charge))
            self.events.append({
                "month": month, "day": clock.day(charge["created_ts"]), "gross": charge["amount"], "fee": None,
                "charge": charge, "customer": charge["customer"], "method": charge["method"],
            })
            no_fee += 1
        if no_fee:
            data.notes.add(f"{no_fee} succeeded charge(s) have no imported balance transaction: their gross is counted, their Stripe fee is not known")
        for row in data.capfee:
            self.capfee_month[row["date"][:7]] += -int(row["amount_cents"])

    def _spread(self, month: str, field: str, cents: int, shares: list[tuple[str, float]]) -> None:
        if not cents:
            return
        for product, part in allocate(cents, shares).items():
            self.cells[(month, product)][field] += part

    def _link_invoices(self) -> dict[str, str]:
        data = self.data
        by_charge, by_pi = {}, {}
        for ip in data.inv_payments:
            if not ip["invoice"]:
                continue
            if ip["charge"]:
                by_charge.setdefault(ip["charge"], ip["invoice"])
            if ip["payment_intent"]:
                by_pi.setdefault(ip["payment_intent"], ip["invoice"])
        legacy_charge = {inv["charge"]: inv["id"] for inv in data.invoices.values() if inv["charge"]}
        legacy_pi = {inv["payment_intent"]: inv["id"] for inv in data.invoices.values() if inv["payment_intent"]}
        out: dict[str, str] = {}
        for charge in data.charges.values():
            found = by_charge.get(charge["id"]) or by_pi.get(charge["payment_intent"] or "")
            if found:
                out[charge["id"]] = found
                self.links["invoice_payment"] += 1
                continue
            found = charge["invoice"] or legacy_charge.get(charge["id"]) or legacy_pi.get(charge["payment_intent"] or "")
            if found:
                out[charge["id"]] = found
                self.links["legacy"] += 1
        # Heuristic: same customer, amount paid, paid within 2 days; only a unique candidate.
        claimed = set(out.values())
        pool = defaultdict(list)
        for inv in data.invoices.values():
            if inv["status"] == "paid" and inv["id"] not in claimed and inv["customer"] and inv["amount_paid"] > 0:
                pool[(inv["customer"], inv["amount_paid"])].append(inv)
        for charge in data.charges.values():
            if charge["id"] in out or charge["status"] != "succeeded" or not charge["customer"]:
                continue
            near = [
                inv for inv in pool.get((charge["customer"], charge["amount"]), [])
                if inv["id"] not in claimed and abs((inv["paid_ts"] or inv["created_ts"] or 0) - (charge["created_ts"] or 0)) <= HEURISTIC_DAYS * 86400
            ]
            if len(near) == 1:
                out[charge["id"]] = near[0]["id"]
                claimed.add(near[0]["id"])
                self.links["heuristic"] += 1
            else:
                self.links["unlinked"] += 1
        if self.links["heuristic"]:
            data.notes.add(f"{self.links['heuristic']} charge(s) were linked to an invoice by customer, amount, and a paid date within {HEURISTIC_DAYS} days")
        return out

    def shares(self, charge: dict | None) -> list[tuple[str, float]]:
        if charge is None:
            return [(UNATTRIBUTED, 1.0)]
        invoice = self.data.invoices.get(self.charge_invoice.get(charge["id"], ""))
        if invoice is None or not invoice["lines"]:
            return [(UNATTRIBUTED, 1.0)]
        weights: dict[str, float] = defaultdict(float)
        for line in invoice["lines"]:
            weights[self.data.line_product(line)] += line["amount"] - line["discount"]
        if sum(weights.values()) <= 0:
            return [(UNATTRIBUTED, 1.0)]
        return sorted(weights.items())

    def _refund_charge(self, btx: dict) -> dict | None:
        if not hasattr(self, "_refund_ids"):
            self._refund_ids = {r["id"]: c for c in self.data.charges.values() for r in c["refunds"]}
            self._refund_left = {c["id"]: c["amount_refunded"] for c in self.data.charges.values() if c["amount_refunded"] > 0}
        charge = self._refund_ids.get(btx["source_id"] or "")
        if charge is not None:
            self._refund_left[charge["id"]] = self._refund_left.get(charge["id"], 0) - abs(int(btx["amount_cents"]))
            return charge
        # Heuristic: a charge with that much refunded and not yet matched, the latest before the refund.
        want = abs(int(btx["amount_cents"]))
        before = [
            self.data.charges[cid] for cid, left in self._refund_left.items()
            if left >= want and (self.data.charges[cid]["created_ts"] or 0) <= btx["created_ts"]
        ]
        exact = [c for c in before if self._refund_left[c["id"]] == want]
        pick = max(exact or before, key=lambda c: c["created_ts"] or 0, default=None)
        if pick is not None:
            self._refund_left[pick["id"]] -= want
        return pick

    def _dispute_charge(self, btx: dict) -> dict | None:
        match = _CHARGE_RE.search(btx["description"] or "")
        if match and match.group(1) in self.data.charges:
            return self.data.charges[match.group(1)]
        want = abs(int(btx["amount_cents"]))
        found = [c for c in self.data.charges.values() if c["disputed"] and c["amount"] == want]
        return found[0] if len(found) == 1 else None

    def month_totals(self, month: str) -> dict:
        out = {"gross": 0, "fees": 0, "refunds": 0, "disputes": 0, "capfee": 0, "cogs": 0}
        for (m, _product), cell in self.cells.items():
            if m == month:
                for key in out:
                    out[key] += cell[key]
        return out

    def products_in(self, month: str) -> dict[str, int]:
        return {p: cell["gross"] for (m, p), cell in self.cells.items() if m == month}


def _allocate_costs(data: Data, rev: Revenue, conn, months: list[str]) -> list[dict]:
    """Capital fees and the mapped COGS categories onto products, by revenue share in the month."""
    for month, cents in list(rev.capfee_month.items()):
        shares = [(p, float(g)) for p, g in sorted(rev.products_in(month).items()) if g > 0]
        rev._spread(month, "capfee", cents, shares or [(UNATTRIBUTED, 1.0)])
    metrics = data.cfg.metrics
    if not (metrics.cogs or metrics.cogs_categories):
        return []
    businesses = sorted({a.business for a in data.accounts})
    mapped = {entry.category: entry.products for entry in metrics.cogs}
    for name in metrics.cogs_categories:
        mapped.setdefault(name, ())
    marks = ", ".join("?" for _ in mapped)
    bmarks = ", ".join("?" for _ in businesses)
    spend: dict[tuple[str, str], int] = defaultdict(int)
    for row in conn.execute(
        f"""
        SELECT substr(t.date, 1, 7) AS month, c.category, SUM(t.amount_cents) AS cents
        FROM transactions t JOIN classifications c ON c.txn_id = t.id
        WHERE t.status = 'active' AND c.category IN ({marks}) AND c.business_tag IN ({bmarks})
        GROUP BY 1, 2
        """,
        (*mapped, *businesses),
    ):
        if row["month"] in months:
            spend[(row["month"], row["category"])] += -int(row["cents"])
    out = []
    for (month, category), cents in sorted(spend.items()):
        products = mapped[category]
        gross = rev.products_in(month)
        if products:
            shares = [(p, float(gross.get(p, 0))) for p in products if gross.get(p, 0) > 0] or [(p, 1.0) for p in products]
        else:
            shares = [(p, float(g)) for p, g in sorted(gross.items()) if g > 0] or [(UNATTRIBUTED, 1.0)]
        rev._spread(month, "cogs", cents, shares)
        out.append({"month": month, "category": category, "cents": cents, "products": list(products) or ["all (by revenue share)"]})
    return out


def _margin_figures(cell: dict) -> dict:
    margin = cell["gross"] - cell["fees"] - cell["refunds"] - cell["disputes"] - cell["capfee"] - cell["cogs"]
    return {
        "gross_cents": cell["gross"], "fees_cents": cell["fees"], "refunds_cents": cell["refunds"], "disputes_cents": cell["disputes"],
        "capital_fees_cents": cell["capfee"], "cogs_cents": cell["cogs"], "margin_cents": margin, "margin_pct": _pct(margin, cell["gross"]),
    }


def _sum_cells(cells) -> dict:
    out = {"gross": 0, "fees": 0, "refunds": 0, "disputes": 0, "capfee": 0, "cogs": 0}
    for cell in cells:
        for key in out:
            out[key] += cell[key]
    return out


# --- sections -----------------------------------------------------------------------------------


def _margin_section(data: Data, rev: Revenue, months: list[str], cogs: list[dict]) -> dict:
    by_product: dict[str, list[dict]] = defaultdict(list)
    for (month, product), cell in rev.cells.items():
        if month in months:
            by_product[product].append(cell)
    totals = _sum_cells(c for cells in by_product.values() for c in cells)
    products = []
    for product, cells in by_product.items():
        cell = _sum_cells(cells)
        products.append({"product": product, "name": data.product_name(product), **_margin_figures(cell), "revenue_share_pct": _pct(cell["gross"], totals["gross"])})
    products.sort(key=lambda r: (r["product"] == UNATTRIBUTED, -r["gross_cents"], r["product"]))
    return {
        "products": products,
        "totals": _margin_figures(totals),
        "months": [{"month": m, **_margin_figures(rev.month_totals(m))} for m in months],
        "cogs": cogs,
        "links": dict(rev.links),
    }


def _fees_section(data: Data, rev: Revenue, months: list[str]) -> dict:
    def empty():
        return {"count": 0, "gross_cents": 0, "fees_cents": 0}

    per = {m: {k: empty() for k in (*METHODS, "total")} for m in months}
    whole = {k: empty() for k in (*METHODS, "total")}
    card_link = []
    for event in rev.events:
        if event["fee"] is None or event["month"] not in per:
            continue
        bucket = method_bucket(event["method"])
        for target in (per[event["month"]][bucket], per[event["month"]]["total"], whole[bucket], whole["total"]):
            target["count"] += 1
            target["gross_cents"] += event["gross"]
            target["fees_cents"] += event["fee"]
        if bucket in ("card", "link"):
            card_link.append(event)

    def finish(fig):
        return {**fig, "rate_pct": _pct(fig["fees_cents"], fig["gross_cents"], 3)}

    ach = whole["ach"]
    if ach["gross_cents"] > 0:
        rate, source = ach["fees_cents"] / ach["gross_cents"], "observed"
    else:
        rate, source = ACH_RATE, "stripe_pricing"
    estimated = sum(min(int(round(e["gross"] * rate)), ACH_CAP_CENTS) for e in card_link)
    actual = sum(e["fee"] for e in card_link)
    volume = sum(e["gross"] for e in card_link)
    return {
        "months": [{"month": m, **{k: finish(v) for k, v in per[m].items()}} for m in months],
        "range": {k: finish(v) for k, v in whole.items()},
        "ach_savings": {
            "estimate": True,
            "card_link_count": len(card_link),
            "card_link_volume_cents": volume,
            "card_link_fees_cents": actual,
            "card_link_rate_pct": _pct(actual, volume, 3),
            # Link is card-funded and priced like a card: shown apart so a Link-heavy account reads clearly.
            "card_rate_pct": _pct(whole["card"]["fees_cents"], whole["card"]["gross_cents"], 3),
            "link_rate_pct": _pct(whole["link"]["fees_cents"], whole["link"]["gross_cents"], 3),
            "link_share_pct": _pct(whole["link"]["gross_cents"], volume),
            "ach_history": whole["ach"]["count"] > 0,
            "ach_rate_pct": round(rate * 100, 3),
            "ach_rate_source": source,
            "ach_cap_cents": ACH_CAP_CENTS,
            "estimated_ach_fees_cents": estimated,
            "estimated_savings_cents": actual - estimated,
        },
    }


def irr_daily(flows: list[tuple[int, float]]) -> float | None:
    """The daily rate r with sum(amount / (1 + r) ** day) = 0, by bisection; None if there is none in range."""
    if not flows or not any(a > 0 for _d, a in flows) or not any(a < 0 for _d, a in flows):
        return None

    def npv(rate: float) -> float:
        growth = math.log1p(rate)
        return sum(amount * math.exp(-day * growth) for day, amount in flows)

    lo, hi = -0.05, 0.05
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo == 0:
        return lo
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if f_mid == 0 or hi - lo < 1e-15:
            return mid
        if (f_mid > 0) == (f_lo > 0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return (lo + hi) / 2


def _capital_section(conn, data: Data, rev: Revenue, months: list[str]) -> dict:
    from hpbooks.stripe_capital import plan

    clock = data.clock
    financings = []
    paydown_day: dict[str, int] = defaultdict(int)
    starts: list[str] = []
    for acct in data.accounts:
        result = plan(conn, data.cfg, acct)
        for row in result["rows"]:
            if row["kind"] in ("payout", "paydown"):
                starts.append(row["created"])
            if row["kind"] == "paydown":
                paydown_day[row["created"]] += -int(row["amount_cents"])
            elif row["kind"] == "paydown_reversal":
                paydown_day[row["created"]] -= int(row["amount_cents"])
        fins = result["financings"]
        for fin in fins:
            if len(fins) == 1:
                mine = result["rows"]
            else:
                # The rows plan() grouped under this financing: its ids, or no id for the default entry.
                ids = set(fin["financing_ids"]) | ({fin["financing"]} if fin["financing"] else set())
                mine = [r for r in result["rows"] if r["ref"] in ids or (r["ref"] is None and fin["key"] in ("default", "unsplit:unknown"))]
            financings.append(_financing(acct, fin, mine))
    gross_day: dict[str, int] = defaultdict(int)
    for event in rev.events:
        gross_day[event["day"]] += event["gross"]
    daily = [(day, cents, gross_day.get(day, 0)) for day, cents in sorted(paydown_day.items())]
    shares = [cents / gross for _day, cents, gross in daily if gross > 0]
    # Only from the loan's start (the first proceeds or repayment): earlier months had nothing to withhold.
    first = min(starts) if starts else None
    owing = any((f["remaining_cents"] or 0) > 0 or (not f["terms"] and (f["principal_outstanding_cents"] or 0) > 0) for f in financings)
    last = clock.today.isoformat() if owing or not paydown_day else max(paydown_day)
    month_rows = []
    for month in months:
        if first is None or not first[:7] <= month <= last[:7]:
            continue
        withheld = sum(c for d, c, _g in daily if d[:7] == month)
        gross = sum(g for d, g in gross_day.items() if d[:7] == month and d >= first)
        if withheld or gross:
            month_rows.append({"month": month, "gross_cents": gross, "withheld_cents": withheld, "share_pct": _pct(withheld, gross)})
    active = [r for r in month_rows if r["gross_cents"] > 0]
    return {
        "financings": financings,
        "withheld": {
            "start_date": first,
            "months": month_rows,
            "active_months": len(active),
            "days": len(shares),
            "avg_daily_share_pct": round(sum(shares) * 100 / len(shares), 2) if shares else None,
            "avg_monthly_share_pct": round(sum(r["withheld_cents"] / r["gross_cents"] for r in active) * 100 / len(active), 2) if active else None,
        },
        "_recent_share": _recent_share(daily, gross_day, clock.today, first),
    }


def _recent_share(daily: list[tuple[str, int, int]], gross_day: dict[str, int], today: date, first: str | None) -> float:
    """Repayments / gross charges over the last 90 days, from the loan's start at the earliest."""
    if first is None:
        return 0.0
    since = max((today - timedelta(days=90)).isoformat(), first)
    withheld = sum(c for d, c, _g in daily if d >= since)
    gross = sum(g for d, g in gross_day.items() if d >= since)
    return withheld / gross if gross else 0.0


def _financing(acct: StripeAccount, fin: dict, mine: list[dict]) -> dict:
    """Effective APR from the configured fee and the actual repayment timeline: the IRR of
    proceeds in and repayments out, by day, annualized (APR = daily rate x 365)."""
    out = {
        "account": acct.name, "financing": fin["financing"], "label": fin["label"], "terms": fin["terms"],
        "principal_cents": fin["principal_cents"], "fee_cents": fin["fee_cents"], "paid_cents": fin["paid_cents"],
        "principal_outstanding_cents": fin["principal_outstanding_cents"],
        "remaining_cents": None, "proceeds_date": None, "last_paydown": None, "apr_pct": None, "effective_annual_pct": None,
        "projected": False, "note": "",
    }
    payouts = [r for r in mine if r["kind"] in ("payout", "payout_reversal")]
    paydowns = [r for r in mine if r["kind"] in ("paydown", "paydown_reversal")]
    if not fin["terms"]:
        out["note"] = "APR unknown: add [[stripe.capital]] terms (principal and fee)"
        return out
    total = fin["principal_cents"] + fin["fee_cents"]
    if payouts:
        t0 = date.fromisoformat(payouts[0]["created"])
        flows = [((date.fromisoformat(r["created"]) - t0).days, float(r["amount_cents"])) for r in payouts]
        owed = total
        out["proceeds_date"] = t0.isoformat()
    elif fin.get("opening_principal_cents") is not None and fin.get("start_date"):
        t0 = date.fromisoformat(fin["start_date"])
        flows = [(0, float(fin["opening_principal_cents"]))]
        owed = fin["opening_principal_cents"] + fin["fee_cents"] - fin["fee_before_history_cents"]
        out["proceeds_date"] = t0.isoformat()
        out["note"] = "from opening_principal on start_date (the proceeds predate the imported history)"
    else:
        out["note"] = "APR unknown: the financing payout is not in the imported history"
        return out
    paid = 0
    for r in paydowns:
        flows.append(((date.fromisoformat(r["created"]) - t0).days, float(r["amount_cents"])))
        paid -= int(r["amount_cents"])
    remaining = owed - paid
    out["remaining_cents"] = max(0, remaining)
    if paydowns:
        out["last_paydown"] = paydowns[-1]["created"]
    if remaining > 0:
        # Project the rest at the average pace so far (a Capital loan has no fixed schedule).
        last_day = max(d for d, _a in flows)
        pace = paid / max(1, last_day) if paid > 0 else 0
        if pace <= 0:
            out["note"] = "APR unknown: no repayments yet"
            return out
        day = last_day
        left = float(remaining)
        while left > 0.5 and day < last_day + 3650:
            day += 1
            step = min(pace, left)
            flows.append((day, -step))
            left -= step
        out["projected"] = True
        out["note"] = (out["note"] + "; " if out["note"] else "") + "rest of the repayment projected at the average daily pace so far"
    rate = irr_daily(flows)
    if rate is not None:
        out["apr_pct"] = round(rate * 365 * 100, 2)
        out["effective_annual_pct"] = round(math.expm1(365 * math.log1p(rate)) * 100, 2)
    out["days"] = max(d for d, _a in flows)
    return out


def _cohorts(data: Data, mrr: Mrr, series: dict, months: list[str]) -> dict:
    clock = data.clock
    signup: dict[str, str] = {}
    revenue: dict[tuple[str, str], int] = defaultdict(int)
    for inv in data.invoices.values():
        if inv["subscription"] and inv["status"] == "paid" and inv["amount_paid"] > 0 and inv["customer"]:
            month = clock.month(inv["paid_ts"] or inv["created_ts"])
            if inv["customer"] not in signup or month < signup[inv["customer"]]:
                signup[inv["customer"]] = month
            revenue[(inv["customer"], month)] += inv["amount_paid"]
    for sub in data.subs:
        cust = sub["cust"]
        if cust in signup:
            continue
        end = mrr.ends[sub["id"]]
        if mrr.free(sub, min(clock.now_ts, end) if end else clock.now_ts):
            continue  # free (forever coupon): not a paying customer
        row = data.customers.get(cust)
        ts = (row or {}).get("created_ts") or sub["start_ts"]
        if ts:
            signup[cust] = clock.month(ts)
    if not months:
        return {"cohorts": [], "max_k": 0}
    last = months[-1]
    groups: dict[str, list[str]] = defaultdict(list)
    for cust, month in signup.items():
        if months[0] <= month <= last:
            groups[month].append(cust)
    cohorts = []
    for month in sorted(groups):
        members = groups[month]
        cells = []
        base_rev = None
        for k in range(_month_diff(month, last) + 1):
            at = _add_months(month, k)
            snap = series.get(at, {"customers": {}})
            active = sum(1 for c in members if snap["customers"].get(c, 0) > 0)
            cents = sum(revenue.get((c, at), 0) for c in members)
            if k == 0:
                base_rev = cents
            cells.append({
                "k": k, "month": at, "customers": active, "customers_pct": _pct(active, len(members), 1),
                "revenue_cents": cents, "revenue_pct": _pct(cents, base_rev, 1),
            })
        cohorts.append({"cohort": month, "customers": len(members), "retention": cells})
    return {"cohorts": cohorts, "max_k": max((len(c["retention"]) - 1 for c in cohorts), default=0)}


def _concentration(data: Data, rev: Revenue, month: str) -> dict:
    first = _add_months(month, -11)
    totals: dict[str, int] = defaultdict(int)
    anonymous = 0
    for event in rev.events:
        if first <= event["month"] <= month:
            if event["customer"]:
                totals[event["customer"]] += event["gross"]
            else:
                anonymous += event["gross"]
    total = sum(totals.values()) + anonymous
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))

    def top(n):
        return _pct(sum(v for _c, v in ranked[:n]), total)

    hhi = round(sum((v * 100 / total) ** 2 for _c, v in ranked), 1) if total else None
    return {
        "window_start": first, "window_end": month, "total_cents": total, "customers": len(ranked), "no_customer_cents": anonymous,
        "top1_pct": top(1), "top5_pct": top(5), "top10_pct": top(10), "hhi": hhi,
        "top": [{"rank": i + 1, "customer": c, "revenue_cents": v, "share_pct": _pct(v, total)} for i, (c, v) in enumerate(ranked[:10])],
    }


def _recovery(data: Data, mrr: Mrr, months: list[str]) -> dict:
    clock = data.clock
    rows = {m: {"month": m, "failed_charges": 0, "failed_cents": 0, "dunning_invoices": 0, "dunning_cents": 0,
                "recovered_invoices": 0, "recovered_cents": 0, "lost_invoices": 0, "lost_cents": 0, "in_progress_invoices": 0, "in_progress_cents": 0,
                "open_invoices": 0, "open_cents": 0}
            for m in months}
    for charge in data.charges.values():
        if charge["status"] == "failed" and charge["created_ts"] and charge["currency"] == data.currency:
            row = rows.get(clock.month(charge["created_ts"]))
            if row:
                row["failed_charges"] += 1
                row["failed_cents"] += charge["amount"]

    today_ts = clock.day_ts(clock.today)

    def outcome(inv) -> str | None:
        if inv["status"] == "draft" or inv["attempt_count"] <= 0:
            return None
        if inv["status"] == "paid":
            return "recovered" if inv["attempt_count"] > 1 else None
        if inv["status"] in ("uncollectible", "void"):
            return "lost"
        if inv["status"] == "open":
            # Still in dunning: Stripe will retry, so it is neither recovered nor lost yet.
            if inv["next_payment_attempt_ts"] and inv["next_payment_attempt_ts"] >= today_ts:
                return "in_progress"
            sub = data.subs_by_id.get(inv["subscription"] or "")
            if sub and sub["status"] in ("canceled", "incomplete_expired") and sub["cancel_reason"] == "payment_failed":
                return "lost"
            return "open"
        return None

    for inv in data.invoices.values():
        kind = outcome(inv)
        row = rows.get(clock.month(inv["created_ts"])) if inv["created_ts"] else None
        if kind is None or row is None:
            continue
        row["dunning_invoices"] += 1
        row["dunning_cents"] += inv["amount_due"]
        if kind == "recovered":
            row["recovered_invoices"] += 1
            row["recovered_cents"] += inv["amount_paid"]
        elif kind == "lost":
            row["lost_invoices"] += 1
            row["lost_cents"] += inv["amount_due"] - inv["amount_paid"]
        elif kind == "in_progress":
            row["in_progress_invoices"] += 1
            row["in_progress_cents"] += inv["amount_remaining"] or inv["amount_due"]
        else:
            row["open_invoices"] += 1
            row["open_cents"] += inv["amount_remaining"] or inv["amount_due"]
    for row in rows.values():
        row["recovery_rate_pct"] = _pct(row["recovered_cents"], row["recovered_cents"] + row["lost_cents"])
    totals = {key: sum(r[key] for r in rows.values()) for key in next(iter(rows.values()), {}) if key != "month" and key != "recovery_rate_pct"}
    totals["recovery_rate_pct"] = _pct(totals.get("recovered_cents", 0), totals.get("recovered_cents", 0) + totals.get("lost_cents", 0))
    at_risk = [s for s in data.subs if s["status"] in ("past_due", "unpaid")]
    risk_cents = int(round(sum(sum(mrr.current(s, clock.now_ts).values()) for s in at_risk)))
    # Collection rate for the forecast: subscription invoices of the last 6 months that were due.
    since = clock.day_ts(clock.today - timedelta(days=183))
    due = paid = 0
    for inv in data.invoices.values():
        if not inv["subscription"] or (inv["created_ts"] or 0) < since or inv["amount_due"] <= 0:
            continue
        kind = outcome(inv)
        if inv["status"] == "paid" or kind == "lost":
            due += inv["amount_due"]
            paid += inv["amount_paid"]
    return {
        "months": [rows[m] for m in months],
        "totals": totals,
        "at_risk_mrr_cents": risk_cents,
        "at_risk_subscriptions": len(at_risk),
        "collection_rate_pct": _pct(paid, due) if due else None,
    }


def _refunds(data: Data, rev: Revenue, months: list[str]) -> dict:
    metrics = data.cfg.metrics
    every = sorted({m for (m, _p) in rev.cells})
    if months:
        every = sorted(set(every) | set(_span(min(every + months), months[-1])) if every else set(months))
    products = sorted({p for (_m, p) in rev.cells})
    spikes = []
    out_products = []

    def rate(cell):
        return cell["refunds"] / cell["gross"] if cell["gross"] > 0 else None

    for product in products:
        history = []
        rows = []
        for month in every:
            cell = rev.cells.get((month, product)) or {"gross": 0, "refunds": 0, "disputes": 0}
            r = rate(cell)
            prior = [x for x in history[-6:] if x is not None]
            spike = False
            base = None
            if r is not None and len(prior) >= 3:
                base = median(prior)
                spike = r > metrics.spike_factor * base and cell["refunds"] >= metrics.spike_min_cents
            history.append(r)
            if month in months:
                row = {
                    "month": month, "gross_cents": cell["gross"], "refunds_cents": cell["refunds"], "disputes_cents": cell["disputes"],
                    "refund_rate_pct": _pct(cell["refunds"], cell["gross"]), "dispute_rate_pct": _pct(cell["disputes"], cell["gross"]),
                    "median_rate_pct": None if base is None else round(base * 100, 2), "spike": spike,
                }
                rows.append(row)
                if spike:
                    spikes.append({"month": month, "product": product, "name": data.product_name(product), "refunds_cents": cell["refunds"],
                                   "refund_rate_pct": row["refund_rate_pct"], "median_rate_pct": row["median_rate_pct"]})
        if any(r["gross_cents"] or r["refunds_cents"] or r["disputes_cents"] for r in rows):
            out_products.append({"product": product, "name": data.product_name(product), "months": rows})
    month_rows = []
    for month in months:
        cell = rev.month_totals(month)
        month_rows.append({"month": month, "gross_cents": cell["gross"], "refunds_cents": cell["refunds"], "disputes_cents": cell["disputes"],
                           "refund_rate_pct": _pct(cell["refunds"], cell["gross"]), "dispute_rate_pct": _pct(cell["disputes"], cell["gross"])})
    return {"months": month_rows, "products": out_products, "spikes": spikes,
            "spike_factor": metrics.spike_factor, "spike_min_cents": metrics.spike_min_cents}


def _ltv(data: Data, conn, movement: dict, margin: dict, series: dict, month: str) -> dict:
    snap = series.get(month)
    customers = len(snap["customers"]) if snap else 0
    arpa = snap["mrr"] / customers if snap and customers else None
    window = [m for m in movement if _add_months(month, -11) <= m <= month]
    opening = sum(movement[m]["opening_cents"] for m in window)
    lost = sum(movement[m]["churned_cents"] + movement[m]["contraction_cents"] for m in window)
    churn = lost / opening if opening else None
    margin_pct = margin["totals"]["margin_pct"]
    notes = []
    out = {
        "arpa_cents": int(round(arpa)) if arpa is not None else None,
        "gross_margin_pct": margin_pct,
        "monthly_revenue_churn_pct": round(churn * 100, 3) if churn is not None else None,
        "churn_capped": False,
        "lifetime_months": None,
        "ltv_cents": None,
        "cac_cents": None,
        "cac_source": None,
        "payback_months": None,
        "notes": notes,
    }
    if arpa is None:
        notes.append("no active customers: ARPA and LTV are not defined")
        return out
    if margin_pct is None:
        notes.append("no revenue in the range: gross margin and LTV are not defined")
        return out
    if churn is None or churn < 1 / LTV_MAX_MONTHS:
        out["churn_capped"] = True
        notes.append(f"monthly revenue churn is about zero: lifetime capped at {LTV_MAX_MONTHS} months")
        churn_used = 1 / LTV_MAX_MONTHS
    else:
        churn_used = churn
    out["lifetime_months"] = round(1 / churn_used, 1)
    monthly_margin = arpa * margin_pct / 100
    out["ltv_cents"] = int(round(monthly_margin / churn_used))
    metrics = data.cfg.metrics
    if metrics.cac_cents is not None:
        out["cac_cents"], out["cac_source"] = metrics.cac_cents, "config"
    elif metrics.cac_category:
        businesses = sorted({a.business for a in data.accounts})
        bmarks = ", ".join("?" for _ in businesses)
        first = _add_months(month, -11) + "-01"
        last = _next_month(month) + "-01"
        spend = -int(conn.execute(
            f"""SELECT COALESCE(SUM(t.amount_cents), 0) FROM transactions t JOIN classifications c ON c.txn_id = t.id
                WHERE t.status = 'active' AND c.category = ? AND c.business_tag IN ({bmarks}) AND t.date >= ? AND t.date < ?""",
            (metrics.cac_category, *businesses, first, last),
        ).fetchone()[0])
        new = sum(movement[m]["new_customers"] for m in window)
        if new:
            out["cac_cents"], out["cac_source"] = int(round(spend / new)), f"{metrics.cac_category} spend over 12 months / {new} new customers"
        else:
            notes.append("no new customers in the last 12 months: CAC from the category is not defined")
    else:
        notes.append("payback omitted: set [stripe.metrics] cac or cac_category")
    if out["cac_cents"] is not None and monthly_margin > 0:
        out["payback_months"] = round(out["cac_cents"] / monthly_margin, 1)
    return out


# --- forecast -------------------------------------------------------------------------------------


def _median_days(pairs: list[tuple[str | None, str | None]], default: int) -> int:
    gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in pairs if a and b and b >= a]
    return int(round(median(gaps))) if gaps else default


def _add_interval(ts: int, interval: str, count: int, tz: ZoneInfo) -> int:
    moment = datetime.fromtimestamp(ts, tz)
    count = count or 1
    if interval == "day":
        return int((moment + timedelta(days=count)).timestamp())
    if interval == "week":
        return int((moment + timedelta(weeks=count)).timestamp())
    months = count * (12 if interval == "year" else 1)
    idx = moment.year * 12 + moment.month - 1 + months
    year, month = idx // 12, idx % 12 + 1
    day = moment.day
    while True:
        try:
            return int(moment.replace(year=year, month=month, day=day).timestamp())
        except ValueError:
            day -= 1


def _period_amount(item: dict, sub: dict, T: int, first_item: bool, mrr: Mrr) -> float:
    """One billing period of a licensed item less its recurring discounts; a subscription-level
    amount_off comes off the subscription's first item. Discounts saved as ids only use the
    discounted share of the most recent paid invoice (Mrr.paid_ratios)."""
    notes = mrr.notes
    amount = float(item["unit_amount"] * (item["quantity"] or 0))
    if _has_id_only(sub):
        ratios = mrr.paid_ratios(sub)
        if ratios is not None:
            notes.add(ID_ONLY_RATIO, sub["id"])
            return amount * ratios.get(item["price"], ratios[None])
    for disc in item["discounts"] + sub["discounts"]:
        if disc.get("id_only"):
            notes.add(ID_ONLY, sub["id"])
            continue
        if not _discount_active(disc, T):
            continue
        if disc.get("percent_off"):
            amount *= max(0.0, 1 - float(disc["percent_off"]) / 100)
        elif disc.get("amount_off") and (disc in item["discounts"] or first_item):
            amount = max(0.0, amount - disc["amount_off"])
    return amount


# Weekly forecast columns (signed: inflows positive, outflows negative) and the event kinds in each.
WEEK_KINDS = ("renewals_cents", "in_transit_cents", "capital_withholding_cents", "bills_cents", "cards_cents")
_WEEK_KIND = {"renewals": "renewals_cents", "payout_in_transit": "in_transit_cents", "stripe_balance": "in_transit_cents",
              "capital_withholding": "capital_withholding_cents", "bill": "bills_cents", "card_due": "cards_cents"}


def _forecast(conn, data: Data, mrr: Mrr, recovery: dict, fees: dict, capital: dict, business: str) -> dict:
    from hpbooks.analytics import upcoming_bills
    from hpbooks.balances import snapshot_for
    from hpbooks.payments import add_months
    from hpbooks.payments import build as payment_terms
    from hpbooks.scope import accounts_in

    clock = data.clock
    today = clock.today
    days = data.cfg.metrics.forecast_days
    horizon = today + timedelta(days=days)
    horizon_ts = clock.day_ts(horizon + timedelta(days=1))
    notes = []
    collection = (recovery["collection_rate_pct"] or 100.0) / 100
    fee_rate = (fees["range"]["total"]["fees_cents"] / fees["range"]["total"]["gross_cents"]) if fees["range"]["total"]["gross_cents"] else 0.0
    available_lag = _median_days([(b["created"], b["available_on"]) for b in data.btx if b["booking"] == "revenue"], DEFAULT_AVAILABLE_DAYS)
    arrival_lag = _median_days([(p["created"], p["arrival_date"]) for p in data.payouts if p["status"] not in ("failed", "canceled")], DEFAULT_ARRIVAL_DAYS)
    lag = available_lag + arrival_lag
    share = capital["_recent_share"]
    owed = 0
    for fin in capital["financings"]:
        if fin["terms"] and fin["remaining_cents"]:
            owed += fin["remaining_cents"]
        elif not fin["terms"] and fin["principal_outstanding_cents"]:
            owed += fin["principal_outstanding_cents"]
    events: list[dict] = []

    def add(day: date, kind: str, label: str, cents: int) -> None:
        if cents and today <= day <= horizon:
            events.append({"date": day.isoformat(), "kind": kind, "label": label, "cents": int(cents)})

    # Stripe renewals: each licensed item at its period end, then every interval, until canceled.
    renewals: dict[date, list[float]] = defaultdict(list)
    skipped_metered = 0
    for sub in data.subs:
        if sub["status"] not in ("active", "past_due", "trialing"):
            continue
        stop = sub["cancel_at_ts"]
        first_item = True
        for item in sub["items"]:
            if item["usage_type"] == "metered":
                skipped_metered += 1
                continue
            if item["unit_amount"] is None or not item["interval"]:
                continue
            due = item["current_period_end_ts"] or sub["current_period_end_ts"]
            if sub["status"] == "trialing" and sub["trial_end_ts"]:
                due = sub["trial_end_ts"]
            if not due:
                continue
            if sub["cancel_at_period_end"]:
                continue
            guard = 0
            while due < clock.now_ts - 86400 and guard < 500:
                due = _add_interval(due, item["interval"], item["interval_count"], clock.tz)
                guard += 1
            while due < horizon_ts and guard < 1000 and (stop is None or due < stop):
                amount = _period_amount(item, sub, due, first_item, mrr)
                if amount > 0:
                    renewals[date.fromisoformat(clock.day(due))].append(amount)
                due = _add_interval(due, item["interval"], item["interval_count"], clock.tz)
                guard += 1
            first_item = False
    totals = defaultdict(int)
    for charge_day in sorted(renewals):
        expected = sum(renewals[charge_day]) * collection
        fee = expected * fee_rate
        withheld = 0.0
        if owed > 0 and share > 0:
            withheld = min(expected * share, owed)
            owed -= withheld
        arrive = max(today, charge_day + timedelta(days=lag))
        count = len(renewals[charge_day])
        add(arrive, "renewals", f"Stripe renewals charged {charge_day.isoformat()} ({count})", int(round(expected - fee)))
        add(arrive, "capital_withholding", "Stripe Capital withheld from those renewals", -int(round(withheld)))
        if arrive <= horizon:
            totals["renewals_cents"] += int(round(expected - fee))
            totals["capital_withholding_cents"] -= int(round(withheld))
    if skipped_metered:
        notes.append("metered (usage) items are not forecast")
    # Payouts on their way, and the Stripe balance not yet paid out.
    for payout in data.payouts:
        if payout["status"] in ("pending", "in_transit") and payout["arrival_date"]:
            day = max(today, date.fromisoformat(payout["arrival_date"]))
            add(day, "payout_in_transit", f"Stripe payout {payout['id']}", int(payout["amount_cents"]))
            if day <= horizon:
                totals["in_transit_cents"] += int(payout["amount_cents"])
    stripe_balance = 0
    for acct in data.accounts:
        if conn.execute("SELECT 1 FROM accounts WHERE id = ?", (acct.ledger_id,)).fetchone():
            stripe_balance += max(0, int(snapshot_for(conn, acct.ledger_id)["display_cents"]))
    if stripe_balance:
        add(today + timedelta(days=arrival_lag), "stripe_balance", "Stripe balance not yet paid out", stripe_balance)
        totals["stripe_balance_cents"] += stripe_balance
    # The books: recurring bills paid from the bank, and card due dates.
    cash_ids = {
        a["id"] for a in accounts_in(conn, "business")
        if a.get("type") == "cash" and a.get("class", "cash") == "cash" and not a["id"].startswith("stripe-")
    }
    for bill in upcoming_bills(conn, business=business, today=today, days=days):
        if bill["account_id"] not in cash_ids:
            continue
        due = date.fromisoformat(bill["due_date"])
        gap = int(bill["gap_days"])
        while due <= horizon:
            add(due, "bill", bill["merchant"], int(bill["cents"]))
            totals["bills_cents"] += int(bill["cents"])
            due += timedelta(days=gap)
    cards = payment_terms(conn, "business", today.isoformat())
    for row in cards["rows"]:
        if row["status"] not in ("overdue", "due_soon", "upcoming") or not row["min_payment_cents"] or not row["effective_due_date"]:
            continue
        due = max(today, date.fromisoformat(row["effective_due_date"]))
        step = 0
        while due <= horizon:
            add(due, "card_due", f"{row['label']} minimum payment" + (" (estimate)" if step else ""), -int(row["min_payment_cents"]))
            totals["cards_cents"] -= int(row["min_payment_cents"])
            step += 1
            due = max(today, add_months(date.fromisoformat(row["effective_due_date"]), step))
    if business != "all":
        notes.append("card due dates and the bank balance are for every business account (cards and banks carry no business)")
    opening = 0
    for acct_id in cash_ids:
        opening += int(snapshot_for(conn, acct_id)["display_cents"])
    events.sort(key=lambda e: (e["date"], e["kind"], e["label"]))
    by_day: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        by_day[event["date"]].append(event)
    daily = []
    balance = opening
    lowest = {"date": today.isoformat(), "balance_cents": opening}
    day = today
    while day <= horizon:
        key = day.isoformat()
        inflow = sum(e["cents"] for e in by_day.get(key, []) if e["cents"] > 0)
        outflow = -sum(e["cents"] for e in by_day.get(key, []) if e["cents"] < 0)
        balance += inflow - outflow
        daily.append({"date": key, "inflow_cents": inflow, "outflow_cents": outflow, "balance_cents": balance, "lowest": False})
        if balance < lowest["balance_cents"]:
            lowest = {"date": key, "balance_cents": balance}
        day += timedelta(days=1)
    for row in daily:
        row["lowest"] = row["date"] == lowest["date"]
    weekly = []
    for start in range(0, len(daily), 7):
        chunk = daily[start:start + 7]
        kinds = {key: 0 for key in WEEK_KINDS}
        for row in chunk:
            for event in by_day.get(row["date"], []):
                kinds[_WEEK_KIND[event["kind"]]] += event["cents"]
        weekly.append({
            "week_start": chunk[0]["date"], "week_end": chunk[-1]["date"],
            **kinds,
            "inflow_cents": sum(r["inflow_cents"] for r in chunk), "outflow_cents": sum(r["outflow_cents"] for r in chunk),
            "closing_cents": chunk[-1]["balance_cents"], "low_cents": min(r["balance_cents"] for r in chunk),
        })
    return {
        "estimate": True,
        "start": today.isoformat(), "end": horizon.isoformat(), "days": days,
        "opening_cash_cents": opening,
        "closing_cents": balance,
        "lowest": lowest,
        "collection_rate_pct": round(collection * 100, 2),
        "fee_rate_pct": round(fee_rate * 100, 3),
        "withheld_share_pct": round(share * 100, 2),
        "capital_owed_cents": int(round(sum(f["remaining_cents"] or 0 for f in capital["financings"]))),
        "payout_lag_days": lag,
        "totals": {key: totals.get(key, 0) for key in ("renewals_cents", "capital_withholding_cents", "in_transit_cents", "stripe_balance_cents", "bills_cents", "cards_cents")},
        "daily": daily,
        "weekly": weekly,
        "events": events,
        "notes": notes,
    }


# --- the report -----------------------------------------------------------------------------------


def _accounts(cfg: StripeConfig, business: str, account: str | None) -> list[StripeAccount]:
    config = get_config()
    if business not in ("all", *config.business_slugs):
        raise HpbooksError(config.business_filter_error)
    if account and cfg.account(account) is None:
        raise HpbooksError(f"no Stripe account named {account!r}")
    return [a for a in cfg.accounts if (business == "all" or a.business == business) and account in (None, a.name) and a.currency == cfg.books_currency]


def resolve_period(start: str | None, end: str | None, month: str | None, today: date) -> tuple[str, str, str]:
    """(start, end, focus month). Default focus: the last complete month; default range: the 12 months ending with it."""
    current = today.isoformat()[:7]
    if month is not None:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month or ""):
            raise HpbooksError("month must be YYYY-MM")
        if month > current:
            raise HpbooksError("month must not be in the future")
    if (start is None) != (end is None):
        raise HpbooksError("start and end go together")
    if start is not None:
        start, end = require_date(start), require_date(end)
        if start > end:
            raise HpbooksError("start must be on or before end")
        if end > today.isoformat():
            end = today.isoformat()
            start = min(start, end)
        if month is None:
            # The focus month is the last complete one in the range; the current month only when the range has nothing else.
            month = end[:7]
            if month == current and prev_month(current) >= start[:7]:
                month = prev_month(current)
        return start, end, month
    month = month or prev_month(current)
    first = _add_months(month, -11)
    last_day = (date.fromisoformat(_next_month(month) + "-01") - timedelta(days=1)).isoformat()
    return first + "-01", min(last_day, today.isoformat()), month


def build(conn, *, start: str | None = None, end: str | None = None, month: str | None = None, business: str = "all",
          account: str | None = None, sections: tuple[str, ...] = SECTIONS, today: date | None = None) -> dict:
    """Every metric for the range and focus month. See the module docstring and docs/stripe.md."""
    cfg = settings()
    today = today or date.today()
    start, end, month = resolve_period(start, end, month, today)
    accounts = _accounts(cfg, business, account)
    clock = Clock(cfg.timezone, today)
    data = Data(conn, cfg, accounts, clock)
    months = months_covering(start, end)
    first_seen = min((clock.month(s["start_ts"]) for s in data.subs if s["start_ts"]), default=months[0])
    series_first = max(min(first_seen, months[0], _add_months(month, -12)), _add_months(max(months[-1], month), -MAX_MONTHS))
    series_first = min(series_first, months[0], month)
    series_months = _span(series_first, max(months[-1], month))
    mrr = Mrr(data)
    series = _series(data, mrr, series_months)
    movement = _movement(data, mrr, series, series_months)
    rev = Revenue(data)
    cogs = _allocate_costs(data, rev, conn, months)
    out: dict = {
        "ready": data.ready and bool(data.subs or data.charges or data.btx),
        "start": start, "end": end, "month": month, "business": business, "account": account,
        "currency": cfg.books_currency, "as_of": today.isoformat(),
        "accounts": [a.name for a in accounts],
    }
    margin = _margin_section(data, rev, months, cogs)
    fees = _fees_section(data, rev, months)
    recovery = _recovery(data, mrr, months)
    capital = _capital_section(conn, data, rev, months)
    snap = series[month]
    mv = movement[month]

    usage_by_month: dict[str, int] = defaultdict(int)
    for inv in data.invoices.values():
        if inv["status"] == "paid" and (inv["paid_ts"] or inv["created_ts"]):
            for line in inv["lines"]:
                if (data.price_meta.get(line["price"] or "") or {}).get("usage_type") == "metered":
                    usage_by_month[clock.month(inv["paid_ts"] or inv["created_ts"])] += line["amount"] - line["discount"]

    def usage(m):
        return usage_by_month.get(m, 0)

    month_rows = []
    for m in months:
        s, v = series[m], movement[m]
        month_rows.append({
            "month": m, "mrr_cents": s["mrr"], "arr_cents": s["mrr"] * 12, "trialing_mrr_cents": s["trialing"],
            "customers": len(s["customers"]), "subscriptions": s["subscriptions"], "free_subscriptions": s["free_subscriptions"],
            "arpa_cents": int(round(s["mrr"] / len(s["customers"]))) if s["customers"] else None,
            "usage_revenue_cents": usage(m),
            **{k: v[k] for k in ("opening_cents", "new_cents", "reactivated_cents", "expansion_cents", "contraction_cents", "churned_cents", "closing_cents",
                                 "new_customers", "reactivated_customers", "expansion_customers", "contraction_customers", "churned_customers")},
        })
    by_product = sorted(snap["by_product"].items(), key=lambda kv: (-kv[1], kv[0]))
    sections_out = {
        "mrr": {
            "month": month, "mrr_cents": snap["mrr"], "arr_cents": snap["mrr"] * 12, "trialing_mrr_cents": snap["trialing"],
            "customers": len(snap["customers"]), "subscriptions": snap["subscriptions"], "free_subscriptions": snap["free_subscriptions"],
            "arpa_cents": int(round(snap["mrr"] / len(snap["customers"]))) if snap["customers"] else None,
            "usage_revenue_cents": usage(month),
            "bridge": {"month": month, **{k: mv[k] for k in (
                "opening_cents", "new_cents", "reactivated_cents", "expansion_cents", "contraction_cents", "churned_cents", "closing_cents",
                "new_customers", "reactivated_customers", "expansion_customers", "contraction_customers", "churned_customers", "reconciles")}},
            "by_product": [{"product": p, "name": data.product_name(p), "mrr_cents": c, "share_pct": _pct(c, snap["mrr"])} for p, c in by_product if c],
            "months": month_rows,
        },
    }
    nrr, grr = _retention_t12m(series, month)
    churn_months = [_churn_row(m, movement[m]) for m in months]
    sections_out["churn"] = {"month": _churn_row(month, mv), "months": churn_months, "nrr_t12m_pct": nrr, "grr_t12m_pct": grr}
    sections_out["cohorts"] = _cohorts(data, mrr, series, months)
    sections_out["margin"] = margin
    sections_out["fees"] = fees
    sections_out["capital"] = {k: v for k, v in capital.items() if not k.startswith("_")}
    sections_out["ltv"] = _ltv(data, conn, movement, margin, series, month)
    sections_out["concentration"] = _concentration(data, rev, month)
    sections_out["recovery"] = recovery
    sections_out["refunds"] = _refunds(data, rev, months)
    if "forecast" in sections:
        sections_out["forecast"] = _forecast(conn, data, mrr, recovery, fees, capital, business)
    churn = sections_out["churn"]["month"]
    forecast = sections_out.get("forecast")
    out["summary"] = {
        "mrr_cents": snap["mrr"],
        "arr_cents": snap["mrr"] * 12,
        "trialing_mrr_cents": snap["trialing"],
        "active_customers": len(snap["customers"]),
        "free_subscriptions": snap["free_subscriptions"],
        "arpa_cents": sections_out["mrr"]["arpa_cents"],
        "net_new_mrr_cents": mv["closing_cents"] - mv["opening_cents"],
        "customer_churn_pct": churn["customer_churn_pct"],
        "gross_revenue_churn_pct": churn["gross_revenue_churn_pct"],
        "net_revenue_churn_pct": churn["net_revenue_churn_pct"],
        "nrr_t12m_pct": nrr,
        "grr_t12m_pct": grr,
        "gross_margin_pct": margin["totals"]["margin_pct"],
        "effective_fee_pct": fees["range"]["total"]["rate_pct"],
        "ltv_cents": sections_out["ltv"]["ltv_cents"],
        "top10_share_pct": sections_out["concentration"]["top10_pct"],
        "hhi": sections_out["concentration"]["hhi"],
        "recovery_rate_pct": recovery["totals"]["recovery_rate_pct"],
        "at_risk_mrr_cents": recovery["at_risk_mrr_cents"],
        "forecast_low_cents": forecast["lowest"]["balance_cents"] if forecast else None,
        "forecast_low_date": forecast["lowest"]["date"] if forecast else None,
    }
    for name in SECTIONS:
        if name in sections and name in sections_out:
            out[name] = sections_out[name]
    out["approximations"] = data.notes.list()
    return out


# --- tables (CSV / XLSX / PDF exports and the CLI) --------------------------------------------------

MONEY, TEXT, NUMBER, PCT = "money", "text", "number", "pct"
EXPORT_TABLES = {
    "summary": "mrr", "mrr": "mrr", "movement": "mrr", "mrr-products": "mrr", "churn": "churn", "cohorts": "cohorts",
    "cohort-revenue": "cohorts", "margin": "margin", "margin-months": "margin", "fees": "fees", "fees-methods": "fees", "capital": "capital",
    "capital-withheld": "capital", "ltv": "ltv", "concentration": "concentration", "recovery": "recovery", "refunds": "refunds",
    "forecast": "forecast", "forecast-weekly": "forecast", "forecast-events": "forecast",
}
_SUMMARY_KEYS = (
    ("MRR", "mrr_cents", MONEY), ("ARR", "arr_cents", MONEY), ("Trialing MRR", "trialing_mrr_cents", MONEY),
    ("Active customers", "active_customers", NUMBER), ("Free subscriptions", "free_subscriptions", NUMBER), ("ARPA", "arpa_cents", MONEY), ("Net new MRR", "net_new_mrr_cents", MONEY),
    ("Customer churn", "customer_churn_pct", PCT), ("Gross revenue churn", "gross_revenue_churn_pct", PCT),
    ("Net revenue churn", "net_revenue_churn_pct", PCT), ("NRR (12 months)", "nrr_t12m_pct", PCT), ("GRR (12 months)", "grr_t12m_pct", PCT),
    ("Gross margin", "gross_margin_pct", PCT), ("Effective fee rate", "effective_fee_pct", PCT), ("LTV", "ltv_cents", MONEY),
    ("Top 10 customers' share", "top10_share_pct", PCT), ("HHI", "hhi", NUMBER), ("Recovery rate", "recovery_rate_pct", PCT),
    ("At-risk MRR", "at_risk_mrr_cents", MONEY), ("Forecast low", "forecast_low_cents", MONEY), ("Forecast low date", "forecast_low_date", TEXT),
)


def table(name: str, data: dict) -> tuple[list[tuple[str, str]], list[list]]:
    """(columns as (header, kind), rows) for one export table."""
    if name == "summary":
        s = data["summary"]
        return [("Metric", TEXT), ("Value", TEXT)], [[label, _show(s[key], kind) or "n/a"] for label, key, kind in _SUMMARY_KEYS]
    if name == "mrr":
        cols = [("Month", TEXT), ("MRR", MONEY), ("ARR", MONEY), ("Trialing MRR", MONEY), ("Customers", NUMBER), ("Subscriptions", NUMBER),
                ("Free subscriptions", NUMBER), ("ARPA", MONEY), ("Usage revenue", MONEY)]
        return cols, [[r["month"], r["mrr_cents"], r["arr_cents"], r["trialing_mrr_cents"], r["customers"], r["subscriptions"], r["free_subscriptions"],
                       r["arpa_cents"], r["usage_revenue_cents"]] for r in data["mrr"]["months"]]
    if name == "movement":
        cols = [("Month", TEXT), ("Opening", MONEY), ("New", MONEY), ("Reactivated", MONEY), ("Expansion", MONEY), ("Contraction", MONEY), ("Churned", MONEY), ("Closing", MONEY),
                ("New customers", NUMBER), ("Reactivated customers", NUMBER), ("Churned customers", NUMBER)]
        return cols, [[r["month"], r["opening_cents"], r["new_cents"], r["reactivated_cents"], r["expansion_cents"], r["contraction_cents"], r["churned_cents"], r["closing_cents"],
                       r["new_customers"], r["reactivated_customers"], r["churned_customers"]] for r in data["mrr"]["months"]]
    if name == "mrr-products":
        cols = [("Product", TEXT), ("Name", TEXT), ("MRR", MONEY), ("Share", PCT)]
        return cols, [[r["product"], r["name"], r["mrr_cents"], r["share_pct"]] for r in data["mrr"]["by_product"]]
    if name == "churn":
        cols = [("Month", TEXT), ("Start customers", NUMBER), ("Churned", NUMBER), ("Voluntary", NUMBER), ("Involuntary", NUMBER), ("Customer churn", PCT),
                ("Opening MRR", MONEY), ("Churned MRR", MONEY), ("Involuntary MRR", MONEY), ("Contraction", MONEY), ("Expansion", MONEY),
                ("Gross revenue churn", PCT), ("Net revenue churn", PCT), ("NRR", PCT), ("GRR", PCT)]
        return cols, [[r["month"], r["start_customers"], r["churned_customers"], r["voluntary_customers"], r["involuntary_customers"], r["customer_churn_pct"],
                       r["opening_mrr_cents"], r["churned_mrr_cents"], r["involuntary_mrr_cents"], r["contraction_cents"], r["expansion_cents"],
                       r["gross_revenue_churn_pct"], r["net_revenue_churn_pct"], r["nrr_pct"], r["grr_pct"]] for r in data["churn"]["months"]]
    if name in ("cohorts", "cohort-revenue"):
        width = data["cohorts"]["max_k"] + 1
        money = name == "cohort-revenue"
        cols = [("Cohort", TEXT), ("Customers", NUMBER)] + [(f"M{k}", MONEY if money else PCT) for k in range(width)]
        rows = []
        for c in data["cohorts"]["cohorts"]:
            cells = [cell["revenue_cents"] if money else cell["customers_pct"] for cell in c["retention"]]
            rows.append([c["cohort"], c["customers"], *cells, *([None] * (width - len(cells)))])
        return cols, rows
    if name == "margin":
        cols = [("Product", TEXT), ("Name", TEXT), ("Gross", MONEY), ("Stripe fees", MONEY), ("Refunds", MONEY), ("Disputes", MONEY), ("Capital fees", MONEY),
                ("COGS", MONEY), ("Margin", MONEY), ("Margin %", PCT), ("Revenue share", PCT)]
        rows = [[r["product"], r["name"], r["gross_cents"], r["fees_cents"], r["refunds_cents"], r["disputes_cents"], r["capital_fees_cents"], r["cogs_cents"],
                 r["margin_cents"], r["margin_pct"], r["revenue_share_pct"]] for r in data["margin"]["products"]]
        t = data["margin"]["totals"]
        rows.append(["Total", "", t["gross_cents"], t["fees_cents"], t["refunds_cents"], t["disputes_cents"], t["capital_fees_cents"], t["cogs_cents"], t["margin_cents"], t["margin_pct"], 100.0 if t["gross_cents"] else None])
        return cols, rows
    if name == "margin-months":
        cols = [("Month", TEXT), ("Gross", MONEY), ("Stripe fees", MONEY), ("Refunds", MONEY), ("Disputes", MONEY), ("Capital fees", MONEY), ("COGS", MONEY), ("Margin", MONEY), ("Margin %", PCT)]
        return cols, [[r["month"], r["gross_cents"], r["fees_cents"], r["refunds_cents"], r["disputes_cents"], r["capital_fees_cents"], r["cogs_cents"], r["margin_cents"], r["margin_pct"]] for r in data["margin"]["months"]]
    if name == "fees":
        cols = [("Month", TEXT), ("Method", TEXT), ("Charges", NUMBER), ("Gross", MONEY), ("Fees", MONEY), ("Fee rate", PCT)]
        rows = []
        for r in data["fees"]["months"]:
            for method in (*METHODS, "total"):
                fig = r[method]
                if fig["count"] or method == "total":
                    rows.append([r["month"], method, fig["count"], fig["gross_cents"], fig["fees_cents"], fig["rate_pct"]])
        return cols, rows
    if name == "fees-methods":
        cols = [("Method", TEXT), ("Charges", NUMBER), ("Gross", MONEY), ("Fees", MONEY), ("Fee rate", PCT)]
        return cols, [[METHOD_LABELS[m], data["fees"]["range"][m]["count"], data["fees"]["range"][m]["gross_cents"], data["fees"]["range"][m]["fees_cents"],
                       data["fees"]["range"][m]["rate_pct"]] for m in (*METHODS, "total")]
    if name == "capital":
        cols = [("Account", TEXT), ("Financing", TEXT), ("Principal", MONEY), ("Fee", MONEY), ("Proceeds", TEXT), ("Paid", MONEY), ("Remaining", MONEY),
                ("APR", PCT), ("Effective annual", PCT), ("Projected", TEXT), ("Note", TEXT)]
        return cols, [[f["account"], f["label"], f["principal_cents"], f["fee_cents"], f["proceeds_date"] or "", f["paid_cents"], f["remaining_cents"],
                       f["apr_pct"], f["effective_annual_pct"], "yes" if f["projected"] else "", f["note"]] for f in data["capital"]["financings"]]
    if name == "capital-withheld":
        cols = [("Month", TEXT), ("Gross charges", MONEY), ("Withheld", MONEY), ("Share", PCT)]
        return cols, [[r["month"], r["gross_cents"], r["withheld_cents"], r["share_pct"]] for r in data["capital"]["withheld"]["months"]]
    if name == "ltv":
        lt = data["ltv"]
        rows = [[label, _show(value, kind) or "n/a"] for label, value, kind in (
            ("ARPA", lt["arpa_cents"], MONEY), ("Gross margin", lt["gross_margin_pct"], PCT),
            ("Monthly revenue churn", lt["monthly_revenue_churn_pct"], PCT), ("Lifetime (months)", lt["lifetime_months"], NUMBER),
            ("LTV", lt["ltv_cents"], MONEY), ("CAC", lt["cac_cents"], MONEY), ("Payback (months)", lt["payback_months"], NUMBER))]
        rows += [["Note", text] for text in lt["notes"]]
        return [("Metric", TEXT), ("Value", TEXT)], rows
    if name == "concentration":
        cols = [("Rank", NUMBER), ("Customer", TEXT), ("Revenue (12 months)", MONEY), ("Share", PCT)]
        return cols, [[r["rank"], r["customer"], r["revenue_cents"], r["share_pct"]] for r in data["concentration"]["top"]]
    if name == "recovery":
        cols = [("Month", TEXT), ("Failed charges", NUMBER), ("Failed amount", MONEY), ("Dunning invoices", NUMBER), ("Dunning amount", MONEY),
                ("Recovered", MONEY), ("Lost", MONEY), ("In progress", MONEY), ("Still open", MONEY), ("Recovery rate", PCT)]
        return cols, [[r["month"], r["failed_charges"], r["failed_cents"], r["dunning_invoices"], r["dunning_cents"], r["recovered_cents"], r["lost_cents"],
                       r["in_progress_cents"], r["open_cents"], r["recovery_rate_pct"]] for r in data["recovery"]["months"]]
    if name == "refunds":
        cols = [("Month", TEXT), ("Product", TEXT), ("Name", TEXT), ("Gross", MONEY), ("Refunds", MONEY), ("Refund rate", PCT), ("Disputes", MONEY),
                ("Dispute rate", PCT), ("6-month median rate", PCT), ("Spike", TEXT)]
        rows = []
        for p in data["refunds"]["products"]:
            for r in p["months"]:
                rows.append([r["month"], p["product"], p["name"], r["gross_cents"], r["refunds_cents"], r["refund_rate_pct"], r["disputes_cents"],
                             r["dispute_rate_pct"], r["median_rate_pct"], "SPIKE" if r["spike"] else ""])
        rows.sort(key=lambda r: (r[0], r[1]))
        return cols, rows
    if name == "forecast":
        cols = [("Date", TEXT), ("Inflow", MONEY), ("Outflow", MONEY), ("Balance", MONEY), ("Lowest", TEXT)]
        return cols, [[r["date"], r["inflow_cents"], r["outflow_cents"], r["balance_cents"], "LOWEST" if r["lowest"] else ""] for r in data["forecast"]["daily"]]
    if name == "forecast-weekly":
        cols = [("Week start", TEXT), ("Week end", TEXT), ("Renewals", MONEY), ("Payouts in transit", MONEY), ("Capital withholding", MONEY), ("Bills", MONEY),
                ("Card due dates", MONEY), ("Inflow", MONEY), ("Outflow", MONEY), ("Closing", MONEY), ("Low", MONEY)]
        return cols, [[r["week_start"], r["week_end"], r["renewals_cents"], r["in_transit_cents"], r["capital_withholding_cents"], r["bills_cents"], r["cards_cents"],
                       r["inflow_cents"], r["outflow_cents"], r["closing_cents"], r["low_cents"]] for r in data["forecast"]["weekly"]]
    if name == "forecast-events":
        cols = [("Date", TEXT), ("Kind", TEXT), ("Label", TEXT), ("Amount", MONEY)]
        return cols, [[e["date"], e["kind"], e["label"], e["cents"]] for e in data["forecast"]["events"]]
    raise HpbooksError(f"unknown Stripe metrics table {name}")


def _show(value, kind: str) -> str:
    if value is None:
        return ""
    if kind == MONEY:
        return format_money(int(value))
    if kind == PCT:
        return f"{value:.2f}%"
    return str(value)


def tabular(name: str, data: dict):
    """An analytics.TabularReport for the CSV / XLSX / PDF writers."""
    from hpbooks.analytics import TabularCell, TabularReport
    from hpbooks.db import now_iso

    cols, rows = table(name, data)
    cells = []
    for row in rows:
        out = []
        for (_header, kind), value in zip(cols, row):
            if kind == MONEY and value is not None:
                out.append(TabularCell(format_money(int(value)), cents=int(value)))
            else:
                out.append(TabularCell(_show(value, kind) if kind != TEXT else ("" if value is None else str(value))))
        cells.append(out)
    title = f"Stripe {name.replace('-', ' ')} ({data['start']} to {data['end']}, focus {data['month']})"
    return TabularReport(title=title, generated=now_iso(), columns=[h for h, _k in cols], rows=cells, kinds=["line"] * len(cells))


def table_text(name: str, data: dict) -> str:
    from hpbooks.reports import render_table

    cols, rows = table(name, data)
    body = [[_show(v, kind) if kind != TEXT else ("" if v is None else str(v)) for (_h, kind), v in zip(cols, row)] for row in rows]
    return render_table([h for h, _k in cols], body, right_from=1)


SECTION_TABLES = {
    "mrr": ("mrr", "mrr-products"), "churn": ("churn",), "cohorts": ("cohorts", "cohort-revenue"), "margin": ("margin", "margin-months"),
    "fees": ("fees-methods", "fees"), "capital": ("capital", "capital-withheld"), "ltv": ("ltv",), "concentration": ("concentration",),
    "recovery": ("recovery",), "refunds": ("refunds",), "forecast": ("forecast-weekly", "forecast-events"),
}


def summary_text(data: dict) -> str:
    b = data["mrr"]["bridge"]
    lines = [f"Stripe metrics for {data['month']} (range {data['start']} to {data['end']}, {', '.join(data['accounts']) or 'no accounts'})"]
    if not data["ready"]:
        lines.append("No Stripe billing data imported yet. Pull subscriptions, invoices, charges ... (docs/stripe.md) and run: hpbooks stripe import")
    lines.append(table_text("summary", data))
    lines.append("")
    lines.append(f"MRR movement, {b['month']}:")
    rows = [
        ["Opening MRR", format_money(b["opening_cents"]), ""],
        ["+ New", format_money(b["new_cents"]), str(b["new_customers"])],
        ["+ Reactivated", format_money(b["reactivated_cents"]), str(b["reactivated_customers"])],
        ["+ Expansion", format_money(b["expansion_cents"]), str(b["expansion_customers"])],
        ["- Contraction", format_money(b["contraction_cents"]), str(b["contraction_customers"])],
        ["- Churned", format_money(b["churned_cents"]), str(b["churned_customers"])],
        ["Closing MRR", format_money(b["closing_cents"]), ""],
    ]
    from hpbooks.reports import render_table

    lines.append(render_table(["", "amount", "customers"], rows, right_from=1))
    if data["approximations"]:
        lines.append("")
        lines.append("Approximations:")
        lines.extend(f"- {text}" for text in data["approximations"])
    return "\n".join(lines)


def section_text(name: str, data: dict) -> str:
    parts = []
    if name == "fees":
        a = data["fees"]["ach_savings"]
        parts.append(
            f"Estimated ACH savings (estimate): card and Link (card-funded) volume {format_money(a['card_link_volume_cents'])} paid {format_money(a['card_link_fees_cents'])} "
            f"in fees ({_show(a['card_link_rate_pct'], PCT) or 'n/a'}); at ACH {a['ach_rate_pct']:.3f}% ({a['ach_rate_source']}, capped at {format_money(a['ach_cap_cents'])} per charge) it would be "
            f"{format_money(a['estimated_ach_fees_cents'])}: savings {format_money(a['estimated_savings_cents'])}"
        )
    if name == "churn":
        c = data["churn"]
        parts.append(f"NRR (12 months): {_show(c['nrr_t12m_pct'], PCT) or 'n/a'}; GRR (12 months): {_show(c['grr_t12m_pct'], PCT) or 'n/a'}")
    if name == "concentration":
        c = data["concentration"]
        parts.append(f"{c['window_start']} to {c['window_end']}: top 1 {_show(c['top1_pct'], PCT)}, top 5 {_show(c['top5_pct'], PCT)}, "
                     f"top 10 {_show(c['top10_pct'], PCT)}, HHI {_show(c['hhi'], NUMBER)}")
    if name == "recovery":
        r = data["recovery"]
        parts.append(f"At-risk MRR now: {format_money(r['at_risk_mrr_cents'])} ({r['at_risk_subscriptions']} past due or unpaid subscriptions)")
    if name == "capital":
        w = data["capital"]["withheld"]
        parts.append(f"Withheld share of sales: daily average {_show(w['avg_daily_share_pct'], PCT) or 'n/a'}, monthly average {_show(w['avg_monthly_share_pct'], PCT) or 'n/a'}")
    if name == "forecast":
        f = data["forecast"]
        parts.append(f"Cash forecast (estimate) {f['start']} to {f['end']}: opening {format_money(f['opening_cash_cents'])}, closing {format_money(f['closing_cents'])}, "
                     f"lowest {format_money(f['lowest']['balance_cents'])} on {f['lowest']['date']}")
        parts.extend(f"note: {n}" for n in f["notes"])
    if name == "refunds" and data["refunds"]["spikes"]:
        parts.append("Spikes: " + ", ".join(f"{s['month']} {s['name']} {_show(s['refund_rate_pct'], PCT)}" for s in data["refunds"]["spikes"]))
    for table_name in SECTION_TABLES[name]:
        parts.append(table_text(table_name, data))
    return "\n\n".join(parts)
