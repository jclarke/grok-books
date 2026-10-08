"""Stripe payout backfill from the books' start date: month-by-month files imported in more
than one run and out of order, bank history that starts later than the payouts
(no_bank_history), and a year of daily payouts.

All data is synthetic (tests/stripe_fake.py): po_TEST..., txn_TEST... ids, round amounts.
"""

from __future__ import annotations

import time
from datetime import date
from pathlib import Path

import pytest
import stripe_fake as sf
from fake_accounts import BANK, PAYPAL
from golden_fixture import run_cli, set_env

import hpbooks.config as hpconfig
from hpbooks.db import connect, init_db

SEPT = date(2026, 9, 30)


@pytest.fixture()
def on(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    init_db()
    hpconfig.override(stripe_enabled=True)
    return tmp_path


def _stripe(folder: Path, today: date = SEPT):
    from hpbooks.stripe import import_paths

    with connect() as conn:
        return import_paths(conn, [str(folder)], today=today)


def _finance(path: Path):
    from hpbooks.importer import import_paths

    with connect() as conn:
        return import_paths(conn, [str(path)])


def _bank(path: Path, items: list[dict], account: str = BANK, *, date_from: str, date_to: str, extra=()) -> Path:
    return sf.bank_feed(path, account, [item["bank"] for item in items] + list(extra), date_from=date_from, date_to=date_to)


def _statuses(account: str = "main") -> dict[str, int]:
    with connect() as conn:
        return {
            row["match_status"]: row["n"]
            for row in conn.execute("SELECT match_status, COUNT(*) AS n FROM stripe_payouts WHERE account = ? GROUP BY match_status", (account,))
        }


def _payout(payout_id: str, account: str = "main") -> dict:
    with connect() as conn:
        return dict(conn.execute("SELECT * FROM stripe_payouts WHERE account = ? AND id = ?", (account, payout_id)).fetchone())


def _tag(txn_id: str) -> str:
    with connect() as conn:
        return conn.execute("SELECT business_tag FROM classifications WHERE txn_id = ?", (txn_id,)).fetchone()[0]


def test_backfill_in_two_runs_out_of_order(on):
    items = sf.backfill("2026-01-05", 36)  # weekly from Jan 5 to early September
    early = [item for item in items if item["month"] < "2026-05"]
    late = [item for item in items if item["month"] >= "2026-05"]
    assert len(early) == 17 and len(late) == 19
    first_run = on / "inbox" / "backfill-stripe" / "stripe"
    second_run = on / "inbox" / "backfill-stripe-2" / "stripe"

    # Run 1: the Finance history from May (the rules book Stripe deposits as revenue), then the Stripe months from May.
    _finance(_bank(on / "inbox" / "bank-late.json", late, date_from="2026-05-01", date_to="2026-09-30"))
    assert _tag(late[0]["bank"][0]) == "branda"
    next_page = sf.write_backfill(first_run, late)
    _stripe(first_run)
    assert _statuses() == {"matched": 19}
    assert all(_tag(item["bank"][0]) == "transfer" for item in late)

    # Run 2: the older Stripe months. Their payouts arrived before the bank history starts.
    sf.write_backfill(second_run, early, first_page=next_page)
    result = _stripe(second_run)
    assert result["match"]["no_bank_history"] == 17 and result["match"]["matched"] == 19
    old = _payout(early[0]["payout"]["id"])
    assert old["match_status"] == "no_bank_history"
    assert "before the imported bank history of the business bank accounts (starts 2026-05-" in old["match_note"]
    code, out, err = run_cli(["stripe", "reconcile", "--from", "2026-01-01", "--to", "2026-09-30", "--rows"])
    assert code == 0, err
    assert "no_bank_history" in out and "matched 19" in err and "no_bank_history 17" in err

    # The older bank history arrives: every old payout pairs with its old deposit.
    _finance(_bank(on / "inbox" / "bank-early.json", early, date_from="2026-01-01", date_to="2026-04-30"))
    assert _statuses() == {"matched": 36}
    for item in items:
        assert _payout(item["payout"]["id"])["matched_txn_id"] == item["bank"][0]
    # Importing everything again changes nothing.
    _stripe(first_run)
    _stripe(second_run)
    assert _statuses() == {"matched": 36}


def test_no_bank_history_follows_the_payout_account(on):
    from hpbooks import stripe_reports as sr

    # PayPal has rows from January; the 0101 bank account only from June.
    _finance(sf.bank_feed(on / "pp.json", PAYPAL, [("pp-jan", "2026-01-10", 500, "Example deposit")], date_from="2026-01-01", date_to="2026-01-31"))
    _finance(sf.bank_feed(on / "bank.json", BANK, [("bank-jun", "2026-06-01", 700, "Example deposit")], date_from="2026-06-01", date_to="2026-06-30"))
    folder = on / "inbox" / "backfill-stripe" / "stripe"
    march = [sf.btx("txn_TESTNB01", "payout", -4000, "2026-03-02", source="po_TESTNB01")]
    sf.write(folder, "consult_1.json", sf.page(march, query={"stripe_account": sf.CONSULT, "livemode": True}))
    sf.write(folder, "main_1.json", sf.page([sf.btx("txn_TESTNB02", "payout", -5000, "2026-03-02", source="po_TESTNB02")], query={"stripe_account": sf.MAIN, "livemode": True}))
    _stripe(folder)
    consult = _payout("po_TESTNB01", "consult")
    assert consult["match_status"] == "no_bank_history" and "payout account 0101 (starts 2026-06-01)" in consult["match_note"]
    # main may pay out to any business cash account, and PayPal has history in March.
    assert _payout("po_TESTNB02")["match_status"] == "unmatched"
    with connect() as conn:
        summary = sr.summary(conn, "2026-01-01", "2026-09-30")
    assert summary["payouts"]["no_bank_history"] == 1 and summary["open_payouts"] == 1


def test_a_year_of_daily_payouts_matches_quickly(on):
    items = sf.backfill("2025-09-01", 400, step=1)
    noise = [(f"bank-noise{n:04d}", sf.day_after("2025-09-01", n), 10_000 + n * 100, "EXAMPLE CUSTOMER DEPOSIT") for n in range(400)]
    _finance(_bank(on / "bank.json", items, date_from="2025-09-01", date_to="2026-10-10", extra=noise))
    folder = on / "inbox" / "backfill-stripe" / "stripe"
    sf.write_backfill(folder, items)
    started = time.perf_counter()
    result = _stripe(folder)
    elapsed = time.perf_counter() - started
    assert result["match"]["matched"] == 400, result["match"]
    assert elapsed < 30, elapsed
    from hpbooks.stripe import match_payouts

    with connect() as conn:
        started = time.perf_counter()
        counts = match_payouts(conn, today=SEPT)
        rerun = time.perf_counter() - started
    assert counts["matched"] == 400 and rerun < 10, rerun
