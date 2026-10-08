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


def bank_feed(path: Path, account: str, rows: list[tuple[str, str, int, str]]) -> Path:
    """A Finance result for the bank side: (id, date, cents, name)."""
    txns = [
        {"id": txn_id, "account_id": account, "date": day, "amount": f"{cents / 100:.2f}", "name": name, "pending": False}
        for txn_id, day, cents, name in rows
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"source": "finance-mcp", "account_id": account, "date_from": "2026-09-01", "date_to": "2026-09-30", "transactions": txns}),
        encoding="utf-8",
    )
    return path
