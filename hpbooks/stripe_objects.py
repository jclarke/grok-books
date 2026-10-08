"""Stripe billing objects for the business analytics (features.stripe).

Grok Bot saves GetCustomers, GetSubscriptions, GetInvoices, GetInvoicePayments,
GetCharges, GetPrices, GetProducts, and GetCoupons results verbatim under
sync/inbox/<day>/stripe/<name>_<kind>_<n>.json. stripe.import_files hands each
loaded file of those kinds to import_file() here.

Privacy: WHITELIST is the one place that says which fields of each object are
kept. Every raw object is projected onto it before anything else reads it, so
the database never sees a name, email, phone, address, billing_details, URL,
invoice_pdf, account_name, customer_* field, description, metadata, or coupon
name (it often holds a person's name). After a successful import the
PII-bearing files (customers, invoices, charges, subscriptions, coupons) are
rewritten in place, atomically, to the same projection
(scrub_file); the projection is also exactly what the import reads, so a
scrubbed file re-imports to the same rows.

Freshness: each row records seen_on, the pull date of its file (the inbox
folder date, else today). A file pulled earlier than the stored row is not
applied, so importing an old folder never rolls a subscription's status back.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from hpbooks.db import now_iso

# Object kinds by file-name suffix (<name>_<kind>_<n>.json) and their list `object`.
KINDS = ("customers", "products", "prices", "subscriptions", "invoices", "invoice_payments", "charges", "coupons")
OBJECT_KIND = {
    "customer": "customers",
    "product": "products",
    "price": "prices",
    "subscription": "subscriptions",
    "invoice": "invoices",
    "invoice_payment": "invoice_payments",
    "charge": "charges",
    "coupon": "coupons",
}
URL_KIND = (
    ("/v1/invoice_payments", "invoice_payments"),
    ("/v1/subscriptions", "subscriptions"),
    ("/v1/invoices", "invoices"),
    ("/v1/customers", "customers"),
    ("/v1/prices", "prices"),
    ("/v1/products", "products"),
    ("/v1/coupons", "coupons"),
)
SCRUB_KINDS = ("customers", "invoices", "charges", "subscriptions", "coupons")

# --- the whitelist --------------------------------------------------------------------
# A spec maps a key to True (keep the value if it is a scalar) or to a nested spec
# (keep a dict projected onto it; a list keeps each element projected; a string id
# in place of an expanded object is kept). Anything not named is dropped.

_RECURRING = {"interval": True, "interval_count": True, "usage_type": True}
# Never the coupon's name: it often holds a person's name.
_COUPON = {"id": True, "percent_off": True, "amount_off": True, "currency": True, "duration": True, "duration_in_months": True}
_DISCOUNT = {"id": True, "start": True, "end": True, "coupon": _COUPON, "source": {"type": True, "coupon": _COUPON}}
_PRICE = {
    "id": True, "object": True, "product": True, "nickname": True, "active": True, "currency": True,
    "unit_amount": True, "type": True, "recurring": _RECURRING, "created": True, "livemode": True,
}
_LIST_META = {"object": True, "has_more": True, "url": True}

WHITELIST: dict[str, dict] = {
    "customers": {"id": True, "object": True, "created": True, "delinquent": True, "currency": True, "livemode": True},
    "products": {"id": True, "object": True, "name": True, "active": True, "created": True, "livemode": True},
    "prices": _PRICE,
    "subscriptions": {
        "id": True, "object": True, "customer": True, "status": True, "currency": True, "livemode": True,
        "created": True, "start_date": True, "canceled_at": True, "ended_at": True, "cancel_at": True,
        "cancel_at_period_end": True, "cancellation_details": {"reason": True},
        "trial_start": True, "trial_end": True, "current_period_start": True, "current_period_end": True,
        "discount": _DISCOUNT, "discounts": _DISCOUNT,
        "items": {
            **_LIST_META,
            "data": {
                "id": True, "object": True, "price": _PRICE, "quantity": True, "discounts": _DISCOUNT,
                "current_period_start": True, "current_period_end": True,
            },
        },
    },
    "invoices": {
        "id": True, "object": True, "customer": True, "subscription": True, "status": True, "billing_reason": True,
        "currency": True, "livemode": True, "amount_due": True, "amount_paid": True, "amount_remaining": True,
        "attempt_count": True, "attempted": True, "next_payment_attempt": True, "created": True,
        "period_start": True, "period_end": True, "charge": True, "payment_intent": True,
        "status_transitions": {"paid_at": True, "finalized_at": True, "voided_at": True, "marked_uncollectible_at": True},
        "parent": {"type": True, "subscription_details": {"subscription": True}},
        "lines": {
            **_LIST_META,
            "data": {
                "id": True, "object": True, "amount": True, "currency": True, "quantity": True, "proration": True,
                "period": {"start": True, "end": True},
                "pricing": {"type": True, "price_details": {"price": True, "product": True}},
                "price": _PRICE,
                "discount_amounts": {"amount": True},
                "parent": {
                    "type": True,
                    "subscription_item_details": {"proration": True, "subscription": True, "subscription_item": True},
                    "invoice_item_details": {"proration": True},
                },
            },
        },
    },
    "invoice_payments": {
        "id": True, "object": True, "invoice": True, "amount_paid": True, "amount_requested": True, "status": True,
        "currency": True, "created": True, "livemode": True, "is_default": True,
        "status_transitions": {"paid_at": True, "canceled_at": True},
        "payment": {"type": True, "payment_intent": True, "charge": True, "payment_record": True},
    },
    "charges": {
        "id": True, "object": True, "amount": True, "amount_captured": True, "amount_refunded": True, "currency": True,
        "status": True, "paid": True, "refunded": True, "disputed": True, "captured": True, "created": True,
        "customer": True, "invoice": True, "payment_intent": True, "balance_transaction": True, "livemode": True,
        "failure_code": True, "outcome": {"type": True, "network_status": True},
        "payment_method_details": {"type": True},
        "refunds": {**_LIST_META, "data": {"id": True, "object": True, "amount": True, "created": True, "status": True}},
    },
    "coupons": {**_COUPON, "object": True, "valid": True, "created": True, "livemode": True},
}
# Page-level fields kept in a scrubbed file.
_PAGE = {"object": True, "has_more": True, "url": True, "_query": True}


def _scalar(value) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def project(value, spec):
    """`value` reduced to the fields `spec` names (see WHITELIST)."""
    if spec is True:
        return value if _scalar(value) else None
    if isinstance(value, list):
        return [project(item, spec) for item in value]
    if isinstance(value, dict):
        return {key: project(value[key], sub) for key, sub in spec.items() if key in value}
    return value if isinstance(value, str) or value is None else None


def project_page(page: dict, kind: str) -> dict:
    out = {key: page[key] for key in _PAGE if key in page and key != "_query" and _scalar(page[key])}
    if isinstance(page.get("_query"), dict):
        out["_query"] = {key: value for key, value in page["_query"].items() if _scalar(value)}
    out["data"] = [project(item, WHITELIST[kind]) for item in page.get("data") or [] if isinstance(item, dict)]
    return out


# --- normalizing -------------------------------------------------------------------------


def _ref(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) and value else None


def _num(value) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _text(value) -> str | None:
    return value if isinstance(value, str) and value else None


def _flag(value) -> int:
    return 1 if value is True else 0


def _dig(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def _coupon_terms(coupon: dict) -> dict:
    return {
        "percent_off": coupon.get("percent_off") if isinstance(coupon.get("percent_off"), (int, float)) and not isinstance(coupon.get("percent_off"), bool) else None,
        "amount_off": _num(coupon.get("amount_off")),
        "currency": (_text(coupon.get("currency")) or "").lower() or None,
        "duration": _text(coupon.get("duration")),
        "duration_in_months": _num(coupon.get("duration_in_months")),
    }


def _discounts(raw) -> list[dict]:
    """Compact discounts: [{"coupon", "percent_off", "amount_off", "currency", "duration", "duration_in_months",
    "start", "end"}]. A discount whose coupon is only an id (expand data.discounts, current API) becomes
    {"id_only": True, "coupon", "start", "end"}, resolved by the metrics through stripe_coupons; a discount
    that is itself only an id (not expanded) becomes {"id_only": True}."""
    items = raw if isinstance(raw, list) else [raw] if raw else []
    out = []
    for item in items:
        if isinstance(item, str):
            out.append({"id_only": True})
            continue
        if not isinstance(item, dict):
            continue
        coupon = item.get("coupon") if item.get("coupon") is not None else _dig(item, "source", "coupon")
        when = {"start": _num(item.get("start")), "end": _num(item.get("end"))}
        if isinstance(coupon, dict):
            out.append({"coupon": _ref(coupon), **_coupon_terms(coupon), **when})
        else:
            out.append({"id_only": True, "coupon": _ref(coupon), **when})
    return out


def _price_fields(price) -> dict:
    if not isinstance(price, dict):
        return {"price": _ref(price), "product": None, "unit_amount": None, "currency": None,
                "interval": None, "interval_count": None, "usage_type": None}
    recurring = price.get("recurring") if isinstance(price.get("recurring"), dict) else {}
    return {
        "price": _ref(price),
        "product": _ref(price.get("product")),
        "unit_amount": _num(price.get("unit_amount")),
        "currency": (_text(price.get("currency")) or "").lower() or None,
        "interval": _text(recurring.get("interval")),
        "interval_count": _num(recurring.get("interval_count")) or (1 if recurring.get("interval") else None),
        "usage_type": _text(recurring.get("usage_type")),
    }


def norm_coupon(obj: dict) -> dict:
    return {**_coupon_terms(obj), "valid": _flag(obj.get("valid")), "created_ts": _num(obj.get("created"))}


def norm_customer(obj: dict) -> dict:
    return {"created_ts": _num(obj.get("created")), "delinquent": _flag(obj.get("delinquent")),
            "currency": (_text(obj.get("currency")) or "").lower() or None}


def norm_product(obj: dict) -> dict:
    return {"name": (_text(obj.get("name")) or "")[:120] or None, "active": _flag(obj.get("active")), "created_ts": _num(obj.get("created"))}


def norm_price(obj: dict) -> dict:
    fields = _price_fields(obj)
    return {
        "product": fields["product"], "nickname": (_text(obj.get("nickname")) or "")[:120] or None,
        "active": _flag(obj.get("active")), "currency": fields["currency"], "unit_amount": fields["unit_amount"],
        "interval": fields["interval"], "interval_count": fields["interval_count"], "usage_type": fields["usage_type"],
        "created_ts": _num(obj.get("created")),
    }


def norm_subscription(obj: dict) -> tuple[dict, list[dict]]:
    items = []
    for item in _dig(obj, "items", "data") or []:
        if not isinstance(item, dict) or not _ref(item):
            continue
        price = _price_fields(item.get("price"))
        items.append(
            {
                "id": item["id"], "price": price["price"], "product": price["product"],
                "quantity": _num(item.get("quantity")) if item.get("quantity") is not None else 1,
                "unit_amount": price["unit_amount"], "currency": price["currency"], "interval": price["interval"],
                "interval_count": price["interval_count"], "usage_type": price["usage_type"],
                "current_period_start_ts": _num(item.get("current_period_start")),
                "current_period_end_ts": _num(item.get("current_period_end")),
                "discounts_json": json.dumps(_discounts(item.get("discounts")), sort_keys=True),
            }
        )
    starts = [i["current_period_start_ts"] for i in items if i["current_period_start_ts"] is not None]
    ends = [i["current_period_end_ts"] for i in items if i["current_period_end_ts"] is not None]
    discounts = _discounts(obj.get("discounts")) + _discounts(obj.get("discount"))
    row = {
        "customer": _ref(obj.get("customer")),
        "status": _text(obj.get("status")) or "unknown",
        "currency": (_text(obj.get("currency")) or "").lower() or None,
        "created_ts": _num(obj.get("created")),
        "start_ts": _num(obj.get("start_date")) or _num(obj.get("created")),
        "canceled_ts": _num(obj.get("canceled_at")),
        "ended_ts": _num(obj.get("ended_at")),
        "cancel_at_ts": _num(obj.get("cancel_at")),
        "cancel_at_period_end": _flag(obj.get("cancel_at_period_end")),
        "cancel_reason": _text(_dig(obj, "cancellation_details", "reason")),
        "trial_start_ts": _num(obj.get("trial_start")),
        "trial_end_ts": _num(obj.get("trial_end")),
        "current_period_start_ts": _num(obj.get("current_period_start")) or (min(starts) if starts else None),
        "current_period_end_ts": _num(obj.get("current_period_end")) or (min(ends) if ends else None),
        "discounts_json": json.dumps(discounts, sort_keys=True),
    }
    return row, items


def _line_proration(line: dict) -> bool:
    for value in (line.get("proration"), _dig(line, "parent", "subscription_item_details", "proration"),
                  _dig(line, "parent", "invoice_item_details", "proration")):
        if value is True:
            return True
    return False


def norm_invoice(obj: dict) -> tuple[dict, list[dict]]:
    lines = []
    for index, line in enumerate(_dig(obj, "lines", "data") or []):
        if not isinstance(line, dict):
            continue
        details = _dig(line, "pricing", "price_details") or {}
        legacy = line.get("price") if isinstance(line.get("price"), dict) else {}
        price = _ref(details.get("price")) or _ref(line.get("price"))
        product = _ref(details.get("product")) or _ref(legacy.get("product"))
        discount = sum(_num(d.get("amount")) or 0 for d in line.get("discount_amounts") or [] if isinstance(d, dict))
        lines.append(
            {
                "line": index, "id": _ref(line), "amount": _num(line.get("amount")) or 0, "discount": discount,
                "currency": (_text(line.get("currency")) or "").lower() or None, "price": price, "product": product,
                "quantity": _num(line.get("quantity")), "proration": _flag(_line_proration(line)),
                "period_start_ts": _num(_dig(line, "period", "start")), "period_end_ts": _num(_dig(line, "period", "end")),
            }
        )
    row = {
        "customer": _ref(obj.get("customer")),
        "subscription": _ref(_dig(obj, "parent", "subscription_details", "subscription")) or _ref(obj.get("subscription")),
        "status": _text(obj.get("status")),
        "billing_reason": _text(obj.get("billing_reason")),
        "currency": (_text(obj.get("currency")) or "").lower() or None,
        "amount_due": _num(obj.get("amount_due")) or 0,
        "amount_paid": _num(obj.get("amount_paid")) or 0,
        "amount_remaining": _num(obj.get("amount_remaining")) or 0,
        "attempt_count": _num(obj.get("attempt_count")) or 0,
        "attempted": _flag(obj.get("attempted")),
        "next_payment_attempt_ts": _num(obj.get("next_payment_attempt")),
        "created_ts": _num(obj.get("created")),
        "paid_ts": _num(_dig(obj, "status_transitions", "paid_at")),
        "period_start_ts": _num(obj.get("period_start")),
        "period_end_ts": _num(obj.get("period_end")),
        "charge": _ref(obj.get("charge")),
        "payment_intent": _ref(obj.get("payment_intent")),
    }
    return row, lines


def norm_invoice_payment(obj: dict) -> dict:
    payment = obj.get("payment") if isinstance(obj.get("payment"), dict) else {}
    return {
        "invoice": _ref(obj.get("invoice")),
        "amount_paid": _num(obj.get("amount_paid")),
        "amount_requested": _num(obj.get("amount_requested")),
        "status": _text(obj.get("status")),
        "currency": (_text(obj.get("currency")) or "").lower() or None,
        "created_ts": _num(obj.get("created")),
        "paid_ts": _num(_dig(obj, "status_transitions", "paid_at")),
        "payment_type": _text(payment.get("type")),
        "payment_intent": _ref(payment.get("payment_intent")),
        "charge": _ref(payment.get("charge")),
        "payment_record": _ref(payment.get("payment_record")),
    }


def norm_charge(obj: dict) -> dict:
    refunds = [
        {"id": r["id"], "amount": _num(r.get("amount")), "created": _num(r.get("created"))}
        for r in _dig(obj, "refunds", "data") or []
        if isinstance(r, dict) and _ref(r)
    ]
    return {
        "customer": _ref(obj.get("customer")),
        "status": _text(obj.get("status")) or ("succeeded" if obj.get("paid") is True else None),
        "currency": (_text(obj.get("currency")) or "").lower() or None,
        "amount": _num(obj.get("amount")) or 0,
        "amount_refunded": _num(obj.get("amount_refunded")) or 0,
        "disputed": _flag(obj.get("disputed")),
        "created_ts": _num(obj.get("created")),
        "method": _text(_dig(obj, "payment_method_details", "type")),
        "failure_code": _text(obj.get("failure_code")),
        "outcome_type": _text(_dig(obj, "outcome", "type")),
        "network_status": _text(_dig(obj, "outcome", "network_status")),
        "balance_transaction": _ref(obj.get("balance_transaction")),
        "payment_intent": _ref(obj.get("payment_intent")),
        "invoice": _ref(obj.get("invoice")),
        "refunds_json": json.dumps(refunds, sort_keys=True),
    }


# --- storing ------------------------------------------------------------------------------

_TABLES = {
    "customers": ("stripe_customers", norm_customer),
    "products": ("stripe_products", norm_product),
    "prices": ("stripe_prices", norm_price),
    "subscriptions": ("stripe_subscriptions", norm_subscription),
    "invoices": ("stripe_invoices", norm_invoice),
    "invoice_payments": ("stripe_invoice_payments", norm_invoice_payment),
    "charges": ("stripe_charges", norm_charge),
    "coupons": ("stripe_coupons", norm_coupon),
}
_CHILDREN = {
    "subscriptions": ("stripe_subscription_items", "subscription"),
    "invoices": ("stripe_invoice_lines", "invoice"),
}


def _upsert(conn, table: str, account: str, obj_id: str, row: dict, seen_on: str) -> str:
    """'new', 'updated', 'unchanged', or 'stale' (the stored row comes from a later pull)."""
    existing = conn.execute(f"SELECT * FROM {table} WHERE account = ? AND id = ?", (account, obj_id)).fetchone()
    fields = list(row)
    ts = now_iso()
    if existing is None:
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        conn.execute(
            f"INSERT INTO {table} (account, id, {cols}, seen_on, imported_at, updated_at) VALUES (?, ?, {marks}, ?, ?, ?)",
            (account, obj_id, *row.values(), seen_on, ts, ts),
        )
        return "new"
    if existing["seen_on"] > seen_on:
        return "stale"
    if all(existing[field] == row[field] for field in fields):
        if existing["seen_on"] != seen_on:
            conn.execute(f"UPDATE {table} SET seen_on = ? WHERE account = ? AND id = ?", (seen_on, account, obj_id))
        return "unchanged"
    sets = ", ".join(f"{field} = ?" for field in fields)
    conn.execute(
        f"UPDATE {table} SET {sets}, seen_on = ?, updated_at = ? WHERE account = ? AND id = ?",
        (*row.values(), seen_on, ts, account, obj_id),
    )
    return "updated"


def _replace_children(conn, kind: str, account: str, parent: str, children: list[dict]) -> None:
    table, key = _CHILDREN[kind]
    conn.execute(f"DELETE FROM {table} WHERE account = ? AND {key} = ?", (account, parent))
    for child in children:
        cols = ", ".join(child)
        marks = ", ".join("?" for _ in child)
        conn.execute(f"INSERT OR REPLACE INTO {table} (account, {key}, {cols}) VALUES (?, ?, {marks})", (account, parent, *child.values()))


def _children_differ(conn, kind: str, account: str, parent: str, children: list[dict]) -> bool:
    table, key = _CHILDREN[kind]
    order = "line" if kind == "invoices" else "id"
    have = [dict(row) for row in conn.execute(f"SELECT * FROM {table} WHERE account = ? AND {key} = ? ORDER BY {order}", (account, parent))]
    want = sorted(children, key=lambda c: c[order])
    if len(have) != len(want):
        return True
    return any(any(h[field] != w[field] for field in w) for h, w in zip(have, want))


def import_file(conn, account: str, item: dict, seen_on: str) -> dict:
    """Store every object of one loaded file. Returns {"new", "updated", "unchanged", "stale", "skipped"}."""
    kind = item["kind"]
    table, normalize = _TABLES[kind]
    counts = {"new": 0, "updated": 0, "unchanged": 0, "stale": 0, "skipped": 0}
    for page in item["pages"]:
        for raw in page.get("data") or []:
            if not isinstance(raw, dict) or not _ref(raw):
                counts["skipped"] += 1
                continue
            obj = project(raw, WHITELIST[kind])
            result = normalize(obj)
            row, children = result if isinstance(result, tuple) else (result, None)
            outcome = _upsert(conn, table, account, obj["id"], row, seen_on)
            if children is not None and outcome != "stale":
                if outcome == "new" or _children_differ(conn, kind, account, obj["id"], children):
                    _replace_children(conn, kind, account, obj["id"], children)
                    if outcome == "unchanged":
                        outcome = "updated"
            counts[outcome] += 1
    return counts


# --- the privacy scrub --------------------------------------------------------------------


def scrub_file(path: Path, kind: str, pages: list[dict]) -> bool:
    """Rewrite a saved file to its whitelisted fields, atomically (mode 600). True when it changed."""
    scrubbed = [project_page(page, kind) for page in pages]
    payload = scrubbed[0] if len(scrubbed) == 1 else scrubbed
    text = json.dumps(payload, indent=1, sort_keys=True) + "\n"
    try:
        if path.read_text(encoding="utf-8") == text:
            return False
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return True
