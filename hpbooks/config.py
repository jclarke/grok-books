"""Site configuration: product name, businesses, categories, accounts, rules, WHMCS.

The file is TOML. It is read from $HPBOOKS_CONFIG when that is set, else from
config/local.toml in the repository when it exists, else built-in generic
defaults are used. config/config.example.toml documents every key.

Business tags, categories, and seeded accounts are read once per process: the
database CHECK constraints and module tables are built from them at import. A
change to those needs a restart (and a fresh database for new tags or
categories). Feature flags and WHMCS settings are read on each call through
get_config(), so tests can switch them with override().
"""

from __future__ import annotations

import json
import os
import re
import stat
import sys
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_CONFIG = REPO_ROOT / "config" / "local.toml"

# Tags and categories every install has. The business tags and the P&L
# category lists come from the config file.
SYSTEM_TAGS = ("owner_draw", "transfer", "needs_review")
REFUNDS = "Refunds"
OTHER_CATEGORIES = ("Owner Draw", "Transfer", "Uncategorized")

DEFAULT_CATEGORIES = {
    "revenue": ["Revenue - Sales", "Revenue - Services"],
    "cogs": ["Cost of Goods Sold"],
    "opex": [
        "Software & Licenses",
        "Payroll",
        "Contractors",
        "Professional Services",
        "Advertising",
        "Bank & Card Fees",
        "Payment Processing Fees",
        "Interest",
        "Insurance",
        "Rent",
        "Utilities",
        "Travel",
        "Meals",
        "Taxes & Licenses",
        "Office/Other",
    ],
}

DEFAULT_MONARCH_ALIASES = {"apple card": "apple card", "apple cash": "apple cash"}

DEFAULT_BUSINESSES = [
    {"slug": "general", "label": "General", "kind": "overhead", "color": "#64748b", "color_dark": "#94a3b8"},
]

ACCOUNT_TYPES = ("cash", "liability")
_TONE_BY_KIND = {"brand": "brand", "consulting": "violet", "overhead": "neutral"}
PAIR_WINDOWS = ("abs7", "after0_7")


class ConfigError(Exception):
    """The config file is unreadable or has an invalid value."""


@dataclass(frozen=True)
class Business:
    slug: str
    label: str
    kind: str = "business"
    color: str = ""
    color_dark: str = ""
    tone: str = ""
    revenue_category: str | None = None


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    type: str
    last4: str | None = None
    institution: str | None = None
    notes: str | None = None
    short_name: str | None = None
    short_name_prefix: str | None = None
    label: str | None = None
    roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class TransferPair:
    kind: str
    left_account: str
    left_pattern: str
    right_account: str
    right_pattern: str
    window: str = "abs7"
    classify_left: bool = False
    matched_note: str = "matched to transfer {txn_id}"
    unmatched_note: str = "transfer not matched to the other account"


@dataclass(frozen=True)
class WhmcsBrand:
    name: str
    server: str
    database: str = "whmcs"
    port: int = 3307
    secret: str = "whmcs.secret"


@dataclass(frozen=True)
class BankSide:
    """A books account compared with one WHMCS gateway in the gateway totals."""

    gateway: str
    account_role: str
    label: str
    match: str = ""


@dataclass(frozen=True)
class WhmcsConfig:
    ssh_user: str = "hpbooks"
    ssh_key: str = "~/.ssh/hpbooks_whmcs"
    mysql_user: str = "books_ro"
    placeholder_credit_cents: int = 100_000_000
    revenue_category: str = ""  # empty: the first revenue category
    paypal_account_role: str = "paypal"
    brands: tuple[WhmcsBrand, ...] = ()
    bank_sides: tuple[BankSide, ...] = ()


@dataclass(frozen=True)
class StripeAccount:
    """One Stripe balance booked as a cash account. Files are named <name>_N.json."""

    name: str
    business: str
    stripe_account: str | None = None
    label: str = ""
    currency: str = "usd"
    revenue_category: str = ""  # resolved at load: the business's revenue category, else the first one
    payout_account: str | None = None
    secret: str | None = None  # direct API mode: this account's key file; default [stripe] secret

    @property
    def ledger_id(self) -> str:
        return f"stripe-{self.name}"

    @property
    def display(self) -> str:
        return self.label or f"Stripe {self.name}"


@dataclass(frozen=True)
class StripeCapital:
    """Terms of one Stripe Capital financing: principal plus one flat fee, repaid pro rata.

    financing None is the account's default entry: it takes that account's Capital
    rows that match no other entry (and rows whose description names no financing).
    """

    account: str
    principal_cents: int
    fee_cents: int | None = None  # as configured; use fee_total_cents
    financing: str | None = None
    fee_rate: float | None = None
    label: str = ""
    opening_principal_cents: int | None = None
    start_date: str | None = None

    @property
    def fee_total_cents(self) -> int:
        """The flat fee: `fee`, or principal x fee_rate rounded half up to the cent."""
        if self.fee_rate is None:
            return int(self.fee_cents or 0)
        from decimal import ROUND_HALF_UP, Decimal

        return int((Decimal(self.principal_cents) * Decimal(str(self.fee_rate))).quantize(Decimal(1), rounding=ROUND_HALF_UP))

    @property
    def key(self) -> str:
        return self.financing or "default"

    @property
    def display(self) -> str:
        return self.label or self.financing or "Stripe Capital"


@dataclass(frozen=True)
class StripeConfig:
    fee_category: str = "Payment Processing Fees"
    payout_match: str = "(?i)stripe"
    payout_window_days: int = 5
    secret: str | None = None
    books_currency: str = "usd"
    timezone: str = "America/New_York"
    capital_fee_category: str = ""  # resolved when on: "Interest" if that category exists, else fee_category
    accounts: tuple[StripeAccount, ...] = ()
    capital: tuple[StripeCapital, ...] = ()

    def account(self, name: str) -> StripeAccount | None:
        for item in self.accounts:
            if item.name == name:
                return item
        return None

    def capital_for(self, name: str) -> tuple[StripeCapital, ...]:
        return tuple(item for item in self.capital if item.account == name)


@dataclass(frozen=True)
class PayerHint:
    """Where to look for a loan's payments: bank rows matching `pattern` pay the
    personal loan whose last 4 equals `match`, or whose name contains it."""

    match: str
    pattern: str


@dataclass(frozen=True)
class ImportersConfig:
    applecard_account_id: str = "manual-apple-card"
    cfna_last4: str | None = None
    monarch_aliases: dict = field(default_factory=lambda: dict(DEFAULT_MONARCH_ALIASES))


@dataclass(frozen=True)
class UpdateConfig:
    """Where `hpbooks update check|apply` looks. A git remote named `remote` wins; else `repo` on GitHub."""

    repo: str = "jclarke/grok-books"
    remote: str = "public"
    branch: str = "main"


@dataclass(frozen=True)
class Config:
    source: str
    base_dir: Path
    product_name: str = "Books"
    company_name: str = "My Business"
    wordmark: str = "Books"
    db_path: str | None = None
    key_file: str | None = None
    whmcs_enabled: bool = False
    margins_enabled: bool = False
    stripe_enabled: bool = False
    business_enabled: bool = True
    personal_enabled: bool = True
    businesses: tuple[Business, ...] = ()
    revenue_categories: tuple[str, ...] = ()
    cogs_categories: tuple[str, ...] = ()
    opex_categories: tuple[str, ...] = ()
    accounts: tuple[Account, ...] = ()
    transfer_pairs: tuple[TransferPair, ...] = ()
    rules_file: Path | None = None
    starter_rules: bool = True
    prior_csv: str | None = None
    prior_business: str | None = None
    prior_status: str = "business"
    prior_category_map: dict = field(default_factory=dict)
    whmcs: WhmcsConfig = field(default_factory=WhmcsConfig)
    stripe: StripeConfig = field(default_factory=StripeConfig)
    payer_hints: tuple[PayerHint, ...] = ()
    importers: ImportersConfig = field(default_factory=ImportersConfig)
    update: UpdateConfig = field(default_factory=UpdateConfig)

    # --- derived -----------------------------------------------------------

    @property
    def business_slugs(self) -> tuple[str, ...]:
        return tuple(b.slug for b in self.businesses)

    @property
    def business_tags(self) -> tuple[str, ...]:
        return self.business_slugs + SYSTEM_TAGS

    @property
    def categories(self) -> tuple[str, ...]:
        return (
            self.revenue_categories
            + (REFUNDS,)
            + self.cogs_categories
            + self.opex_categories
            + OTHER_CATEGORIES
        )

    @property
    def business_filter_error(self) -> str:
        choices = ("all",) + self.business_slugs
        if len(choices) == 2:
            text = " or ".join(choices)
        else:
            text = ", ".join(choices[:-1]) + ", or " + choices[-1]
        return f"business must be {text}"

    @property
    def default_business(self) -> str:
        """The overhead business: where unassigned costs go. First 'overhead' kind, else the last business."""
        for business in self.businesses:
            if business.kind == "overhead":
                return business.slug
        return self.businesses[-1].slug

    def business(self, slug: str) -> Business | None:
        for business in self.businesses:
            if business.slug == slug:
                return business
        return None

    def account_for_role(self, role: str) -> str | None:
        """Id of the first configured account with this role, or None."""
        for account in self.accounts:
            if role in account.roles:
                return account.id
        return None

    def resolve_account(self, ref: str | None) -> str | None:
        """An account id from a config reference: an account id or a role name."""
        if not ref:
            return None
        for account in self.accounts:
            if account.id == ref:
                return account.id
        return self.account_for_role(ref)

    def short_account(self, name: str) -> str:
        """Short display name for an account name: exact name, then name prefix, else the name."""
        for account in self.accounts:
            if account.short_name and account.name == name:
                return account.short_name
        for account in self.accounts:
            if account.short_name and account.short_name_prefix and name.startswith(account.short_name_prefix):
                return account.short_name
        return name

    def whmcs_brand_names(self) -> tuple[str, ...]:
        return tuple(brand.name for brand in self.whmcs.brands)

    def public_payload(self, *, detail: bool) -> dict:
        """What the web UI needs to brand itself and hide disabled features."""
        out = {
            "product": self.product_name,
            "company": self.company_name,
            "wordmark": self.wordmark,
            "features": {
                "whmcs": self.whmcs_enabled,
                "margins": self.margins_enabled,
                "business": self.business_enabled,
                "personal": self.personal_enabled,
            },
        }
        if self.stripe_enabled:
            # Only sent when on, so a site without Stripe gets the same payload as before.
            out["features"]["stripe"] = True
        if detail:
            out["businesses"] = [
                {
                    "slug": b.slug,
                    "label": b.label,
                    "kind": b.kind,
                    "color": b.color,
                    "color_dark": b.color_dark or b.color,
                    "tone": b.tone or _TONE_BY_KIND.get(b.kind, "neutral"),
                    "revenue_category": b.revenue_category,
                }
                for b in self.businesses
            ]
            out["default_business"] = self.default_business
            out["accounts"] = [
                {
                    "id": a.id,
                    "short_name": a.short_name or a.name,
                    "label": a.label or a.institution or a.short_name or a.name,
                    "type": a.type,
                    "roles": list(a.roles),
                }
                for a in self.accounts
            ]
            operating = self.account_for_role("operating")
            out["operating_account"] = next(
                (item for item in out["accounts"] if item["id"] == operating), None
            )
            whmcs = self.whmcs_enabled
            out["whmcs_brands"] = list(self.whmcs_brand_names()) if whmcs else []
            out["whmcs_bank_sides"] = (
                [{"gateway": s.gateway, "label": s.label} for s in self.whmcs.bank_sides] if whmcs else []
            )
            if self.stripe_enabled:
                out["stripe_accounts"] = [
                    {"name": a.name, "label": a.display, "business": a.business} for a in self.stripe.accounts
                ]
        return out


# --- loading -----------------------------------------------------------------


def config_path() -> Path | None:
    """The file that would be loaded, or None for built-in defaults."""
    env = os.environ.get("HPBOOKS_CONFIG")
    if env is not None and env.strip() != "":
        path = Path(env).expanduser()
        return path if path.exists() else None
    return LOCAL_CONFIG if LOCAL_CONFIG.exists() else None


def _get(table: dict, key: str, kind, default, where: str):
    value = table.get(key, default)
    if value is None or value is default:
        return value
    if kind is float and isinstance(value, int) and not isinstance(value, bool):
        value = float(value)
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        raise ConfigError(f"{where}.{key} must be {getattr(kind, '__name__', kind)}")
    return value


def _str_or_none(table: dict, key: str, where: str) -> str | None:
    value = table.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ConfigError(f"{where}.{key} must be text")
    return value


def _str_list(value, where: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ConfigError(f"{where} must be a list of names")
    return tuple(value)


def _businesses(raw) -> tuple[Business, ...]:
    if raw is None:
        raw = DEFAULT_BUSINESSES
    if not isinstance(raw, list) or not raw:
        raise ConfigError("businesses must be a non-empty list of [[businesses]] tables")
    out = []
    for index, item in enumerate(raw):
        where = f"businesses[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{where} must be a table")
        slug = _get(item, "slug", str, None, where)
        if not slug or not slug.replace("_", "").isalnum() or slug != slug.lower():
            raise ConfigError(f"{where}.slug must be lowercase letters, digits, or _")
        if slug in SYSTEM_TAGS or slug == "all":
            raise ConfigError(f"{where}.slug {slug!r} is reserved")
        out.append(
            Business(
                slug=slug,
                label=_get(item, "label", str, slug, where),
                kind=_get(item, "kind", str, "business", where),
                color=_get(item, "color", str, "", where),
                color_dark=_get(item, "color_dark", str, "", where),
                tone=_get(item, "tone", str, "", where),
                revenue_category=_str_or_none(item, "revenue_category", where),
            )
        )
    if len({b.slug for b in out}) != len(out):
        raise ConfigError("businesses have a repeated slug")
    return tuple(out)


def _accounts(raw) -> tuple[Account, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ConfigError("accounts.business must be a list of [[accounts.business]] tables")
    out = []
    for index, item in enumerate(raw):
        where = f"accounts.business[{index}]"
        acct_id = _get(item, "id", str, None, where)
        name = _get(item, "name", str, None, where)
        if not acct_id or not name:
            raise ConfigError(f"{where} needs id and name")
        acct_type = _get(item, "type", str, "cash", where)
        if acct_type not in ACCOUNT_TYPES:
            raise ConfigError(f"{where}.type must be cash or liability")
        roles = item.get("roles", [])
        if isinstance(roles, str):
            roles = [roles]
        out.append(
            Account(
                id=acct_id,
                name=name,
                type=acct_type,
                last4=_str_or_none(item, "last4", where),
                institution=_str_or_none(item, "institution", where),
                notes=_str_or_none(item, "notes", where),
                short_name=_str_or_none(item, "short_name", where),
                short_name_prefix=_str_or_none(item, "short_name_prefix", where),
                label=_str_or_none(item, "label", where),
                roles=_str_list(roles, f"{where}.roles") if roles else (),
            )
        )
    if len({a.id for a in out}) != len(out):
        raise ConfigError("accounts.business has a repeated id")
    return tuple(out)


def _pairs(raw) -> tuple[TransferPair, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ConfigError("transfer_pairs must be a list of [[transfer_pairs]] tables")
    out = []
    for index, item in enumerate(raw):
        where = f"transfer_pairs[{index}]"
        values = {}
        for key in ("kind", "left_account", "left_pattern", "right_account", "right_pattern"):
            value = _get(item, key, str, None, where)
            if not value:
                raise ConfigError(f"{where}.{key} is required")
            values[key] = value
        window = _get(item, "window", str, "abs7", where)
        if window not in PAIR_WINDOWS:
            raise ConfigError(f"{where}.window must be one of {', '.join(PAIR_WINDOWS)}")
        out.append(
            TransferPair(
                **values,
                window=window,
                classify_left=_get(item, "classify_left", bool, False, where),
                matched_note=_get(item, "matched_note", str, TransferPair.matched_note, where),
                unmatched_note=_get(item, "unmatched_note", str, TransferPair.unmatched_note, where),
            )
        )
    return tuple(out)


def _whmcs(raw) -> WhmcsConfig:
    raw = raw or {}
    where = "whmcs"
    brands = []
    for index, item in enumerate(raw.get("brands", []) or []):
        bw = f"whmcs.brands[{index}]"
        name = _get(item, "name", str, None, bw)
        server = _get(item, "server", str, None, bw)
        if not name or not server:
            raise ConfigError(f"{bw} needs name and server")
        brands.append(
            WhmcsBrand(
                name=name,
                server=server,
                database=_get(item, "database", str, "whmcs", bw),
                port=_get(item, "port", int, 3307, bw),
                secret=_get(item, "secret", str, WhmcsBrand.secret, bw),
            )
        )
    if len({b.name.lower() for b in brands}) != len(brands):
        raise ConfigError("whmcs.brands has a repeated name")
    sides = []
    for index, item in enumerate(raw.get("bank_sides", []) or []):
        sw = f"whmcs.bank_sides[{index}]"
        gateway = _get(item, "gateway", str, None, sw)
        role = _get(item, "account_role", str, None, sw)
        if not gateway or not role:
            raise ConfigError(f"{sw} needs gateway and account_role")
        sides.append(
            BankSide(
                gateway=gateway.lower(),
                account_role=role,
                label=_get(item, "label", str, gateway, sw),
                match=_get(item, "match", str, "", sw),
            )
        )
    if "bank_sides" not in raw:
        sides = [BankSide("paypal", "paypal", "PayPal account, deposits less refunds")]
    defaults = WhmcsConfig()
    return WhmcsConfig(
        ssh_user=_get(raw, "ssh_user", str, defaults.ssh_user, where),
        ssh_key=_get(raw, "ssh_key", str, defaults.ssh_key, where),
        mysql_user=_get(raw, "mysql_user", str, defaults.mysql_user, where),
        placeholder_credit_cents=_get(raw, "placeholder_credit_cents", int, defaults.placeholder_credit_cents, where),
        revenue_category=_get(raw, "revenue_category", str, defaults.revenue_category, where),
        paypal_account_role=_get(raw, "paypal_account_role", str, defaults.paypal_account_role, where),
        brands=tuple(brands),
        bank_sides=tuple(sides),
    )


_STRIPE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


def _stripe(raw) -> StripeConfig:
    """The [stripe] table and its [[stripe.accounts]]. Types are checked here; names,
    businesses, and categories are checked by _check_stripe when the feature is on."""
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ConfigError("stripe must be a table")
    where = "stripe"
    defaults = StripeConfig()
    accounts_raw = raw.get("accounts", []) or []
    if not isinstance(accounts_raw, list):
        raise ConfigError("stripe.accounts must be a list of [[stripe.accounts]] tables")
    accounts = []
    for index, item in enumerate(accounts_raw):
        aw = f"stripe.accounts[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{aw} must be a table")
        name = _get(item, "name", str, None, aw)
        business = _get(item, "business", str, None, aw)
        if not name or not business:
            raise ConfigError(f"{aw} needs name and business")
        accounts.append(
            StripeAccount(
                name=name,
                business=business,
                stripe_account=_str_or_none(item, "stripe_account", aw),
                label=_get(item, "label", str, "", aw),
                currency=(_get(item, "currency", str, "usd", aw) or "usd").lower(),
                revenue_category=_get(item, "revenue_category", str, "", aw),
                payout_account=_str_or_none(item, "payout_account", aw),
                secret=_str_or_none(item, "secret", aw),
            )
        )
    capital_raw = raw.get("capital", []) or []
    if not isinstance(capital_raw, list):
        raise ConfigError("stripe.capital must be a list of [[stripe.capital]] tables")
    capital = []
    for index, item in enumerate(capital_raw):
        cw = f"stripe.capital[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{cw} must be a table")
        account = _get(item, "account", str, None, cw)
        if not account:
            raise ConfigError(f"{cw} needs account")
        if "principal" not in item:
            raise ConfigError(f"{cw} needs principal")
        rate = _get(item, "fee_rate", float, None, cw)
        start = _str_or_none(item, "start_date", cw)
        capital.append(
            StripeCapital(
                account=account,
                principal_cents=_dollars(item, "principal", cw),
                fee_cents=_dollars(item, "fee", cw) if "fee" in item else None,
                financing=_str_or_none(item, "financing", cw),
                fee_rate=rate,
                label=_get(item, "label", str, "", cw),
                opening_principal_cents=_dollars(item, "opening_principal", cw) if "opening_principal" in item else None,
                start_date=start,
            )
        )
    window = _get(raw, "payout_window_days", int, defaults.payout_window_days, where)
    if window < 0 or window > 31:
        raise ConfigError("stripe.payout_window_days must be 0 to 31")
    return StripeConfig(
        fee_category=_get(raw, "fee_category", str, defaults.fee_category, where),
        payout_match=_get(raw, "payout_match", str, defaults.payout_match, where),
        payout_window_days=window,
        secret=_str_or_none(raw, "secret", where),
        books_currency=(_get(raw, "books_currency", str, defaults.books_currency, where) or "usd").lower(),
        timezone=_get(raw, "timezone", str, defaults.timezone, where),
        capital_fee_category=_get(raw, "capital_fee_category", str, defaults.capital_fee_category, where),
        accounts=tuple(accounts),
        capital=tuple(capital),
    )


def _dollars(table: dict, key: str, where: str) -> int:
    """A dollar amount (number) as integer cents, at most two decimal places."""
    from decimal import Decimal, InvalidOperation

    value = table.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError(f"{where}.{key} must be a dollar amount")
    try:
        cents = Decimal(str(value)) * 100
    except InvalidOperation as exc:
        raise ConfigError(f"{where}.{key} must be a dollar amount") from exc
    if cents != cents.to_integral_value():
        raise ConfigError(f"{where}.{key} has more than two decimal places")
    return int(cents)


def _check_stripe(stripe: StripeConfig, businesses, revenue, every_category) -> StripeConfig:
    """Validate references and fill each account's revenue category. Only run with features.stripe on."""
    from zoneinfo import ZoneInfo

    if stripe.fee_category not in every_category:
        raise ConfigError(f"stripe.fee_category {stripe.fee_category!r} is not a category")
    if stripe.fee_category in revenue:
        raise ConfigError("stripe.fee_category must be an expense category")
    try:
        re.compile(stripe.payout_match)
    except re.error as exc:
        raise ConfigError(f"stripe.payout_match is not a valid regex: {exc}") from exc
    try:
        ZoneInfo(stripe.timezone)
    except Exception as exc:
        raise ConfigError(f"stripe.timezone {stripe.timezone!r} is not a known time zone") from exc
    for where, secret in [("stripe.secret", stripe.secret)] + [
        (f"stripe.accounts[{i}].secret", a.secret) for i, a in enumerate(stripe.accounts)
    ]:
        if secret is not None and ("/" in secret or "\\" in secret or secret.startswith(".")):
            raise ConfigError(f"{where} must be a file name in the data directory")
    slugs = {b.slug: b for b in businesses}
    seen: set[str] = set()
    out = []
    for index, acct in enumerate(stripe.accounts):
        aw = f"stripe.accounts[{index}]"
        if not _STRIPE_NAME_RE.fullmatch(acct.name):
            raise ConfigError(f"{aw}.name must be lowercase letters, digits, or - (up to 32)")
        if acct.name in seen:
            raise ConfigError(f"stripe.accounts has a repeated name {acct.name!r}")
        seen.add(acct.name)
        business = slugs.get(acct.business)
        if business is None:
            raise ConfigError(f"{aw}.business {acct.business!r} is not a business slug")
        category = acct.revenue_category or business.revenue_category or revenue[0]
        if category not in revenue:
            raise ConfigError(f"{aw}.revenue_category {category!r} is not a revenue category")
        if acct.stripe_account is not None and not acct.stripe_account.startswith("acct_"):
            raise ConfigError(f"{aw}.stripe_account must start with acct_")
        out.append(replace(acct, revenue_category=category))
    fee_category = stripe.capital_fee_category or ("Interest" if "Interest" in every_category else stripe.fee_category)
    if fee_category not in every_category:
        raise ConfigError(f"stripe.capital_fee_category {fee_category!r} is not a category")
    if fee_category in revenue or fee_category == REFUNDS:
        raise ConfigError("stripe.capital_fee_category must be an expense category")
    return replace(stripe, accounts=tuple(out), capital=_check_capital(stripe.capital, seen), capital_fee_category=fee_category)


_FINANCING_RE = re.compile(r"^[A-Za-z0-9_]{3,64}$")


def _check_capital(entries, account_names: set[str]) -> tuple[StripeCapital, ...]:
    """Validate [[stripe.capital]] entries."""
    out = []
    keys: set[tuple[str, str | None]] = set()
    for index, entry in enumerate(entries):
        cw = f"stripe.capital[{index}]"
        if entry.account not in account_names:
            raise ConfigError(f"{cw}.account {entry.account!r} is not a [[stripe.accounts]] name")
        if entry.financing is not None and not _FINANCING_RE.fullmatch(entry.financing):
            raise ConfigError(f"{cw}.financing must be a Stripe financing id such as flxln_...")
        key = (entry.account, entry.financing)
        if key in keys:
            which = f"financing {entry.financing!r}" if entry.financing else "default entry (no financing)"
            raise ConfigError(f"stripe.capital has a repeated {which} for account {entry.account!r}")
        keys.add(key)
        if entry.principal_cents <= 0:
            raise ConfigError(f"{cw}.principal must be more than zero")
        if (entry.fee_cents is None) == (entry.fee_rate is None):
            raise ConfigError(f"{cw} needs exactly one of fee and fee_rate")
        if entry.fee_rate is not None and not 0 <= entry.fee_rate < 1:
            raise ConfigError(f"{cw}.fee_rate must be from 0 to less than 1 (0.10 is 10%)")
        if entry.fee_cents is not None and entry.fee_cents < 0:
            raise ConfigError(f"{cw}.fee must not be negative")
        opening = entry.opening_principal_cents
        if (opening is None) != (entry.start_date is None):
            raise ConfigError(f"{cw}: opening_principal and start_date go together")
        if opening is not None:
            if not 0 <= opening <= entry.principal_cents:
                raise ConfigError(f"{cw}.opening_principal must be from 0 to principal")
            if not _is_day(entry.start_date):
                raise ConfigError(f"{cw}.start_date must be YYYY-MM-DD")
        out.append(entry)
    return tuple(out)


def _is_day(text: str) -> bool:
    from datetime import date

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _payer_hints(raw) -> tuple[PayerHint, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ConfigError("payments.payer_hints must be a list of [[payments.payer_hints]] tables")
    out = []
    for index, item in enumerate(raw):
        where = f"payments.payer_hints[{index}]"
        match = _get(item, "match", str, None, where)
        pattern = _get(item, "pattern", str, None, where)
        if not match or not pattern:
            raise ConfigError(f"{where} needs match and pattern")
        out.append(PayerHint(match=match, pattern=pattern))
    return tuple(out)


def _importers(raw) -> ImportersConfig:
    raw = raw or {}
    where = "importers"
    defaults = ImportersConfig()
    last4 = _str_or_none(raw, "cfna_last4", where)
    if last4 is not None and not (len(last4) == 4 and last4.isdigit()):
        raise ConfigError("importers.cfna_last4 must be 4 digits")
    aliases = raw.get("monarch_aliases", defaults.monarch_aliases)
    if not isinstance(aliases, dict) or not all(isinstance(v, str) for v in aliases.values()):
        raise ConfigError("importers.monarch_aliases must be a table of names")
    return ImportersConfig(
        applecard_account_id=_get(raw, "applecard_account_id", str, defaults.applecard_account_id, where)
        or defaults.applecard_account_id,
        cfna_last4=last4,
        monarch_aliases={str(k): v for k, v in aliases.items()},
    )


def _update(raw) -> UpdateConfig:
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ConfigError("update must be a table")
    defaults = UpdateConfig()
    out = UpdateConfig(
        repo=_get(raw, "repo", str, defaults.repo, "update") or defaults.repo,
        remote=_get(raw, "remote", str, defaults.remote, "update") or defaults.remote,
        branch=_get(raw, "branch", str, defaults.branch, "update") or defaults.branch,
    )
    if out.repo.count("/") != 1 or not all(out.repo.split("/")):
        raise ConfigError("update.repo must be owner/name")
    return out


def build(data: dict, *, source: str = "defaults", base_dir: Path | None = None) -> Config:
    """A Config from parsed TOML (an empty dict gives the generic defaults)."""
    base_dir = base_dir or REPO_ROOT
    app = data.get("app", {}) or {}
    features = data.get("features", {}) or {}
    paths = data.get("paths", {}) or {}
    cats = data.get("categories", {}) or {}
    seed = data.get("seed", {}) or {}
    accounts = (data.get("accounts", {}) or {}).get("business")

    product = _get(app, "product_name", str, "Books", "app")
    whmcs_on = _get(features, "whmcs", bool, False, "features")
    margins_on = _get(features, "margins", bool, whmcs_on, "features") and whmcs_on
    stripe_on = _get(features, "stripe", bool, False, "features")
    business_on = _get(features, "business", bool, True, "features")
    personal_on = _get(features, "personal", bool, True, "features")
    if not business_on and not personal_on:
        raise ConfigError("features.business and features.personal cannot both be false")

    revenue = _str_list(cats.get("revenue", DEFAULT_CATEGORIES["revenue"]), "categories.revenue")
    cogs = _str_list(cats.get("cogs", DEFAULT_CATEGORIES["cogs"]), "categories.cogs") if cats.get("cogs", DEFAULT_CATEGORIES["cogs"]) else ()
    opex = _str_list(cats.get("opex", DEFAULT_CATEGORIES["opex"]), "categories.opex")
    if not revenue:
        raise ConfigError("categories.revenue needs at least one category")
    reserved = {REFUNDS, *OTHER_CATEGORIES}
    every = list(revenue) + list(cogs) + list(opex)
    if reserved & set(every):
        raise ConfigError(f"categories may not list {', '.join(sorted(reserved))}; they are built in")
    if len(set(every)) != len(every):
        raise ConfigError("categories have a repeated name")
    for name in every:
        if "'" in name:
            raise ConfigError(f"category {name!r} may not contain a quote")

    businesses = _businesses(data.get("businesses"))
    for business in businesses:
        if business.revenue_category and business.revenue_category not in revenue:
            raise ConfigError(f"businesses.{business.slug}.revenue_category is not a revenue category")

    whmcs = _whmcs(data.get("whmcs"))
    if not whmcs.revenue_category:
        whmcs = replace(whmcs, revenue_category=revenue[0])
    elif whmcs_on and whmcs.revenue_category not in revenue:
        raise ConfigError("whmcs.revenue_category is not a revenue category")

    stripe = _stripe(data.get("stripe"))
    if stripe_on:
        every_category = (*revenue, REFUNDS, *cogs, *opex)
        stripe = _check_stripe(stripe, businesses, revenue, every_category)

    rules_file = _str_or_none(seed, "rules_file", "seed")
    prior_map = seed.get("prior_category_map", {}) or {}
    if not isinstance(prior_map, dict):
        raise ConfigError("seed.prior_category_map must be a table")

    def _path(value: str | None) -> str | None:
        if not value:
            return None
        path = Path(value).expanduser()
        return str(path if path.is_absolute() else REPO_ROOT / path)

    return Config(
        source=source,
        base_dir=base_dir,
        product_name=product,
        company_name=_get(app, "company_name", str, "My Business", "app"),
        wordmark=_get(app, "wordmark", str, product, "app"),
        db_path=_path(_str_or_none(paths, "db", "paths")),
        key_file=_path(_str_or_none(paths, "key_file", "paths")),
        whmcs_enabled=whmcs_on,
        margins_enabled=margins_on,
        stripe_enabled=stripe_on,
        business_enabled=business_on,
        personal_enabled=personal_on,
        businesses=businesses,
        revenue_categories=revenue,
        cogs_categories=cogs,
        opex_categories=opex,
        accounts=_accounts(accounts),
        transfer_pairs=_pairs(data.get("transfer_pairs")),
        rules_file=(base_dir / rules_file) if rules_file else None,
        starter_rules=_get(seed, "starter_rules", bool, True, "seed"),
        prior_csv=_str_or_none(seed, "prior_csv", "seed"),
        prior_business=_str_or_none(seed, "prior_business", "seed"),
        prior_status=_get(seed, "prior_status", str, "business", "seed"),
        prior_category_map={str(k): str(v) for k, v in prior_map.items()},
        whmcs=whmcs,
        stripe=stripe,
        payer_hints=_payer_hints((data.get("payments", {}) or {}).get("payer_hints")),
        importers=_importers(data.get("importers")),
        update=_update(data.get("update")),
    )


def warn_if_exposed(path: Path) -> bool:
    """Warn on stderr when a site config file is readable by group or others. True if it warned.

    The committed example and the test fixtures hold no private data and are skipped.
    """
    resolved = path.resolve()
    if resolved.name == "config.example.toml" or resolved.is_relative_to(REPO_ROOT / "tests"):
        return False
    try:
        mode = path.stat().st_mode
    except OSError:
        return False
    if not mode & (stat.S_IRWXG | stat.S_IRWXO):
        return False
    print(
        f"hpbooks: warning: {path} is readable by other users (mode {stat.S_IMODE(mode):o}); "
        f"run: chmod 600 {path}",
        file=sys.stderr,
    )
    return True


def load(path: Path | None) -> Config:
    if path is None:
        return build({})
    warn_if_exposed(path)
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: {exc}") from exc
    except OSError as exc:
        raise ConfigError(f"could not read config file {path}") from exc
    return build(data, source=str(path), base_dir=path.parent)


_cached: Config | None = None


def get_config() -> Config:
    global _cached
    if _cached is None:
        _cached = load(config_path())
    return _cached


def reset() -> None:
    """Forget the cached config; the next get_config() reads the file again."""
    global _cached
    _cached = None


def override(**changes) -> Config:
    """Replace fields of the cached config (tests). Returns the new config."""
    global _cached
    _cached = replace(get_config(), **changes)
    return _cached


def whmcs_enabled() -> bool:
    return get_config().whmcs_enabled


def margins_enabled() -> bool:
    return get_config().margins_enabled


def stripe_enabled() -> bool:
    return get_config().stripe_enabled


def stripe_settings() -> StripeConfig:
    """The checked [stripe] settings with every account's revenue category filled in.

    Empty (no accounts) when the feature is off: accounts are only active with it on.
    Checked again here so a config switched on with override() is validated too.
    """
    cfg = get_config()
    if not cfg.stripe_enabled:
        return replace(cfg.stripe, accounts=())
    every_category = (*cfg.revenue_categories, REFUNDS, *cfg.cogs_categories, *cfg.opex_categories)
    return _check_stripe(cfg.stripe, cfg.businesses, cfg.revenue_categories, every_category)


BUSINESS_DISABLED = "business mode is disabled (set features.business = true in config/local.toml)"
PERSONAL_DISABLED = "personal mode is disabled (set features.personal = true in config/local.toml)"
WHMCS_DISABLED = "WHMCS integration is disabled (set features.whmcs = true in config/local.toml)"
STRIPE_DISABLED = "Stripe integration is disabled (set features.stripe = true in config/local.toml)"


def load_rules_file(path: Path) -> list[tuple]:
    """Seed rules from a JSON list of objects, in file order, as seed_rules tuples."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigError(f"could not read seed rules file {path}") from exc
    if isinstance(data, dict):
        data = data.get("rules")
    if not isinstance(data, list):
        raise ConfigError(f"{path} must hold a list of rules")
    out = []
    for index, item in enumerate(data):
        where = f"{path.name}[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{where} must be an object")
        try:
            out.append(
                (
                    int(item["priority"]),
                    str(item["pattern"]),
                    str(item.get("field", "any")),
                    item.get("account"),
                    item.get("sign"),
                    str(item["tag"]),
                    str(item["category"]),
                    float(item["confidence"]),
                    str(item.get("note", "")),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ConfigError(f"{where} is missing priority, pattern, tag, category, or confidence") from exc
    return out
