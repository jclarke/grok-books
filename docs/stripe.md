# Stripe (optional)

For businesses that take payments with [Stripe](https://stripe.com/). hpbooks imports each Stripe account's balance transactions and payouts, books gross revenue, refunds, disputes, and Stripe fees into the ledger, and pairs every payout with the bank deposit it became, so revenue is counted once. It is off by default. With it off, the `stripe` commands exit with a message, the `/api/stripe/*` and `/export/stripe/*` routes answer 404, the UI has no Stripe page or dashboard card, `bin/hpbooks import` ignores `stripe/` folders, and no Stripe code is loaded.

## How it is booked

Each Stripe account is a business **cash account** in the ledger (`stripe-<name>`, institution Stripe), like a PayPal Business account. Stripe's balance moves by the net of each balance transaction, and so does the ledger account:

| Stripe type (`type` / `reporting_category`) | Ledger rows | P&L |
| --- | --- | --- |
| `charge`, `payment` (cards, ACH) / `charge` | gross `+amount` to the account's revenue category; fee `-fee` to `fee_category` | revenue and fees |
| `refund`, `payment_refund`, `refund_failure`, `payment_failure_refund`, `payment_reversal` / `refund`, `refund_failure` | `amount` to **Refunds** (negative; a failed refund comes back positive); any fee refund to `fee_category` | reduces revenue |
| `adjustment` / `dispute` (chargeback) | `amount` (negative) to **Refunds**, note "chargeback"; dispute fee to `fee_category` | reduces revenue |
| `adjustment` / `dispute_reversal`, `dispute_reversal` (won) | `amount` (positive) to **Refunds**; returned fee to `fee_category` | restores revenue |
| `stripe_fee`, `stripe_fx_fee`, `tax_fee`, `tax`, `network_cost` / `fee` | `amount` to `fee_category`; sales tax on the fee (its `fee` field) as a second row, also to `fee_category` | expense |
| `payout` / `payout` | `transfer` out of the Stripe account | none |
| `payout_failure`, `payout_cancel` / `payout_reversal` | `transfer` back in | none |
| `payout_minimum_balance_hold` / `_release`, `reserve_hold` / `_release`, `reserved_funds`, `risk_reserved_funds`, `connect_reserved_funds` | `transfer` rows in the Stripe account (they cancel out) | none |
| `financing…` (type or category), money out, e.g. `financing_paydown` | `transfer`, note "Stripe Capital repayment" | none (loan principal) |
| `financing…` (type or category), money in | `transfer` in, note "Stripe Capital financing" | none |
| anything else | `needs_review`, never guessed | review inbox |

- Revenue goes to the business of the `[[stripe.accounts]]` entry, in its `revenue_category` (default: that business's `revenue_category`, else the first revenue category).
- The ledger uses Stripe's settled `amount` in the balance currency. Balance transactions are final even while `status` is `pending` (that is only when funds become available); the status is stored and updated on re-import.
- Row ids are deterministic: `stripe:<name>:<txn_id>` for the amount and `stripe:<name>:<txn_id>:fee` for the fee, so a re-import updates in place and never duplicates. Dates are the `created` time in `[stripe] timezone` (America/New_York by default).
- Text rules never re-tag Stripe rows (`reclassify` leaves them alone). A manual classification is never overwritten by a re-import.
- Stripe Capital totals are listed separately in `stripe status` and on the Stripe page.

## Payout reconciliation (the double-count guard)

The bank feed (Finance) also sees every payout as a deposit, and the starter rules book `STRIPE … TRANSFER/PAYOUT` deposits as revenue. With Stripe on, the gross is already in the books from Stripe, so each payout must pair with its deposit:

- A deposit pairs with a payout when it is a positive row in a business cash account from the bank feed (and in the `payout_account` account, when that is set), the amount is equal to the cent, the date is from one day before to `payout_window_days` days after the payout's arrival date (its created date when the payouts file is missing), and its name, merchant, or description matches `payout_match`.
- **matched**: one candidate. The deposit is tagged `transfer` (note `Stripe payout po_… matched to …`), so P&L revenue counts the Stripe gross once.
- **conflict**: the only candidate was classified by hand as something other than a transfer. It is left as it is and reported.
- **ambiguous**: more than one candidate. Both sides stay unpaired and the deposits keep their rule tag; decide by hand (classify the right deposit as `transfer`).
- **in_transit**: no deposit yet and the window has not closed (or Stripe says the payout is pending / in transit).
- **unmatched**: the window closed with no deposit, or the payout's balance transaction has not been imported and Stripe does not say it is pending / in transit.
- **failed**: Stripe reports the payout failed or canceled, or a `payout_failure` / `payout_cancel` returned it.
- **skipped**: the payout or its Stripe account is not in the books currency; it is not matched.

The matcher runs after every Stripe import, after every `bin/hpbooks import` (a deposit can arrive after the payout file, or the reverse), and after `reclassify`. A deposit that loses its pair (for example, a pending bank row replaced by its posted row) goes back to the rules and the posted row is paired instead. Stripe-looking deposits that pair with no payout are listed as **bank only** by `stripe reconcile` and on the Stripe page: those are still booked by your rules, so check them.

## Multi-currency

The books are single-currency (`[stripe] books_currency`, default `usd`). A balance transaction in another currency, or every row of an account whose `currency` is not the books currency, is stored in the Stripe tables but not posted to the ledger, and counted as `skipped: currency` in the import output and `stripe status`. Nothing is ever converted. For converted charges (non-null `exchange_rate`), an optional charges file supplies the original presentment amount and currency for reference.

## Turn it on

In `config/local.toml`:

```toml
[features]
stripe = true

[stripe]
fee_category = "Payment Processing Fees"   # where Stripe fees go (an expense category)
payout_match = "(?i)stripe"                # regex a bank deposit's text must match to pair with a payout
payout_window_days = 5                     # 0 to 31: a deposit may land 1 day before to N days after the payout's arrival date
# books_currency = "usd"                   # rows in other currencies are stored, not posted
# timezone = "America/New_York"            # Stripe times become ledger dates in this zone
# secret = "stripe.secret"                 # optional direct-API mode: restricted read-only key in data/

[[stripe.accounts]]
name = "main"                  # lowercase letters, digits, -; file prefix in sync/inbox/.../stripe/<name>_N.json and --account
business = "general"           # business slug that gets the revenue and fees
stripe_account = "acct_..."    # optional: checks that a saved file belongs to this account
# label = "Stripe"             # display name (default "Stripe <name>")
# currency = "usd"             # settlement currency of this Stripe balance
# revenue_category = "Revenue - Sales"
# payout_account = "0001"      # last 4 or id of the bank account payouts land in; default any business cash account
# secret = "stripe_main.secret"  # direct-API key for this account (default [stripe] secret)
```

Add one `[[stripe.accounts]]` per Stripe account. A business without an entry simply does not use Stripe. Names, businesses, categories, and the regex are checked when the feature is on. Restart the web server after changing the config. The ledger account is registered on the first import.

## Daily sync with Grok Bot (Stripe connector)

hpbooks never calls Stripe in this mode. Grok Bot, with the Stripe connector, saves the tool results **verbatim** under the day's inbox folder, after the Finance import (see [sync/README.md](../sync/README.md#daily-stripe-sync)):

1. `list_available_accounts_or_orgs` → pick the `stripe_context` whose id is the `stripe_account` of each `[[stripe.accounts]]` entry, and its `livemode`. Use live mode for real books; never mix test and live data (files marked `livemode: false` are refused).
2. For each configured account: `stripe_api_read` with that `stripe_context` and `livemode`, `stripe_api_operation_id: "GetBalanceTransactions"`, and `parameters: {"limit": 100, "created": {"gte": <unix start of today minus 10 days, books time zone>, "lt": <unix start of tomorrow>}}`. Save the result as `sync/inbox/YYYY-MM-DD/stripe/<name>_1.json`. While `has_more` is true, call again with the same parameters plus `"starting_after": "<id of the last item in data>"` and save `<name>_2.json`, and so on.
3. The same for `GetPayouts` (same `limit` and `created`) → `<name>_payouts_1.json`, `<name>_payouts_2.json`, … Optionally `GetBalance` → `<name>_balance.json`.
4. Never call `stripe_api_write` or anything that changes Stripe.
5. `bin/hpbooks import sync/inbox/YYYY-MM-DD/` (or `bin/hpbooks stripe import sync/inbox/YYYY-MM-DD/stripe/`), then `bin/hpbooks stripe reconcile`.

The agent may add a `_query` object (`stripe_account`, `livemode`, `created_gte`, `created_lt`) to each saved file; when present, its `stripe_account` must match the entry's `stripe_account` and `livemode` must not be false (the dates are for reference only). A file can also hold a JSON list of pages, or the MCP wrapper `{"content": [{"type": "text", "text": "<json>"}]}`.

### File layout

```
sync/inbox/YYYY-MM-DD/stripe/
  main_1.json, main_2.json, …            GetBalanceTransactions pages
  main_payouts_1.json, …                 GetPayouts pages (arrival date, status, failures)
  main_balance.json                      optional GetBalance
  main_charges_1.json, …                 optional GetCharges (only amount, currency, balance_transaction are read)
```

`main_balance.json` records a balance anchor for the Stripe ledger account (available + pending in the account currency, as of the folder date; it is stored as a `statement` anchor with the note "Stripe balance (available + pending)"; outside a dated folder, such as `backfill-stripe/`, the date is today). The folder date is the day of the pull, so activity later that day can show as a small difference until the next pull.

### First load / backfill

Pull month by month from the date the books start (for example `created.gte` = the 1st of each month and `created.lt` = the 1st of the next), paging each window with `starting_after`, into `sync/inbox/backfill-stripe/stripe/<name>_<n>.json` and `<name>_payouts_<n>.json` with a running page number. Then `bin/hpbooks stripe import sync/inbox/backfill-stripe/stripe/`. The import is idempotent, so overlapping windows are fine.

## CLI

```bash
bin/hpbooks stripe import <files|dirs|globs> [--account NAME] [--dry-run]
bin/hpbooks stripe status [--account NAME] [--json]
bin/hpbooks stripe reconcile [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--account NAME] [--rows] [--format table|csv]
bin/hpbooks stripe sync [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--account NAME] [--inbox DIR]   # optional direct-API mode
```

- `import` takes the account from the file prefix (`<name>_N.json`, `<name>_payouts_N.json`); `--account` overrides it. Files for an unknown name, for another `stripe_account`, or in test mode are skipped with a message. Output per account: new / updated / unchanged balance transactions, ledger rows posted / refreshed, payouts new / updated (a payout is new when it did not exist before this run), rows skipped for currency or unreadable, then payouts by match status. `--dry-run` writes nothing.
- `bin/hpbooks import sync/inbox/YYYY-MM-DD/` picks up the `stripe/` subfolder when the feature is on and ignores it when off. The Finance importer never reads files in a `stripe/` folder.
- `status`: per account the business, last imported transaction date, counts by booking, the ledger account's activity and the latest Stripe balance anchor, gross / refunds / disputes / fees / net for this month and year to date, Stripe Capital repayments, payouts by status, rows needing review, and rows skipped for currency.
- `reconcile`: each payout (by arrival date) with its matched bank deposit (date, account, last 4) or status and note, the bank-only deposits, and totals (on stderr; `--format csv` prints the payouts and bank-only tables instead). Default range: this year to date; with only one of `--from` / `--to`, the other defaults to Jan 1 or today.
- `sync`: see [Direct-API mode](#direct-api-mode-optional). `--inbox` saves under another inbox directory (default `sync/inbox`).

## Web UI

With the feature on, the business sidebar has a **Stripe** section (also in the command palette) with one page, `/stripe`: KPI cards (gross, refunds + disputes, fees and the effective fee rate, net revenue), Stripe Capital when there is any, a per-account table when there is more than one account, a monthly chart and table, the payouts table with status badges (matched, in transit, unmatched, ambiguous, conflict, failed, skipped) and the matched bank deposit, the bank-only deposits, and CSV links. It follows the global date range and business filter. The business dashboard shows a compact Stripe card (gross, fees, net, and how many payouts are open and how many Stripe-looking deposits match no payout, linking to `/stripe`) once Stripe data exists.

API (read-only): `GET /api/stripe/summary`, `GET /api/stripe/payouts`, and `GET /export/stripe/{summary,accounts,payouts,bank-only}.csv` take `start`, `end`, `business`, and `account` (default range: this year to date); `GET /api/stripe/status` takes `account` only.

## Privacy

Only balance-transaction fields are stored (id, type, reporting category, amount, fee, net, currency, exchange rate, dates, status, source id, description, fee details, and, from a charges file, the original amount and currency), plus payout amounts, currency, dates, status, method, balance transaction id, failure code and message, and the match result. Customer names, emails, billing details, card details, and bank account details are never stored: a charges file is read for `amount`, `currency`, and `balance_transaction` only, and email addresses inside descriptions and failure messages are masked. The Stripe tables live in the encrypted database. Nothing is printed or logged that holds a key.

## Direct-API mode (optional)

If you would rather not use the connector, `bin/hpbooks stripe sync` calls the Stripe REST API itself (over HTTPS with the Python standard library; no extra package): `GET /v1/balance_transactions` and `GET /v1/payouts` with `created[gte]` / `created[lt]` and `starting_after` paging. It writes the pages verbatim (mode 600, with a `_query` object) to `sync/inbox/<today>/stripe/` and then imports them. The default window is the last 10 days.

It needs a **restricted** key (`rk_live_…`; anything that is not an `rk_` key, such as a secret `sk_…` key, is refused; an `rk_test_…` key is accepted, but its files are marked test mode and the import refuses them) with **read** permission for balance transactions and payouts, the only two endpoints it calls, and nothing else. Put it in a file next to the database, mode 600 (a looser mode is refused), and name the file in `[stripe] secret` (or per account in `[[stripe.accounts]] secret`; each account needs its own key). `*.secret` is gitignored and on the privacy scan's forbidden list. The key is sent only in the `Authorization` header and is never printed, logged, or written to the saved files.

```bash
install -m 600 /dev/null data/stripe.secret && $EDITOR data/stripe.secret
bin/hpbooks stripe sync --from 2026-09-01 --to 2026-09-30
```

## Tests

`tests/test_stripe.py` uses synthetic results from `tests/stripe_fake.py` (`acct_TEST…`, `txn_TEST…`, `po_TEST…` ids, round amounts) and never touches the network; the direct-API test drives a fake `urlopen`. The test config lists two Stripe accounts with the feature off, so the rest of the suite runs with Stripe off; the Stripe tests turn it on with `override(stripe_enabled=True)`.
