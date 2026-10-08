"""Stripe balance import, ledger posting, and payout reconciliation (features.stripe).

Data path: Grok Bot saves verbatim Stripe connector results under
sync/inbox/YYYY-MM-DD/stripe/ (GetBalanceTransactions as <name>_N.json,
GetPayouts as <name>_payouts_N.json, optional GetBalance as <name>_balance.json,
optional GetCharges as <name>_charges_N.json). hpbooks never calls Stripe in
that mode. The optional direct mode (`stripe sync`) reads the same endpoints
with a restricted read-only key over urllib and writes the same files.

Booking model (like PayPal): each [[stripe.accounts]] entry is a business cash
account in the ledger (id stripe-<name>). Charges post the gross to revenue and
the fee to [stripe] fee_category, so the Stripe account's balance moves by the
net. A payout is a transfer out of the Stripe account; the bank deposit it
becomes is paired with it here and tagged transfer, so revenue counts once.

Only balance-transaction fields are kept. Charges files are read for id,
amount, currency, and balance_transaction only. Emails in descriptions are
masked. Nothing here prints or stores a key.
"""

from __future__ import annotations

import glob
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from hpbooks.classify import as_dict, classify_ids, write_classification
from hpbooks.config import REPO_ROOT, StripeAccount, StripeConfig, get_config, stripe_settings
from hpbooks.db import HpbooksError, audit, db_path, now_iso

API_BASE = "https://api.stripe.com"
INBOX = REPO_ROOT / "sync" / "inbox"
SOURCE = "stripe"
CONFIDENCE = 0.99
REVIEW_CONFIDENCE = 0.3
MATCH_CONFIDENCE = 0.97
MATCH_NOTE_PREFIX = "Stripe payout "
PAGE_LIMIT = 100
MAX_PAGES = 500

# Stripe types -> how they are booked. Anything not listed (by type or
# reporting_category) is posted to needs_review, never guessed.
REVENUE_TYPES = {"charge", "payment"}
REFUND_TYPES = {"refund", "payment_refund", "refund_failure", "payment_failure_refund", "payment_reversal"}
DISPUTE_TYPES = {"dispute_reversal"}
FEE_TYPES = {"stripe_fee", "stripe_fx_fee", "tax_fee", "tax", "network_cost"}
PAYOUT_TYPES = {"payout"}
PAYOUT_RETURN_TYPES = {"payout_failure", "payout_cancel"}
HOLD_TYPES = {
    "payout_minimum_balance_hold",
    "payout_minimum_balance_release",
    "reserve_hold",
    "reserve_release",
    "reserved_funds",
    "risk_reserved_funds",
    "connect_reserved_funds",
}
HOLD_CATEGORIES = {"payout_minimum_balance_hold", "payout_minimum_balance_release", "risk_reserved_funds", "connect_reserved_funds"}

BOOKINGS = ("revenue", "refund", "dispute", "fee", "payout", "payout_return", "hold", "capital", "unknown", "skipped_currency")
MATCH_STATUSES = ("matched", "in_transit", "unmatched", "ambiguous", "conflict", "failed", "skipped", "no_bank_history")

_FILE_RE = re.compile(r"^(?P<name>[a-z0-9][a-z0-9-]*?)(?:_(?P<kind>payouts|charges|balance))?(?:_(?P<page>\d+))?$")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --- settings -------------------------------------------------------------------------


def settings() -> StripeConfig:
    """Checked [stripe] settings; no accounts when the feature is off."""
    return stripe_settings()


def require_enabled() -> StripeConfig:
    if not get_config().stripe_enabled:
        from hpbooks.config import STRIPE_DISABLED

        raise HpbooksError(STRIPE_DISABLED)
    return settings()


def _tz(cfg: StripeConfig) -> ZoneInfo:
    return ZoneInfo(cfg.timezone)


def local_date(ts, cfg: StripeConfig) -> str | None:
    if ts is None or isinstance(ts, bool):
        return None
    try:
        return datetime.fromtimestamp(int(ts), _tz(cfg)).date().isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def day_start_ts(day: str, cfg: StripeConfig) -> int:
    """Unix time of midnight starting `day` in the books time zone."""
    parsed = date.fromisoformat(day)
    return int(datetime(parsed.year, parsed.month, parsed.day, tzinfo=_tz(cfg)).timestamp())


def ledger_id(acct: StripeAccount) -> str:
    return acct.ledger_id


def txn_id(acct: StripeAccount, stripe_id: str, suffix: str = "") -> str:
    return f"stripe:{acct.name}:{stripe_id}" + (f":{suffix}" if suffix else "")


def account_ok(acct: StripeAccount, cfg: StripeConfig) -> bool:
    """False when this Stripe balance settles in another currency than the books."""
    return acct.currency == cfg.books_currency


# --- reading saved results ---------------------------------------------------------------


def _unwrap(obj, where: str) -> list[dict]:
    """Stripe objects from a saved result: a list response, a list of them, or an MCP wrapper."""
    if isinstance(obj, list):
        out: list[dict] = []
        for item in obj:
            out.extend(_unwrap(item, where))
        return out
    if not isinstance(obj, dict):
        raise HpbooksError(f"{where} holds something other than Stripe results")
    if "object" not in obj and isinstance(obj.get("content"), list):
        out = []
        for part in obj["content"]:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                try:
                    inner = json.loads(part["text"])
                except json.JSONDecodeError as exc:
                    raise HpbooksError(f"{where} has a text part that is not JSON") from exc
                out.extend(_unwrap(inner, where))
        return out
    if obj.get("object") in ("list", "balance") or "data" in obj:
        return [obj]
    raise HpbooksError(f"{where} is not a Stripe list or balance result")


def parse_name(path: Path) -> tuple[str | None, str]:
    """(account name, kind) from <name>_N.json, <name>_payouts_N.json, <name>_charges_N.json, <name>_balance.json."""
    match = _FILE_RE.fullmatch(path.stem)
    if not match:
        return None, "balance_transactions"
    kind = match.group("kind") or "balance_transactions"
    return match.group("name"), kind


def _kind_from_content(page: dict) -> str | None:
    if page.get("object") == "balance":
        return "balance"
    url = str(page.get("url") or "")
    for marker, kind in (("/v1/balance_transactions", "balance_transactions"), ("/v1/payouts", "payouts"), ("/v1/charges", "charges")):
        if url.startswith(marker):
            return kind
    data = page.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return {"balance_transaction": "balance_transactions", "payout": "payouts", "charge": "charges"}.get(data[0].get("object"))
    return None


def load_file(path: Path, account: str | None = None) -> dict:
    """One saved file: {"account", "kind", "pages", "query", "folder_date"}."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        raise HpbooksError(f"could not read {path}") from exc
    except json.JSONDecodeError as exc:
        raise HpbooksError(f"{path} is not valid JSON") from exc
    pages = _unwrap(payload, str(path))
    name, kind = parse_name(path)
    for page in pages:
        found = _kind_from_content(page)
        if found:
            kind = found
            break
    query: dict = {}
    for page in pages:
        if isinstance(page.get("_query"), dict):
            query.update(page["_query"])
    folder = path.parent.parent.name if path.parent.name == "stripe" else path.parent.name
    return {
        "path": path,
        "account": account or name,
        "kind": kind,
        "pages": pages,
        "query": query,
        "folder_date": folder if _DAY_RE.fullmatch(folder) else None,
    }


def stripe_files(items: list[str]) -> list[Path]:
    """Stripe result files among import inputs: stripe/*.json under each directory,
    files inside a stripe/ folder, and globs. Order is stable and duplicates are dropped."""
    found: list[Path] = []
    for item in items:
        path = Path(item)
        if path.is_dir():
            if path.name == "stripe":
                found.extend(sorted(path.glob("*.json")))
            else:
                found.extend(sorted(path.glob("stripe/*.json")))
        elif path.is_file():
            if path.parent.name == "stripe" and path.suffix == ".json":
                found.append(path)
        else:
            found.extend(Path(m) for m in sorted(glob.glob(item)) if Path(m).is_file() and Path(m).parent.name == "stripe")
    seen: set[str] = set()
    out = []
    for path in found:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            out.append(path)
    return out


def _expand_explicit(items: list[str]) -> list[Path]:
    """`stripe import` inputs: any JSON file named, stripe/*.json or *.json in a directory, globs."""
    found: list[Path] = []
    for item in items:
        path = Path(item)
        if path.is_dir():
            inner = sorted(path.glob("stripe/*.json")) or sorted(path.glob("*.json"))
            if not inner:
                raise HpbooksError(f"no Stripe json files in {item}")
            found.extend(inner)
        elif path.is_file():
            found.append(path)
        else:
            matches = [Path(m) for m in sorted(glob.glob(item)) if Path(m).is_file()]
            if not matches:
                raise HpbooksError(f"no such file or pattern: {item}")
            found.extend(matches)
    seen: set[str] = set()
    out = []
    for path in found:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            out.append(path)
    if not out:
        raise HpbooksError("nothing to import")
    return out


# --- normalizing ----------------------------------------------------------------------------


def _int(value, field: str, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HpbooksError(f"{where}: {field} must be an integer number of cents")
    return value


def _ref(value) -> str | None:
    """A Stripe reference that may be an id or an expanded object."""
    if isinstance(value, dict):
        value = value.get("id")
    return str(value) if isinstance(value, str) and value else None


def clean_description(text) -> str:
    if not isinstance(text, str):
        return ""
    return _EMAIL_RE.sub("[email]", text.strip())[:300]


def booking_for(btx: dict) -> str:
    kind = btx["type"]
    cat = btx.get("reporting_category") or ""
    if kind in PAYOUT_TYPES:
        return "payout"
    if kind in PAYOUT_RETURN_TYPES or cat in ("payout_reversal",):
        return "payout_return"
    if kind in HOLD_TYPES or cat in HOLD_CATEGORIES:
        return "hold"
    if kind.startswith("financing") or cat.startswith("financing"):
        return "capital"
    if kind in DISPUTE_TYPES or cat in ("dispute", "dispute_reversal"):
        return "dispute"
    if kind in REFUND_TYPES or cat in ("refund", "refund_failure"):
        return "refund"
    if kind in REVENUE_TYPES or cat == "charge":
        return "revenue"
    if kind in FEE_TYPES or cat == "fee":
        return "fee"
    return "unknown"


def normalize_btx(raw: dict, cfg: StripeConfig, where: str) -> dict:
    stripe_id = raw.get("id")
    if not isinstance(stripe_id, str) or not stripe_id:
        raise HpbooksError(f"{where}: a balance transaction has no id")
    where = f"{where} {stripe_id}"
    kind = raw.get("type")
    if not isinstance(kind, str) or not kind:
        raise HpbooksError(f"{where}: missing type")
    amount = _int(raw.get("amount"), "amount", where)
    fee = _int(raw.get("fee", 0) or 0, "fee", where)
    net = _int(raw.get("net", amount - fee), "net", where)
    if net != amount - fee:
        raise HpbooksError(f"{where}: net {net} is not amount {amount} minus fee {fee}")
    created = local_date(raw.get("created"), cfg)
    if created is None:
        raise HpbooksError(f"{where}: missing created time")
    currency = str(raw.get("currency") or "").lower()
    if not currency:
        raise HpbooksError(f"{where}: missing currency")
    rate = raw.get("exchange_rate")
    fee_details = []
    for item in raw.get("fee_details") or []:
        if isinstance(item, dict):
            fee_details.append(
                {
                    "amount": item.get("amount"),
                    "currency": item.get("currency"),
                    "type": item.get("type"),
                    "description": clean_description(item.get("description")),
                }
            )
    row = {
        "id": stripe_id,
        "type": kind,
        "reporting_category": raw.get("reporting_category") if isinstance(raw.get("reporting_category"), str) else None,
        "amount_cents": amount,
        "fee_cents": fee,
        "net_cents": net,
        "currency": currency,
        "exchange_rate": float(rate) if isinstance(rate, (int, float)) and not isinstance(rate, bool) else None,
        "created": created,
        "created_ts": int(raw["created"]),
        "available_on": local_date(raw.get("available_on"), cfg),
        "status": raw.get("status") if isinstance(raw.get("status"), str) else None,
        "source_id": _ref(raw.get("source")),
        "description": clean_description(raw.get("description")),
        "fee_details_json": json.dumps(fee_details, separators=(",", ":"), sort_keys=True),
    }
    row["payout_id"] = row["source_id"] if row["source_id"] and row["source_id"].startswith("po_") else None
    row["booking"] = booking_for(row)
    return row


def normalize_payout(raw: dict, cfg: StripeConfig, where: str) -> dict:
    payout_id = raw.get("id")
    if not isinstance(payout_id, str) or not payout_id:
        raise HpbooksError(f"{where}: a payout has no id")
    where = f"{where} {payout_id}"
    return {
        "id": payout_id,
        "amount_cents": _int(raw.get("amount"), "amount", where),
        "currency": str(raw.get("currency") or "").lower(),
        "arrival_date": local_date(raw.get("arrival_date"), cfg),
        "created": local_date(raw.get("created"), cfg),
        "status": raw.get("status") if isinstance(raw.get("status"), str) else None,
        "balance_transaction": _ref(raw.get("balance_transaction")),
        "failure_code": raw.get("failure_code") if isinstance(raw.get("failure_code"), str) else None,
        "failure_message": clean_description(raw.get("failure_message")) or None,
        "method": raw.get("method") if isinstance(raw.get("method"), str) else None,
        "livemode": raw.get("livemode"),
    }


def charges_map(pages: list[dict]) -> dict[str, tuple[int, str]]:
    """balance_transaction id -> (presentment amount, currency). Nothing else is read."""
    out: dict[str, tuple[int, str]] = {}
    for page in pages:
        for item in page.get("data") or []:
            if not isinstance(item, dict):
                continue
            btx = _ref(item.get("balance_transaction"))
            amount = item.get("amount")
            currency = item.get("currency")
            if btx and isinstance(amount, int) and not isinstance(amount, bool) and isinstance(currency, str):
                out[btx] = (amount, currency.lower())
    return out


# --- ledger account ------------------------------------------------------------------------


def ensure_ledger_account(conn, acct: StripeAccount, *, actor: str = "stripe") -> bool:
    """Register the business cash account for this Stripe balance. True when it was created.

    An existing account keeps every user setting (scope, names, flags)."""
    if conn.execute("SELECT 1 FROM accounts WHERE id = ?", (acct.ledger_id,)).fetchone():
        return False
    conn.execute(
        """
        INSERT INTO accounts (id, name, type, last4, institution, notes, scope, class,
                              include_in_net_worth, sync_enabled, created_at)
        VALUES (?, ?, 'cash', NULL, 'Stripe', ?, 'business', 'cash', 1, 0, ?)
        """,
        (acct.ledger_id, acct.display, f"stripe:{acct.name} (filled by stripe import, not the Finance sync)", now_iso()),
    )
    audit(conn, "account_register", field=acct.ledger_id, new_value="business", actor=actor, note=f"Stripe {acct.name} cash")
    return True


# --- upserts ---------------------------------------------------------------------------------

_BTX_FIELDS = (
    "type", "reporting_category", "amount_cents", "fee_cents", "net_cents", "currency", "exchange_rate",
    "original_amount_cents", "original_currency", "created", "created_ts", "available_on", "status",
    "source_id", "payout_id", "description", "fee_details_json", "booking",
)


def upsert_btx(conn, acct: StripeAccount, row: dict) -> str:
    """'new', 'updated', or 'unchanged'."""
    existing = conn.execute(
        "SELECT * FROM stripe_balance_transactions WHERE account = ? AND id = ?", (acct.name, row["id"])
    ).fetchone()
    ts = now_iso()
    if existing is None:
        cols = ", ".join(_BTX_FIELDS)
        marks = ", ".join("?" for _ in _BTX_FIELDS)
        conn.execute(
            f"INSERT INTO stripe_balance_transactions (account, id, {cols}, imported_at, updated_at) VALUES (?, ?, {marks}, ?, ?)",
            (acct.name, row["id"], *(row.get(field) for field in _BTX_FIELDS), ts, ts),
        )
        return "new"
    # A later file without the charges lookup must not erase a known presentment amount.
    if row.get("original_amount_cents") is None and existing["original_amount_cents"] is not None:
        row = {**row, "original_amount_cents": existing["original_amount_cents"], "original_currency": existing["original_currency"]}
    if all(existing[field] == row.get(field) for field in _BTX_FIELDS):
        return "unchanged"
    sets = ", ".join(f"{field} = ?" for field in _BTX_FIELDS)
    conn.execute(
        f"UPDATE stripe_balance_transactions SET {sets}, updated_at = ? WHERE account = ? AND id = ?",
        (*(row.get(field) for field in _BTX_FIELDS), ts, acct.name, row["id"]),
    )
    return "updated"


_PAYOUT_FIELDS = ("amount_cents", "currency", "arrival_date", "created", "status", "balance_transaction", "failure_code", "failure_message", "method")


def upsert_payout(conn, acct: StripeAccount, row: dict) -> str:
    existing = conn.execute("SELECT * FROM stripe_payouts WHERE account = ? AND id = ?", (acct.name, row["id"])).fetchone()
    ts = now_iso()
    if existing is None:
        cols = ", ".join(_PAYOUT_FIELDS)
        marks = ", ".join("?" for _ in _PAYOUT_FIELDS)
        conn.execute(
            f"INSERT INTO stripe_payouts (account, id, {cols}, imported_at, updated_at) VALUES (?, ?, {marks}, ?, ?)",
            (acct.name, row["id"], *(row.get(field) for field in _PAYOUT_FIELDS), ts, ts),
        )
        return "new"
    merged = {field: row.get(field) if row.get(field) is not None else existing[field] for field in _PAYOUT_FIELDS}
    if all(existing[field] == merged[field] for field in _PAYOUT_FIELDS):
        return "unchanged"
    sets = ", ".join(f"{field} = ?" for field in _PAYOUT_FIELDS)
    conn.execute(
        f"UPDATE stripe_payouts SET {sets}, updated_at = ? WHERE account = ? AND id = ?",
        (*(merged[field] for field in _PAYOUT_FIELDS), ts, acct.name, row["id"]),
    )
    return "updated"


def _payout_from_btx(conn, acct: StripeAccount, btx: dict) -> str | None:
    """Every payout balance transaction has a stripe_payouts row, even without a payouts file.

    Returns 'new' when this created the row, else None.
    """
    if btx["booking"] != "payout" or not btx["payout_id"]:
        return None
    if conn.execute("SELECT 1 FROM stripe_payouts WHERE account = ? AND id = ?", (acct.name, btx["payout_id"])).fetchone():
        conn.execute(
            "UPDATE stripe_payouts SET balance_transaction = ifnull(balance_transaction, ?) WHERE account = ? AND id = ?",
            (btx["id"], acct.name, btx["payout_id"]),
        )
        return None
    return upsert_payout(
        conn,
        acct,
        {
            "id": btx["payout_id"],
            "amount_cents": -int(btx["amount_cents"]),
            "currency": btx["currency"],
            "arrival_date": None,
            "created": btx["created"],
            "status": None,
            "balance_transaction": btx["id"],
        },
    )


# --- ledger posting ----------------------------------------------------------------------------

_TYPE_WORDS = {
    "charge": "charge",
    "payment": "payment (bank debit)",
    "refund": "refund",
    "payment_refund": "refund",
    "adjustment": "dispute",
    "dispute_reversal": "dispute won",
    "stripe_fee": "fee",
    "stripe_fx_fee": "currency conversion fee",
    "payout": "payout",
    "payout_failure": "failed payout returned",
    "payout_cancel": "canceled payout returned",
    "financing_paydown": "Capital repayment",
}


def _assignment(acct: StripeAccount, cfg: StripeConfig, btx: dict) -> tuple[str, str, float, str]:
    """(tag, category, confidence, note) for the main ledger row."""
    booking = btx["booking"]
    word = _TYPE_WORDS.get(btx["type"], btx["type"].replace("_", " "))
    ref = btx["source_id"] or btx["id"]
    if booking == "revenue":
        return acct.business, acct.revenue_category, CONFIDENCE, f"Stripe {word} {ref}"
    if booking == "refund":
        return acct.business, "Refunds", CONFIDENCE, f"Stripe {word} {ref}"
    if booking == "dispute":
        label = "chargeback won back" if int(btx["amount_cents"]) > 0 else "chargeback"
        return acct.business, "Refunds", CONFIDENCE, f"Stripe {label} (dispute) {ref}"
    if booking == "fee":
        return acct.business, cfg.fee_category, CONFIDENCE, f"Stripe {word}"
    if booking == "payout":
        return "transfer", "Transfer", CONFIDENCE, f"Stripe payout {ref} to the bank"
    if booking == "payout_return":
        return "transfer", "Transfer", CONFIDENCE, f"Stripe {word} {ref}"
    if booking == "hold":
        return "transfer", "Transfer", CONFIDENCE, f"Stripe balance {word} (internal hold, nets to zero)"
    if booking == "capital":
        label = "Stripe Capital repayment" if int(btx["amount_cents"]) < 0 else "Stripe Capital financing"
        return "transfer", "Transfer", CONFIDENCE, f"{label} ({btx['type']})"
    return "needs_review", "Uncategorized", REVIEW_CONFIDENCE, f"Stripe {btx['type']} ({btx.get('reporting_category') or 'no category'}): not a known Stripe type, book it by hand"


def _fee_assignment(acct: StripeAccount, cfg: StripeConfig, btx: dict) -> tuple[str, str, float, str]:
    if btx["booking"] == "unknown":
        return "needs_review", "Uncategorized", REVIEW_CONFIDENCE, f"fee on Stripe {btx['type']}: book it by hand"
    if btx["booking"] == "fee":
        return acct.business, cfg.fee_category, CONFIDENCE, "sales tax on Stripe fees"
    if btx["booking"] == "dispute":
        return acct.business, cfg.fee_category, CONFIDENCE, "Stripe dispute fee" if int(btx["fee_cents"]) > 0 else "Stripe dispute fee returned"
    if int(btx["fee_cents"]) < 0:
        return acct.business, cfg.fee_category, CONFIDENCE, "Stripe fee returned"
    return acct.business, cfg.fee_category, CONFIDENCE, f"Stripe fee on {btx['source_id'] or btx['id']}"


def ledger_base(acct: StripeAccount, cfg: StripeConfig, btx: dict) -> dict:
    """Fields every ledger row of this balance transaction shares."""
    raw = json.dumps(
        {key: btx[key] for key in ("id", "type", "reporting_category", "amount_cents", "fee_cents", "net_cents", "currency", "status", "source_id", "available_on")},
        separators=(",", ":"),
        sort_keys=True,
    )
    return {
        "account_id": acct.ledger_id,
        "date": btx["created"],
        "currency": cfg.books_currency.upper(),
        "merchant_name": "Stripe",
        "provider_category": btx.get("reporting_category") or btx["type"],
        "raw_json": raw,
    }


def fee_row(acct: StripeAccount, cfg: StripeConfig, btx: dict, base: dict) -> dict | None:
    """The row for the balance transaction's own Stripe fee field, or None."""
    fee = int(btx["fee_cents"])
    if fee == 0:
        return None
    ref = btx["source_id"] or btx["id"]
    tag, category, confidence, note = _fee_assignment(acct, cfg, btx)
    return {
        **base,
        "id": txn_id(acct, btx["id"], "fee"),
        "amount_cents": -fee,
        "direction": "in" if fee < 0 else "out",
        "name": "Stripe fee tax" if btx["booking"] == "fee" else f"Stripe fee {ref}",
        "description": note,
        "assign": (tag, category, confidence, note),
    }


def _ledger_rows(acct: StripeAccount, cfg: StripeConfig, btx: dict) -> list[dict]:
    word = _TYPE_WORDS.get(btx["type"], btx["type"].replace("_", " "))
    ref = btx["source_id"] or btx["id"]
    base = ledger_base(acct, cfg, btx)
    amount = int(btx["amount_cents"])
    rows = []
    if amount != 0:
        tag, category, confidence, note = _assignment(acct, cfg, btx)
        rows.append(
            {
                **base,
                "id": txn_id(acct, btx["id"]),
                "amount_cents": amount,
                "direction": "in" if amount > 0 else "out",
                "name": f"Stripe {word} {ref}",
                "description": btx["description"],
                "assign": (tag, category, confidence, note),
            }
        )
    fee = fee_row(acct, cfg, btx, base)
    if fee is not None:
        rows.append(fee)
    return rows


_LEDGER_FIELDS = ("account_id", "date", "amount_cents", "direction", "currency", "name", "merchant_name", "description", "provider_category")


def post_ledger(conn, acct: StripeAccount, cfg: StripeConfig, btx: dict) -> dict:
    """Insert or refresh this balance transaction's ledger rows. Manual classifications are kept."""
    counts = {"inserted": 0, "updated": 0, "unchanged": 0}
    for row in _ledger_rows(acct, cfg, btx):
        counts[upsert_ledger_row(conn, row)] += 1
    return counts


def upsert_ledger_row(conn, row: dict) -> str:
    """Insert or refresh one ledger row and its rule classification: 'inserted', 'updated', or 'unchanged'.

    A manual classification is kept."""
    existing = conn.execute("SELECT * FROM transactions WHERE id = ?", (row["id"],)).fetchone()
    ts = now_iso()
    outcome = "unchanged"
    if existing is None:
        conn.execute(
            """
            INSERT INTO transactions (
              id, account_id, date, amount_cents, direction, currency, name, merchant_name, description,
              pending, provider_category, raw_json, status, superseded_by, first_seen_at, last_seen_at,
              updated_at, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', NULL, ?, ?, ?, ?)
            """,
            (
                row["id"], row["account_id"], row["date"], row["amount_cents"], row["direction"], row["currency"],
                row["name"], row["merchant_name"], row["description"], row["provider_category"], row["raw_json"],
                ts, ts, ts, SOURCE,
            ),
        )
        outcome = "inserted"
    elif any(existing[field] != row[field] for field in _LEDGER_FIELDS) or existing["status"] != "active":
        conn.execute(
            f"""
            UPDATE transactions SET {", ".join(f"{field} = ?" for field in _LEDGER_FIELDS)},
              raw_json = ?, status = 'active', superseded_by = NULL, last_seen_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (*(row[field] for field in _LEDGER_FIELDS), row["raw_json"], ts, ts, row["id"]),
        )
        outcome = "updated"
    else:
        conn.execute("UPDATE transactions SET raw_json = ?, last_seen_at = ? WHERE id = ?", (row["raw_json"], ts, row["id"]))
    tag, category, confidence, note = row["assign"]
    write_classification(
        conn, row["id"], tag, category, "rule", confidence, note, None,
        overwrite_manual=False, actor="stripe", audit_write=False,
    )
    return outcome


def delete_ledger_row(conn, row_id: str, *, note: str) -> None:
    """Remove a ledger row the Stripe import made and no longer wants (never a manual one)."""
    for table in ("classifications", "p_classifications", "p_splits", "p_txn_tags"):
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone():
            conn.execute(f"DELETE FROM {table} WHERE txn_id = ?", (row_id,))
    conn.execute("UPDATE transactions SET superseded_by = NULL WHERE superseded_by = ?", (row_id,))
    conn.execute("DELETE FROM transactions WHERE id = ?", (row_id,))
    audit(conn, "stripe_row_removed", txn_id=row_id, actor="stripe", note=note)


# --- import ------------------------------------------------------------------------------------


def _account_stats() -> dict:
    return {
        "files": 0,
        "new": 0,
        "updated": 0,
        "unchanged": 0,
        "ledger_inserted": 0,
        "ledger_updated": 0,
        "ledger_deleted": 0,
        "skipped_currency": 0,
        "skipped_rows": 0,
        "payouts_new": 0,
        "payouts_updated": 0,
        "payouts_unchanged": 0,
        "anchor": None,
        "ledger_account_created": False,
        "capital": None,
    }


def _check_query(acct: StripeAccount, loaded: dict) -> str | None:
    """Why a file must not be imported for this account, or None."""
    query = loaded["query"]
    if query.get("livemode") is False:
        return "test-mode data (livemode false); the books take live mode only"
    for page in loaded["pages"]:
        items = [page, *(item for item in page.get("data") or [] if isinstance(item, dict))]
        if any(item.get("livemode") is False for item in items):
            return "test-mode data (livemode false); the books take live mode only"
    wanted = acct.stripe_account
    got = query.get("stripe_account")
    if wanted and got and got != wanted:
        return f"file is for Stripe account {got}, not {wanted}"
    return None


def import_files(conn, paths: list[Path], *, account: str | None = None, dry_run: bool = False, today: date | None = None) -> dict:
    """Import saved Stripe results. Returns {"accounts": {name: stats}, "skipped_files": [...], "match": {...}}."""
    cfg = require_enabled()
    today = today or date.today()
    loaded = []
    skipped_files: list[dict] = []
    for path in paths:
        item = load_file(path, account)
        acct = cfg.account(item["account"] or "")
        if acct is None:
            skipped_files.append({"file": str(path), "reason": f"unknown Stripe account {item['account']!r} (not in [[stripe.accounts]])"})
            continue
        reason = _check_query(acct, item)
        if reason:
            skipped_files.append({"file": str(path), "reason": reason})
            continue
        loaded.append((acct, item))

    charges: dict[str, dict[str, tuple[int, str]]] = defaultdict(dict)
    for acct, item in loaded:
        if item["kind"] == "charges":
            charges[acct.name].update(charges_map(item["pages"]))

    results: dict[str, dict] = {}
    touched: set[str] = set()
    # One outcome per payout per run: a row first made from its balance transaction and then
    # filled in from the payouts file is still new.
    payout_outcomes: dict[str, dict[str, str]] = defaultdict(dict)
    rank = {"unchanged": 0, "updated": 1, "new": 2}

    def note_payout(name: str, payout_id: str, outcome: str) -> None:
        seen = payout_outcomes[name].get(payout_id)
        if seen is None or rank[outcome] > rank[seen]:
            payout_outcomes[name][payout_id] = outcome

    for acct, item in loaded:
        stats = results.setdefault(acct.name, _account_stats())
        stats["files"] += 1
        if acct.name not in touched:
            touched.add(acct.name)
            stats["ledger_account_created"] = ensure_ledger_account(conn, acct)
        where = str(item["path"])
        if item["kind"] == "balance_transactions":
            for page in item["pages"]:
                for raw in page.get("data") or []:
                    if not isinstance(raw, dict):
                        stats["skipped_rows"] += 1
                        continue
                    btx = normalize_btx(raw, cfg, where)
                    btx["original_amount_cents"] = None
                    btx["original_currency"] = None
                    if btx["exchange_rate"] is not None and btx["id"] in charges[acct.name]:
                        btx["original_amount_cents"], btx["original_currency"] = charges[acct.name][btx["id"]]
                    if btx["currency"] != cfg.books_currency or not account_ok(acct, cfg):
                        btx["booking"] = "skipped_currency"
                    stats[upsert_btx(conn, acct, btx)] += 1
                    if btx["booking"] == "skipped_currency":
                        stats["skipped_currency"] += 1
                        continue
                    if btx["booking"] == "capital":
                        continue  # booked below from the whole Capital history (stripe_capital)
                    posted = post_ledger(conn, acct, cfg, btx)
                    stats["ledger_inserted"] += posted["inserted"]
                    stats["ledger_updated"] += posted["updated"]
                    if _payout_from_btx(conn, acct, btx):
                        note_payout(acct.name, btx["payout_id"], "new")
        elif item["kind"] == "payouts":
            for page in item["pages"]:
                for raw in page.get("data") or []:
                    if not isinstance(raw, dict):
                        continue
                    payout = normalize_payout(raw, cfg, where)
                    note_payout(acct.name, payout["id"], upsert_payout(conn, acct, payout))
        elif item["kind"] == "balance":
            stats["anchor"] = record_balance(conn, acct, cfg, item, today)
        elif item["kind"] == "charges":
            _apply_charges(conn, acct, charges[acct.name])
    for name, outcomes in payout_outcomes.items():
        for outcome in outcomes.values():
            results[name]["payouts_" + outcome] += 1
    _post_capital(conn, cfg, results)
    match = match_payouts(conn, today=today)
    if not dry_run:
        for name, stats in results.items():
            conn.execute(
                "INSERT INTO stripe_sync_log (ts, account, kind, file, counts_json, status) VALUES (?, ?, 'import', ?, ?, 'ok')",
                (now_iso(), name, None, json.dumps({k: v for k, v in stats.items() if k != "anchor"}, sort_keys=True)),
            )
    out = {"accounts": results, "skipped_files": skipped_files, "match": match, "dry_run": dry_run}
    if dry_run:
        conn.rollback()
    return out


def _post_capital(conn, cfg: StripeConfig, results: dict) -> None:
    """Re-split Stripe Capital for every account on every import, so a change to the
    [[stripe.capital]] terms re-books all rows (stripe_capital)."""
    from hpbooks.stripe_capital import post

    for acct in cfg.accounts:
        if not account_ok(acct, cfg):
            continue
        cap = post(conn, cfg, acct)
        if cap is None:
            continue
        changed = cap["inserted"] or cap["updated"] or cap["deleted"] or cap["conflicts"] or cap["loan_account_created"]
        if acct.name not in results and not changed:
            continue
        stats = results.setdefault(acct.name, _account_stats())
        stats["ledger_inserted"] += cap["inserted"]
        stats["ledger_updated"] += cap["updated"]
        stats["ledger_deleted"] += cap["deleted"]
        stats["capital"] = cap


def import_paths(conn, items: list[str], **kwargs) -> dict:
    return import_files(conn, _expand_explicit(items), **kwargs)


def _apply_charges(conn, acct: StripeAccount, mapping: dict[str, tuple[int, str]]) -> None:
    """Fill presentment amounts for converted charges imported before their charges file."""
    for btx_id, (amount, currency) in mapping.items():
        conn.execute(
            """
            UPDATE stripe_balance_transactions SET original_amount_cents = ?, original_currency = ?, updated_at = ?
            WHERE account = ? AND id = ? AND exchange_rate IS NOT NULL
              AND (original_amount_cents IS NOT ? OR original_currency IS NOT ?)
            """,
            (amount, currency, now_iso(), acct.name, btx_id, amount, currency),
        )


def record_balance(conn, acct: StripeAccount, cfg: StripeConfig, item: dict, today: date) -> dict | None:
    """A balance anchor (available + pending in the account currency) as of the folder date."""
    from hpbooks.balances import set_anchor

    if not account_ok(acct, cfg):
        return None
    total = 0
    seen = False
    for page in item["pages"]:
        if page.get("object") != "balance":
            continue
        for key in ("available", "pending"):
            for part in page.get(key) or []:
                if isinstance(part, dict) and str(part.get("currency") or "").lower() == acct.currency and isinstance(part.get("amount"), int):
                    total += int(part["amount"])
                    seen = True
    if not seen:
        return None
    as_of = item["folder_date"] or today.isoformat()
    latest = conn.execute(
        "SELECT as_of_date, balance_cents FROM balance_anchors WHERE account_id = ? ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1",
        (acct.ledger_id,),
    ).fetchone()
    if latest is not None and latest["as_of_date"] == as_of and int(latest["balance_cents"]) == total:
        return {"as_of": as_of, "balance_cents": total, "recorded": False}
    set_anchor(conn, acct.ledger_id, total, as_of, "statement", "Stripe balance (available + pending)", actor="stripe")
    return {"as_of": as_of, "balance_cents": total, "recorded": True}


# --- payout reconciliation ------------------------------------------------------------------------


def _bank_candidates(conn, cfg: StripeConfig) -> list[dict]:
    """Business cash deposits from the bank feed that could be Stripe payouts."""
    from hpbooks.scope import has_scope

    regex = re.compile(cfg.payout_match)
    scope_sql = "AND a.scope = 'business'" if has_scope(conn) else ""
    rows = conn.execute(
        f"""
        SELECT t.id, t.account_id, t.date, t.amount_cents, t.name, t.merchant_name, t.description, t.pending,
               a.last4, a.name AS account_name, a.display_name,
               c.business_tag, c.category, c.source AS class_source, c.note AS class_note
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN classifications c ON c.txn_id = t.id
        WHERE t.status = 'active' AND t.amount_cents > 0 AND a.type = 'cash'
          AND COALESCE(t.source, '') != 'stripe' AND a.id NOT LIKE 'stripe-%' {scope_sql}
        """
    ).fetchall()
    out = []
    for row in rows:
        item = as_dict(row)
        text = " ".join(item.get(key) or "" for key in ("name", "merchant_name", "description"))
        if regex.search(text):
            out.append(item)
    return out


def _payout_rows(conn, acct: StripeAccount) -> list[dict]:
    rows = conn.execute(
        """
        SELECT p.*, coalesce(b1.id, b2.id) AS btx_id, coalesce(b1.amount_cents, b2.amount_cents) AS btx_amount,
               coalesce(b1.created, b2.created) AS btx_created
        FROM stripe_payouts p
        LEFT JOIN stripe_balance_transactions b1
          ON b1.account = p.account AND b1.id = p.balance_transaction AND b1.booking = 'payout'
        LEFT JOIN stripe_balance_transactions b2 INDEXED BY idx_stripe_btx_source
          ON b2.account = p.account AND b2.source_id = p.id AND b2.booking = 'payout'
        WHERE p.account = ?
        ORDER BY ifnull(p.arrival_date, p.created), p.id
        """,
        (acct.name,),
    ).fetchall()
    out, seen = [], set()
    for row in rows:
        item = as_dict(row)
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        out.append(item)
    return out


def _returned_payouts(conn, acct: StripeAccount) -> set[str]:
    return {
        row["source_id"]
        for row in conn.execute(
            "SELECT source_id FROM stripe_balance_transactions WHERE account = ? AND booking = 'payout_return' AND source_id IS NOT NULL",
            (acct.name,),
        )
    }


def _fits(acct: StripeAccount, payout: dict, bank: dict, cents: int, base: str, window: int) -> bool:
    """The deposit is the payout's amount, in its payout account, from 1 day before to `window`
    days after the payout's own arrival date (never relative to today)."""
    if int(bank["amount_cents"]) != cents:
        return False
    if acct.payout_account and acct.payout_account not in (bank["account_id"], bank.get("last4")):
        return False
    start = (date.fromisoformat(base) - timedelta(days=1)).isoformat()
    end = (date.fromisoformat(base) + timedelta(days=window)).isoformat()
    return start <= bank["date"] <= end


def _history_start(conn, cfg: StripeConfig) -> dict[str | None, str | None]:
    """The earliest imported row of the bank accounts a payout can land in: per payout_account
    (id or last 4), and under None for any business cash account."""
    from hpbooks.scope import has_scope

    scope_sql = "AND a.scope = 'business'" if has_scope(conn) else ""
    firsts = conn.execute(
        f"""
        SELECT a.id, a.last4, (SELECT min(t.date) FROM transactions t WHERE t.account_id = a.id AND t.status = 'active') AS first
        FROM accounts a
        WHERE a.type = 'cash' AND a.id NOT LIKE 'stripe-%' {scope_sql}
        """
    ).fetchall()
    out: dict[str | None, str | None] = {}
    every = [row["first"] for row in firsts if row["first"]]
    out[None] = min(every) if every else None
    for acct in cfg.accounts:
        if acct.payout_account:
            mine = [row["first"] for row in firsts if row["first"] and acct.payout_account in (row["id"], row["last4"])]
            out[acct.payout_account] = min(mine) if mine else None
    return out


def match_payouts(conn, *, today: date | None = None) -> dict:
    """Pair each Stripe payout with its bank deposit and set every payout's match status.

    A unique match tags the bank deposit `transfer` (unless it is a manual
    classification of something else: that is a conflict and is left alone).
    More than one candidate leaves both sides unpaired (ambiguous). Safe to
    run any number of times; it runs after every Stripe and Finance import.
    """
    cfg = settings()
    today = today or date.today()
    counts = {status: 0 for status in MATCH_STATUSES}
    if not cfg.accounts:
        return counts
    banks = _bank_candidates(conn, cfg)
    bank_by_id = {row["id"]: row for row in banks}
    # Deposits by amount: a payout only ever looks at deposits of its own amount, so a
    # long backfill (hundreds of payouts, a year of bank rows) is not payouts x deposits.
    by_amount: dict[int, list[dict]] = defaultdict(list)
    for row in banks:
        by_amount[int(row["amount_cents"])].append(row)
    history = _history_start(conn, cfg)
    plans: list[tuple[StripeAccount, dict, int, str]] = []
    decided: dict[tuple[str, str], tuple[str, str | None, str]] = {}
    for acct in cfg.accounts:
        returned = _returned_payouts(conn, acct)
        for payout in _payout_rows(conn, acct):
            key = (acct.name, payout["id"])
            cents = -int(payout["btx_amount"]) if payout["btx_amount"] is not None else int(payout["amount_cents"])
            base = payout["arrival_date"] or payout["created"] or payout["btx_created"]
            if not account_ok(acct, cfg) or (payout["currency"] and payout["currency"] != cfg.books_currency):
                decided[key] = ("skipped", None, "currency is not the books currency")
            elif payout["status"] in ("failed", "canceled") or payout["id"] in returned:
                note = "payout failed" + (f" ({payout['failure_code']})" if payout["failure_code"] else "")
                decided[key] = ("failed", None, note)
            elif payout["btx_id"] is None:
                decided[key] = ("in_transit" if payout["status"] in ("pending", "in_transit") else "unmatched", None,
                                "payout balance transaction not imported yet")
            elif base is None:
                decided[key] = ("unmatched", None, "no payout date")
            else:
                plans.append((acct, payout, cents, base))

    claimed: dict[str, tuple[str, str]] = {}
    # Keep earlier pairs that still fit, so a match is stable across runs.
    for acct, payout, cents, base in plans:
        prior = payout["matched_txn_id"]
        if prior and prior in bank_by_id and prior not in claimed and _fits(acct, payout, bank_by_id[prior], cents, base, cfg.payout_window_days):
            claimed[prior] = (acct.name, payout["id"])
    pending = [plan for plan in plans if (plan[0].name, plan[1]["id"]) not in claimed.values()]
    changed = True
    candidates: dict[tuple[str, str], list[dict]] = {}
    while changed:
        changed = False
        for acct, payout, cents, base in pending:
            key = (acct.name, payout["id"])
            if key in claimed.values():
                continue
            found = [bank for bank in by_amount.get(cents, ()) if bank["id"] not in claimed and _fits(acct, payout, bank, cents, base, cfg.payout_window_days)]
            candidates[key] = found
            if len(found) == 1:
                claimed[found[0]["id"]] = key
                changed = True
    by_payout = {key: bank_id for bank_id, key in claimed.items()}

    for acct, payout, cents, base in plans:
        key = (acct.name, payout["id"])
        bank_id = by_payout.get(key)
        if bank_id:
            bank = bank_by_id[bank_id]
            if bank["class_source"] == "manual" and bank["business_tag"] != "transfer":
                decided[key] = ("conflict", bank_id, f"bank deposit {bank_id} is manually classified {bank['business_tag']} / {bank['category']}")
            else:
                decided[key] = ("matched", bank_id, f"bank deposit {bank_id} on {bank['date']}")
            continue
        found = candidates.get(key, [])
        if len(found) > 1:
            decided[key] = ("ambiguous", None, f"{len(found)} bank deposits fit: " + ", ".join(row["id"] for row in found[:5]))
            continue
        latest = (date.fromisoformat(base) + timedelta(days=cfg.payout_window_days)).isoformat()
        first = history.get(acct.payout_account)
        if payout["status"] in ("pending", "in_transit") or latest >= today.isoformat():
            decided[key] = ("in_transit", None, f"expected in the bank by {latest}")
        elif first is not None and base < first:
            where = f"payout account {acct.payout_account}" if acct.payout_account else "the business bank accounts"
            decided[key] = ("no_bank_history", None, f"arrived {base}, before the imported bank history of {where} (starts {first})")
        else:
            decided[key] = ("unmatched", None, f"no bank deposit of {cents / 100:.2f} matching the payout text from {base} to {latest}")

    accounts = {acct.name: acct for acct in cfg.accounts}
    for (name, payout_id), (status, bank_id, note) in decided.items():
        counts[status] += 1
        acct = accounts[name]
        previous = conn.execute(
            "SELECT matched_txn_id, match_status, match_note FROM stripe_payouts WHERE account = ? AND id = ?", (name, payout_id)
        ).fetchone()
        old_bank = previous["matched_txn_id"] if previous else None
        if previous is None or (previous["match_status"], old_bank, previous["match_note"]) != (status, bank_id, note):
            conn.execute(
                "UPDATE stripe_payouts SET match_status = ?, matched_txn_id = ?, match_note = ? WHERE account = ? AND id = ?",
                (status, bank_id, note, name, payout_id),
            )
        if old_bank and old_bank != bank_id:
            _release_bank(conn, old_bank)
        if status == "matched" and bank_id:
            leg = conn.execute(
                "SELECT id FROM stripe_balance_transactions WHERE account = ? AND booking = 'payout' AND source_id = ?",
                (name, payout_id),
            ).fetchone()
            ledger_leg = txn_id(acct, leg["id"]) if leg else acct.ledger_id
            write_classification(
                conn, bank_id, "transfer", "Transfer", "agent", MATCH_CONFIDENCE,
                f"{MATCH_NOTE_PREFIX}{payout_id} ({acct.display}) matched to {ledger_leg}", None,
                overwrite_manual=False, actor="stripe", audit_write=False,
            )
            if leg:
                write_classification(
                    conn, ledger_leg, "transfer", "Transfer", "rule", CONFIDENCE,
                    f"Stripe payout {payout_id} to the bank, matched to {bank_id}", None,
                    overwrite_manual=False, actor="stripe", audit_write=False,
                )
    return counts


def _release_bank(conn, bank_id: str) -> None:
    """A deposit that is no longer paired goes back to the rules, unless someone set it by hand."""
    row = conn.execute("SELECT source, note FROM classifications WHERE txn_id = ?", (bank_id,)).fetchone()
    if row is None or row["source"] == "manual" or not (row["note"] or "").startswith(MATCH_NOTE_PREFIX):
        return
    if conn.execute("SELECT 1 FROM stripe_payouts WHERE matched_txn_id = ?", (bank_id,)).fetchone():
        return
    classify_ids(conn, [bank_id], overwrite_non_manual=True)


def after_ledger_change(conn) -> dict:
    """Run after a Finance import or a reclassify: re-pair payouts and deposits.

    A reclassify puts rule tags back on paired deposits; this puts transfer back."""
    if not get_config().stripe_enabled:
        return {}
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stripe_payouts'").fetchone():
        return {}
    return match_payouts(conn)


def bank_only(conn, start: str | None = None, end: str | None = None) -> list[dict]:
    """Stripe-looking bank deposits not paired with any payout."""
    cfg = settings()
    if not cfg.accounts:
        return []
    paired = {row["matched_txn_id"] for row in conn.execute("SELECT matched_txn_id FROM stripe_payouts WHERE matched_txn_id IS NOT NULL")}
    out = []
    for bank in _bank_candidates(conn, cfg):
        if bank["id"] in paired:
            continue
        if start and bank["date"] < start or end and bank["date"] > end:
            continue
        out.append(bank)
    out.sort(key=lambda row: (row["date"], row["id"]))
    return out


# --- direct API mode (optional) ---------------------------------------------------------------------


def secret_path(filename: str) -> Path:
    """Key files sit next to the database (data/), like the WHMCS password files."""
    return Path(db_path()).parent / filename


def read_secret(filename: str) -> str:
    path = secret_path(filename)
    if not path.exists():
        raise HpbooksError(f"Stripe key file is missing: {path}")
    mode = path.stat().st_mode & 0o777
    if mode & ~0o600:
        raise HpbooksError(f"Stripe key file permissions are too open ({mode:03o}); require 600 or stricter")
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise HpbooksError(f"could not read Stripe key file: {path}") from exc
    if not value:
        raise HpbooksError(f"Stripe key file is empty: {path}")
    if not value.startswith(("rk_live_", "rk_test_")):
        raise HpbooksError("the Stripe key file must hold a restricted key (rk_...); never a secret key")
    return value


def _get(opener, path: str, params: list[tuple[str, str]], key: str) -> dict:
    url = f"{API_BASE}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Stripe-Version": "2024-06-20"})
    try:
        with opener(request, timeout=30) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise HpbooksError(f"Stripe API {path} returned HTTP {exc.code}") from None
    except (urllib.error.URLError, OSError) as exc:
        raise HpbooksError(f"could not reach the Stripe API for {path}: {getattr(exc, 'reason', exc)}") from None
    try:
        data = json.loads(body)
    except (ValueError, TypeError) as exc:
        raise HpbooksError(f"Stripe API {path} did not return JSON") from exc
    if not isinstance(data, dict) or data.get("object") != "list":
        raise HpbooksError(f"Stripe API {path} returned an unexpected result")
    return data


def _write_private(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
        fh.write("\n")


def sync(
    conn,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    account: str | None = None,
    inbox: Path | None = None,
    today: date | None = None,
    opener=None,
) -> dict:
    """Pull balance transactions and payouts with the restricted key, save them, import them."""
    cfg = require_enabled()
    today = today or date.today()
    opener = opener or urllib.request.urlopen
    date_to = date_to or today.isoformat()
    date_from = date_from or (today - timedelta(days=10)).isoformat()
    if date_from > date_to:
        raise HpbooksError("--from must be on or before --to")
    gte = day_start_ts(date_from, cfg)
    lt = day_start_ts((date.fromisoformat(date_to) + timedelta(days=1)).isoformat(), cfg)
    targets = [acct for acct in cfg.accounts if account in (None, acct.name)]
    if account and not targets:
        raise HpbooksError(f"no Stripe account named {account!r}")
    folder = (inbox or INBOX) / today.isoformat() / "stripe"
    secrets = [acct_secret(cfg, acct) for acct in targets]
    if any(not secret for secret in secrets):
        raise HpbooksError("direct API mode needs [stripe] secret (a restricted read-only key file in data/)")
    if len(set(secrets)) != len(secrets):
        raise HpbooksError("each Stripe account needs its own key file: set secret in each [[stripe.accounts]] entry")
    written: list[Path] = []
    for acct, secret in zip(targets, secrets):
        key = read_secret(secret)
        livemode = key.startswith("rk_live_")
        query = {"stripe_account": acct.stripe_account, "livemode": livemode, "created_gte": gte, "created_lt": lt, "source": "hpbooks stripe sync"}
        for path, stem in (("/v1/balance_transactions", acct.name), ("/v1/payouts", f"{acct.name}_payouts")):
            after = None
            for page_no in range(1, MAX_PAGES + 1):
                params = [("limit", str(PAGE_LIMIT)), ("created[gte]", str(gte)), ("created[lt]", str(lt))]
                if after:
                    params.append(("starting_after", after))
                page = _get(opener, path, params, key)
                page["_query"] = query
                target = folder / f"{stem}_{page_no}.json"
                _write_private(target, page)
                written.append(target)
                data = page.get("data") or []
                if not page.get("has_more") or not data:
                    break
                after = data[-1].get("id")
            else:
                raise HpbooksError(f"Stripe API {path} returned more than {MAX_PAGES} pages; use a shorter --from/--to range")
        del key
    result = import_files(conn, written, today=today) if written else {"accounts": {}, "skipped_files": [], "match": {}}
    for acct in targets:
        conn.execute(
            "INSERT INTO stripe_sync_log (ts, account, kind, file, counts_json, status) VALUES (?, ?, 'sync', ?, ?, 'ok')",
            (now_iso(), acct.name, str(folder), json.dumps({"files": sum(1 for p in written if p.name.startswith(acct.name + "_"))})),
        )
    result["written"] = [str(path) for path in written]
    return result


def acct_secret(cfg: StripeConfig, acct: StripeAccount) -> str | None:
    """The account's own key file, else [stripe] secret."""
    return acct.secret or cfg.secret
