"""JSON API for the Stripe page. Mounted under /api/stripe only when features.stripe is on. Read-only.

Query string: start/end (YYYY-MM-DD, together; default this year to date),
business (all or a slug), account (a [[stripe.accounts]] name). The same
query string drives the CSV exports at /export/stripe/<table>.csv. No
customer data exists to return: only balance-transaction fields are stored.
"""

from __future__ import annotations

from flask import Blueprint, abort, jsonify, request

from hpbooks import stripe_reports as sr
from hpbooks.db import HpbooksError, connect
from hpbooks.webargs import _business, _optional_date

stripe_api = Blueprint("stripe_api", __name__, url_prefix="/api/stripe")


@stripe_api.errorhandler(HpbooksError)
def _hpbooks_error(err: HpbooksError):
    return jsonify({"ok": False, "error": str(err)}), 400


def _args() -> dict:
    account = (request.args.get("account") or "").strip() or None
    if account is not None and len(account) > 40:
        abort(400)
    return {"start": _optional_date("start"), "end": _optional_date("end"), "business": _business(), "account": account}


def build(name: str, conn) -> dict:
    args = _args()
    if name == "summary":
        return sr.summary(conn, args["start"], args["end"], business=args["business"], account=args["account"])
    if name == "payouts":
        return sr.payouts(conn, args["start"], args["end"], business=args["business"], account=args["account"])
    abort(404)


@stripe_api.get("/summary")
def summary():
    with connect(readonly=True) as conn:
        data = build("summary", conn)
    return jsonify({"ok": True, **data})


@stripe_api.get("/payouts")
def payouts():
    with connect(readonly=True) as conn:
        data = build("payouts", conn)
    return jsonify({"ok": True, **data})


@stripe_api.get("/status")
def status():
    account = (request.args.get("account") or "").strip() or None
    with connect(readonly=True) as conn:
        data = sr.status(conn, account=account)
    return jsonify({"ok": True, **data})


@stripe_api.route("/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def not_found(_rest):
    abort(404)


EXPORT_TABLES = {"summary": "summary", "accounts": "summary", "payouts": "payouts", "bank-only": "payouts"}


def export_csv(table: str) -> tuple[str, str]:
    if table not in EXPORT_TABLES:
        abort(404)
    try:
        with connect(readonly=True) as conn:
            data = build(EXPORT_TABLES[table], conn)
    except HpbooksError:
        abort(400)
    return sr.table_csv(table, data), f"stripe-{table}.csv"
