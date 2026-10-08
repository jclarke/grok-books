"""Stripe integration (features.stripe): config, import, ledger posting, payout matching, CLI, API.

All Stripe data is synthetic (tests/stripe_fake.py). Nothing here reaches the
network: the direct API mode is driven through a fake urlopen.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest
import stripe_fake as sf
from fake_accounts import BANK, PAYPAL
from golden_fixture import run_cli, set_env

import hpbooks.config as hpconfig
from hpbooks.config import ConfigError, build
from hpbooks.db import HpbooksError, connect, init_db

ROOT = Path(__file__).resolve().parent.parent
SEPT = date(2026, 9, 30)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    init_db()
    return tmp_path


@pytest.fixture()
def on(db):
    hpconfig.override(stripe_enabled=True)
    return db


def _import(paths, **kwargs):
    from hpbooks.stripe import import_files

    kwargs.setdefault("today", SEPT)
    with connect() as conn:
        return import_files(conn, [Path(p) for p in paths], **kwargs)


def _finance(path):
    from hpbooks.importer import import_paths

    with connect() as conn:
        return import_paths(conn, [str(path)])


def _rows(sql, params=()):
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params)]


def _class(txn_id):
    rows = _rows("SELECT business_tag, category, source, note FROM classifications WHERE txn_id = ?", (txn_id,))
    return rows[0] if rows else None


def _payout(payout_id, account="main"):
    return _rows("SELECT * FROM stripe_payouts WHERE account = ? AND id = ?", (account, payout_id))[0]


def _inbox(tmp_path, day="2026-09-12"):
    return tmp_path / "inbox" / day


# --- config -------------------------------------------------------------------------------


def test_defaults_and_flag_off():
    cfg = build({})
    assert cfg.stripe_enabled is False and cfg.stripe.accounts == ()
    assert cfg.stripe.fee_category == "Payment Processing Fees" and cfg.stripe.payout_window_days == 5
    assert "stripe" not in cfg.public_payload(detail=True)["features"]
    assert "stripe_accounts" not in cfg.public_payload(detail=True)
    # The test config lists two accounts, but they are inactive while the flag is off.
    assert len(hpconfig.get_config().stripe.accounts) == 2
    assert hpconfig.stripe_settings().accounts == ()


def test_config_when_on():
    data = {
        "features": {"stripe": True},
        "businesses": [{"slug": "shop", "label": "Shop", "revenue_category": "Revenue - Services"}, {"slug": "general", "kind": "overhead"}],
        "stripe": {"accounts": [{"name": "main", "business": "shop"}, {"name": "eu", "business": "general", "currency": "EUR", "label": "Stripe EU"}]},
    }
    cfg = build(data)
    assert cfg.stripe_enabled
    main, eu = cfg.stripe.accounts
    assert (main.revenue_category, main.display, main.ledger_id, main.currency) == ("Revenue - Services", "Stripe main", "stripe-main", "usd")
    assert (eu.revenue_category, eu.display, eu.currency) == ("Revenue - Sales", "Stripe EU", "eur")
    payload = cfg.public_payload(detail=True)
    assert payload["features"]["stripe"] is True
    assert payload["stripe_accounts"] == [
        {"name": "main", "label": "Stripe main", "business": "shop"},
        {"name": "eu", "label": "Stripe EU", "business": "general"},
    ]


@pytest.mark.parametrize(
    "stripe, message",
    [
        ({"accounts": [{"name": "a", "business": "general"}, {"name": "a", "business": "general"}]}, "repeated name"),
        ({"accounts": [{"name": "a", "business": "nope"}]}, r"stripe.accounts\[0\].business 'nope'"),
        ({"accounts": [{"name": "a", "business": "general", "revenue_category": "Rent"}]}, "not a revenue category"),
        ({"accounts": [{"name": "A_b", "business": "general"}]}, "name must be"),
        ({"accounts": [{"business": "general"}]}, "needs name and business"),
        ({"accounts": [{"name": "a", "business": "general", "stripe_account": "x1"}]}, "must start with acct_"),
        ({"fee_category": "Nope"}, "not a category"),
        ({"fee_category": "Revenue - Sales"}, "must be an expense category"),
        ({"payout_match": "(unclosed"}, "not a valid regex"),
        ({"payout_window_days": 99}, "0 to 31"),
        ({"timezone": "Mars/Base"}, "not a known time zone"),
        ({"secret": "../stripe.secret"}, "file name in the data directory"),
    ],
)
def test_config_validation(stripe, message):
    with pytest.raises(ConfigError, match=message):
        build({"features": {"stripe": True}, "stripe": stripe})


def test_references_are_only_checked_when_on():
    cfg = build({"stripe": {"accounts": [{"name": "a", "business": "nope"}]}})
    assert cfg.stripe.accounts[0].business == "nope"
    with pytest.raises(ConfigError, match="stripe.accounts must be a list"):
        build({"stripe": {"accounts": "main"}})


# --- flag off: nothing changes -------------------------------------------------------------


def test_flag_off_cli_api_and_generic_import(db):
    inbox = _inbox(db)
    sf.main_files(inbox / "stripe")
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-08", 9000, "STRIPE TRANSFER ST-TEST0001")])
    for argv in (["stripe", "status"], ["stripe", "import", str(inbox / "stripe")], ["stripe", "reconcile"], ["stripe", "sync"]):
        code, out, err = run_cli(argv)
        assert code == 2 and out == ""
        assert "Stripe integration is disabled (set features.stripe = true in config/local.toml)" in err
    code, out, err = run_cli(["import", str(inbox)])
    assert code == 0, err
    assert "stripe" not in out.lower() and "stripe" not in err.lower()
    assert _rows("SELECT id FROM transactions") == [{"id": "bank-po1"}]
    assert _rows("SELECT id FROM accounts WHERE id LIKE 'stripe-%'") == []
    assert _class("bank-po1")["business_tag"] == "branda"  # the seed rule, untouched
    assert _rows("SELECT * FROM stripe_balance_transactions") == []
    # Stripe files are never read as Finance results, named one by one or by glob.
    code, _out, err = run_cli(["import", str(inbox / "stripe" / "main_1.json")])
    assert code == 1 and "nothing to import" in err
    code, _out, err = run_cli(["import", str(inbox / "*" / "*.json")])
    assert code == 1 and "nothing to import" in err

    from hpbooks.web import create_app

    client = create_app().test_client()
    for url in ("/api/stripe/summary", "/api/stripe/payouts", "/export/stripe/summary.csv"):
        response = client.get(url)
        assert response.status_code == 404, url
        assert response.get_json() == {"ok": False, "error": "Stripe integration is disabled"}
    assert "stripe" not in client.get("/api/config").get_json()["features"]
    assert client.get("/stripe").status_code in (404, 503)


def test_help_lists_stripe_as_disabled(db):
    from hpbooks.cli import build_parser

    text = " ".join(build_parser().format_help().split())
    assert "Stripe balance import, payouts, and reconciliation (disabled)" in text


def test_no_stripe_module_is_loaded_when_off(tmp_path):
    env = {key: value for key, value in os.environ.items() if not key.startswith("HPBOOKS_")}
    env.update(HPBOOKS_CONFIG=str(ROOT / "tests" / "fixtures" / "config.test.toml"), HPBOOKS_DB=str(tmp_path / "b.db"), HPBOOKS_KEY="ef" * 32)
    script = (
        "import sys, contextlib, io\n"
        "from hpbooks.cli import main\n"
        "from hpbooks.web import create_app\n"
        "import hpbooks.importer, hpbooks.classify\n"
        "with contextlib.redirect_stdout(io.StringIO()):\n"
        "    main(['init']); main(['reclassify'])\n"
        "app = create_app(); app.test_client().get('/api/config')\n"
        "print(sorted(m for m in sys.modules if 'stripe' in m))\n"
    )
    proc = subprocess.run([sys.executable, "-c", script], cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "[]"


# --- import and booking ----------------------------------------------------------------------


def test_each_type_is_booked(on):
    result = _import(sf.main_files(_inbox(on) / "stripe"))
    stats = result["accounts"]["main"]
    assert (stats["new"], stats["updated"], stats["unchanged"]) == (11, 0, 0)
    assert stats["ledger_inserted"] == 16 and stats["ledger_account_created"] is True
    acct = _rows("SELECT * FROM accounts WHERE id = 'stripe-main'")[0]
    assert (acct["name"], acct["type"], acct["class"], acct["scope"], acct["institution"]) == ("Stripe", "cash", "cash", "business", "Stripe")
    assert acct["sync_enabled"] == 0 and acct["include_in_net_worth"] == 1
    expected = {
        "stripe:main:txn_TEST0001": (10000, "branda", "Revenue - Hosting"),
        "stripe:main:txn_TEST0001:fee": (-320, "branda", "Payment Processing Fees"),
        "stripe:main:txn_TEST0002": (5000, "branda", "Revenue - Hosting"),  # ACH payment
        "stripe:main:txn_TEST0002:fee": (-40, "branda", "Payment Processing Fees"),
        "stripe:main:txn_TEST0003": (-2000, "branda", "Refunds"),
        "stripe:main:txn_TEST0004": (-3000, "branda", "Refunds"),  # chargeback
        "stripe:main:txn_TEST0004:fee": (-1500, "branda", "Payment Processing Fees"),  # dispute fee
        "stripe:main:txn_TEST0005": (-500, "branda", "Payment Processing Fees"),  # Stripe billing fee
        "stripe:main:txn_TEST0005:fee": (-40, "branda", "Payment Processing Fees"),  # sales tax on it
        "stripe:main:txn_TEST0006": (-9000, "transfer", "Transfer"),  # payout
        "stripe:main:txn_TEST0007": (-1000, "transfer", "Transfer"),  # minimum balance hold
        "stripe:main:txn_TEST0008": (1000, "transfer", "Transfer"),  # and release
        "stripe:main:txn_TEST0009": (-800, "transfer", "Transfer"),  # Stripe Capital repayment
        "stripe:main:txn_TEST0010": (3000, "branda", "Refunds"),  # dispute won
        "stripe:main:txn_TEST0010:fee": (1500, "branda", "Payment Processing Fees"),  # dispute fee returned
        "stripe:main:txn_TEST0011": (-100, "needs_review", "Uncategorized"),  # unknown type
    }
    got = {
        row["id"]: (row["amount_cents"], row["business_tag"], row["category"])
        for row in _rows("SELECT t.id, t.amount_cents, c.business_tag, c.category FROM transactions t JOIN classifications c ON c.txn_id = t.id WHERE t.account_id = 'stripe-main'")
    }
    assert got == expected
    assert "chargeback" in _class("stripe:main:txn_TEST0004")["note"]
    assert "Stripe Capital repayment" in _class("stripe:main:txn_TEST0009")["note"]
    assert _class("stripe:main:txn_TEST0011")["source"] == "rule"
    rows = _rows("SELECT date, source, pending, currency FROM transactions WHERE id = 'stripe:main:txn_TEST0001'")
    assert rows == [{"date": "2026-09-01", "source": "stripe", "pending": 0, "currency": "USD"}]
    # The review inbox lists the unknown type.
    from hpbooks.reports import query_review

    with connect() as conn:
        assert [row["id"] for row in query_review(conn, 2026)] == ["stripe:main:txn_TEST0011"]


def test_ledger_balance_is_the_stripe_net(on):
    from hpbooks.balances import snapshot_for

    _import(sf.main_files(_inbox(on) / "stripe"))
    with connect() as conn:
        assert snapshot_for(conn, "stripe-main")["activity_cents"] == sf.MAIN_NET
    stored = _rows("SELECT sum(net_cents) AS net FROM stripe_balance_transactions WHERE account = 'main'")[0]["net"]
    assert stored == sf.MAIN_NET


def test_pnl_effect(on):
    from hpbooks.reports import build_pnl, reconcile

    _import(sf.main_files(_inbox(on) / "stripe"))
    with connect() as conn:
        report = build_pnl(conn, 2026, by="year", business="branda")
        lines = {row.label: row.values[-1] for row in report.rows}
        assert lines["Revenue - Hosting"] == 15000
        assert lines["Refunds"] == -2000  # refund, chargeback, and the chargeback won back
        assert lines["Payment Processing Fees"] == 900
        assert report.net_income_cents == 15000 - 2000 - 900
        everything = build_pnl(conn, 2026, by="year", business="all")
        lines = {row.label: row.values[-1] for row in everything.rows}
        assert lines["Uncategorized / needs_review"] == -100
        # Payout, holds, and Capital repayment are transfers, never in the P&L.
        assert everything.net_income_cents == 15000 - 2000 - 900 - 100
        assert everything.transfer_cents == -9000 - 1000 + 1000 - 800
        assert reconcile(conn, 2026).ok


def test_reimport_is_idempotent_and_updates_status(on):
    folder = _inbox(on) / "stripe"
    paths = sf.main_files(folder)
    first = _import(paths)["accounts"]["main"]
    # Payout rows made from payout balance transactions, then filled in from the payouts file, are new.
    payouts = len(_rows("SELECT id FROM stripe_payouts WHERE account = 'main'"))
    assert payouts > 0
    assert (first["payouts_new"], first["payouts_updated"], first["payouts_unchanged"]) == (payouts, 0, 0)
    before = _rows("SELECT id, amount_cents, updated_at FROM transactions ORDER BY id")
    again = _import(paths)["accounts"]["main"]
    assert (again["new"], again["updated"], again["unchanged"], again["ledger_inserted"], again["ledger_updated"]) == (0, 0, 11, 0, 0)
    assert again["payouts_unchanged"] == 1
    assert _rows("SELECT id, amount_cents, updated_at FROM transactions ORDER BY id") == before
    # A later pull shows the same charge as available instead of pending.
    pending = sf.btx("txn_TEST0001", "charge", 10000, "2026-09-01", fee=320, source="ch_TEST0001", status="pending")
    sf.write(folder, "main_1.json", sf.page([pending], query=sf.MAIN_QUERY))
    _import([folder / "main_1.json"])
    assert _rows("SELECT status FROM stripe_balance_transactions WHERE id = 'txn_TEST0001'") == [{"status": "pending"}]
    available = dict(pending, status="available")
    sf.write(folder, "main_1.json", sf.page([available], query=sf.MAIN_QUERY))
    stats = _import([folder / "main_1.json"])["accounts"]["main"]
    assert (stats["new"], stats["updated"]) == (0, 1)
    assert _rows("SELECT status FROM stripe_balance_transactions WHERE id = 'txn_TEST0001'") == [{"status": "available"}]
    assert _rows("SELECT COUNT(*) AS n FROM transactions WHERE id LIKE 'stripe:main:txn_TEST0001%'") == [{"n": 2}]


def test_manual_classification_survives_reimport(on):
    from hpbooks.classify import classify_manual, reclassify

    paths = sf.main_files(_inbox(on) / "stripe")
    _import(paths)
    with connect() as conn:
        classify_manual(conn, "stripe:main:txn_TEST0011", "general", "Office/Other", "climate pledge")
    _import(paths)
    with connect() as conn:
        reclassify(conn)
    got = _class("stripe:main:txn_TEST0011")
    assert (got["business_tag"], got["category"], got["source"]) == ("general", "Office/Other", "manual")
    # Rules never re-tag Stripe rows: a reclassify leaves the Stripe booking as it was.
    assert _class("stripe:main:txn_TEST0005:fee")["note"] == "sales tax on Stripe fees"


def test_dry_run_writes_nothing(on):
    result = _import(sf.main_files(_inbox(on) / "stripe"), dry_run=True)
    assert result["accounts"]["main"]["new"] == 11 and result["dry_run"]
    assert _rows("SELECT COUNT(*) AS n FROM stripe_balance_transactions") == [{"n": 0}]
    assert _rows("SELECT COUNT(*) AS n FROM transactions") == [{"n": 0}]
    assert _rows("SELECT id FROM accounts WHERE id = 'stripe-main'") == []
    code, out, _err = run_cli(["stripe", "import", "--dry-run", str(_inbox(on) / "stripe")])
    assert code == 0 and out.startswith("dry run: stripe main: new=11")
    assert _rows("SELECT COUNT(*) AS n FROM transactions") == [{"n": 0}]


def test_file_forms_mcp_wrapper_and_list_of_pages(on):
    rows = sf.main_transactions()
    folder = _inbox(on) / "stripe"
    sf.write(folder, "main_1.json", sf.mcp_wrap(sf.page(rows[:5], has_more=True, query=sf.MAIN_QUERY)))
    sf.write(folder, "main_2.json", [sf.page(rows[5:8], has_more=True), sf.page(rows[8:], has_more=False)])
    stats = _import([folder / "main_1.json", folder / "main_2.json"])["accounts"]["main"]
    assert stats["new"] == 11


def test_unknown_account_test_mode_and_wrong_account_are_skipped(on):
    folder = _inbox(on) / "stripe"
    row = [sf.btx("txn_TEST0101", "charge", 1000, "2026-09-01", source="ch_TEST0101")]
    sf.write(folder, "other_1.json", sf.page(row))
    sf.write(folder, "main_1.json", sf.page(row, query={**sf.MAIN_QUERY, "livemode": False}))
    sf.write(folder, "consult_1.json", sf.page(row, query={**sf.MAIN_QUERY}))  # acct_TEST000001 is not consult's
    result = _import(sorted(folder.glob("*.json")))
    reasons = sorted(item["reason"] for item in result["skipped_files"])
    assert len(reasons) == 3
    assert "file is for Stripe account acct_TEST000001, not acct_TEST000002" in reasons
    assert any("test-mode data" in reason for reason in reasons)
    assert any("unknown Stripe account 'other'" in reason for reason in reasons)
    assert result["accounts"] == {}
    # --account overrides the file name.
    stats = _import([folder / "other_1.json"], account="main")["accounts"]["main"]
    assert stats["new"] == 1


def test_currency_mismatch_is_stored_not_posted(on):
    folder = _inbox(on) / "stripe"
    rows = [
        sf.btx("txn_TEST0201", "charge", 10000, "2026-09-01", fee=300, source="ch_TEST0201"),
        sf.btx("txn_TEST0202", "charge", 8000, "2026-09-02", fee=250, source="ch_TEST0202", currency="eur"),
    ]
    sf.write(folder, "main_1.json", sf.page(rows))
    stats = _import([folder / "main_1.json"])["accounts"]["main"]
    assert stats["new"] == 2 and stats["skipped_currency"] == 1
    assert _rows("SELECT booking FROM stripe_balance_transactions WHERE id = 'txn_TEST0202'") == [{"booking": "skipped_currency"}]
    assert not _rows("SELECT id FROM transactions WHERE id LIKE 'stripe:main:txn_TEST0202%'")
    code, out, _err = run_cli(["stripe", "status", "--account", "main"])
    assert code == 0 and "skipped (currency): 1" in out
    # An account whose whole balance is in another currency posts nothing.
    cfg = hpconfig.get_config()
    eur = tuple(hpconfig.replace(a, currency="eur") if a.name == "consult" else a for a in cfg.stripe.accounts)
    hpconfig.override(stripe=hpconfig.replace(cfg.stripe, accounts=eur))
    sf.write(folder, "consult_1.json", sf.page([sf.btx("txn_TEST0203", "charge", 5000, "2026-09-03", currency="eur", source="ch_TEST0203")]))
    stats = _import([folder / "consult_1.json"])["accounts"]["consult"]
    assert stats["skipped_currency"] == 1
    assert _rows("SELECT COUNT(*) AS n FROM transactions WHERE account_id = 'stripe-consult'") == [{"n": 0}]


def test_converted_charge_keeps_presentment_amount_and_nothing_else(on):
    folder = _inbox(on) / "stripe"
    converted = sf.btx("txn_TEST0301", "charge", 10800, "2026-09-01", fee=350, source="ch_TEST0301", exchange_rate=1.08)
    sf.write(folder, "main_1.json", sf.page([converted]))
    sf.write(folder, "main_charges_1.json", sf.page([sf.charge("ch_TEST0301", 10000, "eur", "txn_TEST0301")], url="/v1/charges"))
    _import([folder / "main_1.json", folder / "main_charges_1.json"])
    row = _rows("SELECT original_amount_cents, original_currency, amount_cents FROM stripe_balance_transactions WHERE id = 'txn_TEST0301'")[0]
    assert row == {"original_amount_cents": 10000, "original_currency": "eur", "amount_cents": 10800}
    # The ledger uses the settled USD amount.
    assert _rows("SELECT amount_cents FROM transactions WHERE id = 'stripe:main:txn_TEST0301'") == [{"amount_cents": 10800}]
    # Billing details from the charges file are never stored.
    with connect() as conn:
        for table in ("stripe_balance_transactions", "stripe_payouts", "transactions", "classifications", "audit_log"):
            text = json.dumps([dict(r) for r in conn.execute(f"SELECT * FROM {table}")])
            assert "example.com" not in text and "Example Customer" not in text, table
    # Re-importing the balance file without the charges file keeps the presentment amount.
    _import([folder / "main_1.json"])
    assert _rows("SELECT original_amount_cents FROM stripe_balance_transactions WHERE id = 'txn_TEST0301'") == [{"original_amount_cents": 10000}]


def test_emails_in_descriptions_are_masked(on):
    folder = _inbox(on) / "stripe"
    row = sf.btx("txn_TEST0401", "charge", 1000, "2026-09-01", source="ch_TEST0401", description="Invoice for someone@example.com")
    sf.write(folder, "main_1.json", sf.page([row]))
    _import([folder / "main_1.json"])
    assert _rows("SELECT description FROM stripe_balance_transactions") == [{"description": "Invoice for [email]"}]
    assert _rows("SELECT description FROM transactions") == [{"description": "Invoice for [email]"}]


def test_balance_file_records_an_anchor(on):
    from hpbooks.balances import snapshot_for

    folder = _inbox(on, "2026-09-12") / "stripe"
    sf.main_files(folder)
    sf.write(folder, "main_balance.json", sf.balance(1500, 700))
    result = _import(sorted(folder.glob("*.json")))
    assert result["accounts"]["main"]["anchor"] == {"as_of": "2026-09-12", "balance_cents": 2200, "recorded": True}
    with connect() as conn:
        snap = snapshot_for(conn, "stripe-main")
    assert snap["anchored"] and snap["anchor_cents"] == 2200 and snap["real_balance_cents"] == 2200
    again = _import([folder / "main_balance.json"])
    assert again["accounts"]["main"]["anchor"]["recorded"] is False
    assert len(_rows("SELECT id FROM balance_anchors WHERE account_id = 'stripe-main'")) == 1


def test_two_accounts_two_businesses(on):
    from hpbooks.reports import build_pnl

    folder = _inbox(on) / "stripe"
    sf.main_files(folder)
    consult = [sf.btx("txn_TEST0501", "charge", 40000, "2026-09-03", fee=1190, source="ch_TEST0501", description="Example retainer")]
    sf.write(folder, "consult_1.json", sf.page(consult, query={**sf.MAIN_QUERY, "stripe_account": sf.CONSULT}))
    result = _import(sorted(folder.glob("*.json")))
    assert set(result["accounts"]) == {"main", "consult"}
    with connect() as conn:
        lines = {row.label: row.values[-1] for row in build_pnl(conn, 2026, by="year", business="consulting").rows}
    assert lines["Revenue - Consulting"] == 40000 and lines["Payment Processing Fees"] == 1190
    assert _rows("SELECT id FROM accounts WHERE id LIKE 'stripe-%' ORDER BY id") == [{"id": "stripe-consult"}, {"id": "stripe-main"}]


# --- payout reconciliation ----------------------------------------------------------------------


def test_unique_match_pairs_and_counts_revenue_once(on):
    from hpbooks.reports import build_pnl

    inbox = _inbox(on)
    _import(sf.main_files(inbox / "stripe"))
    # The bank deposit arrives later (next day's Finance pull): the generic import pairs it.
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-08", 9000, "STRIPE TRANSFER ST-TEST0001")])
    code, _out, err = run_cli(["import", str(inbox / "bank.json")])
    assert code == 0, err
    got = _class("bank-po1")
    assert (got["business_tag"], got["category"], got["source"]) == ("transfer", "Transfer", "agent")
    assert got["note"].startswith("Stripe payout po_TEST0001")
    payout = _payout("po_TEST0001")
    assert (payout["match_status"], payout["matched_txn_id"], payout["arrival_date"]) == ("matched", "bank-po1", "2026-09-08")
    assert "bank-po1" in _class("stripe:main:txn_TEST0006")["note"]
    with connect() as conn:
        lines = {row.label: row.values[-1] for row in build_pnl(conn, 2026, by="year", business="branda").rows}
    assert lines["Revenue - Hosting"] == 15000  # Stripe gross only; the deposit is a transfer
    # A reclassify puts the rule tag back for a moment and the matcher undoes it.
    code, _out, err = run_cli(["reclassify"])
    assert code == 0, err
    assert _class("bank-po1")["business_tag"] == "transfer"
    code, out, err = run_cli(["stripe", "reconcile", "--from", "2026-09-01", "--to", "2026-09-30"])
    assert code == 0 and "po_TEST0001" in out and "matched" in out and "2026-09-08 Bank 0101 (0101)" in out
    assert "matched 1" in err and "bank only 0" in err


def test_bank_first_then_stripe(on):
    inbox = _inbox(on)
    sf.main_files(inbox / "stripe")
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-09", 9000, "STRIPE TRANSFER ST-TEST0001")])
    _finance(inbox / "bank.json")
    assert _class("bank-po1")["business_tag"] == "branda"
    _import(sorted((inbox / "stripe").glob("*.json")))
    assert _class("bank-po1")["business_tag"] == "transfer"
    assert _payout("po_TEST0001")["match_status"] == "matched"


def test_ambiguous_leaves_both_and_lists_bank_only(on):
    inbox = _inbox(on)
    sf.bank_feed(
        inbox / "bank.json",
        BANK,
        [("bank-a", "2026-09-08", 9000, "STRIPE TRANSFER ST-A"), ("bank-b", "2026-09-09", 9000, "STRIPE TRANSFER ST-B")],
    )
    _finance(inbox / "bank.json")
    _import(sf.main_files(inbox / "stripe"))
    payout = _payout("po_TEST0001")
    assert payout["match_status"] == "ambiguous" and payout["matched_txn_id"] is None
    assert _class("bank-a")["business_tag"] == "branda" and _class("bank-b")["business_tag"] == "branda"
    code, out, err = run_cli(["stripe", "reconcile", "--from", "2026-09-01", "--to", "2026-09-30"])
    assert code == 0 and "ambiguous" in out and "Bank only" in out and "bank only 2" in err


def test_in_transit_then_unmatched(on):
    from hpbooks.stripe import match_payouts

    _import(sf.main_files(_inbox(on) / "stripe"), today=date(2026, 9, 9))
    assert _payout("po_TEST0001")["match_status"] == "in_transit"
    with connect() as conn:
        match_payouts(conn, today=date(2026, 9, 20))
    payout = _payout("po_TEST0001")
    assert payout["match_status"] == "unmatched" and "no bank deposit" in payout["match_note"]


def test_window_text_and_payout_account_rules(on):
    inbox = _inbox(on)
    sf.bank_feed(
        inbox / "bank.json",
        BANK,
        [
            ("bank-early", "2026-09-06", 9000, "STRIPE TRANSFER"),  # two days before arrival: outside
            ("bank-late", "2026-09-14", 9000, "STRIPE TRANSFER"),  # six days after: outside
            ("bank-text", "2026-09-08", 9000, "ACME DEPOSIT"),  # text does not match
        ],
    )
    sf.bank_feed(inbox / "paypal.json", PAYPAL, [("pp-1", "2026-09-08", 9000, "Stripe deposit")])
    _finance(inbox / "bank.json")
    _finance(inbox / "paypal.json")
    _import(sf.main_files(inbox / "stripe"))
    payout = _payout("po_TEST0001")
    assert (payout["match_status"], payout["matched_txn_id"]) == ("matched", "pp-1")  # any business cash account
    # consult pays out only to the account with last 4 0101.
    folder = inbox / "stripe"
    sf.write(folder, "consult_1.json", sf.page([sf.btx("txn_TEST0601", "payout", -4000, "2026-09-06", source="po_TEST0601")]))
    sf.bank_feed(inbox / "pp2.json", PAYPAL, [("pp-2", "2026-09-07", 4000, "STRIPE PAYOUT")])
    _finance(inbox / "pp2.json")
    _import([folder / "consult_1.json"])
    assert _payout("po_TEST0601", "consult")["match_status"] == "unmatched"
    sf.bank_feed(inbox / "b2.json", BANK, [("bank-c", "2026-09-07", 4000, "STRIPE PAYOUT")])
    _finance(inbox / "b2.json")
    assert _payout("po_TEST0601", "consult")["matched_txn_id"] == "bank-c"


def test_manual_conflict_is_reported_not_changed(on):
    from hpbooks.classify import classify_manual

    inbox = _inbox(on)
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-08", 9000, "STRIPE TRANSFER ST-TEST0001")])
    _finance(inbox / "bank.json")
    with connect() as conn:
        classify_manual(conn, "bank-po1", "branda", "Revenue - Hosting", "booked by hand")
    _import(sf.main_files(inbox / "stripe"))
    payout = _payout("po_TEST0001")
    assert payout["match_status"] == "conflict" and "manually classified" in payout["match_note"]
    got = _class("bank-po1")
    assert (got["business_tag"], got["source"]) == ("branda", "manual")
    # A manual transfer is fine.
    with connect() as conn:
        classify_manual(conn, "bank-po1", "transfer", "Transfer", "")
    _import([_inbox(on) / "stripe" / "main_payouts_1.json"])
    assert _payout("po_TEST0001")["match_status"] == "matched"


def test_failed_payout(on):
    folder = _inbox(on) / "stripe"
    rows = [
        sf.btx("txn_TEST0701", "payout", -4000, "2026-09-05", source="po_TEST0701"),
        sf.btx("txn_TEST0702", "payout_failure", 4000, "2026-09-07", source="po_TEST0701"),
    ]
    sf.write(folder, "main_1.json", sf.page(rows))
    sf.write(folder, "main_payouts_1.json", sf.page([sf.payout("po_TEST0701", 4000, "2026-09-05", "2026-09-07", status="failed", failure_code="account_closed")], url="/v1/payouts"))
    _import([folder / "main_1.json", folder / "main_payouts_1.json"])
    payout = _payout("po_TEST0701")
    assert payout["match_status"] == "failed" and payout["failure_code"] == "account_closed"
    legs = _rows("SELECT t.amount_cents, c.business_tag FROM transactions t JOIN classifications c ON c.txn_id = t.id WHERE t.account_id = 'stripe-main' ORDER BY t.id")
    assert legs == [{"amount_cents": -4000, "business_tag": "transfer"}, {"amount_cents": 4000, "business_tag": "transfer"}]


def test_superseded_bank_row_rematches(on):
    inbox = _inbox(on)
    _import(sf.main_files(inbox / "stripe"))
    pending = inbox / "pending.json"
    pending.write_text(json.dumps({"account_id": BANK, "date_from": "2026-09-01", "date_to": "2026-09-30", "transactions": [
        {"id": "bank-pend", "account_id": BANK, "date": "2026-09-08", "amount": "90.00", "name": "STRIPE TRANSFER", "pending": True}]}))
    _finance(pending)
    assert _payout("po_TEST0001")["matched_txn_id"] == "bank-pend"
    posted = inbox / "posted.json"
    posted.write_text(json.dumps({"account_id": BANK, "date_from": "2026-09-01", "date_to": "2026-09-30", "transactions": [
        {"id": "bank-post", "account_id": BANK, "date": "2026-09-08", "amount": "90.00", "name": "STRIPE TRANSFER ST-1", "pending": False}]}))
    _finance(posted)
    assert _payout("po_TEST0001")["matched_txn_id"] == "bank-post"
    assert _class("bank-post")["business_tag"] == "transfer"


# --- status, API, exports ------------------------------------------------------------------------


def test_status_json(on):
    inbox = _inbox(on)
    sf.main_files(inbox / "stripe")
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-08", 9000, "STRIPE TRANSFER ST-TEST0001")])
    run_cli(["import", str(inbox)])
    code, out, err = run_cli(["stripe", "status", "--json"])
    assert code == 0, err
    data = json.loads(out)
    main = data["accounts"][0]
    assert main["name"] == "main" and main["last_transaction"] == "2026-09-11" and main["transactions"] == 11
    assert main["ledger"]["activity_cents"] == sf.MAIN_NET
    assert main["payouts"]["matched"] == 1 and main["needs_review"] == 1
    code, out, _err = run_cli(["stripe", "status"])
    assert code == 0 and "Stripe (main, business branda, usd)" in out


def test_summary_figures(on):
    from hpbooks import stripe_reports as sr

    _import(sf.main_files(_inbox(on) / "stripe"))
    with connect() as conn:
        data = sr.summary(conn, "2026-09-01", "2026-09-30")
        branda = sr.summary(conn, "2026-09-01", "2026-09-30", business="consulting")
    totals = data["totals"]
    assert (totals["gross_cents"], totals["refunds_cents"], totals["disputes_cents"], totals["fees_cents"]) == (15000, 2000, 0, 900)
    assert totals["net_revenue_cents"] == 12100 and totals["fee_pct"] == 6.0
    assert totals["capital_repayments_cents"] == 800 and totals["payouts_cents"] == 9000
    assert data["months"] == [{"month": "2026-09", **totals}]
    assert data["accounts"][0]["needs_review"] == 1
    assert branda["accounts"][0]["name"] == "consult" and branda["totals"]["gross_cents"] == 0
    with pytest.raises(HpbooksError):
        with connect() as conn:
            sr.summary(conn, "2026-09-01", None)


def test_api_and_csv_exports(on):
    from hpbooks.web import create_app

    inbox = _inbox(on)
    sf.main_files(inbox / "stripe")
    sf.bank_feed(inbox / "bank.json", BANK, [("bank-po1", "2026-09-08", 9000, "STRIPE TRANSFER ST-TEST0001"),
                                              ("bank-x", "2026-09-20", 1234, "STRIPE TRANSFER ST-OTHER")])
    run_cli(["import", str(inbox)])
    client = create_app().test_client()
    config = client.get("/api/config").get_json()
    assert config["features"]["stripe"] is True and config["stripe_accounts"][0]["name"] == "main"
    summary = client.get("/api/stripe/summary?start=2026-09-01&end=2026-09-30").get_json()
    assert summary["ok"] and summary["ready"] and summary["totals"]["gross_cents"] == 15000
    assert summary["payouts"]["matched"] == 1 and summary["bank_only"] == 1 and summary["open_payouts"] == 0
    payouts = client.get("/api/stripe/payouts?start=2026-09-01&end=2026-09-30").get_json()
    assert payouts["rows"][0]["bank"]["txn_id"] == "bank-po1" and payouts["rows"][0]["bank"]["last4"] == "0101"
    assert [row["txn_id"] for row in payouts["bank_only"]] == ["bank-x"]
    assert client.get("/api/stripe/summary?business=nope").status_code == 400
    assert client.get("/api/stripe/summary?start=2026-09-01").status_code == 400
    assert client.get("/api/stripe/summary?account=nope").status_code == 400
    assert client.get("/api/stripe/nope").status_code == 404
    assert client.get("/api/stripe/summary?mode=personal").status_code == 404
    for table in ("summary", "accounts", "payouts", "bank-only"):
        response = client.get(f"/export/stripe/{table}.csv?start=2026-09-01&end=2026-09-30")
        assert response.status_code == 200 and response.mimetype == "text/csv", table
    text = client.get("/export/stripe/payouts.csv?start=2026-09-01&end=2026-09-30").get_data(as_text=True)
    assert text.splitlines()[0].startswith("account,payout,created,arrival,amount") and "po_TEST0001" in text
    assert client.get("/export/stripe/nope.csv").status_code == 404
    assert client.get("/stripe").status_code in (200, 503)


# --- direct API mode ----------------------------------------------------------------------------


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_opener(calls):
    rows = sf.main_transactions()
    pages = {"/v1/balance_transactions": [sf.page(rows[:6], has_more=True), sf.page(rows[6:])],
             "/v1/payouts": [sf.page([sf.payout("po_TEST0001", 9000, "2026-09-06", "2026-09-08")], url="/v1/payouts")]}

    def opener(request, timeout=None):
        from urllib.parse import parse_qs, urlparse

        url = urlparse(request.full_url)
        assert url.scheme == "https" and url.netloc == "api.stripe.com"
        calls.append((url.path, parse_qs(url.query), request.get_header("Authorization")))
        index = 1 if "starting_after" in parse_qs(url.query) else 0
        return _Response(json.dumps(pages[url.path][index]).encode())

    return opener


def _secret(db, mode=0o600, value="rk_live_TESTKEY000"):
    path = Path(os.environ["HPBOOKS_DB"]).parent / "stripe.secret"
    path.write_text(value + "\n")
    os.chmod(path, mode)
    return path


def test_sync_reads_restricted_key_and_imports(on):
    from hpbooks.stripe import sync

    cfg = hpconfig.get_config()
    hpconfig.override(stripe=hpconfig.replace(cfg.stripe, secret="stripe.secret"))
    _secret(on)
    calls: list = []
    with connect() as conn:
        result = sync(conn, date_from="2026-09-01", date_to="2026-09-30", account="main", inbox=on / "inbox",
                      today=date(2026, 9, 12), opener=_fake_opener(calls))
    paths = [Path(p).name for p in result["written"]]
    assert paths == ["main_1.json", "main_2.json", "main_payouts_1.json"]
    assert [c[0] for c in calls] == ["/v1/balance_transactions", "/v1/balance_transactions", "/v1/payouts"]
    assert calls[1][1]["starting_after"] == [sf.main_transactions()[5]["id"]]
    assert calls[0][1]["created[gte]"] == [str(sf.ts("2026-09-01", 0))] and calls[0][1]["limit"] == ["100"]
    assert all(c[2] == "Bearer rk_live_TESTKEY000" for c in calls)
    folder = on / "inbox" / "2026-09-12" / "stripe"
    for path in folder.iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
        assert "rk_live" not in path.read_text()
    saved = json.loads((folder / "main_1.json").read_text())
    assert saved["_query"]["stripe_account"] == sf.MAIN and saved["_query"]["livemode"] is True
    assert result["accounts"]["main"]["new"] == 11
    assert _payout("po_TEST0001")["arrival_date"] == "2026-09-08"


def test_sync_refuses_open_or_missing_key(on):
    from hpbooks.stripe import sync

    def boom(*_a, **_k):
        raise AssertionError("no request may be made")

    with connect() as conn:
        with pytest.raises(HpbooksError, match="needs \\[stripe\\] secret"):
            sync(conn, account="main", inbox=on / "inbox", opener=boom)
    cfg = hpconfig.get_config()
    hpconfig.override(stripe=hpconfig.replace(cfg.stripe, secret="stripe.secret"))
    with connect() as conn:
        with pytest.raises(HpbooksError, match="key file is missing"):
            sync(conn, account="main", inbox=on / "inbox", opener=boom)
    _secret(on, mode=0o644)
    with connect() as conn:
        with pytest.raises(HpbooksError, match="too open \\(644\\)"):
            sync(conn, account="main", inbox=on / "inbox", opener=boom)
    _secret(on, value="sk_live_TESTKEY000")
    with connect() as conn:
        with pytest.raises(HpbooksError, match="restricted key") as exc:
            sync(conn, account="main", inbox=on / "inbox", opener=boom)
    assert "TESTKEY" not in str(exc.value)
    _secret(on)
    with connect() as conn:
        with pytest.raises(HpbooksError, match="its own key file"):
            sync(conn, inbox=on / "inbox", opener=boom)  # both accounts would share one key
    code, out, err = run_cli(["stripe", "sync", "--account", "main", "--from", "2026-09-30", "--to", "2026-09-01", "--inbox", str(on / "inbox")])
    assert code == 1 and "--from must be on or before --to" in err and "TESTKEY" not in out + err
