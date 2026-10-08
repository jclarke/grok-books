"""Stripe business analytics (stripe_objects, stripe_metrics): import, privacy scrub, and every metric.

All data is synthetic (tests/stripe_fake.py): *_TEST ids, round amounts, "Plan A" names, and
PII-MARKER placeholders in the personal-data fields. Today is fixed at 2026-09-15, so the
default focus month is 2026-08.
"""

from __future__ import annotations

import json
import time
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
import stripe_fake as sf
from fake_accounts import BANK, REWARDS
from golden_fixture import run_cli, set_env

import hpbooks.config as hpconfig
from hpbooks.config import ConfigError, StripeCapital, StripeCogs, StripeMetricsConfig, build
from hpbooks.db import connect, init_db

TODAY = date(2026, 9, 15)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    set_env(monkeypatch, tmp_path)
    init_db()
    return tmp_path


@pytest.fixture()
def on(db):
    hpconfig.override(stripe_enabled=True)
    return db


def _folder(tmp: Path, day: str = "2026-09-15") -> Path:
    return tmp / "inbox" / day / "stripe"


def _import(paths, **kwargs):
    from hpbooks.stripe import import_files

    kwargs.setdefault("today", TODAY)
    with connect() as conn:
        return import_files(conn, [Path(p) for p in paths], **kwargs)


def _load(tmp: Path, book: sf.Book, day: str = "2026-09-15", **kwargs):
    return _import(book.write(_folder(tmp, day)), **kwargs)


def _metrics(**kwargs):
    from hpbooks import stripe_metrics as sm

    with connect(readonly=True) as conn:
        return sm.build(conn, today=TODAY, **kwargs)


def _metrics_cfg(**changes):
    cfg = hpconfig.get_config()
    return hpconfig.override(stripe=replace(cfg.stripe, metrics=replace(cfg.stripe.metrics, **changes)))


def _next(month: str) -> str:
    year, num = int(month[:4]), int(month[5:7])
    return f"{year + 1}-01" if num == 12 else f"{year}-{num + 1:02d}"


def _cycles(book: sf.Book, cus: str, sub: str, price_id: str, prod: str, amounts: dict[str, int], *, day: int = 1, status: str = "paid", attempts: int = 1):
    """One subscription_cycle invoice per month (period from `day` to the same day next month)."""
    for month, amount in amounts.items():
        start, end = f"{month}-{day:02d}", f"{_next(month)}-{day:02d}"
        book.add("invoices", sf.invoice(f"in_TEST{sub[-4:]}{month.replace('-', '')}", cus, sub, [sf.line(amount, price_id, prod, start, end)],
                                         day=start, status=status, attempts=attempts))


def _months(first: str, last: str) -> list[str]:
    out = [first]
    while out[-1] < last:
        out.append(_next(out[-1]))
    return out


PROD_A = "prod_TESTA"
PROD_B = "prod_TESTB"


# --- config ---------------------------------------------------------------------------------


CATEGORIES = {"revenue": ["Revenue - Sales"], "cogs": ["Hosting & Infrastructure"], "opex": ["Contractors", "Payment Processing Fees"]}


def test_metrics_config_parses_and_validates():
    metrics = {"cogs": [{"category": "Hosting & Infrastructure", "products": ["prod_TESTA"]}], "cogs_categories": ["Contractors"],
               "cac": 250.0, "spike_factor": 3, "spike_min": 20, "forecast_days": 60}
    cfg = build({"features": {"stripe": True}, "categories": CATEGORIES, "stripe": {"metrics": metrics}})
    m = cfg.stripe.metrics
    assert m.cogs == (StripeCogs("Hosting & Infrastructure", ("prod_TESTA",)),) and m.cogs_categories == ("Contractors",)
    assert (m.cac_cents, m.spike_factor, m.spike_min_cents, m.forecast_days) == (25000, 3.0, 2000, 60)
    assert build({}).stripe.metrics == StripeMetricsConfig()
    for bad, message in (
        ({"cogs": [{"category": "Nope"}]}, "not a category"),
        ({"cogs_categories": ["Revenue - Sales"]}, "must be an expense category"),
        ({"cac_category": "Nope"}, "not a category"),
        ({"cogs": [{"category": "Hosting & Infrastructure", "products": ["x"]}]}, "prod_"),
        ({"spike_factor": 1}, "more than 1"),
        ({"forecast_days": 2}, "7 to 365"),
        ({"cac": -1}, "must not be negative"),
        ([1], "must be a table"),
    ):
        with pytest.raises(ConfigError, match=message):
            build({"features": {"stripe": True}, "categories": CATEGORIES, "stripe": {"metrics": bad}})
    # Category names are only checked with the feature on.
    assert build({"categories": CATEGORIES, "stripe": {"metrics": {"cogs_categories": ["Nope"]}}}).stripe.metrics.cogs_categories == ("Nope",)


# --- import, freshness, privacy ------------------------------------------------------------------


def _basic_book(status: str = "active") -> sf.Book:
    book = sf.Book()
    p = sf.price("price_TESTA", PROD_A, 10000, nickname="Monthly A")
    book.add("products", sf.product(PROD_A, "Plan A"))
    book.add("prices", p)
    book.add("customers", sf.customer("cus_TEST0001"))
    reason = "cancellation_requested" if status == "canceled" else None
    book.add("subscriptions", sf.subscription("sub_TEST0001", "cus_TEST0001", [("si_TEST0001", p, 1)], status=status,
                                              canceled="2026-09-14" if status == "canceled" else None,
                                              ended="2026-09-14" if status == "canceled" else None, reason=reason))
    book.sale("cus_TEST0001", "sub_TEST0001", [sf.line(10000, "price_TESTA", PROD_A, "2026-09-01", "2026-10-01")], "2026-09-01", fee=320)
    return book


def _dump(conn) -> str:
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stripe_%'")]
    tables += ["transactions", "classifications", "audit_log"]
    return json.dumps({t: [dict(r) for r in conn.execute(f"SELECT * FROM {t}")] for t in tables})


def test_import_stores_whitelisted_fields_and_scrubs_files(on):
    paths = _basic_book().write(_folder(on))
    raw = {p.name: p.read_text() for p in paths}
    assert all(sf.PII in raw[f"main_{k}_1.json"] for k in ("customers", "invoices", "charges", "subscriptions"))
    result = _import(paths)
    objects = result["accounts"]["main"]["objects"]
    assert {k: v["new"] for k, v in objects.items()} == {
        "customers": 1, "products": 1, "prices": 1, "subscriptions": 1, "invoices": 1, "invoice_payments": 1, "charges": 1}
    assert len(result["scrubbed"]) == 4
    with connect() as conn:
        dump = _dump(conn)
        assert sf.PII not in dump and "invoice.invalid" not in dump and "receipt.invalid" not in dump
        # Business data stays: the product name, the price nickname, the charge's method.
        assert conn.execute("SELECT name FROM stripe_products").fetchone()[0] == "Plan A"
        assert conn.execute("SELECT nickname FROM stripe_prices").fetchone()[0] == "Monthly A"
        assert conn.execute("SELECT method FROM stripe_charges").fetchone()[0] == "card"
        cols = {r[1] for r in conn.execute("PRAGMA table_info(stripe_customers)")}
        assert cols == {"account", "id", "created_ts", "delinquent", "currency", "seen_on", "imported_at", "updated_at"}
    for path in paths:
        text = path.read_text()
        assert sf.PII not in text and "last4" not in text and "billing_details" not in text, path.name
    # Scrubbed files are still valid inputs, and give the same rows.
    again = _import(paths)["accounts"]["main"]["objects"]
    assert all(v["new"] == 0 and v["updated"] == 0 for v in again.values())
    assert _import(paths)["scrubbed"] == []


def test_keep_raw_and_dry_run_leave_files_alone(on):
    paths = _basic_book().write(_folder(on))
    before = {p: p.read_text() for p in paths}
    assert _import(paths, dry_run=True)["scrubbed"] == []
    assert _import(paths, keep_raw=True)["scrubbed"] == []
    assert {p: p.read_text() for p in paths} == before
    with connect() as conn:
        assert sf.PII not in _dump(conn)
    code, out, err = run_cli(["stripe", "import", str(_folder(on))])
    assert code == 0, err
    assert "scrubbed 4 file(s)" in out and "subscriptions: new=0 updated=0 unchanged=1" in out


def test_reimport_is_idempotent_newer_updates_older_is_ignored(on):
    first = _import(_basic_book().write(_folder(on, "2026-09-10")))["accounts"]["main"]["objects"]
    assert first["subscriptions"]["new"] == 1
    again = _import(_basic_book().write(_folder(on, "2026-09-10")))["accounts"]["main"]["objects"]
    assert all(v["new"] == 0 and v["updated"] == 0 for v in again.values())
    # A later pull: canceled.
    later = _import(_basic_book("canceled").write(_folder(on, "2026-09-15")))["accounts"]["main"]["objects"]
    assert later["subscriptions"]["updated"] == 1
    # An older folder imported afterwards never rolls it back.
    older = _import(_basic_book().write(_folder(on, "2026-09-01")))["accounts"]["main"]["objects"]
    assert older["subscriptions"]["stale"] == 1
    with connect() as conn:
        row = conn.execute("SELECT status, cancel_reason, seen_on FROM stripe_subscriptions").fetchone()
        assert tuple(row) == ("canceled", "cancellation_requested", "2026-09-15")
    # A changed quantity replaces the items.
    book = _basic_book("canceled")
    book.objects["subscriptions"][0]["items"]["data"][0]["quantity"] = 3
    stats = _import(book.write(_folder(on, "2026-09-16")))["accounts"]["main"]["objects"]
    assert stats["subscriptions"]["updated"] == 1
    with connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT id, quantity FROM stripe_subscription_items")] == [("si_TEST0001", 3)]


def test_kind_from_file_name_and_content_and_test_mode(on):
    from hpbooks.stripe import load_file

    folder = _folder(on)
    path = sf.write(folder, "main_invoice_payments_2.json", sf.object_page("invoice_payments", [sf.invoice_payment("inpay_TEST1", "in_TEST1", 100, "2026-09-01", pi="pi_TEST1")]))
    assert load_file(path)["kind"] == "invoice_payments" and load_file(path)["account"] == "main"
    odd = sf.write(folder, "main_7.json", {"object": "list", "data": [sf.product(PROD_A)], "has_more": False})
    assert load_file(odd)["kind"] == "products"
    test_mode = sf.write(folder, "main_customers_1.json", {"object": "list", "data": [dict(sf.customer("cus_TEST9"), livemode=False)]})
    result = _import([test_mode])
    assert "test-mode" in result["skipped_files"][0]["reason"] and result["scrubbed"] == []


# --- MRR -------------------------------------------------------------------------------------------


def test_mrr_normalization_discounts_metered_and_trials(on):
    book = sf.Book()
    book.add("products", sf.product(PROD_A, "Plan A"))
    cases = [
        # (price, quantity, discounts, status, trial)
        (sf.price("price_TESTM", PROD_A, 10000), 1, [], "active", None),  # 10,000
        (sf.price("price_TESTY", PROD_A, 120000, interval="year"), 1, [], "active", None),  # 10,000
        (sf.price("price_TESTW", PROD_A, 1000, interval="week"), 1, [], "active", None),  # 4,333.33
        (sf.price("price_TESTQ", PROD_A, 30000, count=3), 1, [], "active", None),  # 10,000
        (sf.price("price_TESTN", PROD_A, 1000), 3, [], "active", None),  # 3,000
        (sf.price("price_TESTP", PROD_A, 10000), 1, [sf.coupon_discount(percent=50)], "past_due", None),  # 5,000
        (sf.price("price_TESTO", PROD_A, 10000), 1, [sf.coupon_discount(amount=1000)], "active", None),  # 9,000
        (sf.price("price_TESTU", PROD_A, 10000), 1, [sf.coupon_discount(percent=50, duration="once")], "active", None),  # 10,000
        (sf.price("price_TESTX", PROD_A, 500, usage="metered"), 1, [], "active", None),  # usage, not MRR
        (sf.price("price_TESTT", PROD_A, 10000), 1, [], "trialing", ("2026-09-10", "2026-09-24")),  # trialing MRR
        (sf.price("price_TESTZ", PROD_A, 10000), 1, [], "unpaid", None),  # out of MRR, at risk
    ]
    for n, (p, qty, discounts, status, trial) in enumerate(cases):
        cus, sub = f"cus_TESTN{n:02d}", f"sub_TESTN{n:02d}"
        book.add("customers", sf.customer(cus))
        book.add("subscriptions", sf.subscription(sub, cus, [(f"si_TESTN{n:02d}", p, qty)], status=status, discounts=discounts, trial=trial,
                                                  start=trial[0] if trial else "2026-01-01"))
    _load(on, book)
    data = _metrics(month="2026-09")
    mrr = data["mrr"]
    assert mrr["mrr_cents"] == 10000 + 10000 + 4333 + 10000 + 3000 + 5000 + 9000 + 10000
    assert mrr["arr_cents"] == mrr["mrr_cents"] * 12
    assert mrr["trialing_mrr_cents"] == 10000
    assert mrr["customers"] == 8 and mrr["subscriptions"] == 8
    assert mrr["by_product"] == [{"product": PROD_A, "name": "Plan A", "mrr_cents": 61333, "share_pct": 100.0}]
    assert data["summary"]["mrr_cents"] == 61333 and data["summary"]["arpa_cents"] == 7667
    assert data["recovery"]["at_risk_mrr_cents"] == 15000  # past_due 5,000 + unpaid 10,000
    assert any(text.startswith("1 unpaid subscription(s) leave MRR") for text in data["approximations"])
    # Past months in the range have no invoices here, so they use the current items and say so.
    assert any("use the current items" in text for text in data["approximations"])


def _discount_sub(sub_id: str, cus: str, p: dict, discounts: list, item_discounts: list | None = None) -> dict:
    sub = sf.subscription(sub_id, cus, [(f"si_{sub_id[4:]}", p, 1)], discounts=discounts)
    sub["items"]["data"][0]["discounts"] = item_discounts or []
    return sub


def test_expanded_discount_shapes_and_id_only_fallback(on):
    """GetSubscriptions with expand ["data.discounts", "data.items.data.discounts"]: the current shape
    ({source: {coupon: {...}, type: "coupon"}}) and the older {coupon: {...}} both apply; discounts saved
    as ids only use the discounted share of the most recent paid invoice."""
    from hpbooks.stripe_objects import _discounts

    coupon = {"id": "co_TEST", "object": "coupon", "percent_off": 25.0, "amount_off": None, "currency": None, "duration": "forever",
              "duration_in_months": None, "name": "PII-MARKER-coupon", "metadata": {"x": "PII-MARKER"}}
    current = {"id": "di_TEST1", "object": "discount", "source": {"coupon": coupon, "type": "coupon"}, "start": sf.ts("2025-01-02"), "end": None,
               "customer": "cus_TEST", "subscription": "sub_TEST", "promotion_code": None}
    older = {"id": "di_TEST2", "object": "discount", "coupon": {**coupon, "percent_off": None, "amount_off": 1000, "currency": "usd"},
             "start": sf.ts("2025-01-02"), "end": None}
    unexpanded_coupon = {"id": "di_TEST3", "object": "discount", "source": {"coupon": "co_TEST", "type": "coupon"}, "start": sf.ts("2025-01-02")}
    assert _discounts([current]) == [{"coupon": "co_TEST", "percent_off": 25.0, "amount_off": None, "currency": None, "duration": "forever",
                                      "duration_in_months": None, "start": sf.ts("2025-01-02"), "end": None}]
    assert _discounts([older])[0]["amount_off"] == 1000
    assert _discounts(["di_TEST4", unexpanded_coupon]) == [{"id_only": True}, {"id_only": True, "coupon": "co_TEST", "start": sf.ts("2025-01-02"), "end": None}]

    book = sf.Book()
    book.add("products", sf.product(PROD_A, "Plan A"))
    p = sf.price("price_TESTD", PROD_A, 10000)
    book.add("subscriptions", _discount_sub("sub_TESTD1", "cus_TESTD1", p, [current]))  # 7,500
    book.add("subscriptions", _discount_sub("sub_TESTD2", "cus_TESTD2", p, [older]))  # 9,000
    book.add("subscriptions", _discount_sub("sub_TESTD3", "cus_TESTD3", p, [], item_discounts=[current]))  # item level: 7,500
    # Ids only, with a paid invoice: 10,000 less a 2,000 discount -> 80% -> 8,000. The newest paid invoice wins.
    book.add("subscriptions", _discount_sub("sub_TESTD4", "cus_TESTD4", p, ["di_TEST4"]))
    book.add("invoices", sf.invoice("in_TESTD4A", "cus_TESTD4", "sub_TESTD4", [sf.line(10000, "price_TESTD", PROD_A, "2026-07-01", "2026-08-01", discount=5000)], day="2026-07-01"))
    book.add("invoices", sf.invoice("in_TESTD4B", "cus_TESTD4", "sub_TESTD4", [sf.line(10000, "price_TESTD", PROD_A, "2026-08-01", "2026-09-01", discount=2000)], day="2026-08-01"))
    # Ids only on the item, no paid invoice: not applied (10,000), and said so.
    book.add("subscriptions", _discount_sub("sub_TESTD5", "cus_TESTD5", p, [], item_discounts=[unexpanded_coupon]))
    _load(on, book)
    with connect(readonly=True) as conn:
        stored = json.loads(conn.execute("SELECT discounts_json FROM stripe_subscription_items WHERE subscription = 'sub_TESTD3'").fetchone()[0])
        raw = conn.execute("SELECT discounts_json FROM stripe_subscriptions WHERE id = 'sub_TESTD1'").fetchone()[0]
    assert stored[0]["percent_off"] == 25.0 and "PII-MARKER" not in raw
    data = _metrics(month="2026-09")
    assert data["mrr"]["mrr_cents"] == 7500 + 9000 + 7500 + 8000 + 10000
    notes = data["approximations"]
    assert any(text.startswith("1 subscription(s) have discounts whose coupon is not imported") and "most recent paid invoice" in text for text in notes)
    assert any(text.startswith("1 subscription(s) have discounts whose coupon is not imported") and "not applied" in text for text in notes)
    # The forecast's renewals use the same discounts and ratio (no fees, everything collected).
    first = next(e for e in data["forecast"]["events"] if e["kind"] == "renewals")
    assert first["label"].startswith("Stripe renewals charged 2026-10-01 (5)") and first["cents"] == 7500 + 9000 + 7500 + 8000 + 10000


def test_coupons_import_whitelisted_and_scrubbed(on):
    book = sf.Book()
    book.add("coupons", sf.coupon("co_TESTP", percent=25))
    book.add("coupons", sf.coupon("co_TESTR", amount=1500, duration="repeating", months=3))
    paths = book.write(_folder(on))
    assert [p.name for p in paths] == ["main_coupons_1.json"] and sf.PII in paths[0].read_text()
    result = _import(paths)
    assert result["accounts"]["main"]["objects"]["coupons"]["new"] == 2 and len(result["scrubbed"]) == 1
    text = paths[0].read_text()
    assert sf.PII not in text and '"name"' not in text and "times_redeemed" not in text
    with connect() as conn:
        assert sf.PII not in _dump(conn)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(stripe_coupons)")}
        assert "name" not in cols and "metadata" not in cols
        rows = [dict(r) for r in conn.execute("SELECT id, percent_off, amount_off, currency, duration, duration_in_months, valid FROM stripe_coupons ORDER BY id")]
    assert rows == [
        {"id": "co_TESTP", "percent_off": 25.0, "amount_off": None, "currency": None, "duration": "forever", "duration_in_months": None, "valid": 1},
        {"id": "co_TESTR", "percent_off": None, "amount_off": 1500, "currency": "usd", "duration": "repeating", "duration_in_months": 3, "valid": 1},
    ]
    # The kind also comes from the list object and the URL.
    from hpbooks.stripe import load_file

    odd = sf.write(_folder(on), "main_9.json", {"object": "list", "data": [sf.coupon("co_TESTQ", percent=10)], "has_more": False})
    assert load_file(odd)["kind"] == "coupons"
    again = _import(paths)["accounts"]["main"]["objects"]["coupons"]
    assert again["unchanged"] == 2 and again["new"] == again["updated"] == 0


def test_coupon_ids_resolve_through_the_coupons_table(on):
    """expand data.discounts (current API): the discount's coupon is an id only, resolved through GetCoupons.
    Percent, amount (per billing period, made monthly, never below zero), once, repeating, forever, an explicit
    end, a 100%-off forever coupon (free: not a paying customer), and a coupon that is not imported."""
    book = sf.Book()
    book.add("products", sf.product(PROD_A, "Plan A"))
    for c in (
        sf.coupon("co_TESTPCT", percent=25),
        sf.coupon("co_TESTAMT", amount=12000),  # per year on a yearly price: 1,000 a month
        sf.coupon("co_TESTONCE", percent=50, duration="once"),
        sf.coupon("co_TESTREP", percent=50, duration="repeating", months=3),
        sf.coupon("co_TESTFREE", percent=100),
        sf.coupon("co_TESTBIG", amount=15000, duration="repeating", months=12),
    ):
        book.add("coupons", c)
    pm, py = sf.price("price_TESTCM", PROD_A, 10000), sf.price("price_TESTCY", PROD_A, 120000, interval="year")
    cases = [
        # (n, price, subscription discounts, item discounts)       MRR in 2026-09 / 2026-07
        (1, pm, [sf.id_discount("co_TESTPCT")], []),  # 7,500 / 7,500
        (2, py, [sf.id_discount("co_TESTAMT")], []),  # 10,000 - 1,000 = 9,000 / 9,000
        (3, pm, [sf.id_discount("co_TESTONCE")], []),  # once: 10,000 / 10,000
        (4, pm, [sf.id_discount("co_TESTREP", start="2026-08-01")], []),  # until 2026-11-01: 5,000 / not yet 10,000
        (5, pm, [sf.id_discount("co_TESTREP", start="2026-05-01")], []),  # ended 2026-08-01: 10,000 / 5,000
        (6, pm, [sf.id_discount("co_TESTFREE")], []),  # free: 0 / 0
        (7, pm, [], [sf.id_discount("co_TESTPCT")]),  # item level: 7,500 / 7,500
        (8, pm, [sf.id_discount("co_TESTBIG", start="2026-09-01")], []),  # 15,000 off 10,000: 0, not free / 10,000
        (9, pm, [sf.id_discount("co_TESTMISSING")], []),  # not imported: invoice share 70%: 7,000 / 7,000
        (10, pm, [sf.id_discount("co_TESTPCT", end="2026-09-01")], []),  # ended: 10,000 / 7,500
    ]
    for n, p, discounts, item_discounts in cases:
        book.add("subscriptions", _discount_sub(f"sub_TESTC{n:02d}", f"cus_TESTC{n:02d}", p, discounts, item_discounts))
    book.add("invoices", sf.invoice("in_TESTC09", "cus_TESTC09", "sub_TESTC09", [sf.line(10000, "price_TESTCM", PROD_A, "2026-09-01", "2026-10-01", discount=3000)],
                                    day="2026-09-01"))
    _load(on, book)
    with connect(readonly=True) as conn:
        stored = json.loads(conn.execute("SELECT discounts_json FROM stripe_subscriptions WHERE id = 'sub_TESTC01'").fetchone()[0])
    assert stored == [{"id_only": True, "coupon": "co_TESTPCT", "start": sf.ts("2025-01-02"), "end": None}]
    data = _metrics(month="2026-09")
    mrr = data["mrr"]
    assert mrr["mrr_cents"] == 7500 + 9000 + 10000 + 5000 + 10000 + 0 + 7500 + 0 + 7000 + 10000
    assert (mrr["customers"], mrr["subscriptions"], mrr["free_subscriptions"]) == (8, 8, 1)
    assert mrr["arpa_cents"] == 66000 // 8 and data["summary"]["free_subscriptions"] == 1
    months = {row["month"]: row for row in mrr["months"]}
    assert months["2026-07"]["mrr_cents"] == 7500 + 9000 + 10000 + 10000 + 5000 + 0 + 7500 + 10000 + 7000 + 7500
    assert (months["2026-07"]["customers"], months["2026-07"]["free_subscriptions"]) == (9, 1)
    # Churn denominators leave the free subscription out: 9 paying at the start of September, 1 lost (the 15,000-off coupon).
    churn = {row["month"]: row for row in data["churn"]["months"]}["2026-09"]
    assert (churn["start_customers"], churn["churned_customers"], churn["customer_churn_pct"]) == (9, 1, 11.11)
    # Cohorts: the free customer never joins one.
    cohorts = {c["cohort"]: c["customers"] for c in data["cohorts"]["cohorts"]}
    assert cohorts == {"2026-01": 8, "2026-09": 1}
    # Only the coupon that is not imported falls back to the invoice share.
    notes = data["approximations"]
    assert sum("whose coupon is not imported" in text for text in notes) == 1
    assert any(text.startswith("1 subscription(s) have discounts whose coupon is not imported") and "GetCoupons" in text for text in notes)
    # The forecast's renewals on 2026-10-01: one billing period less the same discounts; the zero ones are left out.
    first = next(e for e in data["forecast"]["events"] if e["kind"] == "renewals")
    assert first["label"].startswith("Stripe renewals charged 2026-10-01 (8)")
    assert first["cents"] == 7500 + 108000 + 10000 + 5000 + 10000 + 7500 + 7000 + 10000
    # Without the coupons file every one of them is unresolved.
    with connect() as conn:
        conn.execute("DELETE FROM stripe_coupons")
    notes = _metrics(month="2026-09")["approximations"]
    assert any(text.startswith("9 subscription(s) have discounts whose coupon is not imported") and "not applied" in text for text in notes)


def test_monthly_amount_and_allocate():
    from hpbooks.stripe_metrics import allocate, monthly_amount

    assert monthly_amount(120000, "year", 1) == 10000
    assert monthly_amount(30000, "month", 3) == 10000
    assert round(monthly_amount(1000, "week", 1), 2) == 4333.33
    assert round(monthly_amount(100, "day", 1), 2) == 3041.67
    assert round(monthly_amount(1000, "week", 2), 2) == 2166.67
    parts = allocate(10001, [("a", 1), ("b", 1), ("c", 1)])
    assert sum(parts.values()) == 10001 and sorted(parts.values()) == [3333, 3334, 3334]
    assert allocate(500, []) == {"Unattributed": 500}
    assert sum(allocate(1000, [("a", 1500), ("b", -500)]).values()) == 1000


def _movement_book() -> sf.Book:
    book = sf.Book()
    for prod, name in ((PROD_A, "Plan A"), (PROD_B, "Plan B")):
        book.add("products", sf.product(prod, name))
    pa, pa2 = sf.price("price_TESTA1", PROD_A, 10000), sf.price("price_TESTA2", PROD_A, 15000)
    pb, pb2 = sf.price("price_TESTB1", PROD_B, 20000), sf.price("price_TESTB2", PROD_B, 12000)
    pc, pd, pd2 = sf.price("price_TESTC1", PROD_A, 5000), sf.price("price_TESTD1", PROD_A, 7000), sf.price("price_TESTD2", PROD_A, 8000)
    for p in (pa, pa2, pb, pb2, pc, pd, pd2):
        book.add("prices", p)
    # A: 10,000 from January, 15,000 from May (expansion).
    book.add("subscriptions", sf.subscription("sub_TESTA", "cus_TESTA", [("si_TESTA", pa2, 1)]))
    _cycles(book, "cus_TESTA", "sub_TESTA", "price_TESTA1", PROD_A, {m: 10000 for m in _months("2026-01", "2026-04")})
    _cycles(book, "cus_TESTA", "sub_TESTA", "price_TESTA2", PROD_A, {m: 15000 for m in _months("2026-05", "2026-09")})
    # B: 20,000 from February, 12,000 from June (contraction).
    book.add("subscriptions", sf.subscription("sub_TESTB", "cus_TESTB", [("si_TESTB", pb2, 1)], start="2026-02-01"))
    _cycles(book, "cus_TESTB", "sub_TESTB", "price_TESTB1", PROD_B, {m: 20000 for m in _months("2026-02", "2026-05")})
    _cycles(book, "cus_TESTB", "sub_TESTB", "price_TESTB2", PROD_B, {m: 12000 for m in _months("2026-06", "2026-09")})
    # C: 5,000 from March, canceled by the customer on June 10 (voluntary churn in June).
    book.add("subscriptions", sf.subscription("sub_TESTC", "cus_TESTC", [("si_TESTC", pc, 1)], status="canceled", start="2026-03-01",
                                              period=("2026-06-01", "2026-07-01"), canceled="2026-06-10", ended="2026-06-10", reason="cancellation_requested"))
    _cycles(book, "cus_TESTC", "sub_TESTC", "price_TESTC1", PROD_A, {m: 5000 for m in _months("2026-03", "2026-06")})
    # D: 7,000 January and February, ended March 5 after failed payments (involuntary), back in June at 8,000.
    book.add("subscriptions", sf.subscription("sub_TESTD1", "cus_TESTD", [("si_TESTD1", pd, 1)], status="canceled", start="2026-01-01",
                                              period=("2026-03-01", "2026-04-01"), canceled="2026-03-05", ended="2026-03-05", reason="payment_failed"))
    _cycles(book, "cus_TESTD", "sub_TESTD1", "price_TESTD1", PROD_A, {m: 7000 for m in ("2026-01", "2026-02")})
    _cycles(book, "cus_TESTD", "sub_TESTD1", "price_TESTD1", PROD_A, {"2026-03": 7000}, status="uncollectible", attempts=4)
    book.add("subscriptions", sf.subscription("sub_TESTD2", "cus_TESTD", [("si_TESTD2", pd2, 1)], start="2026-06-03", period=("2026-09-03", "2026-10-03")))
    _cycles(book, "cus_TESTD", "sub_TESTD2", "price_TESTD2", PROD_A, {m: 8000 for m in _months("2026-06", "2026-09")}, day=3)
    return book


def test_movement_bridge_reconciles_and_churn_split(on):
    _load(on, _movement_book())
    data = _metrics(start="2026-01-01", end="2026-08-31", month="2026-06")
    months = {row["month"]: row for row in data["mrr"]["months"]}
    assert [months[m]["mrr_cents"] for m in _months("2026-01", "2026-08")] == [17000, 37000, 35000, 35000, 40000, 35000, 35000, 35000]
    for row in months.values():
        assert row["opening_cents"] + row["new_cents"] + row["reactivated_cents"] + row["expansion_cents"] - row["contraction_cents"] - row["churned_cents"] == row["closing_cents"]
    assert (months["2026-01"]["new_cents"], months["2026-01"]["new_customers"]) == (17000, 2)
    assert months["2026-02"]["new_cents"] == 20000
    assert (months["2026-03"]["new_cents"], months["2026-03"]["churned_cents"]) == (5000, 7000)
    assert months["2026-05"]["expansion_cents"] == 5000
    bridge = data["mrr"]["bridge"]
    assert {k: bridge[k] for k in ("opening_cents", "new_cents", "reactivated_cents", "expansion_cents", "contraction_cents", "churned_cents", "closing_cents")} == {
        "opening_cents": 40000, "new_cents": 0, "reactivated_cents": 8000, "expansion_cents": 0, "contraction_cents": 8000, "churned_cents": 5000, "closing_cents": 35000}
    assert bridge["reconciles"] is True
    churn = {row["month"]: row for row in data["churn"]["months"]}
    march, june = churn["2026-03"], churn["2026-06"]
    assert (march["churned_customers"], march["involuntary_customers"], march["voluntary_customers"], march["involuntary_mrr_cents"]) == (1, 1, 0, 7000)
    assert (june["churned_customers"], june["voluntary_customers"], june["involuntary_customers"]) == (1, 1, 0)
    assert june["customer_churn_pct"] == 33.33
    assert june["gross_revenue_churn_pct"] == 32.5 and june["net_revenue_churn_pct"] == 32.5
    assert june["nrr_pct"] == 67.5 and june["grr_pct"] == 67.5
    assert churn["2026-05"]["net_revenue_churn_pct"] == -14.29 and churn["2026-05"]["nrr_pct"] == 114.29
    # History came from invoices, so nothing was approximated for these months.
    assert not any("current items" in text for text in data["approximations"])
    # The CLI default prints the KPI summary and this bridge.
    code, out, err = run_cli(["stripe", "metrics", "--month", "2026-06"])
    assert code == 0, err
    assert "MRR movement, 2026-06" in out and "+ Reactivated" in out and "35,000.00" not in out  # cents are shown as dollars
    assert "350.00" in out and "400.00" in out


def test_nrr_grr_trailing_twelve_months(on):
    book = sf.Book()
    px, py, pz = sf.price("price_TESTX", PROD_A, 15000), sf.price("price_TESTY", PROD_A, 10000), sf.price("price_TESTZ", PROD_A, 5000)
    book.add("subscriptions", sf.subscription("sub_TESTX", "cus_TESTX", [("si_TESTX", px, 1)], start="2025-06-01", period=("2026-08-01", "2026-09-01")))
    _cycles(book, "cus_TESTX", "sub_TESTX", "price_TESTX0", PROD_A, {"2025-08": 10000})
    book.add("subscriptions", sf.subscription("sub_TESTY", "cus_TESTY", [("si_TESTY", py, 1)], status="canceled", start="2025-06-01",
                                              period=("2026-01-01", "2026-02-01"), canceled="2026-01-15", ended="2026-01-15", reason="cancellation_requested"))
    _cycles(book, "cus_TESTY", "sub_TESTY", "price_TESTY", PROD_A, {"2025-08": 10000})
    book.add("subscriptions", sf.subscription("sub_TESTZ", "cus_TESTZ", [("si_TESTZ", pz, 1)], start="2026-03-01", period=("2026-08-01", "2026-09-01")))
    _load(on, book)
    data = _metrics(month="2026-08")
    assert data["churn"]["nrr_t12m_pct"] == 75.0 and data["churn"]["grr_t12m_pct"] == 50.0
    assert data["summary"]["nrr_t12m_pct"] == 75.0


def test_cohorts_by_first_paid_invoice(on):
    book = sf.Book()
    p = sf.price("price_TESTK", PROD_A, 10000)
    book.add("subscriptions", sf.subscription("sub_TESTK1", "cus_TESTK1", [("si_TESTK1", p, 1)], period=("2026-09-01", "2026-10-01")))
    _cycles(book, "cus_TESTK1", "sub_TESTK1", "price_TESTK", PROD_A, {m: 10000 for m in _months("2026-01", "2026-08")})
    book.add("subscriptions", sf.subscription("sub_TESTK2", "cus_TESTK2", [("si_TESTK2", p, 1)], status="canceled", period=("2026-02-01", "2026-03-01"),
                                              canceled="2026-03-10", ended="2026-03-10", reason="cancellation_requested"))
    _cycles(book, "cus_TESTK2", "sub_TESTK2", "price_TESTK", PROD_A, {m: 10000 for m in ("2026-01", "2026-02")})
    book.add("subscriptions", sf.subscription("sub_TESTK3", "cus_TESTK3", [("si_TESTK3", p, 1)], start="2026-02-01", period=("2026-09-01", "2026-10-01")))
    _cycles(book, "cus_TESTK3", "sub_TESTK3", "price_TESTK", PROD_A, {m: 10000 for m in _months("2026-02", "2026-08")})
    _load(on, book)
    data = _metrics(start="2026-01-01", end="2026-03-31", month="2026-03")
    cohorts = {c["cohort"]: c for c in data["cohorts"]["cohorts"]}
    jan = cohorts["2026-01"]
    assert jan["customers"] == 2
    assert [(c["k"], c["customers"], c["customers_pct"], c["revenue_cents"], c["revenue_pct"]) for c in jan["retention"]] == [
        (0, 2, 100.0, 20000, 100.0), (1, 2, 100.0, 20000, 100.0), (2, 1, 50.0, 10000, 50.0)]
    assert cohorts["2026-02"]["customers"] == 1 and len(cohorts["2026-02"]["retention"]) == 2
    assert data["cohorts"]["max_k"] == 2


# --- revenue: margin, fees, linking ----------------------------------------------------------------


def _with_capital(principal: int, fee: int):
    cfg = hpconfig.get_config()
    entry = StripeCapital(account="main", principal_cents=principal, fee_cents=fee, financing=sf.LOAN)
    return hpconfig.override(stripe=replace(cfg.stripe, capital=(entry,)))


def test_margin_with_fees_refunds_disputes_capfee_and_cogs(on):
    from hpbooks.classify import classify_manual

    _with_capital(1_000_000, 100_000)
    _metrics_cfg(cogs=(StripeCogs("Hosting & Infrastructure", (PROD_A,)),))
    book = sf.Book()
    book.add("products", sf.product(PROD_A, "Plan A"))
    book.add("products", sf.product(PROD_B, "Plan B"))
    book.sale("cus_TEST1", "sub_TEST1", [sf.line(6000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01"),
                                         sf.line(4000, "price_TESTB", PROD_B, "2026-08-01", "2026-09-01")], "2026-08-03", fee=320)
    book.sale("cus_TEST2", "sub_TEST2", [sf.line(5000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")], "2026-08-04", fee=175,
              link="charge", refund=1000, refund_day="2026-08-10")
    book.sale("cus_TEST3", "sub_TEST3", [sf.line(2000, "price_TESTB", PROD_B, "2026-08-01", "2026-09-01")], "2026-08-05", fee=88,
              link="legacy", dispute_day="2026-08-12")
    book.btx.append(sf.btx("txn_TESTLOOSE", "charge", 3000, "2026-08-06", fee=117, source="ch_TESTNOTPULLED"))
    book.btx.append(sf.btx("txn_TESTFEE", "stripe_fee", -500, "2026-08-07", description="Billing - Usage Fee"))
    book.btx.append(sf.capital_payout("txn_TESTCAPIN", 1_000_000, "2026-08-02"))
    book.btx.append(sf.paydown("txn_TESTCAPPD", 110_000, "2026-08-20"))
    _load(on, book)
    sf.bank_feed(on / "bank" / "bank.json", BANK, [("bank-host1", "2026-08-15", -4000, "ZZZ RACK SPACE")], date_from="2026-08-01", date_to="2026-08-31")
    code, _out, err = run_cli(["import", str(on / "bank" / "bank.json")])
    assert code == 0, err
    with connect() as conn:
        classify_manual(conn, "bank-host1", "branda", "Hosting & Infrastructure", "rack")
    data = _metrics()
    margin = data["margin"]
    rows = {r["product"]: r for r in margin["products"]}
    assert {p: (r["gross_cents"], r["fees_cents"], r["refunds_cents"], r["disputes_cents"], r["capital_fees_cents"], r["cogs_cents"], r["margin_cents"])
            for p, r in rows.items()} == {
        PROD_A: (11000, 367, 1000, 0, 5500, 4000, 133),
        PROD_B: (6000, 1716, 0, 2000, 3000, 0, -716),
        "Unattributed": (3000, 617, 0, 0, 1500, 0, 883),
    }
    assert rows[PROD_A]["name"] == "Plan A" and rows[PROD_A]["revenue_share_pct"] == 55.0
    assert margin["totals"]["margin_cents"] == 300 and margin["totals"]["margin_pct"] == 1.5
    assert margin["links"] == {"invoice_payment": 2, "legacy": 1, "heuristic": 0, "unlinked": 0}
    assert margin["cogs"] == [{"month": "2026-08", "category": "Hosting & Infrastructure", "cents": 4000, "products": [PROD_A]}]
    august = next(m for m in margin["months"] if m["month"] == "2026-08")
    assert august["margin_cents"] == 300
    # The same figures through cogs_categories (allocated by revenue share instead).
    _metrics_cfg(cogs=(), cogs_categories=("Hosting & Infrastructure",))
    rows = {r["product"]: r for r in _metrics()["margin"]["products"]}
    assert (rows[PROD_A]["cogs_cents"], rows[PROD_B]["cogs_cents"], rows["Unattributed"]["cogs_cents"]) == (2200, 1200, 600)


def test_heuristic_link_and_ambiguity(on):
    book = sf.Book()
    l1 = sf.line(5000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")
    book.add("invoices", sf.invoice("in_TESTH1", "cus_TESTH", "sub_TESTH", [l1], day="2026-08-01", paid="2026-08-02"))
    book.add("charges", sf.charge_obj("ch_TESTH1", 5000, "2026-08-03", customer_id="cus_TESTH", btx_id="txn_TESTH1"))
    book.btx.append(sf.btx("txn_TESTH1", "charge", 5000, "2026-08-03", fee=175, source="ch_TESTH1"))
    # Two invoices of the same amount for another customer: not linked.
    for n in (1, 2):
        book.add("invoices", sf.invoice(f"in_TESTG{n}", "cus_TESTG", "sub_TESTG", [sf.line(3000, "price_TESTB", PROD_B, "2026-08-01", "2026-09-01")], day="2026-08-01"))
    book.add("charges", sf.charge_obj("ch_TESTG1", 3000, "2026-08-01", customer_id="cus_TESTG", btx_id="txn_TESTG1"))
    book.btx.append(sf.btx("txn_TESTG1", "charge", 3000, "2026-08-01", fee=117, source="ch_TESTG1"))
    _load(on, book)
    data = _metrics()
    assert data["margin"]["links"] == {"invoice_payment": 0, "legacy": 0, "heuristic": 1, "unlinked": 1}
    rows = {r["product"]: r["gross_cents"] for r in data["margin"]["products"]}
    assert rows == {PROD_A: 5000, "Unattributed": 3000}
    assert any("within 2 days" in text for text in data["approximations"])


def test_fee_rate_by_method_and_ach_savings_cap(on):
    book = sf.Book()
    lines = lambda amount: [sf.line(amount, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")]  # noqa: E731
    book.sale("cus_TEST1", None, lines(10000), "2026-08-03", fee=320, method="card")
    book.sale("cus_TEST2", None, lines(20000), "2026-08-04", fee=600, method="link")
    book.sale("cus_TEST3", None, lines(100000), "2026-08-05", fee=500, method="us_bank_account")
    book.sale("cus_TEST4", None, lines(10000), "2026-08-06", fee=80, method="us_bank_account")
    book.sale("cus_TEST5", None, lines(10000), "2026-07-06", fee=290, method="cashapp")
    _load(on, book)
    fees = _metrics()["fees"]
    rng = fees["range"]
    assert (rng["card"]["rate_pct"], rng["link"]["rate_pct"], rng["ach"]["rate_pct"], rng["other"]["rate_pct"]) == (3.2, 3.0, 0.527, 2.9)
    assert rng["total"]["fees_cents"] == 1790 and rng["total"]["gross_cents"] == 150000
    august = next(m for m in fees["months"] if m["month"] == "2026-08")
    assert august["ach"]["count"] == 2 and august["other"]["count"] == 0
    ach = fees["ach_savings"]
    assert ach["ach_rate_source"] == "observed" and ach["card_link_volume_cents"] == 30000 and ach["card_link_fees_cents"] == 920
    assert ach["estimated_ach_fees_cents"] == 53 + 105 and ach["estimated_savings_cents"] == 920 - 158 and ach["estimate"] is True


def test_ach_savings_uses_stripe_pricing_with_the_cap(on):
    book = sf.Book()
    book.sale("cus_TEST1", None, [sf.line(100000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")], "2026-08-03", fee=2930)
    book.sale("cus_TEST2", None, [sf.line(10000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")], "2026-08-04", fee=320)
    _load(on, book)
    ach = _metrics()["fees"]["ach_savings"]
    assert ach["ach_rate_source"] == "stripe_pricing" and ach["ach_rate_pct"] == 0.8
    # 0.8% of $1,000 is $8, capped at $5; 0.8% of $100 is $0.80.
    assert ach["estimated_ach_fees_cents"] == 500 + 80
    assert ach["estimated_savings_cents"] == 2930 + 320 - 580


# --- Capital ---------------------------------------------------------------------------------------


def test_capital_apr_hand_checked(on):
    _with_capital(1_000_000, 100_000)
    book = sf.Book()
    book.btx.append(sf.capital_payout("txn_TESTCAP0", 1_000_000, "2025-01-02"))
    book.btx.append(sf.paydown("txn_TESTCAP1", 1_100_000, "2026-01-02"))
    _load(on, book)
    fin = _metrics()["capital"]["financings"][0]
    # One repayment of principal x 1.10 a year (365 days) later: (1 + r) ** 365 = 1.1.
    assert fin["effective_annual_pct"] == 10.0
    assert fin["apr_pct"] == round(365 * (1.1 ** (1 / 365) - 1) * 100, 2) == 9.53
    assert fin["remaining_cents"] == 0 and fin["projected"] is False and fin["days"] == 365


def test_capital_apr_projects_the_rest_and_irr():
    from hpbooks.stripe_metrics import irr_daily

    # 10,000 now, 30 payments of 400 a day: the daily rate solves the same equation.
    flows = [(0, 10000.0)] + [(d, -400.0) for d in range(1, 31)]
    rate = irr_daily(flows)
    assert abs(sum(a / (1 + rate) ** d for d, a in flows)) < 1e-6
    assert irr_daily([(0, 100.0)]) is None


def test_capital_withheld_share_without_terms(on):
    book = sf.Book()
    book.btx.append(sf.capital_payout("txn_TESTCAP0", 50_000, "2026-08-01"))
    book.sale("cus_TEST1", None, [sf.line(10000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")], "2026-08-10", fee=300)
    book.sale("cus_TEST2", None, [sf.line(20000, "price_TESTA", PROD_A, "2026-08-01", "2026-09-01")], "2026-08-11", fee=600)
    book.btx.append(sf.paydown("txn_TESTPD1", 1000, "2026-08-10"))
    book.btx.append(sf.paydown("txn_TESTPD2", 1000, "2026-08-11"))
    _load(on, book)
    capital = _metrics()["capital"]
    fin = capital["financings"][0]
    assert fin["apr_pct"] is None and "APR unknown" in fin["note"]
    withheld = capital["withheld"]
    assert withheld["avg_daily_share_pct"] == 7.5 and withheld["days"] == 2
    assert withheld["months"] == [{"month": "2026-08", "gross_cents": 30000, "withheld_cents": 2000, "share_pct": 6.67}]
    assert withheld["avg_monthly_share_pct"] == 6.67


def test_capital_withheld_share_starts_with_the_loan(on):
    """Months before the financing payout are left out, the first month counts sales from the payout
    day, and the monthly average is over the active months only."""
    book = sf.Book()
    for day in ("2026-04-10", "2026-05-10", "2026-06-10"):  # before the loan: no row, no 0% dragging the average down
        book.sale("cus_TEST1", None, [sf.line(10000, "price_TESTA", PROD_A, day, day)], day)
    book.btx.append(sf.capital_payout("txn_TESTCAP0", 50_000, "2026-06-15"))
    book.sale("cus_TEST1", None, [sf.line(20000, "price_TESTA", PROD_A, "2026-06-20", "2026-06-20")], "2026-06-20")
    book.btx.append(sf.paydown("txn_TESTPD1", 2000, "2026-06-20"))
    book.sale("cus_TEST1", None, [sf.line(40000, "price_TESTA", PROD_A, "2026-07-20", "2026-07-20")], "2026-07-20")
    book.btx.append(sf.paydown("txn_TESTPD2", 8000, "2026-07-20"))
    _load(on, book)
    withheld = _metrics()["capital"]["withheld"]
    assert withheld["start_date"] == "2026-06-15"
    # June counts only the sales from the 15th (20,000, not 30,000); August is active (the loan is still owed) with no sales.
    assert withheld["months"] == [
        {"month": "2026-06", "gross_cents": 20000, "withheld_cents": 2000, "share_pct": 10.0},
        {"month": "2026-07", "gross_cents": 40000, "withheld_cents": 8000, "share_pct": 20.0},
    ]
    assert withheld["active_months"] == 2 and withheld["avg_monthly_share_pct"] == 15.0
    assert withheld["avg_daily_share_pct"] == 15.0


def test_capital_withheld_share_from_the_first_paydown_without_proceeds(on):
    book = sf.Book()
    book.sale("cus_TEST1", None, [sf.line(10000, "price_TESTA", PROD_A, "2026-05-01", "2026-05-01")], "2026-05-01")
    book.sale("cus_TEST1", None, [sf.line(10000, "price_TESTA", PROD_A, "2026-07-01", "2026-07-01")], "2026-07-01")
    book.btx.append(sf.paydown("txn_TESTPD1", 1000, "2026-07-01"))
    _load(on, book)
    withheld = _metrics()["capital"]["withheld"]
    assert withheld["start_date"] == "2026-07-01"
    assert [r["month"] for r in withheld["months"]] == ["2026-07"]
    assert withheld["avg_monthly_share_pct"] == 10.0


# --- LTV, concentration, recovery, refunds --------------------------------------------------------------


def _steady_book() -> sf.Book:
    book = sf.Book()
    p = sf.price("price_TESTS", PROD_A, 10000)
    book.add("subscriptions", sf.subscription("sub_TESTS", "cus_TESTS", [("si_TESTS", p, 1)], period=("2026-09-01", "2026-10-01")))
    for month in _months("2026-01", "2026-08"):
        book.sale("cus_TESTS", "sub_TESTS", [sf.line(10000, "price_TESTS", PROD_A, f"{month}-01", f"{_next(month)}-01")], f"{month}-01", fee=300)
    return book


def test_ltv_with_zero_churn_is_capped_and_flagged(on):
    _load(on, _steady_book())
    ltv = _metrics()["ltv"]
    assert ltv["arpa_cents"] == 10000 and ltv["gross_margin_pct"] == 97.0
    assert ltv["churn_capped"] is True and ltv["lifetime_months"] == 60.0
    assert ltv["ltv_cents"] == 10000 * 97 * 60 // 100
    assert ltv["payback_months"] is None and any("payback omitted" in n for n in ltv["notes"])
    _metrics_cfg(cac_cents=100_000)
    ltv = _metrics()["ltv"]
    assert ltv["cac_source"] == "config" and ltv["payback_months"] == round(100_000 / 9700, 1)


def test_concentration_and_hhi(on):
    book = sf.Book()
    for n, amount in enumerate((50000, 30000, 20000)):
        cus = f"cus_TESTC{n}"
        book.add("charges", sf.charge_obj(f"ch_TESTC{n}", amount, "2026-05-10", customer_id=cus, btx_id=f"txn_TESTC{n}"))
        book.btx.append(sf.btx(f"txn_TESTC{n}", "charge", amount, "2026-05-10", fee=0, source=f"ch_TESTC{n}"))
    _load(on, book)
    c = _metrics()["concentration"]
    assert (c["top1_pct"], c["top5_pct"], c["top10_pct"], c["hhi"], c["customers"]) == (50.0, 100.0, 100.0, 3800.0, 3)
    assert [r["customer"] for r in c["top"]] == ["cus_TESTC0", "cus_TESTC1", "cus_TESTC2"]
    assert set(c["top"][0]) == {"rank", "customer", "revenue_cents", "share_pct"}


def test_failed_payment_recovery(on):
    book = sf.Book()
    p, p5 = sf.price("price_TESTR", PROD_A, 10000), sf.price("price_TESTR5", PROD_A, 5000)
    book.add("subscriptions", sf.subscription("sub_TESTR1", "cus_TESTR1", [("si_TESTR1", p, 1)], status="past_due"))
    book.add("subscriptions", sf.subscription("sub_TESTR2", "cus_TESTR2", [("si_TESTR2", p5, 1)], status="unpaid"))
    book.add("subscriptions", sf.subscription("sub_TESTR4", "cus_TESTR4", [("si_TESTR4", p, 1)], status="canceled", canceled="2026-08-25",
                                              ended="2026-08-25", reason="payment_failed"))
    ln = lambda amount: [sf.line(amount, "price_TESTR", PROD_A, "2026-08-01", "2026-09-01")]  # noqa: E731
    book.add("invoices", sf.invoice("in_TESTR1", "cus_TESTR1", "sub_TESTR1", ln(10000), day="2026-08-01", attempts=3))  # recovered
    book.add("invoices", sf.invoice("in_TESTR2", "cus_TESTR2", "sub_TESTR2", ln(5000), day="2026-08-02", status="uncollectible", attempts=4))  # lost
    book.add("invoices", sf.invoice("in_TESTR3", "cus_TESTR1", "sub_TESTR1", ln(2000), day="2026-08-20", status="open", attempts=1))  # still open
    book.add("invoices", sf.invoice("in_TESTR4", "cus_TESTR4", "sub_TESTR4", ln(3000), day="2026-08-05", status="open", attempts=2))  # lost
    book.add("invoices", sf.invoice("in_TESTR5", "cus_TESTR1", "sub_TESTR1", ln(10000), day="2026-07-01", attempts=1))  # paid first time
    book.add("charges", sf.charge_obj("ch_TESTF1", 10000, "2026-08-01", customer_id="cus_TESTR1", status="failed", failure="card_declined"))
    book.add("charges", sf.charge_obj("ch_TESTF2", 5000, "2026-08-02", customer_id="cus_TESTR2", status="failed", failure="insufficient_funds"))
    _load(on, book)
    rec = _metrics()["recovery"]
    aug = next(r for r in rec["months"] if r["month"] == "2026-08")
    assert (aug["failed_charges"], aug["failed_cents"]) == (2, 15000)
    assert (aug["dunning_invoices"], aug["recovered_cents"], aug["lost_cents"], aug["open_cents"]) == (4, 10000, 8000, 2000)
    assert aug["recovery_rate_pct"] == 55.56
    july = next(r for r in rec["months"] if r["month"] == "2026-07")
    assert july["dunning_invoices"] == 0
    assert rec["at_risk_mrr_cents"] == 15000 and rec["at_risk_subscriptions"] == 2
    # Collection rate (forecast): due 10,000 + 5,000 + 3,000 + 10,000, collected 20,000.
    assert rec["collection_rate_pct"] == round(20000 * 100 / 28000, 2)


def test_recovery_leaves_invoices_still_in_dunning_out_of_the_rate(on):
    """An open invoice with a retry scheduled (next_payment_attempt today or later) is in progress:
    not recovered, not lost, and not in the rate's denominator. One whose retries ended stays open."""
    book = sf.Book()
    p = sf.price("price_TESTR", PROD_A, 10000)
    book.add("subscriptions", sf.subscription("sub_TESTR1", "cus_TESTR1", [("si_TESTR1", p, 1)], status="past_due"))
    book.add("subscriptions", sf.subscription("sub_TESTR4", "cus_TESTR4", [("si_TESTR4", p, 1)], status="canceled", canceled="2026-08-25",
                                              ended="2026-08-25", reason="payment_failed"))
    ln = lambda amount: [sf.line(amount, "price_TESTR", PROD_A, "2026-08-01", "2026-09-01")]  # noqa: E731
    book.add("invoices", sf.invoice("in_TESTR1", "cus_TESTR1", "sub_TESTR1", ln(10000), day="2026-08-01", attempts=3))  # recovered
    retrying = sf.invoice("in_TESTR2", "cus_TESTR1", "sub_TESTR1", ln(4000), day="2026-08-10", status="open", attempts=2)
    retrying["next_payment_attempt"] = sf.ts("2026-09-18")  # Stripe retries in three days
    book.add("invoices", retrying)
    retry_today = sf.invoice("in_TESTR3", "cus_TESTR1", "sub_TESTR1", ln(1000), day="2026-08-12", status="open", attempts=1)
    retry_today["next_payment_attempt"] = sf.ts("2026-09-15", 18)
    book.add("invoices", retry_today)
    stalled = sf.invoice("in_TESTR5", "cus_TESTR1", "sub_TESTR1", ln(500), day="2026-08-14", status="open", attempts=4)
    stalled["next_payment_attempt"] = sf.ts("2026-09-01")  # in the past: no retry left
    book.add("invoices", stalled)
    lost = sf.invoice("in_TESTR4", "cus_TESTR4", "sub_TESTR4", ln(3000), day="2026-08-05", status="open", attempts=2)
    book.add("invoices", lost)
    _load(on, book)
    rec = _metrics()["recovery"]
    aug = next(r for r in rec["months"] if r["month"] == "2026-08")
    assert (aug["recovered_cents"], aug["lost_cents"]) == (10000, 3000)
    assert (aug["in_progress_invoices"], aug["in_progress_cents"]) == (2, 5000)
    assert (aug["open_invoices"], aug["open_cents"]) == (1, 500)
    assert aug["dunning_invoices"] == 5
    assert aug["recovery_rate_pct"] == round(10000 * 100 / 13000, 2)
    assert rec["totals"]["in_progress_cents"] == 5000 and rec["totals"]["recovery_rate_pct"] == aug["recovery_rate_pct"]
    # In-progress invoices are not "due" for the forecast's collection rate either.
    assert rec["collection_rate_pct"] == round(10000 * 100 / 13000, 2)
    from hpbooks import stripe_metrics as sm

    cols, rows = sm.table("recovery", {"recovery": rec})
    assert ("In progress", sm.MONEY) in cols and [r for r in rows if r[0] == "2026-08"][0][cols.index(("In progress", sm.MONEY))] == 5000


def test_refund_spike_flag(on):
    book = sf.Book()
    book.add("products", sf.product(PROD_A, "Plan A"))
    book.add("products", sf.product(PROD_B, "Plan B"))
    for month in _months("2026-02", "2026-08"):
        last = month == "2026-08"
        book.sale("cus_TESTS1", None, [sf.line(100000, "price_TESTA", PROD_A, f"{month}-01", f"{_next(month)}-01")], f"{month}-05",
                  refund=10000 if last else 1000, refund_day=f"{month}-20")
        book.sale("cus_TESTS2", None, [sf.line(10000, "price_TESTB", PROD_B, f"{month}-01", f"{_next(month)}-01")], f"{month}-06",
                  refund=1000 if last else 100, refund_day=f"{month}-21")
    _load(on, book)
    refunds = _metrics()["refunds"]
    assert [(s["month"], s["product"], s["refund_rate_pct"], s["median_rate_pct"]) for s in refunds["spikes"]] == [("2026-08", PROD_A, 10.0, 1.0)]
    plan_b = next(p for p in refunds["products"] if p["product"] == PROD_B)
    aug_b = next(r for r in plan_b["months"] if r["month"] == "2026-08")
    assert aug_b["refund_rate_pct"] == 10.0 and aug_b["spike"] is False  # above 2x the median, below spike_min
    _metrics_cfg(spike_min_cents=500)
    assert len(_metrics()["refunds"]["spikes"]) == 2
    aug = next(r for r in refunds["months"] if r["month"] == "2026-08")
    assert (aug["gross_cents"], aug["refunds_cents"], aug["refund_rate_pct"]) == (110000, 11000, 10.0)


# --- forecast --------------------------------------------------------------------------------------------


def test_forecast_arithmetic_with_bills_and_card_due_dates(on):
    from hpbooks.payments import set_manual

    book = sf.Book()
    p = sf.price("price_TESTF", PROD_A, 10000)
    book.add("subscriptions", sf.subscription("sub_TESTF", "cus_TESTF", [("si_TESTF", p, 1)], period=("2026-08-20", "2026-09-20")))
    book.add("subscriptions", sf.subscription("sub_TESTG", "cus_TESTG", [("si_TESTG", p, 1)], period=("2026-08-25", "2026-09-25"), cancel_at_period_end=True))
    book.btx.append(sf.btx("txn_TESTF1", "charge", 10000, "2026-08-20", fee=300, source="ch_TESTF1"))
    book.btx.append(sf.btx("txn_TESTF2", "payout", -5000, "2026-09-14", source="po_TESTF1"))
    book.payouts.append(sf.payout("po_TESTF1", 5000, "2026-09-14", "2026-09-17", status="in_transit", btx_id="txn_TESTF2"))
    _load(on, book)
    rows = [("bank-in", "2026-06-01", 100000, "ZZZ CLIENT DEPOSIT")]
    rows += [(f"bank-rent{n}", day, -20000, "ZZZ RACK RENT") for n, day in enumerate(("2026-06-12", "2026-07-12", "2026-08-11"))]
    sf.bank_feed(on / "bank" / "bank.json", BANK, rows, date_from="2026-06-01", date_to="2026-09-14")
    code, _out, err = run_cli(["import", str(on / "bank" / "bank.json")])
    assert code == 0, err
    with connect() as conn:
        set_manual(conn, REWARDS, {"due_date": "2026-10-05", "min_payment_cents": 2500}, as_of="2026-09-10")
    f = _metrics()["forecast"]
    assert (f["start"], f["end"], f["days"]) == ("2026-09-15", "2026-12-14", 90)
    assert f["opening_cash_cents"] == 40000
    # Lag: 2 days to available (the fake balance transactions) + 3 days payout created -> arrival.
    assert f["payout_lag_days"] == 5 and f["fee_rate_pct"] == 3.0 and f["collection_rate_pct"] == 100.0
    by_kind = {}
    for e in f["events"]:
        by_kind.setdefault(e["kind"], []).append((e["date"], e["cents"]))
    # sub_TESTG ends at period end, so only sub_TESTF renews: 10,000 x 100% less 3% fees, 5 days later.
    assert by_kind["renewals"] == [("2026-09-25", 9700), ("2026-10-25", 9700), ("2026-11-25", 9700)]
    assert by_kind["payout_in_transit"] == [("2026-09-17", 5000)]
    assert by_kind["stripe_balance"] == [("2026-09-18", 10000 - 300 - 5000)]
    assert by_kind["bill"] == [("2026-10-10", -20000), ("2026-11-09", -20000), ("2026-12-09", -20000)]
    assert by_kind["card_due"] == [("2026-10-05", -2500), ("2026-11-05", -2500), ("2026-12-05", -2500)]
    final = 40000 + 3 * 9700 + 5000 + 4700 - 3 * 20000 - 3 * 2500
    assert f["closing_cents"] == final == f["daily"][-1]["balance_cents"]
    assert f["lowest"] == {"date": "2026-12-09", "balance_cents": final}
    assert [r["date"] for r in f["daily"] if r["lowest"]] == ["2026-12-09"]
    assert sum(w["inflow_cents"] - w["outflow_cents"] for w in f["weekly"]) == final - 40000
    # Each week's columns by kind add up to its net flow.
    kinds = ("renewals_cents", "in_transit_cents", "capital_withholding_cents", "bills_cents", "cards_cents")
    assert all(sum(w[k] for k in kinds) == w["inflow_cents"] - w["outflow_cents"] for w in f["weekly"])
    assert sum(w["bills_cents"] for w in f["weekly"]) == f["totals"]["bills_cents"]
    assert f["totals"]["bills_cents"] == -60000 and f["totals"]["cards_cents"] == -7500


def test_forecast_capital_withholding(on):
    _with_capital(100_000, 10_000)
    book = sf.Book()
    p = sf.price("price_TESTF", PROD_A, 100000)
    book.add("subscriptions", sf.subscription("sub_TESTF", "cus_TESTF", [("si_TESTF", p, 1)], period=("2026-08-20", "2026-09-20")))
    book.btx.append(sf.capital_payout("txn_TESTCAP0", 100_000, "2026-08-01"))
    book.btx.append(sf.btx("txn_TESTS1", "charge", 100000, "2026-09-01", fee=0, source="ch_TESTS1"))
    book.btx.append(sf.paydown("txn_TESTPD1", 10000, "2026-09-01"))
    _load(on, book)
    f = _metrics()["forecast"]
    assert f["withheld_share_pct"] == 10.0
    held = [e["cents"] for e in f["events"] if e["kind"] == "capital_withholding"]
    # 110,000 owed less 10,000 repaid = 100,000 left: 10% of each 100,000 renewal.
    assert held == [-10000, -10000, -10000]


# --- flag off, API, exports, speed --------------------------------------------------------------------


def test_flag_off(db):
    book = _basic_book()
    folder = _folder(db)
    book.write(folder)
    code, out, err = run_cli(["stripe", "metrics"])
    assert code == 2 and out == "" and "Stripe integration is disabled" in err
    code, _out, err = run_cli(["import", str(folder.parent)])
    assert code == 1 and "stripe" not in err.lower()  # the stripe/ folder is not read
    with connect() as conn:
        for table in ("stripe_subscriptions", "stripe_invoices", "stripe_charges", "stripe_customers"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert sf.PII in (folder / "main_customers_1.json").read_text()  # not read, not scrubbed
    from hpbooks.web import create_app

    client = create_app().test_client()
    for url in ("/api/stripe/metrics", "/api/stripe/metrics/mrr", "/api/stripe/metrics/export/mrr.csv"):
        response = client.get(url)
        assert response.status_code == 404 and response.get_json()["error"] == "Stripe integration is disabled", url


def test_api_shape_sections_and_exports(on):
    _load(on, _movement_book())
    from hpbooks.web import create_app

    client = create_app().test_client()
    body = client.get("/api/stripe/metrics?month=2026-06&start=2026-01-01&end=2026-08-31").get_json()
    assert body["ok"] is True
    for key in ("summary", "approximations", "mrr", "churn", "cohorts", "margin", "fees", "capital", "ltv", "concentration", "recovery", "refunds", "forecast"):
        assert key in body, key
    assert body["summary"]["mrr_cents"] == 35000 and body["mrr"]["bridge"]["closing_cents"] == 35000
    assert body["month"] == "2026-06" and body["currency"] == "usd"
    one = client.get("/api/stripe/metrics/churn?month=2026-06&start=2026-01-01&end=2026-08-31").get_json()
    assert one["churn"]["month"]["churned_customers"] == 1 and "mrr" not in one and "forecast" not in one
    # Section responses carry the summary KPIs too (the dashboard card uses /metrics/mrr); no forecast, so its fields are null.
    assert one["summary"]["mrr_cents"] == 35000 and one["summary"]["forecast_low_cents"] is None
    # A range that ends in the current month focuses on the last complete month in it.
    from hpbooks.stripe_metrics import resolve_period

    assert resolve_period("2026-01-01", "2026-09-15", None, TODAY) == ("2026-01-01", "2026-09-15", "2026-08")
    assert resolve_period("2026-09-01", "2026-09-15", None, TODAY)[2] == "2026-09"
    assert resolve_period("2026-01-01", "2026-06-30", None, TODAY)[2] == "2026-06"
    assert resolve_period("2026-01-01", "2026-09-15", "2026-03", TODAY)[2] == "2026-03"
    assert client.get("/api/stripe/metrics/nope").status_code == 404
    assert client.get("/api/stripe/metrics?month=2026-13").status_code == 400
    assert client.get("/api/stripe/metrics?business=nope").status_code == 400
    # The business filter: the main account belongs to branda, so consulting has no Stripe data.
    other = client.get("/api/stripe/metrics?business=consulting").get_json()
    assert other["summary"]["mrr_cents"] == 0 and other["accounts"] == ["consult"]
    for table in ("summary", "mrr", "movement", "churn", "cohorts", "margin", "fees", "capital", "ltv", "concentration", "recovery", "refunds", "forecast", "forecast-weekly", "fees-methods"):
        response = client.get(f"/api/stripe/metrics/export/{table}.csv?month=2026-06")
        assert response.status_code == 200 and response.mimetype == "text/csv", table
    csv_text = client.get("/api/stripe/metrics/export/movement.csv?month=2026-06&start=2026-01-01&end=2026-08-31").get_data(as_text=True)
    assert csv_text.splitlines()[0].startswith("Month,Opening,New,Reactivated") and "2026-06,400.00,0.00,80.00,0.00,80.00,50.00,350.00" in csv_text
    xlsx = client.get("/api/stripe/metrics/export/mrr.xlsx")
    assert xlsx.status_code == 200 and xlsx.data[:2] == b"PK"
    pdf = client.get("/api/stripe/metrics/export/churn.pdf")
    assert pdf.status_code == 200 and pdf.data[:4] == b"%PDF"
    assert client.get("/api/stripe/metrics/export/nope.csv").status_code == 404
    assert client.get("/api/stripe/metrics/export/mrr.txt").status_code == 404
    # Nothing personal in any response.
    assert sf.PII not in json.dumps(body)
    # CLI sections and JSON.
    for section in ("mrr", "churn", "cohorts", "margin", "fees", "capital", "ltv", "concentration", "recovery", "refunds", "forecast"):
        code, out, err = run_cli(["stripe", "metrics", "--month", "2026-06", "--section", section])
        assert code == 0 and out.strip(), (section, err)
    code, out, _err = run_cli(["stripe", "metrics", "--json", "--section", "ltv"])
    assert code == 0 and set(json.loads(out)) >= {"ltv", "month", "approximations"}


def test_two_thousand_charges_and_five_hundred_subscriptions_are_fast(on):
    book = sf.Book()
    prices = [sf.price(f"price_TESTP{n}", f"prod_TESTP{n % 5}", 1000 * (n % 5 + 1), interval="year" if n % 7 == 0 else "month") for n in range(10)]
    for n in range(5):
        book.add("products", sf.product(f"prod_TESTP{n}", f"Plan {chr(65 + n)}"))
    for n in range(500):
        status = "canceled" if n % 9 == 0 else ("past_due" if n % 23 == 0 else "active")
        cus, sub = f"cus_TESTQ{n:04d}", f"sub_TESTQ{n:04d}"
        p = prices[n % 10]
        start = f"2025-{n % 12 + 1:02d}-01"
        book.add("customers", sf.customer(cus, start))
        book.add("subscriptions", sf.subscription(sub, cus, [(f"si_TESTQ{n:04d}", p, n % 3 + 1)], status=status, start=start,
                                                  canceled="2026-05-10" if status == "canceled" else None, ended="2026-05-10" if status == "canceled" else None,
                                                  reason="payment_failed" if n % 18 == 0 else None))
    for n in range(2000):
        month = f"2026-{n % 8 + 1:02d}"
        cus = f"cus_TESTQ{n % 500:04d}"
        book.sale(cus, f"sub_TESTQ{n % 500:04d}", [sf.line(1000 * (n % 5 + 1), f"price_TESTP{n % 10}", f"prod_TESTP{n % 5}", f"{month}-01", f"{_next(month)}-01")],
                  f"{month}-{n % 27 + 1:02d}", fee=30 + n % 50, method=("card", "link", "us_bank_account")[n % 3],
                  refund=500 if n % 40 == 0 else 0)
    _load(on, book)
    started = time.perf_counter()
    data = _metrics()
    elapsed = time.perf_counter() - started
    assert data["summary"]["mrr_cents"] > 0 and data["margin"]["totals"]["gross_cents"] > 0
    assert elapsed < 1.5, f"metrics took {elapsed:.2f}s"  # about 0.4s on a laptop
