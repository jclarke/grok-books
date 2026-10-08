"""JSON API for the Stripe page. Mounted under /api/stripe only when features.stripe is on. Read-only.

Query string: start/end (YYYY-MM-DD, together; default this year to date),
business (all or a slug), account (a [[stripe.accounts]] name). The same
query string drives the CSV exports at /export/stripe/<table>.csv. No
customer data exists to return: balance-transaction fields and the whitelisted
billing-object fields (stripe_objects.WHITELIST) are stored; the metrics name
customers by Stripe id only. /metrics also takes month (YYYY-MM, the focus
month; default the last complete month) and exports its tables at
/api/stripe/metrics/export/<table>.<csv|xlsx|pdf>.
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


@stripe_api.get("/capital")
def capital():
    args = _args()
    with connect(readonly=True) as conn:
        data = sr.capital(conn, business=args["business"], account=args["account"])
    return jsonify({"ok": True, **data})


@stripe_api.get("/status")
def status():
    account = (request.args.get("account") or "").strip() or None
    with connect(readonly=True) as conn:
        data = sr.status(conn, account=account)
    return jsonify({"ok": True, **data})


# --- business analytics (stripe_metrics) ------------------------------------------------------


def _metrics(conn, sections=None) -> dict:
    from hpbooks import stripe_metrics as sm

    args = _args()
    month = (request.args.get("month") or "").strip() or None
    if month is not None and len(month) != 7:
        abort(400)
    return sm.build(
        conn, start=args["start"], end=args["end"], month=month, business=args["business"], account=args["account"],
        sections=sections or sm.SECTIONS,
    )


@stripe_api.get("/metrics")
def metrics():
    """Summary KPIs plus every section (mrr, churn, cohorts, margin, fees, capital, ltv,
    concentration, recovery, refunds, forecast) and the approximations list."""
    with connect(readonly=True) as conn:
        data = _metrics(conn)
    return jsonify({"ok": True, **data})


_META = ("ready", "start", "end", "month", "business", "account", "currency", "as_of", "accounts", "approximations")


@stripe_api.get("/metrics/<section>")
def metrics_section(section):
    from hpbooks.stripe_metrics import SECTIONS

    if section not in SECTIONS:
        abort(404)
    with connect(readonly=True) as conn:
        data = _metrics(conn, (section,))
    # The summary KPIs come along (cheap; every section is computed anyway). Without the forecast section its forecast_* fields are null.
    return jsonify({"ok": True, **{key: data[key] for key in _META}, "summary": data["summary"], section: data[section]})


@stripe_api.get("/metrics/export/<filename>")
def metrics_export(filename):
    """One metrics table as CSV, XLSX, or PDF, through the analytics TabularReport writers."""
    import io

    from flask import Response

    from hpbooks import analytics
    from hpbooks import stripe_metrics as sm

    table, _dot, ext = filename.rpartition(".")
    if ext not in ("csv", "xlsx", "pdf") or table not in sm.EXPORT_TABLES:
        abort(404)
    section = sm.EXPORT_TABLES[table]
    with connect(readonly=True) as conn:
        data = _metrics(conn, sm.SECTIONS if table == "summary" else (section,))
    report = sm.tabular(table, data)
    name = f"stripe-{table}-{data['month']}.{ext}"
    if ext == "csv":
        body, mimetype = analytics.table_csv(report), "text/csv"
    else:
        buffer = io.BytesIO()
        (analytics.write_table_xlsx if ext == "xlsx" else analytics.write_table_pdf)(report, buffer)
        body = buffer.getvalue()
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if ext == "xlsx" else "application/pdf"
    return Response(body, mimetype=mimetype, headers={"Content-Disposition": f"attachment; filename={name}"})


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
