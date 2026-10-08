"""Stripe Capital as a loan ([[stripe.capital]], features.stripe).

Stripe exposes four balance transaction types for Capital: financing_payout
(loan proceeds into the Stripe balance), financing_paydown (a repayment
withheld from sales, or a manual payment), and their _reversal forms. The
balance transactions never say how much of a repayment is principal and how
much is the flat fee ("premium"); the Capital API that would is not available
through the connector. The split therefore comes from the terms in the config:

    fee share = fee / (principal + fee)
    fee booked after a repayment = min(fee, round(cumulative paid x fee share))
    this repayment's fee = fee booked after it - fee booked before it
    principal part = repayment - fee part

per financing, in (created, id) order, so the fee rows add up to the fee and
the principal rows to the principal exactly. The plan is recomputed from the
stored balance transactions on every Stripe import: ledger rows have
deterministic ids, so a config change re-splits every row in place.

Ledger, per Stripe account with Capital terms or loan legs to post:
- the Stripe cash account (stripe-<name>) keeps one row per balance
  transaction for the principal (tagged transfer) and a `:capfee` row for the
  fee (the account's business, [stripe] capital_fee_category);
- the loan account (stripe-<name>-capital, liability, class loan) gets the
  other leg of each transfer (`:loan`): proceeds increase the amount owed
  (negative amount_cents, like a card charge), principal repayments reduce it.
  An `opening_principal` posts one opening row on start_date.

Manual classifications are never changed; a row whose amount the split would
change, or that it would remove, is a conflict and that balance transaction's
rows are left alone.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict

from hpbooks.config import StripeAccount, StripeCapital, StripeConfig
from hpbooks.db import _table_exists, audit, format_money, now_iso
from hpbooks.stripe import (
    CONFIDENCE,
    delete_ledger_row,
    fee_row,
    ledger_base,
    txn_id,
    upsert_ledger_row,
)

KINDS = {
    "financing_payout": "payout",
    "financing_paydown": "paydown",
    "financing_payout_reversal": "payout_reversal",
    "financing_paydown_reversal": "paydown_reversal",
}
MISSING_TERMS = "Capital fee not split: add [[stripe.capital]] terms"

# "Withheld funds from ch_1 to pay down flex loan flxln_1": the token after "loan",
# else any <letters>ln_<alnum> token (flxln_..., ln_...).
_AFTER_LOAN_RE = re.compile(r"(?i)\bloan\s+([a-z]{0,12}ln_[A-Za-z0-9]+)")
_TOKEN_RE = re.compile(r"\b([a-z]{0,12}ln_[A-Za-z0-9]+)\b")
_BTX_RE = re.compile(r"\b(txn_[A-Za-z0-9]+)\b")


def loan_ledger_id(acct: StripeAccount) -> str:
    return f"{acct.ledger_id}-capital"


def capital_kind(btx: dict) -> str | None:
    """payout, paydown, payout_reversal, paydown_reversal, or None for another financing type."""
    kind = KINDS.get(btx["type"]) or KINDS.get(btx.get("reporting_category") or "")
    amount = int(btx["amount_cents"])
    # A row whose sign contradicts its type is not split; it is booked as a plain transfer.
    if kind in ("payout", "paydown_reversal") and amount < 0 or kind in ("paydown", "payout_reversal") and amount > 0:
        return None
    return kind


def financing_ref(btx: dict) -> str | None:
    """The financing id named in the description (or source), if any."""
    for text in (btx.get("description") or "", btx.get("source_id") or ""):
        match = _AFTER_LOAN_RE.search(text) or _TOKEN_RE.search(text)
        if match:
            return match.group(1)
    return None


def _round_div(numerator: int, denominator: int) -> int:
    """numerator / denominator rounded half up, for numerator >= 0."""
    return (2 * numerator + denominator) // (2 * denominator)


# --- the plan -----------------------------------------------------------------------------------


def _capital_rows(conn, acct: StripeAccount) -> list[dict]:
    if not _table_exists(conn, "stripe_balance_transactions"):
        return []
    return [
        {key: row[key] for key in row.keys()}
        for row in conn.execute(
            "SELECT * FROM stripe_balance_transactions WHERE account = ? AND booking = 'capital' ORDER BY created_ts, id",
            (acct.name,),
        )
    ]


def _link_reversals(rows: list[dict]) -> None:
    """Point each reversal at the row it undoes (by a txn_ id in its description, else by source)."""
    by_id = {row["id"]: row for row in rows}
    by_source: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["source_id"]:
            by_source[row["source_id"]].append(row)
    for row in rows:
        row["original"] = None
        if row["kind"] not in ("payout_reversal", "paydown_reversal"):
            continue
        want = row["kind"].removesuffix("_reversal")
        found = None
        for ref in _BTX_RE.findall(row["description"] or ""):
            if ref in by_id and by_id[ref]["kind"] == want:
                found = by_id[ref]
        if found is None and row["source_id"]:
            earlier = [
                other for other in by_source[row["source_id"]]
                if other["kind"] == want and (other["created_ts"], other["id"]) < (row["created_ts"], row["id"])
            ]
            same = [other for other in earlier if abs(int(other["amount_cents"])) == abs(int(row["amount_cents"]))]
            found = (same or earlier or [None])[-1]
        if found is not None:
            row["original"] = found["id"]
            if row["ref"] is None:
                row["ref"] = found["ref"]


def plan(conn, cfg: StripeConfig, acct: StripeAccount) -> dict:
    """How every Capital balance transaction of this account is booked, and the figures per financing.

    {"rows": [btx + "split"], "financings": [...], "needs_loan_account": bool}. Read-only.
    """
    rows = _capital_rows(conn, acct)
    entries = cfg.capital_for(acct.name)
    by_financing = {entry.financing: entry for entry in entries if entry.financing}
    default = next((entry for entry in entries if entry.financing is None), None)
    for row in rows:
        row["kind"] = capital_kind(row)
        row["ref"] = financing_ref(row)
    _link_reversals(rows)

    # A row that names no financing (proceeds often do not) goes to the default entry; without
    # one, to the account's only financing when there is exactly one (configured or seen).
    every_ref = sorted(set(by_financing) | {row["ref"] for row in rows if row["ref"]})
    groups: dict[str, dict] = {}
    for entry in entries:
        groups[entry.key] = {"entry": entry, "rows": [], "refs": set()}
    for row in rows:
        ref = row["ref"]
        if ref is None and default is None and len(every_ref) == 1:
            ref = every_ref[0]
        entry = by_financing.get(ref) or default
        if entry is not None:
            key = entry.key
        else:
            key = f"unsplit:{ref or 'unknown'}"
            groups.setdefault(key, {"entry": None, "rows": [], "refs": set(), "ref": ref})
        groups[key]["rows"].append(row)
        if row["ref"]:
            groups[key]["refs"].add(row["ref"])

    splits: dict[str, dict] = {}
    financings = []
    for key, group in groups.items():
        if group["entry"] is not None:
            fin = _split_with_terms(acct, group["entry"], group["rows"], splits)
        else:
            fin = _split_without_terms(acct, group.get("ref"), group["rows"], splits)
        fin["financing_ids"] = sorted(group["refs"])
        financings.append(fin)
    for row in rows:
        row["split"] = splits[row["id"]]
    needs_loan = bool(entries) or any(row["split"]["loan"] for row in rows)
    return {"rows": rows, "financings": financings, "needs_loan_account": needs_loan}


def _fin_base(acct: StripeAccount, key: str, rows: list[dict]) -> dict:
    return {
        "account": acct.name,
        "account_label": acct.display,
        "business": acct.business,
        "key": key,
        "loan_account_id": loan_ledger_id(acct),
        "rows": len(rows),
        "first_date": rows[0]["created"] if rows else None,
        "last_date": rows[-1]["created"] if rows else None,
        "warnings": [],
    }


def _split_with_terms(acct: StripeAccount, entry: StripeCapital, rows: list[dict], splits: dict) -> dict:
    principal = entry.principal_cents
    fee_total = entry.fee_total_cents
    total = principal + fee_total
    fin = _fin_base(acct, entry.key, rows)
    has_payout = any(row["kind"] == "payout" for row in rows)
    opening = entry.opening_principal_cents if entry.opening_principal_cents is not None and not has_payout else None
    if entry.opening_principal_cents is not None and has_payout:
        fin["warnings"].append("opening_principal is ignored: the financing_payout is in the imported history")

    # Lifetime state. With an opening balance, what was repaid before start_date is
    # assumed to have carried the fee pro rata.
    repaid = principal - opening if opening is not None else 0
    fee_before = _round_div(repaid * fee_total, principal) if opening is not None else 0
    fee_booked = fee_before
    paid = repaid + fee_before
    proceeds = 0
    paid_in_books = 0
    fee_in_books = 0
    principal_in_books = 0
    overpaid = 0
    early = 0
    for row in rows:
        amount = int(row["amount_cents"])
        kind = row["kind"]
        split = {"kind": kind, "terms": True, "label": _label(entry, row), "main": amount, "fee": 0, "loan": 0}
        if opening is not None and row["created"] < entry.start_date:
            early += 1
        if kind == "payout":
            proceeds += amount
            split["loan"] = -amount
        elif kind == "payout_reversal":
            proceeds += amount
            split["loan"] = -amount
        elif kind == "paydown":
            payment = -amount
            paid += payment
            target = min(fee_total, _round_div(paid * fee_total, total)) if total else 0
            fee_part = max(0, min(payment, target - fee_booked))
            principal_part = payment - fee_part
            room = max(0, principal - repaid)
            if principal_part > room:
                extra = principal_part - room
                principal_part = room
                to_fee = min(extra, max(0, fee_total - fee_booked - fee_part))
                fee_part += to_fee
                extra -= to_fee
                if extra:
                    # Beyond principal and fee: the loan account shows a credit (owed < 0).
                    overpaid += extra
                    principal_part += extra
            fee_booked += fee_part
            repaid += principal_part
            paid_in_books += payment
            fee_in_books += fee_part
            principal_in_books += principal_part
            split.update(main=-principal_part, fee=-fee_part, loan=principal_part)
        elif kind == "paydown_reversal":
            back = amount
            original = splits.get(row["original"] or "")
            if original and original["kind"] == "paydown" and original["main"] + original["fee"] != 0:
                orig_paid = -(original["main"] + original["fee"])
                fee_back = -original["fee"] if back == orig_paid else _round_div(back * -original["fee"], orig_paid)
            else:
                fee_back = _round_div(back * fee_total, total) if total else 0
            fee_back = max(0, min(fee_back, back, fee_booked))
            principal_back = back - fee_back
            paid -= back
            fee_booked -= fee_back
            repaid -= principal_back
            paid_in_books -= back
            fee_in_books -= fee_back
            principal_in_books -= principal_back
            split.update(main=principal_back, fee=fee_back, loan=-principal_back)
        else:
            split.update(terms=False)
        splits[row["id"]] = split

    outstanding = principal - repaid
    expected = (opening or 0) + proceeds - principal_in_books
    if rows and not has_payout and opening is None:
        fin["warnings"].append(
            "the financing_payout is not in the imported history: set opening_principal and start_date "
            "(principal still owed on that date) so the loan account starts at the right balance"
        )
    if has_payout and proceeds != principal:
        fin["warnings"].append(f"proceeds {format_money(proceeds)} differ from the configured principal {format_money(principal)}")
    if overpaid:
        fin["warnings"].append(f"repayments exceed principal plus fee by {format_money(overpaid)} (overpayment)")
    if early:
        fin["warnings"].append(f"{early} Capital row(s) are dated before start_date {entry.start_date}; opening_principal should be the amount owed before them")
    fin.update(
        {
            "financing": entry.financing,
            "label": entry.display,
            "terms": True,
            "principal_cents": principal,
            "fee_cents": fee_total,
            "fee_rate": entry.fee_rate,
            "total_cents": total,
            "proceeds_cents": proceeds,
            "opening_principal_cents": opening,
            "start_date": entry.start_date if opening is not None else None,
            "paid_cents": paid_in_books,
            "repaid_principal_cents": repaid,
            "repaid_principal_in_books_cents": principal_in_books,
            "fee_booked_cents": fee_in_books,
            "fee_before_history_cents": fee_before,
            "fee_remaining_cents": fee_total - fee_booked,
            "principal_outstanding_cents": outstanding,
            "pct_repaid": round(repaid * 100 / principal, 1) if principal else None,
            "loan_expected_cents": expected,
            "overpaid_cents": overpaid,
            "unsplit_cents": 0,
        }
    )
    return fin


def _split_without_terms(acct: StripeAccount, ref: str | None, rows: list[dict], splits: dict) -> dict:
    """Today's booking (the whole repayment is a transfer). Loan legs only when the proceeds are known."""
    fin = _fin_base(acct, f"unsplit:{ref or 'unknown'}", rows)
    proceeds = 0
    on_loan = 0
    unsplit = 0
    paid = 0
    for row in rows:
        amount = int(row["amount_cents"])
        kind = row["kind"]
        split = {"kind": kind, "terms": False, "label": row["ref"] or ref or "", "main": amount, "fee": 0, "loan": 0}
        if kind in ("payout", "payout_reversal"):
            proceeds += amount
            split["loan"] = -amount
        elif kind == "paydown":
            unsplit += -amount
            paid += -amount
            if proceeds > 0:
                part = min(-amount, max(0, proceeds - on_loan))
                on_loan += part
                split["loan"] = part
        elif kind == "paydown_reversal":
            unsplit -= amount
            paid -= amount
            part = min(amount, on_loan)
            on_loan -= part
            split["loan"] = -part
        splits[row["id"]] = split
    if unsplit:
        fin["warnings"].append(f"{MISSING_TERMS} ({format_money(unsplit)} of repayments booked as transfers in full)")
    known = proceeds > 0
    fin.update(
        {
            "financing": ref,
            "label": ref or "Stripe Capital (no financing id)",
            "terms": False,
            "principal_cents": proceeds if known else None,
            "fee_cents": None,
            "fee_rate": None,
            "total_cents": None,
            "proceeds_cents": proceeds,
            "opening_principal_cents": None,
            "start_date": None,
            "paid_cents": paid,
            "repaid_principal_cents": on_loan if known else None,
            "repaid_principal_in_books_cents": on_loan if known else None,
            "fee_booked_cents": 0,
            "fee_before_history_cents": 0,
            "fee_remaining_cents": None,
            "principal_outstanding_cents": proceeds - on_loan if known else None,
            "pct_repaid": round(on_loan * 100 / proceeds, 1) if known else None,
            "loan_expected_cents": proceeds - on_loan,
            "overpaid_cents": 0,
            "unsplit_cents": unsplit,
        }
    )
    return fin


def _label(entry: StripeCapital, row: dict) -> str:
    return entry.financing or row["ref"] or entry.display


# --- ledger rows --------------------------------------------------------------------------------

_KIND_WORDS = {
    "payout": "financing",
    "payout_reversal": "financing reversed",
    "paydown": "repayment",
    "paydown_reversal": "repayment reversed",
}


def ledger_rows(acct: StripeAccount, cfg: StripeConfig, btx: dict) -> list[dict]:
    """The ledger rows one Capital balance transaction should have under the plan."""
    split = btx["split"]
    base = ledger_base(acct, cfg, btx)
    ref = btx["source_id"] or btx["id"]
    label = split["label"] or ("default terms" if split["terms"] else "(no financing id)")
    word = _KIND_WORDS.get(split["kind"] or "", btx["type"].replace("_", " "))
    main_id = txn_id(acct, btx["id"])
    loan_id = txn_id(acct, btx["id"], "loan")
    rows = []
    main = split["main"]
    if main != 0:
        if split["kind"] is None:
            note = f"Stripe Capital {btx['type'].replace('_', ' ')} ({btx['type']}): not split"
        elif split["kind"] in ("payout", "payout_reversal"):
            note = f"Stripe Capital {word} {label}"
        elif split["terms"]:
            note = f"Stripe Capital {word} (principal) {label}"
        else:
            note = f"Stripe Capital {word} ({btx['type']}) {label}: fee not split, add [[stripe.capital]] terms"
        if split["loan"]:
            note += f", paired with {loan_id}"
        rows.append(
            {
                **base,
                "id": main_id,
                "amount_cents": main,
                "direction": "in" if main > 0 else "out",
                "name": f"Stripe Capital {word} {ref}",
                "description": btx["description"],
                "assign": ("transfer", "Transfer", CONFIDENCE, note),
            }
        )
    fee = split["fee"]
    if fee != 0:
        note = f"Stripe Capital fee ({label}, configured terms)"
        rows.append(
            {
                **base,
                "id": txn_id(acct, btx["id"], "capfee"),
                "amount_cents": fee,
                "direction": "in" if fee > 0 else "out",
                "name": f"Stripe Capital fee {ref}",
                "description": note,
                "assign": (acct.business, cfg.capital_fee_category, CONFIDENCE, note),
            }
        )
    stripe_fee = fee_row(acct, cfg, btx, base)
    if stripe_fee is not None:
        rows.append(stripe_fee)
    loan = split["loan"]
    if loan != 0:
        note = f"Stripe Capital {word} {label}" + (" (principal)" if split["kind"] in ("paydown", "paydown_reversal") else "") + f", paired with {main_id}"
        rows.append(
            {
                **base,
                "account_id": loan_ledger_id(acct),
                "id": loan_id,
                "amount_cents": loan,
                "direction": "in" if loan > 0 else "out",
                "name": f"Stripe Capital {word} {ref}",
                "description": btx["description"],
                "assign": ("transfer", "Transfer", CONFIDENCE, note),
            }
        )
    return rows


def opening_rows(acct: StripeAccount, cfg: StripeConfig, financings: list[dict]) -> list[dict]:
    out = []
    for fin in financings:
        opening = fin.get("opening_principal_cents")
        if not fin["terms"] or opening is None or opening == 0:
            continue
        label = fin["financing"] or fin["label"]
        note = f"Stripe Capital principal owed on {fin['start_date']} ({label}), from [[stripe.capital]] opening_principal"
        out.append(
            {
                "id": f"stripe:{acct.name}:capital:{fin['key']}:opening",
                "account_id": loan_ledger_id(acct),
                "date": fin["start_date"],
                "currency": cfg.books_currency.upper(),
                "merchant_name": "Stripe",
                "provider_category": "financing",
                "raw_json": json.dumps({"financing": fin["financing"], "opening_principal_cents": opening}, sort_keys=True),
                "amount_cents": -opening,
                "direction": "out",
                "name": f"Stripe Capital opening principal {label}",
                "description": note,
                "assign": ("transfer", "Transfer", CONFIDENCE, note),
            }
        )
    return out


def _existing(conn, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    marks = ", ".join("?" for _ in ids)
    return {
        row["id"]: {key: row[key] for key in row.keys()}
        for row in conn.execute(
            f"""
            SELECT t.id, t.account_id, t.amount_cents, c.source AS class_source, c.business_tag, c.category
            FROM transactions t LEFT JOIN classifications c ON c.txn_id = t.id
            WHERE t.id IN ({marks})
            """,
            ids,
        )
    }


def _conflict(desired: dict[str, dict], existing: dict[str, dict]) -> str | None:
    """Why these rows must be left alone (a manual row would change or go), or None."""
    for row_id, row in existing.items():
        if row["class_source"] != "manual":
            continue
        want = desired.get(row_id)
        if want is None:
            return f"{row_id} is manually classified {row['business_tag']} / {row['category']}; the split would remove it"
        if int(want["amount_cents"]) != int(row["amount_cents"]) or want["account_id"] != row["account_id"]:
            return (
                f"{row_id} is manually classified {row['business_tag']} / {row['category']}; "
                f"the split would change it from {format_money(int(row['amount_cents']))} to {format_money(int(want['amount_cents']))}"
            )
    return None


def _units(conn, acct: StripeAccount, cfg: StripeConfig, result: dict) -> list[tuple[str, dict[str, dict], dict[str, dict]]]:
    """(what, desired rows by id, existing rows by id) per balance transaction and for the opening rows."""
    units = []
    for btx in result["rows"]:
        desired = {row["id"]: row for row in ledger_rows(acct, cfg, btx)}
        candidates = [txn_id(acct, btx["id"], suffix) for suffix in ("", "fee", "capfee", "loan")]
        units.append((btx["id"], desired, _existing(conn, candidates)))
    desired = {row["id"]: row for row in opening_rows(acct, cfg, result["financings"])}
    have = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM transactions WHERE account_id = ? AND id LIKE ? ESCAPE '\\'",
            (loan_ledger_id(acct), f"stripe:{acct.name}:capital:%:opening".replace("_", "\\_")),
        )
    ]
    units.append(("opening", desired, _existing(conn, sorted(set(have) | set(desired)))))
    return units


def conflicts(conn, cfg: StripeConfig, acct: StripeAccount, result: dict | None = None) -> list[dict]:
    result = result or plan(conn, cfg, acct)
    out = []
    for what, desired, existing in _units(conn, acct, cfg, result):
        reason = _conflict(desired, existing)
        if reason:
            out.append({"balance_transaction": what, "reason": reason})
    return out


def ensure_loan_account(conn, acct: StripeAccount, *, actor: str = "stripe") -> bool:
    """Register the Capital loan account for this Stripe account. True when it was created."""
    account_id = loan_ledger_id(acct)
    if conn.execute("SELECT 1 FROM accounts WHERE id = ?", (account_id,)).fetchone():
        return False
    conn.execute(
        """
        INSERT INTO accounts (id, name, type, last4, institution, notes, scope, class,
                              include_in_net_worth, sync_enabled, created_at)
        VALUES (?, ?, 'liability', NULL, 'Stripe', ?, 'business', 'loan', 1, 0, ?)
        """,
        (account_id, f"Stripe Capital ({acct.display})", f"stripe:{acct.name} Capital loan (filled by stripe import, not the Finance sync)", now_iso()),
    )
    audit(conn, "account_register", field=account_id, new_value="business", actor=actor, note=f"Stripe {acct.name} Capital loan")
    return True


def post(conn, cfg: StripeConfig, acct: StripeAccount) -> dict | None:
    """Book every Capital row of this account under the current terms. None when there is nothing to do."""
    result = plan(conn, cfg, acct)
    if not result["rows"] and not result["needs_loan_account"]:
        return None
    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0, "conflicts": [], "loan_account_created": False,
             "warnings": [w for fin in result["financings"] for w in fin["warnings"]]}
    if result["needs_loan_account"]:
        stats["loan_account_created"] = ensure_loan_account(conn, acct)
    for what, desired, existing in _units(conn, acct, cfg, result):
        reason = _conflict(desired, existing)
        if reason:
            stats["conflicts"].append({"balance_transaction": what, "reason": reason})
            continue
        for row in desired.values():
            stats[upsert_ledger_row(conn, row)] += 1
        for row_id in existing:
            if row_id not in desired:
                delete_ledger_row(conn, row_id, note=f"Stripe Capital re-split ({what})")
                stats["deleted"] += 1
    return stats


# --- report -------------------------------------------------------------------------------------


def report(conn, cfg: StripeConfig, accounts: list[StripeAccount]) -> dict:
    """Capital figures per financing, loan account balances, and warnings. Read-only."""
    from hpbooks.balances import snapshot_for

    financings: list[dict] = []
    loans = []
    warnings: list[str] = []
    for acct in accounts:
        result = plan(conn, cfg, acct)
        if not result["rows"] and not result["financings"]:
            continue
        loan_id = loan_ledger_id(acct)
        balance = None
        if conn.execute("SELECT 1 FROM accounts WHERE id = ?", (loan_id,)).fetchone():
            balance = snapshot_for(conn, loan_id)["display_cents"]
        expected = sum(fin["loan_expected_cents"] for fin in result["financings"])
        found = conflicts(conn, cfg, acct, result)
        loan = {
            "account": acct.name,
            "account_label": acct.display,
            "business": acct.business,
            "loan_account_id": loan_id,
            "loan_balance_cents": balance,
            "expected_cents": expected,
            "conflicts": found,
        }
        loans.append(loan)
        for fin in result["financings"]:
            financings.append(fin)
            warnings.extend(f"{acct.display}, {fin['label']}: {text}" for text in fin["warnings"])
        if found:
            warnings.append(f"{acct.display}: {len(found)} Capital row(s) left alone because they are manually classified (see conflicts)")
        if balance is not None and balance != expected:
            warnings.append(
                f"{acct.display}: loan account {loan_id} balance {format_money(balance)} differs from the Capital split {format_money(expected)}"
            )
    unsplit = sum(fin["unsplit_cents"] for fin in financings)
    return {
        "financings": financings,
        "loans": loans,
        "warnings": warnings,
        "missing_terms": unsplit != 0,
        "missing_terms_message": MISSING_TERMS if unsplit else None,
        "unsplit_cents": unsplit,
    }


def report_text(data: dict) -> str:
    from hpbooks.reports import render_table

    if not data["financings"]:
        return "no Stripe Capital activity or [[stripe.capital]] terms"
    body = []
    for fin in data["financings"]:
        def money(key):
            value = fin.get(key)
            return "" if value is None else format_money(value)

        body.append([
            fin["account"], fin["label"][:28], money("principal_cents"), money("fee_cents"), money("repaid_principal_cents"),
            money("fee_booked_cents"), money("principal_outstanding_cents"),
            "" if fin["pct_repaid"] is None else f"{fin['pct_repaid']:.1f}%",
        ])
    lines = [render_table(["account", "financing", "principal", "fee", "repaid principal", "fee booked", "outstanding", "repaid"], body, right_from=2)]
    for loan in data["loans"]:
        if loan["loan_balance_cents"] is not None:
            lines.append(f"loan account {loan['loan_account_id']}: owed {format_money(loan['loan_balance_cents'])}")
        for item in loan["conflicts"]:
            lines.append(f"conflict: {item['balance_transaction']}: {item['reason']}")
    if data["missing_terms"]:
        lines.append(f"warning: {data['missing_terms_message']} (unsplit {format_money(data['unsplit_cents'])})")
    for text in data["warnings"]:
        if MISSING_TERMS not in text:
            lines.append(f"warning: {text}")
    return "\n".join(lines)
