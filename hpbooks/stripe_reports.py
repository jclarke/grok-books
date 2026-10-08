"""Stripe reports: summary, payouts and their bank deposits, status. Read-only.

Figures come from the stored Stripe balance transactions (Stripe's own view);
the P&L reads the ledger rows the import posted from them. Money is integer
cents. In summaries refunds, disputes, and fees are positive amounts that
reduce revenue: net revenue = gross - refunds - disputes - fees.
"""

from __future__ import annotations

import csv
import io
from datetime import date

from hpbooks.config import StripeAccount, get_config
from hpbooks.db import HpbooksError, _table_exists, format_money
from hpbooks.reports import months_covering, render_table, require_date
from hpbooks.stripe import MATCH_STATUSES, bank_only, settings

FIGURES = (
    "gross_cents",
    "refunds_cents",
    "disputes_cents",
    "fees_cents",
    "net_revenue_cents",
    "capital_repayments_cents",
    "capital_proceeds_cents",
    "payouts_cents",
)
# Bookings whose fee field is a Stripe fee (the rest are skipped or go to review).
_FEE_BOOKINGS = ("revenue", "refund", "dispute", "fee", "payout", "payout_return", "hold", "capital")


def ready(conn) -> bool:
    if not _table_exists(conn, "stripe_balance_transactions"):
        return False
    return conn.execute("SELECT 1 FROM stripe_balance_transactions LIMIT 1").fetchone() is not None


def _range(start: str | None, end: str | None, today: date | None = None) -> tuple[str, str]:
    today = today or date.today()
    if (start is None) != (end is None):
        raise HpbooksError("start and end go together")
    if start is None:
        return f"{today.year:04d}-01-01", today.isoformat()
    start, end = require_date(start), require_date(end)
    if start > end:
        raise HpbooksError("start must be on or before end")
    return start, end


def _accounts(business: str = "all", account: str | None = None) -> list[StripeAccount]:
    cfg = settings()
    if business not in ("all", *get_config().business_slugs):
        raise HpbooksError(get_config().business_filter_error)
    if account and cfg.account(account) is None:
        raise HpbooksError(f"no Stripe account named {account!r}")
    return [a for a in cfg.accounts if (business == "all" or a.business == business) and account in (None, a.name)]


def _empty() -> dict:
    return {key: 0 for key in FIGURES}


def _add(acc: dict, row: dict) -> None:
    booking = row["booking"]
    amount = int(row["amount_cents"])
    if booking == "revenue":
        acc["gross_cents"] += amount
    elif booking == "refund":
        acc["refunds_cents"] -= amount
    elif booking == "dispute":
        acc["disputes_cents"] -= amount
    elif booking == "fee":
        acc["fees_cents"] -= amount
    elif booking == "capital":
        if amount < 0:
            acc["capital_repayments_cents"] -= amount
        else:
            acc["capital_proceeds_cents"] += amount
    elif booking == "payout":
        acc["payouts_cents"] -= amount
    elif booking == "payout_return":
        acc["payouts_cents"] -= amount
    if booking in _FEE_BOOKINGS:
        acc["fees_cents"] += int(row["fee_cents"])


def _finish(acc: dict) -> dict:
    acc["net_revenue_cents"] = acc["gross_cents"] - acc["refunds_cents"] - acc["disputes_cents"] - acc["fees_cents"]
    acc["fee_pct"] = round(acc["fees_cents"] * 100 / acc["gross_cents"], 2) if acc["gross_cents"] else None
    return acc


def _rows(conn, names: list[str], start: str, end: str) -> list[dict]:
    if not names or not _table_exists(conn, "stripe_balance_transactions"):
        return []
    marks = ", ".join("?" for _ in names)
    return [
        {key: row[key] for key in row.keys()}
        for row in conn.execute(
            f"""
            SELECT account, id, type, booking, amount_cents, fee_cents, created
            FROM stripe_balance_transactions
            WHERE account IN ({marks}) AND created >= ? AND created <= ?
            ORDER BY created, id
            """,
            (*names, start, end),
        )
    ]


def _needs_review(conn, acct: StripeAccount) -> int:
    return int(
        conn.execute(
            """
            SELECT COUNT(*) FROM transactions t LEFT JOIN classifications c ON c.txn_id = t.id
            WHERE t.account_id = ? AND t.status = 'active' AND ifnull(c.business_tag, 'needs_review') = 'needs_review'
            """,
            (acct.ledger_id,),
        ).fetchone()[0]
    )


def _skipped_currency(conn, acct: StripeAccount) -> int:
    if not _table_exists(conn, "stripe_balance_transactions"):
        return 0
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM stripe_balance_transactions WHERE account = ? AND booking = 'skipped_currency'", (acct.name,)
        ).fetchone()[0]
    )


def _payout_counts(conn, names: list[str]) -> dict:
    counts = {status: 0 for status in MATCH_STATUSES}
    if not names or not _table_exists(conn, "stripe_payouts"):
        return counts
    marks = ", ".join("?" for _ in names)
    for row in conn.execute(
        f"SELECT match_status, COUNT(*) AS n FROM stripe_payouts WHERE account IN ({marks}) GROUP BY match_status", names
    ):
        counts[row["match_status"]] = int(row["n"])
    return counts


def summary(conn, start: str | None = None, end: str | None = None, *, business: str = "all", account: str | None = None, today: date | None = None) -> dict:
    """Gross, refunds, disputes, fees, net, and Capital per account and by month."""
    start, end = _range(start, end, today)
    accounts = _accounts(business, account)
    names = [a.name for a in accounts]
    rows = _rows(conn, names, start, end)
    per: dict[str, dict] = {a.name: _empty() for a in accounts}
    months: dict[str, dict] = {key: _empty() for key in months_covering(start, end)}
    total = _empty()
    for row in rows:
        _add(per[row["account"]], row)
        _add(months[row["created"][:7]], row)
        _add(total, row)
    out_accounts = []
    for acct in accounts:
        figures = _finish(per[acct.name])
        out_accounts.append(
            {
                "name": acct.name,
                "label": acct.display,
                "business": acct.business,
                "currency": acct.currency,
                "ledger_account_id": acct.ledger_id,
                **figures,
                "needs_review": _needs_review(conn, acct),
                "skipped_currency": _skipped_currency(conn, acct),
            }
        )
    payouts = _payout_counts(conn, names)
    return {
        "ready": ready(conn),
        "start": start,
        "end": end,
        "business": business,
        "accounts": out_accounts,
        "totals": _finish(total),
        "months": [{"month": key, **_finish(value)} for key, value in months.items()],
        "payouts": payouts,
        "open_payouts": payouts["unmatched"] + payouts["ambiguous"] + payouts["conflict"],
        "bank_only": len(bank_only(conn, start, end)) if accounts else 0,
    }


def _bank_public(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "txn_id": row["id"],
        "date": row["date"],
        "account_id": row["account_id"],
        "account_label": row.get("display_name") or get_config().short_account(row.get("account_name") or ""),
        "last4": row.get("last4") or "",
        "amount_cents": int(row["amount_cents"]),
        "name": row.get("name") or "",
        "business_tag": row.get("business_tag") or "needs_review",
        "category": row.get("category") or "",
    }


def payouts(conn, start: str | None = None, end: str | None = None, *, account: str | None = None, business: str = "all", today: date | None = None) -> dict:
    """Each payout with its reconciliation status and matched bank deposit; bank-only deposits."""
    start, end = _range(start, end, today)
    accounts = _accounts(business, account)
    by_name = {a.name: a for a in accounts}
    rows = []
    if accounts and _table_exists(conn, "stripe_payouts"):
        marks = ", ".join("?" for _ in accounts)
        found = conn.execute(
            f"""
            SELECT p.*, t.date AS bank_date, t.account_id AS bank_account_id, t.amount_cents AS bank_amount,
                   t.name AS bank_name, a.last4 AS bank_last4, a.name AS bank_account_name, a.display_name AS bank_display,
                   c.business_tag AS bank_tag, c.category AS bank_category
            FROM stripe_payouts p
            LEFT JOIN transactions t ON t.id = p.matched_txn_id
            LEFT JOIN accounts a ON a.id = t.account_id
            LEFT JOIN classifications c ON c.txn_id = t.id
            WHERE p.account IN ({marks}) AND ifnull(p.arrival_date, p.created) >= ? AND ifnull(p.arrival_date, p.created) <= ?
            ORDER BY ifnull(p.arrival_date, p.created) DESC, p.id
            """,
            (*by_name, start, end),
        ).fetchall()
        for row in found:
            bank = None
            if row["matched_txn_id"] and row["bank_date"]:
                bank = _bank_public(
                    {
                        "id": row["matched_txn_id"], "date": row["bank_date"], "account_id": row["bank_account_id"],
                        "display_name": row["bank_display"], "account_name": row["bank_account_name"], "last4": row["bank_last4"],
                        "amount_cents": row["bank_amount"], "name": row["bank_name"], "business_tag": row["bank_tag"], "category": row["bank_category"],
                    }
                )
            rows.append(
                {
                    "account": row["account"],
                    "account_label": by_name[row["account"]].display,
                    "id": row["id"],
                    "amount_cents": int(row["amount_cents"]),
                    "currency": row["currency"],
                    "created": row["created"],
                    "arrival_date": row["arrival_date"],
                    "stripe_status": row["status"],
                    "match_status": row["match_status"],
                    "match_note": row["match_note"] or "",
                    "bank": bank,
                }
            )
    extra = [_bank_public(row) for row in bank_only(conn, start, end)] if accounts else []
    by_status = {status: {"count": 0, "amount_cents": 0} for status in MATCH_STATUSES}
    for row in rows:
        by_status[row["match_status"]]["count"] += 1
        by_status[row["match_status"]]["amount_cents"] += row["amount_cents"]
    return {
        "ready": ready(conn),
        "start": start,
        "end": end,
        "rows": rows,
        "bank_only": extra,
        "totals": {
            "count": len(rows),
            "amount_cents": sum(row["amount_cents"] for row in rows),
            "by_status": by_status,
            "bank_only_count": len(extra),
            "bank_only_cents": sum(row["amount_cents"] for row in extra),
        },
    }


def status(conn, *, account: str | None = None, today: date | None = None) -> dict:
    """Per account: business, last date, counts, ledger vs anchor, month and YTD figures, payouts."""
    from hpbooks.balances import snapshot_for

    today = today or date.today()
    out = []
    for acct in _accounts("all", account):
        last = None
        counts: dict[str, int] = {}
        if _table_exists(conn, "stripe_balance_transactions"):
            last = conn.execute("SELECT max(created) FROM stripe_balance_transactions WHERE account = ?", (acct.name,)).fetchone()[0]
            for row in conn.execute(
                "SELECT booking, COUNT(*) AS n FROM stripe_balance_transactions WHERE account = ? GROUP BY booking", (acct.name,)
            ):
                counts[row["booking"]] = int(row["n"])
        ledger = None
        if conn.execute("SELECT 1 FROM accounts WHERE id = ?", (acct.ledger_id,)).fetchone():
            snap = snapshot_for(conn, acct.ledger_id)
            ledger = {
                "activity_cents": snap["activity_cents"],
                "anchored": snap["anchored"],
                "balance_cents": snap["display_cents"],
                "anchor_cents": snap["anchor_cents"],
                "anchor_as_of": snap["as_of_date"],
                "drift_cents": snap["drift_cents"],
            }
        month_start = today.replace(day=1).isoformat()
        year_start = today.replace(month=1, day=1).isoformat()
        month = summary(conn, month_start, today.isoformat(), account=acct.name, today=today)["totals"]
        ytd = summary(conn, year_start, today.isoformat(), account=acct.name, today=today)["totals"]
        out.append(
            {
                "name": acct.name,
                "label": acct.display,
                "business": acct.business,
                "currency": acct.currency,
                "ledger_account_id": acct.ledger_id,
                "last_transaction": last,
                "counts": counts,
                "transactions": sum(counts.values()),
                "ledger": ledger,
                "month": month,
                "ytd": ytd,
                "payouts": _payout_counts(conn, [acct.name]),
                "needs_review": _needs_review(conn, acct),
                "skipped_currency": counts.get("skipped_currency", 0),
            }
        )
    log = []
    if _table_exists(conn, "stripe_sync_log"):
        log = [
            {key: row[key] for key in ("ts", "account", "kind", "status")}
            for row in conn.execute("SELECT ts, account, kind, status FROM stripe_sync_log ORDER BY id DESC LIMIT 10")
        ]
    return {"ready": ready(conn), "today": today.isoformat(), "accounts": out, "log": log}


# --- text and CSV ------------------------------------------------------------------------------

EXPORT_TABLES = ("summary", "accounts", "payouts", "bank-only")


def table_rows(table: str, data: dict) -> tuple[list[str], list[list]]:
    """Headers and rows (plain values) for one export table."""
    money = ("gross_cents", "refunds_cents", "disputes_cents", "fees_cents", "net_revenue_cents", "capital_repayments_cents", "payouts_cents")
    if table == "summary":
        headers = ["month", "gross", "refunds", "disputes", "fees", "net_revenue", "fee_pct", "capital_repayments", "payouts"]
        rows = [[m["month"], *(_dollars(m[k]) for k in money[:5]), _pct(m["fee_pct"]), _dollars(m["capital_repayments_cents"]), _dollars(m["payouts_cents"])] for m in data["months"]]
        return headers, rows
    if table == "accounts":
        headers = ["account", "business", "gross", "refunds", "disputes", "fees", "net_revenue", "fee_pct", "capital_repayments", "payouts", "needs_review", "skipped_currency"]
        rows = [
            [a["label"], a["business"], *(_dollars(a[k]) for k in money[:5]), _pct(a["fee_pct"]), _dollars(a["capital_repayments_cents"]), _dollars(a["payouts_cents"]), a["needs_review"], a["skipped_currency"]]
            for a in data["accounts"]
        ]
        return headers, rows
    if table == "payouts":
        headers = ["account", "payout", "created", "arrival", "amount", "stripe_status", "match", "bank_date", "bank_account", "bank_last4", "bank_amount", "note"]
        rows = []
        for p in data["rows"]:
            bank = p["bank"] or {}
            rows.append([
                p["account_label"], p["id"], p["created"] or "", p["arrival_date"] or "", _dollars(p["amount_cents"]), p["stripe_status"] or "",
                p["match_status"], bank.get("date", ""), bank.get("account_label", ""), bank.get("last4", ""),
                _dollars(bank["amount_cents"]) if bank else "", p["match_note"],
            ])
        return headers, rows
    if table == "bank-only":
        headers = ["date", "account", "last4", "amount", "name", "tag", "category", "txn_id"]
        rows = [[b["date"], b["account_label"], b["last4"], _dollars(b["amount_cents"]), b["name"], b["business_tag"], b["category"], b["txn_id"]] for b in data["bank_only"]]
        return headers, rows
    raise HpbooksError(f"unknown Stripe table {table}")


def _dollars(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, rem = divmod(abs(int(cents)), 100)
    return f"{sign}{whole}.{rem:02d}"


def _pct(value) -> str:
    return "" if value is None else f"{value:.2f}"


def table_csv(table: str, data: dict) -> str:
    headers, rows = table_rows(table, data)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows(rows)
    return buffer.getvalue()


def reconcile_text(data: dict, *, rows: bool) -> str:
    lines = []
    if rows or data["rows"]:
        body = []
        for p in data["rows"]:
            bank = p["bank"]
            where = f"{bank['date']} {bank['account_label']}" + (f" ({bank['last4']})" if bank["last4"] else "") if bank else ""
            body.append([p["account"], p["id"], p["arrival_date"] or p["created"] or "", format_money(p["amount_cents"]), p["match_status"], where, (p["match_note"] if rows else "")[:70]])
        lines.append(render_table(["account", "payout", "arrival", "amount", "status", "bank deposit", "note"], body, right_from=3))
    if data["bank_only"]:
        lines.append("")
        lines.append("Bank only (Stripe-looking deposits with no payout):")
        body = [[b["date"], b["account_label"], b["last4"], format_money(b["amount_cents"]), f"{b['business_tag']} / {b['category']}", b["name"][:48]] for b in data["bank_only"]]
        lines.append(render_table(["date", "account", "last4", "amount", "booked as", "text"], body, right_from=3))
    return "\n".join(lines) if lines else "no Stripe payouts in this range"


def reconcile_footer(data: dict) -> str:
    t = data["totals"]
    parts = [f"{status} {t['by_status'][status]['count']}" for status in MATCH_STATUSES if t["by_status"][status]["count"]]
    return (
        f"{data['start']} to {data['end']}: {t['count']} payouts {format_money(t['amount_cents'])}"
        + (f" ({', '.join(parts)})" if parts else "")
        + f"; bank only {t['bank_only_count']} {format_money(t['bank_only_cents'])}"
    )


def status_text(data: dict) -> str:
    if not data["accounts"]:
        return "no Stripe accounts configured ([[stripe.accounts]] in config/local.toml)"
    out = []
    for a in data["accounts"]:
        out.append(f"{a['label']} ({a['name']}, business {a['business']}, {a['currency']})")
        out.append(f"  last transaction: {a['last_transaction'] or 'none imported'}; {a['transactions']} balance transactions")
        if a["counts"]:
            out.append("  by booking: " + ", ".join(f"{k} {v}" for k, v in sorted(a["counts"].items())))
        ledger = a["ledger"]
        if ledger:
            line = f"  ledger account {a['ledger_account_id']}: activity {format_money(ledger['activity_cents'])}"
            if ledger["anchored"]:
                line += f"; balance {format_money(ledger['balance_cents'])} from the {ledger['anchor_as_of']} Stripe balance {format_money(ledger['anchor_cents'])}"
                if ledger["drift_cents"]:
                    line += f" (difference {format_money(ledger['drift_cents'])})"
            out.append(line)
        body = []
        for label, figs in (("this month", a["month"]), ("year to date", a["ytd"])):
            body.append([
                label, format_money(figs["gross_cents"]), format_money(figs["refunds_cents"]), format_money(figs["disputes_cents"]),
                format_money(figs["fees_cents"]), format_money(figs["net_revenue_cents"]), _pct(figs["fee_pct"]),
                format_money(figs["capital_repayments_cents"]),
            ])
        table = render_table(["period", "gross", "refunds", "disputes", "fees", "net", "fee %", "Capital repaid"], body, right_from=1)
        out.extend("  " + line for line in table.splitlines())
        pays = ", ".join(f"{k} {v}" for k, v in a["payouts"].items() if v) or "none"
        out.append(f"  payouts: {pays}")
        out.append(f"  needs review: {a['needs_review']}; skipped (currency): {a['skipped_currency']}")
        out.append("")
    return "\n".join(out).rstrip()
