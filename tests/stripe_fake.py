"""Synthetic Stripe connector results for tests/test_stripe.py.

Every id, amount, and description here is made up (acct_TEST..., txn_TEST...,
ch_TEST..., po_TEST..., re_TEST..., dp_TEST...). Shapes follow the
GetBalanceTransactions, GetPayouts, GetBalance, and GetCharges results the
Stripe connector returns, saved verbatim the way Grok Bot saves them.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
MAIN = "acct_TEST000001"
CONSULT = "acct_TEST000002"


def ts(day: str, hour: int = 12) -> int:
    """Unix time for `day` at `hour` in the books time zone."""
    y, m, d = (int(part) for part in day.split("-"))
    return int(datetime(y, m, d, hour, tzinfo=NY).timestamp())


def btx(
    txn_id: str,
    kind: str,
    amount: int,
    day: str,
    *,
    fee: int = 0,
    category: str | None = None,
    source: str | None = None,
    description: str | None = None,
    status: str = "available",
    currency: str = "usd",
    exchange_rate=None,
    hour: int = 12,
    fee_type: str = "stripe_fee",
) -> dict:
    default_category = {
        "charge": "charge",
        "payment": "charge",
        "payment_refund": "refund",
        "refund": "refund",
        "stripe_fee": "fee",
        "payout": "payout",
        "payout_failure": "payout_reversal",
        "payout_minimum_balance_hold": "payout_minimum_balance_hold",
        "payout_minimum_balance_release": "payout_minimum_balance_release",
        "financing_paydown": "financing_paydown",
    }.get(kind, "other_adjustment")
    fee_details = []
    if fee:
        fee_details.append(
            {
                "amount": fee,
                "application": None,
                "currency": currency,
                "description": "Sales tax on Stripe fees" if fee_type == "tax" else "Stripe processing fees",
                "type": fee_type,
            }
        )
    return {
        "id": txn_id,
        "object": "balance_transaction",
        "amount": amount,
        "available_on": ts(day, hour) + 2 * 86400,
        "balance_type": "payments",
        "created": ts(day, hour),
        "currency": currency,
        "description": description,
        "exchange_rate": exchange_rate,
        "fee": fee,
        "fee_details": fee_details,
        "net": amount - fee,
        "reporting_category": category or default_category,
        "source": source,
        "status": status,
        "type": kind,
    }


def page(items: list[dict], *, has_more: bool = False, url: str = "/v1/balance_transactions", query: dict | None = None) -> dict:
    out = {"object": "list", "data": items, "has_more": has_more, "url": url}
    if query is not None:
        out["_query"] = query
    return out


def payout(payout_id: str, amount: int, created: str, arrival: str, *, status: str = "paid", btx_id: str | None = None, failure_code=None) -> dict:
    return {
        "id": payout_id,
        "object": "payout",
        "amount": amount,
        "arrival_date": ts(arrival, 0) + 3600,
        "automatic": True,
        "balance_transaction": btx_id,
        "created": ts(created),
        "currency": "usd",
        "description": "STRIPE PAYOUT",
        "destination": "ba_TEST0001",
        "failure_balance_transaction": None,
        "failure_code": failure_code,
        "failure_message": None,
        "livemode": True,
        "method": "standard",
        "statement_descriptor": None,
        "status": status,
        "type": "bank_account",
    }


def balance(available: int, pending: int, currency: str = "usd") -> dict:
    return {
        "object": "balance",
        "available": [{"amount": available, "currency": currency, "source_types": {"card": available}}],
        "livemode": True,
        "pending": [{"amount": pending, "currency": currency, "source_types": {"card": pending}}],
    }


def charge(charge_id: str, amount: int, currency: str, btx_id: str) -> dict:
    # Only id, amount, currency, and balance_transaction are read. The rest is
    # here to prove that billing details are ignored.
    return {
        "id": charge_id,
        "object": "charge",
        "amount": amount,
        "currency": currency,
        "balance_transaction": btx_id,
        "billing_details": {"email": "customer@example.com", "name": "Example Customer"},
        "receipt_email": "customer@example.com",
        "description": "Example subscription",
    }


def mcp_wrap(payload) -> dict:
    """The MCP tool-result wrapper some agents save instead of the bare JSON."""
    return {"content": [{"type": "text", "text": json.dumps(payload)}]}


def write(folder: Path, name: str, payload) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return path


# --- the main scenario: one of every type, September 2026 ---------------------------------

def main_transactions() -> list[dict]:
    """Newest first, the way Stripe lists them."""
    rows = [
        btx("txn_TEST0001", "charge", 10000, "2026-09-01", fee=320, source="ch_TEST0001", description="Example subscription"),
        btx("txn_TEST0002", "payment", 5000, "2026-09-02", fee=40, source="py_TEST0002", description="Example ACH invoice"),
        btx("txn_TEST0003", "payment_refund", -2000, "2026-09-03", source="re_TEST0003", description="REFUND FOR PAYMENT"),
        btx("txn_TEST0004", "adjustment", -3000, "2026-09-04", fee=1500, category="dispute", source="dp_TEST0004",
            description="Chargeback withdrawal for ch_TEST0009"),
        btx("txn_TEST0005", "stripe_fee", -500, "2026-09-05", fee=40, fee_type="tax", description="Billing - Usage Fee (2026-08)"),
        btx("txn_TEST0006", "payout", -9000, "2026-09-06", source="po_TEST0001", description="STRIPE PAYOUT"),
        btx("txn_TEST0007", "payout_minimum_balance_hold", -1000, "2026-09-06", description="Payout minimum balance hold"),
        btx("txn_TEST0008", "payout_minimum_balance_release", 1000, "2026-09-07", description="Payout minimum balance release"),
        btx("txn_TEST0009", "financing_paydown", -800, "2026-09-07", source="flxlnpd_TEST0009", description="Capital repayment"),
        btx("txn_TEST0010", "adjustment", 3000, "2026-09-10", fee=-1500, category="dispute_reversal", source="dp_TEST0004",
            description="Chargeback reversal for ch_TEST0009"),
        btx("txn_TEST0011", "contribution", -100, "2026-09-11", category="contribution", description="Example climate contribution"),
    ]
    return list(reversed(rows))


MAIN_NET = 9680 + 4960 - 2000 - 4500 - 540 - 9000 - 1000 + 1000 - 800 + 4500 - 100
MAIN_QUERY = {"stripe_account": MAIN, "livemode": True, "created_gte": ts("2026-09-01", 0), "created_lt": ts("2026-10-01", 0)}


def main_files(folder: Path, *, pages: int = 2) -> list[Path]:
    """Balance transactions over `pages` files plus one payouts file."""
    rows = main_transactions()
    size = -(-len(rows) // pages)
    paths = []
    for index in range(pages):
        chunk = rows[index * size:(index + 1) * size]
        paths.append(write(folder, f"main_{index + 1}.json", page(chunk, has_more=index + 1 < pages, query=MAIN_QUERY)))
    paths.append(
        write(
            folder,
            "main_payouts_1.json",
            page([payout("po_TEST0001", 9000, "2026-09-06", "2026-09-08", btx_id="txn_TEST0006")], url="/v1/payouts", query=MAIN_QUERY),
        )
    )
    return paths


def bank_feed(path: Path, account: str, rows: list[tuple[str, str, int, str]], *, date_from: str = "2026-09-01", date_to: str = "2026-09-30") -> Path:
    """A Finance result for the bank side: (id, date, cents, name)."""
    txns = [
        {"id": txn_id, "account_id": account, "date": day, "amount": f"{cents / 100:.2f}", "name": name, "pending": False}
        for txn_id, day, cents, name in rows
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"source": "finance-mcp", "account_id": account, "date_from": date_from, "date_to": date_to, "transactions": txns}),
        encoding="utf-8",
    )
    return path


# --- Stripe Capital: one flex loan, flxln_TEST0001 -------------------------------------------

LOAN = "flxln_TEST0001"


def day_after(day: str, days: int) -> str:
    from datetime import date, timedelta

    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def capital_payout(txn_id: str, amount: int, day: str, *, description: str = "Stripe Capital financing") -> dict:
    return btx(txn_id, "financing_payout", amount, day, category="financing", source="fnpay_TEST0001", description=description)


def paydown(txn_id: str, amount: int, day: str, *, loan: str | None = LOAN, charge: str = "ch_TEST0001", source: str | None = None, hour: int = 12) -> dict:
    """A repayment withheld from a sale; `amount` is the positive sum withheld."""
    text = f"Withheld funds from {charge} to pay down flex loan {loan}" if loan else "Capital repayment"
    return btx(txn_id, "financing_paydown", -amount, day, category="financing", source=source, description=text, hour=hour)


def capital_rows(*, count: int, amount: int = 100_000, start: str = "2026-03-02", proceeds: int | None = 2_000_000, loan: str | None = LOAN) -> list[dict]:
    """Proceeds (unless None) on `start`, then `count` daily paydowns of `amount` cents."""
    rows = []
    if proceeds is not None:
        rows.append(capital_payout("txn_TESTCAP000", proceeds, start))
    for n in range(1, count + 1):
        rows.append(paydown(f"txn_TESTCAP{n:03d}", amount, day_after(start, n), loan=loan, charge=f"ch_TESTCAP{n:03d}", source=f"fnpd_TESTCAP{n:03d}"))
    return list(reversed(rows))


# --- payout backfill: one payout every `step` days, each with its own amount -----------------


def backfill(start: str, count: int, *, step: int = 7, base_cents: int = 10_000) -> list[dict]:
    """[{"payout", "btx", "bank"}] in date order: a payout of base + n dollars created on day n x step,
    arriving two days later, and the bank deposit of it on the arrival day."""
    out = []
    for n in range(count):
        created = day_after(start, n * step)
        arrival = day_after(created, 2)
        cents = base_cents + n * 100
        po, txn = f"po_TESTBF{n:04d}", f"txn_TESTBF{n:04d}"
        out.append(
            {
                "month": created[:7],
                "payout": payout(po, cents, created, arrival, btx_id=txn),
                "btx": btx(txn, "payout", -cents, created, source=po, description="STRIPE PAYOUT"),
                "bank": (f"bank-bf{n:04d}", arrival, cents, f"STRIPE TRANSFER ST-BF{n:04d}"),
            }
        )
    return out


def write_backfill(folder: Path, items: list[dict], *, first_page: int = 1) -> int:
    """Month by month, the way the backfill step saves them: <name>_<n>.json and
    <name>_payouts_<n>.json with a running page number. Returns the next page number."""
    page_no = first_page
    for month in sorted({item["month"] for item in items}):
        chunk = [item for item in items if item["month"] == month]
        query = {"stripe_account": MAIN, "livemode": True}
        write(folder, f"main_{page_no}.json", page([item["btx"] for item in reversed(chunk)], query=query))
        write(folder, f"main_payouts_{page_no}.json", page([item["payout"] for item in reversed(chunk)], url="/v1/payouts", query=query))
        page_no += 1
    return page_no


# --- billing objects for the business analytics (stripe_objects / stripe_metrics) -----------
# Customers, products, prices, subscriptions, invoices with lines, invoice payments, and
# charges in the current API shapes. Every id is a *_TEST id, every amount is round, plan
# names are "Plan A" style, and the personal-data fields carry PII-MARKER placeholders (never
# anything that looks like a real name, email, phone, or address) so the scrub can be checked.

PII = "PII-MARKER"
OBJECT_URLS = {
    "customers": "/v1/customers", "products": "/v1/products", "prices": "/v1/prices", "subscriptions": "/v1/subscriptions",
    "invoices": "/v1/invoices", "invoice_payments": "/v1/invoice_payments", "charges": "/v1/charges", "coupons": "/v1/coupons",
}


def customer(cus_id: str, day: str = "2026-01-02", *, delinquent: bool = False) -> dict:
    return {
        "id": cus_id, "object": "customer", "created": ts(day), "delinquent": delinquent, "currency": "usd", "livemode": True,
        "email": f"{PII}-email", "name": f"{PII}-name", "phone": f"{PII}-phone", "description": f"{PII}-description",
        "address": {"line1": f"{PII}-address", "city": f"{PII}-city"}, "shipping": {"name": f"{PII}-ship"},
        "metadata": {"note": f"{PII}-metadata"}, "invoice_settings": {"footer": f"{PII}-footer"},
    }


def product(prod_id: str, name: str = "Plan A") -> dict:
    return {"id": prod_id, "object": "product", "name": name, "active": True, "created": ts("2025-01-02"), "livemode": True,
            "description": "Plan description", "metadata": {"tier": "x"}}


def price(price_id: str, prod_id: str, unit_amount: int | None, *, interval: str | None = "month", count: int = 1,
          usage: str = "licensed", nickname: str | None = None) -> dict:
    return {
        "id": price_id, "object": "price", "product": prod_id, "unit_amount": unit_amount, "currency": "usd", "active": True,
        "nickname": nickname, "type": "recurring" if interval else "one_time", "created": ts("2025-01-02"), "livemode": True,
        "recurring": {"interval": interval, "interval_count": count, "usage_type": usage} if interval else None,
        "metadata": {"internal": "x"},
    }


def coupon_discount(*, percent: float | None = None, amount: int | None = None, duration: str = "forever", start: str = "2025-01-02",
                    end: str | None = None) -> dict:
    coupon = {"id": "co_TEST", "percent_off": percent, "amount_off": amount, "currency": "usd" if amount else None, "duration": duration}
    return {"id": "di_TEST", "object": "discount", "start": ts(start), "end": ts(end) if end else None, "source": {"type": "coupon", "coupon": coupon}}


def coupon(co_id: str, *, percent: float | None = None, amount: int | None = None, duration: str = "forever",
           months: int | None = None, currency: str = "usd") -> dict:
    """A GetCoupons item; its name and metadata are personal data the import must drop."""
    return {
        "id": co_id, "object": "coupon", "percent_off": percent, "amount_off": amount, "currency": currency if amount else None,
        "duration": duration, "duration_in_months": months, "valid": True, "created": ts("2025-01-02"), "livemode": True,
        "name": f"{PII}-coupon-name", "metadata": {"for": f"{PII}-coupon-meta"}, "max_redemptions": None, "times_redeemed": 1,
    }


def id_discount(co_id: str, *, start: str = "2025-01-02", end: str | None = None, sub_id: str = "sub_TEST", di_id: str = "di_TEST") -> dict:
    """A discount as GetSubscriptions returns it with expand data.discounts: the coupon is only an id."""
    return {"id": di_id, "object": "discount", "source": {"coupon": co_id, "type": "coupon"}, "start": ts(start),
            "end": ts(end) if end else None, "subscription": sub_id, "subscription_item": None, "promotion_code": "promo_TEST",
            "customer": "cus_TEST", "checkout_session": None, "invoice": None, "invoice_item": None}


def subscription(
    sub_id: str, cus_id: str, items: list[tuple[str, dict, int]], *, status: str = "active", start: str = "2026-01-01",
    period: tuple[str, str] = ("2026-09-01", "2026-10-01"), canceled: str | None = None, ended: str | None = None,
    reason: str | None = None, trial: tuple[str, str] | None = None, discounts: list | None = None, cancel_at_period_end: bool = False,
) -> dict:
    """items: (si_id, price object, quantity)."""
    return {
        "id": sub_id, "object": "subscription", "customer": cus_id, "status": status, "currency": "usd", "livemode": True,
        "created": ts(start), "start_date": ts(start), "canceled_at": ts(canceled) if canceled else None, "ended_at": ts(ended) if ended else None,
        "cancel_at": None, "cancel_at_period_end": cancel_at_period_end,
        "cancellation_details": {"reason": reason, "comment": f"{PII}-comment", "feedback": None},
        "trial_start": ts(trial[0]) if trial else None, "trial_end": ts(trial[1]) if trial else None,
        "discounts": discounts or [], "metadata": {"crm": f"{PII}-crm"}, "description": f"{PII}-subscription-note",
        "default_payment_method": "pm_TEST",
        "items": {"object": "list", "has_more": False, "data": [
            {"id": si, "object": "subscription_item", "price": p, "quantity": qty, "discounts": [],
             "current_period_start": ts(period[0]), "current_period_end": ts(period[1]), "metadata": {}}
            for si, p, qty in items
        ]},
    }


def line(amount: int, price_id: str | None, prod_id: str | None, start: str, end: str, *, proration: bool = False, discount: int = 0) -> dict:
    return {
        "id": "il_TEST", "object": "line_item", "amount": amount, "currency": "usd", "quantity": 1, "description": f"{PII}-line",
        "period": {"start": ts(start), "end": ts(end)},
        "pricing": {"type": "price_details", "price_details": {"price": price_id, "product": prod_id}},
        "discount_amounts": [{"amount": discount, "discount": "di_TEST"}] if discount else [],
        "parent": {"type": "subscription_item_details", "subscription_item_details": {"proration": proration, "subscription": None, "subscription_item": "si_TEST"}},
    }


def invoice(
    in_id: str, cus_id: str, sub_id: str | None, lines: list[dict], *, status: str = "paid", reason: str = "subscription_cycle",
    day: str = "2026-01-01", paid: str | None = None, due: int | None = None, amount_paid: int | None = None, attempts: int = 1,
) -> dict:
    total = sum(l["amount"] - sum(d["amount"] for d in l["discount_amounts"]) for l in lines) if due is None else due
    paid_amount = (total if status == "paid" else 0) if amount_paid is None else amount_paid
    return {
        "id": in_id, "object": "invoice", "customer": cus_id, "status": status, "billing_reason": reason, "currency": "usd", "livemode": True,
        "amount_due": total, "amount_paid": paid_amount, "amount_remaining": total - paid_amount, "attempt_count": attempts, "attempted": attempts > 0,
        "next_payment_attempt": None, "created": ts(day), "period_start": ts(day, 0), "period_end": ts(day, 0),
        "status_transitions": {"paid_at": ts(paid or day, 13) if status == "paid" else None, "finalized_at": ts(day)},
        "parent": {"type": "subscription_details", "subscription_details": {"subscription": sub_id, "metadata": {}}} if sub_id else None,
        "customer_email": f"{PII}-email", "customer_name": f"{PII}-name", "customer_address": {"line1": f"{PII}-address"},
        "customer_phone": f"{PII}-phone", "customer_shipping": None, "account_name": f"{PII}-account", "description": f"{PII}-memo",
        "hosted_invoice_url": f"https://invoice.invalid/{PII}", "invoice_pdf": f"https://invoice.invalid/{PII}.pdf", "metadata": {"x": PII},
        "lines": {"object": "list", "has_more": False, "data": lines},
    }


def invoice_payment(inpay_id: str, in_id: str, amount: int, day: str, *, pi: str | None = None, charge_id: str | None = None,
                    status: str = "paid") -> dict:
    payment = {"type": "payment_intent", "payment_intent": pi} if pi else {"type": "charge", "charge": charge_id}
    return {
        "id": inpay_id, "object": "invoice_payment", "invoice": in_id, "amount_paid": amount if status == "paid" else None,
        "amount_requested": amount, "status": status, "currency": "usd", "created": ts(day), "livemode": True, "is_default": True,
        "status_transitions": {"paid_at": ts(day, 13) if status == "paid" else None, "canceled_at": None}, "payment": payment,
    }


def charge_obj(
    ch_id: str, amount: int, day: str, *, customer_id: str | None = None, method: str = "card", status: str = "succeeded",
    btx_id: str | None = None, pi: str | None = None, refunded: int = 0, refund_ids: list[str] | None = None,
    disputed: bool = False, failure: str | None = None, invoice_id: str | None = None, hour: int = 13,
) -> dict:
    return {
        "id": ch_id, "object": "charge", "amount": amount, "amount_captured": amount if status == "succeeded" else 0, "amount_refunded": refunded,
        "currency": "usd", "status": status, "paid": status == "succeeded", "refunded": refunded == amount and refunded > 0, "disputed": disputed,
        "captured": status == "succeeded", "created": ts(day, hour), "customer": customer_id, "payment_intent": pi,
        "balance_transaction": btx_id, "livemode": True, "invoice": invoice_id,
        "failure_code": failure, "failure_message": f"{PII}-failure" if failure else None,
        "outcome": {"type": "issuer_declined" if failure else "authorized", "network_status": "declined_by_network" if failure else "approved_by_network",
                    "seller_message": "x", "risk_level": "normal"},
        "payment_method_details": {"type": method, method: {"last4": "0000", "brand": "testbrand", "fingerprint": f"{PII}-fp"}},
        "billing_details": {"name": f"{PII}-name", "email": f"{PII}-email", "phone": f"{PII}-phone", "address": {"line1": f"{PII}-address"}},
        "receipt_email": f"{PII}-email", "receipt_url": f"https://receipt.invalid/{PII}", "description": f"{PII}-desc",
        "metadata": {"order": PII}, "shipping": None,
        "refunds": {"object": "list", "has_more": False, "data": [{"id": r, "object": "refund", "amount": refunded, "created": ts(day), "status": "succeeded"} for r in refund_ids or []]},
    }


def object_page(kind: str, items: list[dict], *, has_more: bool = False) -> dict:
    return page(items, has_more=has_more, url=OBJECT_URLS[kind], query={"stripe_account": MAIN, "livemode": True})


def write_objects(folder: Path, kinds: dict[str, list[dict]], *, name: str = "main", page_no: int = 1) -> list[Path]:
    """One file per kind: <name>_<kind>_<page>.json."""
    return [write(folder, f"{name}_{kind}_{page_no}.json", object_page(kind, items)) for kind, items in kinds.items() if items]


class Book:
    """A builder for one synthetic Stripe account: objects plus the balance transactions they paid into."""

    def __init__(self):
        self.objects: dict[str, list[dict]] = {kind: [] for kind in OBJECT_URLS}
        self.btx: list[dict] = []
        self.payouts: list[dict] = []
        self._n = 0

    def _id(self, prefix: str) -> str:
        self._n += 1
        return f"{prefix}_TEST{self._n:05d}"

    def add(self, kind: str, obj: dict) -> dict:
        self.objects[kind].append(obj)
        return obj

    def sale(self, cus_id: str, sub_id: str | None, lines: list[dict], day: str, *, fee: int = 0, method: str = "card",
             link: str = "pi", reason: str = "subscription_cycle", refund: int = 0, refund_day: str | None = None,
             dispute_day: str | None = None) -> dict:
        """A paid invoice, its invoice payment (by payment intent or charge), the charge, and its balance transaction."""
        in_id, ch_id, txn, pi = self._id("in"), self._id("ch"), self._id("txn"), self._id("pi")
        inv = invoice(in_id, cus_id, sub_id, lines, day=day, reason=reason)
        amount = inv["amount_paid"]
        self.add("invoices", inv)
        if link == "pi":
            self.add("invoice_payments", invoice_payment(self._id("inpay"), in_id, amount, day, pi=pi))
        elif link == "charge":
            self.add("invoice_payments", invoice_payment(self._id("inpay"), in_id, amount, day, charge_id=ch_id))
        elif link == "legacy":
            inv["charge"] = ch_id
        refund_ids = [self._id("re")] if refund else []
        self.add("charges", charge_obj(ch_id, amount, day, customer_id=cus_id, method=method, btx_id=txn, pi=pi,
                                       refunded=refund, refund_ids=refund_ids, disputed=bool(dispute_day)))
        self.btx.append(btx(txn, "charge", amount, day, fee=fee, source=ch_id, hour=13))
        if refund:
            self.btx.append(btx(self._id("txn"), "refund", -refund, refund_day or day, source=refund_ids[0], hour=14))
        if dispute_day:
            self.btx.append(btx(self._id("txn"), "adjustment", -amount, dispute_day, fee=1500, category="dispute",
                                source=self._id("dp"), description=f"Chargeback withdrawal for {ch_id}", hour=14))
        return {"invoice": in_id, "charge": ch_id, "btx": txn, "amount": amount}

    def write(self, folder: Path, *, name: str = "main") -> list[Path]:
        paths = write_objects(folder, self.objects, name=name)
        if self.btx:
            paths.append(write(folder, f"{name}_1.json", page(list(reversed(self.btx)), query={"stripe_account": MAIN, "livemode": True})))
        if self.payouts:
            paths.append(write(folder, f"{name}_payouts_1.json", page(self.payouts, url="/v1/payouts", query={"stripe_account": MAIN, "livemode": True})))
        return paths
