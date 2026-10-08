"""Stripe Capital as a loan ([[stripe.capital]]): the fee / principal split, the loan account,
reversals, missing terms, re-splitting on a config change, and the P&L effect.

All data is synthetic (tests/stripe_fake.py): acct_TEST..., txn_TEST..., flxln_TEST... ids
and round amounts. The loan is $20,000.00 principal plus a $2,000.00 fee, so the fee share is
1/11 and 22 repayments of $1,000.00 pay it off exactly.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import stripe_fake as sf
from golden_fixture import run_cli, set_env

import hpbooks.config as hpconfig
from hpbooks.config import ConfigError, StripeCapital, build
from hpbooks.db import connect, init_db

SEPT = date(2026, 9, 30)
PRINCIPAL = 2_000_000
FEE = 200_000
LOAN_ACCOUNT = "stripe-main-capital"


@pytest.fixture()
def on(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    init_db()
    hpconfig.override(stripe_enabled=True)
    return tmp_path


def _terms(*entries: StripeCapital) -> None:
    cfg = hpconfig.get_config()
    hpconfig.override(stripe=hpconfig.replace(cfg.stripe, capital=tuple(entries)))


def _loan(**changes) -> StripeCapital:
    values = {"account": "main", "financing": sf.LOAN, "principal_cents": PRINCIPAL, "fee_cents": FEE}
    values.update(changes)
    return StripeCapital(**values)


def _write(tmp_path: Path, rows: list[dict], name: str = "main_1.json") -> Path:
    return sf.write(tmp_path / "inbox" / "2026-09-30" / "stripe", name, sf.page(rows, query=sf.MAIN_QUERY))


def _import(paths, **kwargs):
    from hpbooks.stripe import import_files

    kwargs.setdefault("today", SEPT)
    with connect() as conn:
        return import_files(conn, [Path(p) for p in paths], **kwargs)


def _rows(sql, params=()):
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params)]


def _amount(txn_id):
    rows = _rows("SELECT amount_cents FROM transactions WHERE id = ?", (txn_id,))
    return rows[0]["amount_cents"] if rows else None


def _class(txn_id):
    rows = _rows("SELECT business_tag, category, source, note FROM classifications WHERE txn_id = ?", (txn_id,))
    return rows[0] if rows else None


def _sum(sql, params=()):
    return _rows(sql, params)[0]["n"] or 0


def _fee_total():
    return _sum("SELECT sum(amount_cents) AS n FROM transactions WHERE id LIKE 'stripe:main:%:capfee'")


def _loan_balance():
    from hpbooks.balances import snapshot_for

    with connect() as conn:
        return snapshot_for(conn, LOAN_ACCOUNT)["display_cents"]


def _capital():
    from hpbooks import stripe_reports as sr

    with connect() as conn:
        return sr.capital(conn)


def _expected_fee_parts(payments: list[int]) -> list[int]:
    """Cumulative rounding, half up: fee booked after each payment = round(paid x fee / (principal + fee))."""
    parts, booked, paid = [], 0, 0
    for payment in payments:
        paid += payment
        after = min(FEE, (2 * paid * FEE + PRINCIPAL + FEE) // (2 * (PRINCIPAL + FEE)))
        parts.append(after - booked)
        booked = after
    return parts


# --- config ------------------------------------------------------------------------------------


def _capital_config(entries, **stripe):
    return {
        "features": {"stripe": True},
        "stripe": {"accounts": [{"name": "main", "business": "general"}], "capital": entries, **stripe},
    }


def test_config_parses_fee_and_fee_rate():
    cfg = build(_capital_config([
        {"account": "main", "financing": "flxln_TEST0001", "principal": 20000.00, "fee": 2000.00, "label": "Capital loan 2026"},
        {"account": "main", "principal": 10000, "fee_rate": 0.1, "opening_principal": 6000.50, "start_date": "2026-01-01"},
    ]))
    first, second = cfg.stripe.capital
    assert (first.principal_cents, first.fee_total_cents, first.display, first.key) == (2_000_000, 200_000, "Capital loan 2026", "flxln_TEST0001")
    assert (second.fee_total_cents, second.opening_principal_cents, second.key) == (100_000, 600_050, "default")
    # The default categories include Interest, so the Capital fee goes there.
    assert cfg.stripe.capital_fee_category == "Interest"
    # Without an Interest category it falls back to fee_category.
    data = _capital_config([], fee_category="Bank & Card Fees")
    data["categories"] = {"revenue": ["Sales"], "opex": ["Bank & Card Fees"]}
    data["businesses"] = [{"slug": "general"}]
    assert build(data).stripe.capital_fee_category == "Bank & Card Fees"


@pytest.mark.parametrize(
    "entry, extra, message",
    [
        ({"account": "nope", "principal": 100, "fee": 10}, {}, "not a \\[\\[stripe.accounts\\]\\] name"),
        ({"account": "main", "principal": 100}, {}, "exactly one of fee and fee_rate"),
        ({"account": "main", "principal": 100, "fee": 10, "fee_rate": 0.1}, {}, "exactly one of fee and fee_rate"),
        ({"account": "main", "principal": 0, "fee": 10}, {}, "principal must be more than zero"),
        ({"account": "main", "principal": 100, "fee_rate": 1.5}, {}, "fee_rate must be from 0"),
        ({"account": "main", "principal": 100, "fee": 10, "opening_principal": 50}, {}, "go together"),
        ({"account": "main", "principal": 100, "fee": 10, "opening_principal": 500, "start_date": "2026-01-01"}, {}, "from 0 to principal"),
        ({"account": "main", "principal": 100, "fee": 10, "opening_principal": 50, "start_date": "Jan 1"}, {}, "YYYY-MM-DD"),
        ({"account": "main", "principal": 100.001, "fee": 10}, {}, "more than two decimal places"),
        ({"account": "main", "principal": "100", "fee": 10}, {}, "must be a dollar amount"),
        ({"account": "main", "financing": "flxln_TEST0001 x", "principal": 100, "fee": 10}, {}, "financing id"),
        ({"account": "main", "principal": 100, "fee": 10}, {"capital_fee_category": "Revenue - Sales"}, "must be an expense category"),
        ({"account": "main", "principal": 100, "fee": 10}, {"capital_fee_category": "Nope"}, "is not a category"),
    ],
)
def test_config_validation(entry, extra, message):
    with pytest.raises(ConfigError, match=message):
        build(_capital_config([entry], **extra))


def test_repeated_entries_are_refused_and_only_checked_when_on():
    twice = [{"account": "main", "principal": 100, "fee": 10}, {"account": "main", "principal": 200, "fee": 20}]
    with pytest.raises(ConfigError, match="repeated default entry"):
        build(_capital_config(twice))
    off = _capital_config([{"account": "nope", "principal": 100}])
    off["features"] = {}
    assert build(off).stripe.capital[0].account == "nope"
    with pytest.raises(ConfigError, match="stripe.capital must be a list"):
        build({"stripe": {"capital": "x"}})


# --- the split -----------------------------------------------------------------------------------


def test_proceeds_and_repayments_split_with_cumulative_rounding(on):
    _terms(_loan(label="Capital loan 2026"))
    result = _import([_write(on, sf.capital_rows(count=10))])
    stats = result["accounts"]["main"]
    assert stats["capital"]["loan_account_created"] is True
    loan = _rows("SELECT * FROM accounts WHERE id = ?", (LOAN_ACCOUNT,))[0]
    assert (loan["name"], loan["type"], loan["class"], loan["scope"], loan["institution"]) == ("Stripe Capital (Stripe)", "liability", "loan", "business", "Stripe")
    assert (loan["include_in_net_worth"], loan["sync_enabled"]) == (1, 0)

    # Proceeds: cash in, tagged transfer, paired with the loan leg that raises the amount owed.
    assert _amount("stripe:main:txn_TESTCAP000") == PRINCIPAL
    assert _amount("stripe:main:txn_TESTCAP000:loan") == -PRINCIPAL
    note = _class("stripe:main:txn_TESTCAP000")["note"]
    assert note.startswith(f"Stripe Capital financing {sf.LOAN}") and "stripe:main:txn_TESTCAP000:loan" in note
    assert _class("stripe:main:txn_TESTCAP000:loan")["business_tag"] == "transfer"

    expected = _expected_fee_parts([100_000] * 10)
    assert expected[:3] == [9091, 9091, 9091] and expected[5] == 9090
    for n, fee in enumerate(expected, start=1):
        base = f"stripe:main:txn_TESTCAP{n:03d}"
        assert _amount(base + ":capfee") == -fee
        assert _amount(base) == -(100_000 - fee)
        assert _amount(base + ":loan") == 100_000 - fee
        got = _class(base + ":capfee")
        assert (got["business_tag"], got["category"]) == ("branda", "Interest")
        assert got["note"] == f"Stripe Capital fee ({sf.LOAN}, configured terms)"
        assert _class(base)["business_tag"] == "transfer" and _class(base + ":loan")["business_tag"] == "transfer"

    fee_booked = sum(expected)
    assert fee_booked == 90_909 and _fee_total() == -fee_booked
    repaid = 1_000_000 - fee_booked
    assert _loan_balance() == PRINCIPAL - repaid == 1_090_909
    # The Stripe cash account still moves by the Stripe net.
    assert _sum("SELECT sum(amount_cents) AS n FROM transactions WHERE account_id = 'stripe-main'") == PRINCIPAL - 1_000_000

    fin = _capital()["financings"][0]
    assert (fin["label"], fin["principal_cents"], fin["fee_cents"], fin["fee_booked_cents"]) == ("Capital loan 2026", PRINCIPAL, FEE, fee_booked)
    assert (fin["repaid_principal_cents"], fin["principal_outstanding_cents"], fin["pct_repaid"]) == (repaid, 1_090_909, 45.5)
    assert fin["fee_remaining_cents"] == FEE - fee_booked and fin["warnings"] == []
    assert _capital()["loans"][0]["loan_balance_cents"] == fin["principal_outstanding_cents"]


@pytest.mark.parametrize("terms", [{"fee_cents": FEE}, {"fee_cents": None, "fee_rate": 0.10}])
def test_paid_off_sums_exactly_to_fee_and_principal(on, terms):
    _terms(_loan(**terms))
    _import([_write(on, sf.capital_rows(count=22))])
    assert _fee_total() == -FEE
    principal = _sum("SELECT sum(amount_cents) AS n FROM transactions WHERE id LIKE 'stripe:main:txn_TESTCAP%' AND id NOT LIKE '%:%:%:%' AND amount_cents < 0")
    assert principal == -PRINCIPAL
    assert _loan_balance() == 0
    fin = _capital()["financings"][0]
    assert (fin["fee_booked_cents"], fin["repaid_principal_cents"], fin["principal_outstanding_cents"], fin["pct_repaid"]) == (FEE, PRINCIPAL, 0, 100.0)
    assert fin["warnings"] == []


def test_uneven_repayments_still_sum_exactly(on):
    payments = [12_300, 99_900, 100, 250_000, 333_300, 700, 1_000_000, 503_700]
    assert sum(payments) == PRINCIPAL + FEE
    rows = [sf.capital_payout("txn_TESTCAP000", PRINCIPAL, "2026-03-02")]
    rows += [sf.paydown(f"txn_TESTCAP{n:03d}", cents, sf.day_after("2026-03-02", n)) for n, cents in enumerate(payments, start=1)]
    _terms(_loan())
    _import([_write(on, rows)])
    parts = [-_amount(f"stripe:main:txn_TESTCAP{n:03d}:capfee") if _amount(f"stripe:main:txn_TESTCAP{n:03d}:capfee") else 0 for n in range(1, 9)]
    assert parts == _expected_fee_parts(payments)
    assert sum(parts) == FEE and _loan_balance() == 0


def test_overpayment_is_booked_and_reported(on):
    _terms(_loan())
    rows = sf.capital_rows(count=22) + [sf.paydown("txn_TESTCAP099", 50_000, "2026-04-30")]
    _import([_write(on, rows)])
    assert _fee_total() == -FEE
    assert _loan_balance() == -50_000  # a credit on the loan account
    fin = _capital()["financings"][0]
    assert fin["overpaid_cents"] == 50_000 and any("overpayment" in text for text in fin["warnings"])


def test_opening_principal_when_proceeds_predate_history(on):
    _terms(_loan(opening_principal_cents=1_200_000, start_date="2026-01-01"))
    _import([_write(on, sf.capital_rows(count=5, proceeds=None))])
    opening = _rows("SELECT date, amount_cents FROM transactions WHERE id = ?", (f"stripe:main:capital:{sf.LOAN}:opening",))
    assert opening == [{"date": "2026-01-01", "amount_cents": -1_200_000}]
    assert _class(f"stripe:main:capital:{sf.LOAN}:opening")["business_tag"] == "transfer"
    # $8,000 of principal was repaid before the history, with $800 of fee pro rata.
    fin = _capital()["financings"][0]
    assert fin["fee_before_history_cents"] == 80_000
    fee_in_books = (2 * 1_380_000 * FEE + PRINCIPAL + FEE) // (2 * (PRINCIPAL + FEE)) - 80_000
    assert fee_in_books == 45_455 and fin["fee_booked_cents"] == fee_in_books and _fee_total() == -fee_in_books
    assert fin["repaid_principal_cents"] == 800_000 + 500_000 - fee_in_books
    assert fin["principal_outstanding_cents"] == _loan_balance() == 1_200_000 - (500_000 - fee_in_books)
    assert fin["warnings"] == []
    # Proceeds missing and no opening_principal: booked anyway, with a warning.
    _terms(_loan())
    _import([_write(on, sf.capital_rows(count=5, proceeds=None))])
    assert not _rows("SELECT id FROM transactions WHERE id LIKE 'stripe:main:capital:%'")
    fin = _capital()["financings"][0]
    assert any("set opening_principal and start_date" in text for text in fin["warnings"])


def test_reversal_undoes_the_original_split(on):
    _terms(_loan())
    rows = sf.capital_rows(count=3)
    # Undo the third repayment (found by its source), then an unattributed reversal.
    rows.append(sf.btx("txn_TESTCAPR01", "financing_paydown_reversal", 100_000, "2026-03-06", category="financing",
                       source="fnpd_TESTCAP003", description="Reversal of a flex loan paydown"))
    rows.append(sf.btx("txn_TESTCAPR02", "financing_paydown_reversal", 22_000, "2026-03-07", category="financing",
                       source="fnpdr_TESTOTHER", description=f"Paydown reversal for flex loan {sf.LOAN}"))
    _import([_write(on, rows)])
    third = -_amount("stripe:main:txn_TESTCAP003:capfee")
    assert _amount("stripe:main:txn_TESTCAPR01:capfee") == third
    assert _amount("stripe:main:txn_TESTCAPR01") == 100_000 - third
    assert _amount("stripe:main:txn_TESTCAPR01:loan") == -(100_000 - third)
    # Unknown original: the configured share, 22,000 x 1/11.
    assert _amount("stripe:main:txn_TESTCAPR02:capfee") == 2_000
    assert _amount("stripe:main:txn_TESTCAPR02:loan") == -20_000
    fin = _capital()["financings"][0]
    net_paid = 300_000 - 100_000 - 22_000
    assert fin["paid_cents"] == net_paid
    assert fin["fee_booked_cents"] == -_fee_total()
    assert _loan_balance() == PRINCIPAL - fin["repaid_principal_in_books_cents"] == fin["principal_outstanding_cents"]
    # A payout reversal gives the proceeds back.
    rows.append(sf.btx("txn_TESTCAPR03", "financing_payout_reversal", -PRINCIPAL, "2026-03-08", category="financing", source="fnpay_TEST0001",
                       description="Stripe Capital financing reversal"))
    _import([_write(on, rows)])
    assert _amount("stripe:main:txn_TESTCAPR03:loan") == PRINCIPAL


def test_paydown_without_an_id_uses_the_account_default(on):
    _terms(_loan(financing=None, label="Default flex loan"), _loan(financing="flxln_TEST0002", principal_cents=500_000, fee_cents=50_000))
    rows = [
        sf.capital_payout("txn_TESTCAP000", PRINCIPAL, "2026-03-02"),
        sf.paydown("txn_TESTCAP001", 110_000, "2026-03-03", loan=None),  # "Capital repayment": no id
        sf.paydown("txn_TESTCAP002", 110_000, "2026-03-04"),  # flxln_TEST0001 has no entry of its own
        sf.paydown("txn_TESTCAP003", 55_000, "2026-03-05", loan="flxln_TEST0002"),
    ]
    _import([_write(on, rows)])
    assert _amount("stripe:main:txn_TESTCAP001:capfee") == -10_000
    assert _amount("stripe:main:txn_TESTCAP002:capfee") == -10_000
    assert _amount("stripe:main:txn_TESTCAP003:capfee") == -5_000
    by_key = {fin["key"]: fin for fin in _capital()["financings"]}
    assert by_key["default"]["fee_booked_cents"] == 20_000 and by_key["default"]["label"] == "Default flex loan"
    assert by_key["default"]["financing_ids"] == [sf.LOAN]
    assert by_key["flxln_TEST0002"]["repaid_principal_cents"] == 50_000
    assert _loan_balance() == PRINCIPAL - 200_000 - 50_000


def test_financing_id_extraction():
    from hpbooks.stripe_capital import financing_ref

    def ref(description, source=None):
        return financing_ref({"description": description, "source_id": source})

    assert ref("Withheld funds from ch_TEST1 to pay down flex loan flxln_TEST1") == "flxln_TEST1"
    assert ref("Paydown for Loan ln_TEST2abc") == "ln_TEST2abc"
    assert ref("Capital repayment", "flxln_TEST3") == "flxln_TEST3"
    assert ref("Capital repayment", "flxlnpd_TEST0009") is None
    assert ref("Withheld funds from ch_TEST1") is None


# --- missing terms, config changes, manual rows ---------------------------------------------------


def test_missing_terms_keeps_the_old_booking_and_warns(on):
    from hpbooks import stripe_reports as sr

    path = _write(on, sf.capital_rows(count=3, proceeds=None))
    _import([path])
    assert _amount("stripe:main:txn_TESTCAP001") == -100_000
    assert _class("stripe:main:txn_TESTCAP001")["business_tag"] == "transfer"
    assert "fee not split" in _class("stripe:main:txn_TESTCAP001")["note"]
    assert _amount("stripe:main:txn_TESTCAP001:capfee") is None
    # No principal known: no loan account, no loan rows.
    assert _rows("SELECT id FROM accounts WHERE id = ?", (LOAN_ACCOUNT,)) == []
    data = _capital()
    assert data["missing_terms"] and data["unsplit_cents"] == 300_000
    assert data["missing_terms_message"] == "Capital fee not split: add [[stripe.capital]] terms"
    code, out, err = run_cli(["stripe", "status"])
    assert code == 0, err
    assert "warning: Capital fee not split: add [[stripe.capital]] terms (unsplit 3,000.00)" in out
    code, out, _err = run_cli(["stripe", "capital", "--json"])
    assert code == 0 and json.loads(out)["unsplit_cents"] == 300_000
    with connect() as conn:
        assert sr.summary(conn, "2026-01-01", "2026-09-30")["capital"]["missing_terms"] is True


def test_missing_terms_with_known_proceeds_posts_the_loan_leg(on):
    _import([_write(on, sf.capital_rows(count=22))])
    assert _amount("stripe:main:txn_TESTCAP000:loan") == -PRINCIPAL
    assert _amount("stripe:main:txn_TESTCAP001:loan") == 100_000
    # The unsplit repayments reach the principal after 20 rows; the rest stay plain transfers.
    assert _amount("stripe:main:txn_TESTCAP021:loan") is None
    assert _loan_balance() == 0
    assert _capital()["unsplit_cents"] == 2_200_000


def test_adding_terms_later_resplits_idempotently(on):
    path = _write(on, sf.capital_rows(count=10))
    _import([path])
    assert _amount("stripe:main:txn_TESTCAP001") == -100_000
    _terms(_loan())
    stats = _import([path])["accounts"]["main"]
    assert stats["ledger_inserted"] == 10 and stats["ledger_updated"] == 20  # 10 fee rows; main and loan legs resized
    assert _amount("stripe:main:txn_TESTCAP001") == -(100_000 - 9091)
    assert _fee_total() == -90_909 and _loan_balance() == 1_090_909
    before = _rows("SELECT id, amount_cents, updated_at FROM transactions ORDER BY id")
    again = _import([path])["accounts"]["main"]
    assert (again["ledger_inserted"], again["ledger_updated"], again["ledger_deleted"]) == (0, 0, 0)
    assert _rows("SELECT id, amount_cents, updated_at FROM transactions ORDER BY id") == before
    # The re-split also runs on an import of another account's file.
    _terms(_loan(fee_cents=100_000))
    sf.write(on / "inbox" / "2026-09-30" / "stripe", "consult_1.json",
             sf.page([sf.btx("txn_TEST0501", "charge", 40_000, "2026-09-03", source="ch_TEST0501")],
                     query={**sf.MAIN_QUERY, "stripe_account": sf.CONSULT}))
    result = _import([on / "inbox" / "2026-09-30" / "stripe" / "consult_1.json"])
    assert result["accounts"]["main"]["ledger_updated"] > 0
    assert _amount("stripe:main:txn_TESTCAP001:capfee") == -4762  # 100,000 x 1/21
    # Dropping the terms puts the old booking back and removes the fee rows.
    _terms()
    stats = _import([path])["accounts"]["main"]
    assert stats["ledger_deleted"] == 10
    assert _rows("SELECT id FROM transactions WHERE id LIKE '%:capfee'") == []
    assert _amount("stripe:main:txn_TESTCAP001") == -100_000
    assert _rows("SELECT COUNT(*) AS n FROM classifications WHERE txn_id LIKE '%:capfee'") == [{"n": 0}]


def test_manual_classification_on_a_split_row_is_kept(on):
    from hpbooks.classify import classify_manual

    _terms(_loan())
    path = _write(on, sf.capital_rows(count=4))
    _import([path])
    with connect() as conn:
        classify_manual(conn, "stripe:main:txn_TESTCAP001:capfee", "general", "Interest", "booked to overhead")
    _import([path])
    got = _class("stripe:main:txn_TESTCAP001:capfee")
    assert (got["business_tag"], got["source"]) == ("general", "manual")
    # New terms would change that row: it and its siblings are left alone and reported.
    _terms(_loan(fee_cents=100_000))
    result = _import([path])
    conflicts = result["accounts"]["main"]["capital"]["conflicts"]
    assert [item["balance_transaction"] for item in conflicts] == ["txn_TESTCAP001"]
    assert "manually classified general / Interest" in conflicts[0]["reason"]
    assert _amount("stripe:main:txn_TESTCAP001:capfee") == -9091  # unchanged
    assert _amount("stripe:main:txn_TESTCAP002:capfee") == -(2 * 4762 - 4762)  # re-split
    assert _class("stripe:main:txn_TESTCAP001:capfee")["source"] == "manual"
    data = _capital()
    assert data["loans"][0]["conflicts"] and any("manually classified" in text for text in data["warnings"])
    code, _out, err = run_cli(["stripe", "import", str(path)])
    assert code == 0 and "Capital row left alone" in err


# --- reports ---------------------------------------------------------------------------------------


def test_pnl_shows_the_fee_as_interest_and_never_the_principal(on):
    from hpbooks.analytics import schedule_c_report
    from hpbooks.reports import build_pnl, reconcile

    _terms(_loan())
    _import([_write(on, sf.capital_rows(count=22))])
    with connect() as conn:
        report = build_pnl(conn, 2026, by="year", business="branda")
        lines = {row.label: row.values[-1] for row in report.rows}
        assert lines["Interest"] == FEE
        assert report.net_income_cents == -FEE
        everything = build_pnl(conn, 2026, by="year", business="all")
        assert everything.net_income_cents == -FEE
        assert everything.transfer_cents == 0  # proceeds and principal: both legs are transfers
        assert reconcile(conn, 2026).ok
        sched = repr(schedule_c_report(conn, "2026-01-01", "2026-12-31", "branda"))
    assert "16b" in sched


def test_status_api_and_cli(on):
    from hpbooks.web import create_app

    _terms(_loan(label="Capital loan 2026"))
    _import([_write(on, sf.capital_rows(count=10))])
    code, out, err = run_cli(["stripe", "status"])
    assert code == 0, err
    assert "Stripe Capital (lifetime)" in out and "Capital loan 2026" in out and "loan account stripe-main-capital: owed 10,909.09" in out
    code, out, err = run_cli(["stripe", "capital"])
    assert code == 0 and "909.09" in out and "45.5%" in out
    code, out, _err = run_cli(["stripe", "status", "--json"])
    assert json.loads(out)["capital"]["financings"][0]["principal_outstanding_cents"] == 1_090_909
    client = create_app().test_client()
    summary = client.get("/api/stripe/summary?start=2026-01-01&end=2026-09-30").get_json()
    assert summary["capital"]["financings"][0]["fee_booked_cents"] == 90_909 and summary["capital"]["missing_terms"] is False
    capital = client.get("/api/stripe/capital?business=consulting").get_json()
    assert capital["ok"] and capital["financings"] == []
    assert client.get("/api/stripe/capital?account=nope").status_code == 400
