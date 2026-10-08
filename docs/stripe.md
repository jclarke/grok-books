# Stripe (optional)

For businesses that take payments with [Stripe](https://stripe.com/). hpbooks imports each Stripe account's balance transactions and payouts, books gross revenue, refunds, disputes, and Stripe fees into the ledger, and pairs every payout with the bank deposit it became, so revenue is counted once. With the billing objects pulled too (subscriptions, invoices, charges, ...), it adds [business analytics](#business-analytics): MRR and its movement, churn, cohorts, true margin per product, fee rates, the real cost of Stripe Capital, LTV, concentration, failed-payment recovery, refund trends, and a cash forecast. It is off by default. With it off, the `stripe` commands exit with a message, the `/api/stripe/*` and `/export/stripe/*` routes answer 404, the UI has no Stripe page or dashboard card, `bin/hpbooks import` ignores `stripe/` folders, and no Stripe code is loaded.

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
| `financing_payout` (Stripe Capital proceeds) | `transfer` in, note "Stripe Capital financing …", paired with a row on the loan account `stripe-<name>-capital` that raises the amount owed | none |
| `financing_paydown` (repayment), with `[[stripe.capital]]` terms | principal part: `transfer` out, paired with a loan account row that lowers the amount owed; fee part (`…:capfee`): `capital_fee_category` | the fee only (Interest) |
| `financing_paydown`, no terms | the whole repayment as a `transfer`, note "fee not split, add [[stripe.capital]] terms"; a loan account row only when the proceeds are in the history | none (warning) |
| `financing_payout_reversal`, `financing_paydown_reversal` | undo the original row's split (see [Stripe Capital](#stripe-capital)) | reverses the fee |
| other `financing…` types or categories | `transfer`, not split | none |
| anything else | `needs_review`, never guessed | review inbox |

- Revenue goes to the business of the `[[stripe.accounts]]` entry, in its `revenue_category` (default: that business's `revenue_category`, else the first revenue category).
- The ledger uses Stripe's settled `amount` in the balance currency. Balance transactions are final even while `status` is `pending` (that is only when funds become available); the status is stored and updated on re-import.
- Row ids are deterministic: `stripe:<name>:<txn_id>` for the amount and `stripe:<name>:<txn_id>:fee` for the fee (Capital adds `:capfee` and `:loan`), so a re-import updates in place and never duplicates. Dates are the `created` time in `[stripe] timezone` (America/New_York by default).
- Text rules never re-tag Stripe rows (`reclassify` leaves them alone). A manual classification is never overwritten by a re-import.
- Stripe Capital is a loan: see [Stripe Capital](#stripe-capital).

## Stripe Capital

[Stripe Capital](https://stripe.com/capital) is a loan: Stripe pays the principal into the Stripe balance and withholds a fixed percentage of sales until principal plus one flat fee (the "premium") is repaid. There is no interest compounding and no prepayment penalty; the fee is paid pro rata with each repayment.

### What Stripe exposes, and why the split uses your terms

The balance transactions carry four types: `financing_payout` (proceeds, positive), `financing_paydown` (a repayment withheld from sales, or a manual or bank payment, negative), and `financing_payout_reversal` / `financing_paydown_reversal` (undo the original). A withheld repayment's description reads like "Withheld funds from ch_… to pay down flex loan flxln_…"; hpbooks takes the financing id from the token after "loan" (or any `…ln_…` token). Manual repayments and the proceeds may not name it.

No balance transaction says how much of a repayment is fee and how much is principal, and the Capital API operations that would are not available through the Stripe connector. So the split is computed from the terms you enter, which reproduces Stripe's pro rata rule exactly:

```
fee share            = fee / (principal + fee)
fee booked after it  = min(fee, round(cumulative repaid x fee share))      rounded half up, to the cent
this repayment's fee = fee booked after it - fee booked before it
principal part       = repayment - fee part
```

Rows are taken per financing in (created, id) order. Because the rounding is cumulative, the fee rows add up to the fee and the principal rows to the principal exactly once the loan is repaid. When principal is fully repaid, any later repayment is fee until the fee is booked; anything beyond principal plus fee is an overpayment, booked as a credit on the loan account and reported.

### Where to find the terms

In the Stripe Dashboard, the **Capital** section lists each financing with the amount you received (the principal), the fixed fee, the withholding rate, and what remains; the loan agreement (the offer you accepted) states the same principal and fee. Use those two numbers; `fee_rate` is only a shortcut when the agreement states the fee as a percentage of the principal. The financing id (`flxln_…`) appears in the repayment descriptions, and `bin/hpbooks stripe capital` lists the ids it has seen.

### Config

```toml
[stripe]
capital_fee_category = "Interest"   # default: "Interest" if that category exists, else fee_category; must be an expense category

[[stripe.capital]]
account = "main"            # a [[stripe.accounts]] name
financing = "flxln_..."     # optional: the id seen in repayment descriptions; omitted = the default for that
                            # account's Capital rows that match no other entry
principal = 20000.00        # amount received
fee = 2000.00               # the flat fee from the offer; or fee_rate = 0.10 (fee = principal x rate); exactly one
# label = "Capital loan 2026"
# opening_principal = 12000.00  # principal still owed on start_date, when the proceeds are before your imported history
# start_date = "2026-01-01"     # required with opening_principal
```

A row that names no financing goes to the account's default entry; without one, to the account's only financing if there is exactly one. The Capital fee is a Schedule C line 16b expense (Interest, other) for the account's business; principal never appears in the P&L.

### The loan account

For each Stripe account with Capital terms (or with proceeds to post), the import registers `stripe-<name>-capital`, "Stripe Capital (<label>)": a business **liability** of class **loan**, institution Stripe, in net worth, Finance sync off. Like a card, its rows are signed from your side: proceeds are negative (the amount owed goes up), principal repayments positive (it goes down), and its balance is the principal owed. Each proceeds row and each principal row is a transfer pair: `stripe:<name>:<txn>` in the Stripe cash account and `stripe:<name>:<txn>:loan` on the loan account, each note naming the other.

With `opening_principal`, the loan account gets one opening row `stripe:<name>:capital:<financing or default>:opening` on `start_date`, and the figures assume what was repaid before it carried the fee pro rata. It is ignored (with a warning) once the `financing_payout` itself is imported.

### Reversals

A `financing_paydown_reversal` undoes the repayment it names (a `txn_…` id in its description, else the latest earlier repayment with the same `source`): the fee and principal come back in the same proportion as the original. When the original is unknown, it is reversed at the configured fee share. A `financing_payout_reversal` gives the proceeds back (the amount owed goes down).

### Missing terms, config changes, manual rows

- Without a matching `[[stripe.capital]]` entry, repayments stay whole transfers as before; a loan account row is posted only when the proceeds are in the history (and only up to them). `stripe status`, `stripe capital`, and the Stripe page warn "Capital fee not split: add [[stripe.capital]] terms" with the unsplit total.
- Every Stripe import recomputes the split for every account, so adding the terms later (or correcting the fee) re-books all Capital rows in place; fee rows that are no longer wanted are removed. Running it again changes nothing.
- A manual classification is never changed. If the new split would change the amount of a manually classified row, or remove it, that repayment's rows are left as they are and reported as a conflict (on import and in `stripe capital`).

### Proceeds paid to a bank account

If the financing was paid to your bank account instead of the Stripe balance, there is no `financing_payout`: set `opening_principal` (the principal) and `start_date` (the funding date), and classify the Finance bank deposit by hand as a `transfer` (it is the other side of the loan account's opening row), so it is not counted as revenue.

### Reports

`bin/hpbooks stripe capital [--account NAME] [--json]` and the Capital section of `stripe status` list per financing: principal, fee, repaid principal, fee booked, principal outstanding (equal to the loan account balance), and percent repaid, plus the loan account balance, conflicts, and warnings. The same figures are in `GET /api/stripe/summary` (`capital`), `GET /api/stripe/capital`, and the Stripe page's Capital card. They are lifetime figures; the date range only changes the "repaid in this range" line.

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
- **no_bank_history**: no deposit, and the payout arrived before the earliest imported row of the bank account(s) it can land in (its `payout_account`, else every business cash account). Usual after a long [backfill](#backfill-payouts): import older bank history and it matches. It is not counted as open.

Matching uses each payout's own arrival date, never today's, so a payout from last March is matched against March bank rows; "today" only decides whether a payout without a deposit is still **in_transit**. Deposits are looked up by amount first, so a year of daily payouts reconciles in about a second.

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

### Billing objects (Stripe insights)

The [business analytics](#business-analytics) also need the billing objects. Same `stripe_context` and `livemode` as above, read-only `stripe_api_read`, `"limit": 100`, paging with `"starting_after": "<id of the last item in data>"` while `has_more` is true, saved verbatim with a running page number:

| Operation id | Parameters | File |
| --- | --- | --- |
| `GetSubscriptions` | `{"limit": 100, "status": "all", "expand": ["data.discounts", "data.items.data.discounts"]}` (every status, including canceled; discounts expanded) | `<name>_subscriptions_<n>.json` |
| `GetCoupons` | `{"limit": 100}` (small; always in full) | `<name>_coupons_<n>.json` |
| `GetInvoices` | `{"limit": 100, "created": {"gte": …, "lt": …}}` (all statuses) | `<name>_invoices_<n>.json` |
| `GetInvoicePayments` | `{"limit": 100}` (optionally `"invoice": "in_…"` per invoice) | `<name>_invoice_payments_<n>.json` |
| `GetCharges` | `{"limit": 100, "created": {"gte": …, "lt": …}}` | `<name>_charges_<n>.json` |
| `GetCustomers` | `{"limit": 100}` | `<name>_customers_<n>.json` |
| `GetPrices` | `{"limit": 100}` | `<name>_prices_<n>.json` |
| `GetProducts` | `{"limit": 100}` | `<name>_products_<n>.json` |

- **Discounts**: Ask for the discounts expanded, `"expand": ["data.discounts", "data.items.data.discounts"]`, **and** pull `GetCoupons`. In the current API an expanded discount still names its coupon by id only: `{"id": "di_…", "object": "discount", "source": {"type": "coupon", "coupon": "<coupon id>"}, "start", "end", "subscription", "subscription_item", "promotion_code"}`; its terms (`percent_off`, `amount_off`, `currency`, `duration`, `duration_in_months`) come from the coupons file, matched by id. A discount whose coupon is expanded inline (`source.coupon` or the older `coupon` as an object) is read directly. A discount that is itself only an id (no expand), or whose coupon is not in an imported coupons file, falls back: MRR and the forecast take the discounted share of the subscription's most recent paid invoice, (line amount − discount) / line amount, and say so in the approximations. The coupon's `name` is never stored: it often holds a person's name.
- **Daily**: subscriptions (`status: all`, all pages; they change status), invoices, invoice payments, and charges for the same 10-day `created` window as the balance transactions; coupons in full (a short list, and a new coupon is needed as soon as a subscription uses it). Customers, prices, and products when something new appears (or weekly).
- **Backfill** (first load): subscriptions with `status: all` in full; invoices and charges month by month by `created` from the books' start date (as for [payouts](#backfill-payouts)); invoice payments in full (or per invoice); prices, products, and coupons in full; customers in full. Save under `sync/inbox/backfill-stripe/stripe/` with one running page number per kind.
- Import as usual: `bin/hpbooks import sync/inbox/YYYY-MM-DD/` or `bin/hpbooks stripe import <folder>`. The kind comes from the file name and from the list's `object` (`subscription`, `invoice`, `invoice_payment`, `charge`, `customer`, `price`, `product`, `coupon`); `livemode: false` is refused as for every Stripe file. Re-importing is idempotent, a newer pull updates rows (a subscription that became `canceled`), and a file from an older pull (by its inbox folder date) never overwrites newer data.
- **Privacy scrub**: after a successful import, the customers, invoices, charges, subscriptions, and coupons files are rewritten in place (atomically, mode 600) to the fields the books keep; see [Privacy](#privacy). `--keep-raw` (on `stripe import` and, with Stripe on, `import`) skips it; a dry run never rewrites.

In the current Stripe API an invoice has no `charge` or `payment_intent`: the link from an invoice to its payment is the invoice payment (`payment.payment_intent` or `payment.charge`). Older versions' `invoice.charge`, `invoice.payment_intent`, `invoice.subscription`, `charge.invoice`, and `line.price` are read when present.

### File layout

```
sync/inbox/YYYY-MM-DD/stripe/
  main_1.json, main_2.json, …            GetBalanceTransactions pages
  main_payouts_1.json, …                 GetPayouts pages (arrival date, status, failures)
  main_balance.json                      optional GetBalance
  main_charges_1.json, …                 GetCharges (presentment amounts, and the analytics)
  main_subscriptions_1.json, …           GetSubscriptions (status all)        } business analytics;
  main_invoices_1.json, …                GetInvoices                          } scrubbed after import
  main_invoice_payments_1.json, …        GetInvoicePayments
  main_customers_1.json, …               GetCustomers                         (scrubbed)
  main_prices_1.json, main_products_1.json, …
  main_coupons_1.json, …                 GetCoupons (resolves discount coupon ids) (scrubbed)
```

`main_balance.json` records a balance anchor for the Stripe ledger account (available + pending in the account currency, as of the folder date; it is stored as a `statement` anchor with the note "Stripe balance (available + pending)"; outside a dated folder, such as `backfill-stripe/`, the date is today). The folder date is the day of the pull, so activity later that day can show as a small difference until the next pull.

### Backfill payouts

The first load pulls everything from the date the books start, so every payout since then is reconciled against the bank history:

1. For each configured account, month by month from the books' start date: `GetPayouts` and `GetBalanceTransactions` for the same window, `{"limit": 100, "created": {"gte": <unix start of the 1st of the month>, "lt": <unix start of the 1st of the next month>}}` in the books time zone, paging each window with `"starting_after": "<id of the last item in data>"` while `has_more` is true.
2. Save them with one running page number per account: `sync/inbox/backfill-stripe/stripe/<name>_<n>.json` (balance transactions) and `<name>_payouts_<n>.json` (payouts).
3. `bin/hpbooks stripe import sync/inbox/backfill-stripe/stripe/`
4. `bin/hpbooks stripe reconcile --from <books start> --rows`

The import is idempotent, so overlapping windows, re-runs, and months imported out of order (older months in a second run) are fine; the matcher reruns over every payout each time. What to expect:

- **matched** for payouts whose deposit is in the imported bank history.
- **no_bank_history** for payouts that arrived before the first imported row of their bank account(s). Import that older Finance history (see [sync/README.md](../sync/README.md#history-backfill-for-a-newly-discovered-personal-account) for date windows) and they match.
- **in_transit** only for the last few days; **unmatched** / **ambiguous** / **conflict** need a look as described above.
- **Bank only**: before Stripe was on, your rules booked Stripe deposits as revenue. They pair automatically, and become transfers, once their payout is imported. Anything still bank only after the backfill is a deposit with no payout in the imported Stripe history (a window that was not pulled, another Stripe account, or something else); check it and classify it by hand.

## CLI

```bash
bin/hpbooks stripe import <files|dirs|globs> [--account NAME] [--dry-run] [--keep-raw]
bin/hpbooks stripe status [--account NAME] [--json]
bin/hpbooks stripe reconcile [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--account NAME] [--rows] [--format table|csv]
bin/hpbooks stripe capital [--account NAME] [--json]
bin/hpbooks stripe metrics [--month YYYY-MM] [--account NAME] [--json] [--section mrr|churn|cohorts|margin|fees|capital|ltv|concentration|recovery|refunds|forecast]
bin/hpbooks stripe sync [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--account NAME] [--inbox DIR]   # optional direct-API mode
```

- `import` takes the account from the file prefix (`<name>_N.json`, `<name>_payouts_N.json`); `--account` overrides it. Files for an unknown name, for another `stripe_account`, or in test mode are skipped with a message. Output per account: new / updated / unchanged balance transactions, ledger rows posted / refreshed, payouts new / updated (a payout is new when it did not exist before this run), rows skipped for currency or unreadable, then payouts by match status. `--dry-run` writes nothing.
- `bin/hpbooks import sync/inbox/YYYY-MM-DD/` picks up the `stripe/` subfolder when the feature is on and ignores it when off. The Finance importer never reads files in a `stripe/` folder.
- `status`: per account the business, last imported transaction date, counts by booking, the ledger account's activity and the latest Stripe balance anchor, gross / refunds / disputes / fees / net for this month and year to date, Stripe Capital repayments, payouts by status, rows needing review, and rows skipped for currency; then the Stripe Capital section (per financing, lifetime) with its warnings.
- `reconcile`: each payout (by arrival date) with its matched bank deposit (date, account, last 4) or status and note, the bank-only deposits, and totals (on stderr; `--format csv` prints the payouts and bank-only tables instead). Default range: this year to date; with only one of `--from` / `--to`, the other defaults to Jan 1 or today.
- `capital`: see [Stripe Capital](#reports).
- `metrics`: see [Business analytics](#business-analytics). The import output also lists, per account, the billing objects new / updated / unchanged (and `older-than-stored` for a file from an older pull), and how many files were scrubbed.
- `sync`: see [Direct-API mode](#direct-api-mode-optional). `--inbox` saves under another inbox directory (default `sync/inbox`).

## Web UI

With the feature on, the business sidebar has a **Stripe** section (also in the command palette) with one page, `/stripe`: KPI cards (gross, refunds + disputes, fees and the effective fee rate, net revenue), a Stripe Capital card when there is any (per financing: principal, fee, repaid principal, fee booked, outstanding, percent repaid, and the missing-terms warning), a per-account table when there is more than one account, a monthly chart and table, the payouts table with status badges (matched, in transit, unmatched, ambiguous, conflict, failed, skipped, no bank history) and the matched bank deposit, the bank-only deposits, and CSV links. It follows the global date range and business filter. The business dashboard shows a compact Stripe card (gross, fees, net, and how many payouts are open and how many Stripe-looking deposits match no payout, linking to `/stripe`) once Stripe data exists.

API (read-only): `GET /api/stripe/summary`, `GET /api/stripe/payouts`, and `GET /export/stripe/{summary,accounts,payouts,bank-only}.csv` take `start`, `end`, `business`, and `account` (default range: this year to date); `GET /api/stripe/capital` takes `business` and `account`; `GET /api/stripe/status` takes `account` only. The Stripe page links to **Stripe insights**.

**Stripe insights** (`/stripe/insights`, under Stripe in the sidebar and the command palette, only with the feature on) shows the [business analytics](#business-analytics) for the global date range and business filter, with a focus month picker (default: the last complete month in the range) and four tabs, kept in the URL (`?tab=growth|profit|cash`, `?month=YYYY-MM`, `?cohort=revenue`):

- **Overview**: KPI cards (MRR, ARR, active customers, ARPA, customer and revenue churn, NRR (trailing 12 months, else the focus month), at-risk MRR, the effective fee rate, and the Capital APR or "Terms needed"), the MRR trend, the focus month's MRR bridge (waterfall and table), MRR by product, and the approximations in a muted note.
- **Growth and churn**: MRR movement by month (stacked bars with the net change), the movement table, churned customers voluntary vs involuntary, churn rates, NRR / GRR by month, and the cohort retention heatmap (customers or revenue, % of month 0).
- **Profit and fees**: true margin per product (sortable, with totals) and a bar list of margin $, the effective fee rate by payment method over time, the fees-by-method table (every method, including ACH with no charges; Link is labeled card-funded), the ACH savings estimate with its assumptions, and the Capital cost (APR per financing, the withheld share by month from the loan's start, and a warning when terms are missing).
- **Cash and risk**: LTV, ARPA, and margin cards (payback only with a CAC; otherwise a note says how to set one), revenue concentration (top 1 / 5 / 10, HHI, the top customers by `cus_` id), failed-payment recovery by month (invoices still in dunning shown as in progress), refunds and disputes by product with spike badges and highlighted rows, and the cash forecast (daily balance with the low point marked, and a weekly table of renewals, payouts in transit, Capital withholding, bills, and card due dates).

Every table has CSV / XLSX / PDF links to `/api/stripe/metrics/export/<table>`. With no billing objects imported the page says what to pull. The dashboard's Stripe card adds the last complete month's MRR, customer churn, and net new MRR with a link to the insights.

## Business analytics

`bin/hpbooks stripe metrics` and `GET /api/stripe/metrics` turn the imported [billing objects](#billing-objects-stripe-insights) and balance transactions into the figures below. Everything is in the books currency (objects in another currency are left out and listed), by calendar month in `[stripe] timezone`, integer cents. The focus month defaults to the last complete month and the range to the 12 months ending with it; with a range, to the range's last month, or the month before when the range ends in the current month and starts earlier. The business filter and `--account` / `account` pick the `[[stripe.accounts]]` entries. Customers appear by Stripe id only (`cus_…`), never by name. Every response has an `approximations` list saying what was estimated and why.

| Metric | Definition | Data | Approximations |
| --- | --- | --- | --- |
| **MRR**, **ARR** | At month end (for the current month: today), the subscriptions that had started and not ended, status active or past_due (today) — trials excluded and reported as **trialing MRR**; unpaid, paused, and incomplete excluded. An item is `unit_amount × quantity` per month: year / 12, week × 52 / 12, day × 365 / 12, divided by `interval_count`, less recurring discounts. A discount applies while `start ≤ T < end` (no `end`: for good; a `repeating` coupon without an `end` until `start` + `duration_in_months`); `once` coupons never count. A percent coupon scales the amount; an `amount_off` coupon is per billing period, made monthly with the subscription's (or the item's) interval, and never takes MRR below zero. A subscription that a `forever` coupon takes to zero (100% off) is **free**: not a paying customer, so it is left out of customers, ARPA, the churn denominators, and the cohorts, and counted as `free_subscriptions`. Metered prices are not MRR: their invoiced amounts are **usage revenue**. ARR = MRR × 12. ARPA = MRR / customers with MRR. | subscriptions, items, prices, coupons, invoice lines | Stripe keeps only a subscription's current items plus its dates, so past months take the amounts of that period's invoice lines (`subscription_create` / `_cycle` / `_update` invoices, prorations excluded). A month with no such invoice uses the current items (listed). Discounts whose coupon terms are not imported (the discount saved as an id only, or a coupon id missing from the coupons file) use the discounted share of the subscription's most recent paid invoice (listed); with no paid invoice they are not applied (listed). An `amount_off` coupon in another currency is not applied (listed). Past statuses are not known: before today a started, not-ended subscription counts as active; an unpaid subscription leaves MRR when its unpaid invoices began. Tiered prices without `unit_amount` count as zero. |
| **MRR movement** | Per customer, month end over month end (as `whmcs_reports`): **new** (first MRR ever), **reactivated** (MRR again after a month at zero), **expansion**, **contraction**, **churned** (to zero). Opening + new + reactivated + expansion − contraction − churned = closing, exactly (MRR is rounded once per customer). | MRR | A customer who joins and leaves within one month is never seen. |
| **Churn** | Customer churn = churned customers / customers at the start of the month. Gross revenue churn = (churned + contraction) / opening MRR; net revenue churn = (churned + contraction − expansion) / opening MRR. **Involuntary** when a subscription that ended that month was canceled with `cancellation_details.reason = payment_failed`, is `unpaid` or `incomplete_expired`, or its last invoice is `uncollectible` after at least one attempt; otherwise voluntary. | movement, subscriptions, invoices | |
| **NRR**, **GRR** | Monthly: (opening + expansion − contraction − churned) / opening, and the same without expansion. Trailing 12 months: the customers with MRR 12 months before, their MRR now (NRR) and capped at their MRR then (GRR), over their MRR then. | MRR | Needs 12 months of history. |
| **Cohorts** | Signup month = the month of the customer's first paid subscription invoice (else `customer.created`, else the subscription start). Per cohort and month since signup: customers with MRR (and % of the cohort), paid subscription invoice revenue (and % of month 0). | invoices, customers, MRR | |
| **True margin per product** | Gross revenue minus Stripe fees, refunds, disputes (net of disputes won), Capital fees, and COGS, in $ and %. Revenue balance transactions are attributed through charge → invoice → lines → product, the charge prorated across lines by line amount; refunds and disputes follow their charge, fees their balance transaction. Capital fees (the `:capfee` ledger rows) and `cogs_categories` are allocated by revenue share in the month; `cogs` entries go to the listed products by their revenue share. | balance transactions, charges, invoice payments, invoices, the ledger | **Linking**: charge → invoice through the invoice payment (`payment_intent` or `charge`), else the legacy `invoice.charge` / `payment_intent` / `charge.invoice`, else a heuristic: same customer, same amount, paid within 2 days, only when exactly one invoice fits (counted in `margin.links`). A refund goes to the charge whose expanded `refunds` lists it, else to the latest earlier charge with that much refunded; a dispute to the `ch_` id in its description, else to the one disputed charge of that amount. Anything unlinked, and Stripe's own fees (billing, tax), is **Unattributed**. A succeeded charge without an imported balance transaction counts its gross with an unknown fee (listed). |
| **Fee rate by method** | Per month, fees / gross for card, Link (Stripe Link, card-funded and priced like a card), ACH (`us_bank_account`; many accounts have none), and other (`payment_method_details.type`). | charges + their balance transactions | Charges without a balance transaction are left out. |
| **Estimated ACH savings** | For every card and Link charge: its fee − min(amount × ACH rate, $5). The ACH rate is your own observed ACH rate when there is ACH history, else Stripe's list price (0.8%, capped at $5). | same | An estimate; customers may not switch. |
| **Capital true cost** | Per financing with `[[stripe.capital]]` terms: the IRR of the actual cash flows (proceeds in on their day, each repayment out on its day), solved by bisection; `apr_pct` = daily rate × 365, `effective_annual_pct` = (1 + daily rate)^365 − 1. **Withheld share**: repayments / gross charges, from the loan's start (the first financing payout, else the first repayment; sales earlier that month do not count) to the last repayment (or today while anything is owed): per day (averaged over days with both) and per month, the monthly average over those active months (`start_date`, `active_months`). The forecast uses the last 90 days of the same. | Capital balance transactions, terms | An unfinished loan's remaining principal + fee is projected at the average daily repayment so far (`projected`). With `opening_principal`, the flows start at `start_date`. Without terms the APR is unknown (said so); the withheld share is still shown. |
| **LTV and payback** | ARPA × gross margin % (the margin over the range) / monthly revenue churn (gross revenue churn over the last 12 months). Churn under 1/60 is capped at 1/60 (a 60-month lifetime) and flagged `churn_capped`. Payback months = CAC / (ARPA × margin %), only with `[stripe.metrics] cac`, or `cac_category` (that category's spend over 12 months / new customers in them); otherwise omitted with a note. | MRR, movement, margin, the ledger | |
| **Concentration** | Over the 12 months ending with the focus month: the top 1, 5, and 10 customers' share of gross charge revenue, the top 10 by id, and HHI = Σ (share %)² over customers (0–10,000). | charges, balance transactions | Revenue without a customer counts in the total, not in the ranking. |
| **Failed-payment recovery** | Per month (invoice created month): failed charge attempts (count, amount); invoices that needed a retry (paid after more than one attempt, or open / uncollectible / void after at least one); **recovered** (eventually paid), **lost** (uncollectible, void, or open on a subscription canceled for `payment_failed`), **in progress** (open with `next_payment_attempt` today or later: Stripe is still retrying), still open (no retry left); recovery rate = recovered / (recovered + lost), so invoices in progress are in neither. **At-risk MRR** now = MRR of past_due and unpaid subscriptions. | charges, invoices, subscriptions | |
| **Refund and dispute trends** | Per product and month: gross, refunds, disputes, refund rate (refunds / gross), dispute rate. A **spike** is a month whose refund rate is more than `spike_factor` (2) × the median of the previous 6 months' rates (at least 3 months with sales) and whose refunds are at least `spike_min` ($50). | margin attribution | |
| **Cash forecast** | Daily and weekly for `forecast_days` (90): opening = the business bank accounts' balance (not Stripe, not cards); plus each licensed subscription item's renewals (at `current_period_end`, then every interval, unless canceled at period end) × the expected collection rate (paid / due on the last 6 months' subscription invoices) less the effective fee rate, arriving after the observed lag (median days to `available_on` + median payout created → arrival); minus Capital withholding at the observed share (last 90 days) while principal + fee is owed; plus payouts in transit and the Stripe balance not yet paid out; minus recurring bills paid from the bank (the Calendar's recurring outflows, repeated at their interval) and card minimum payments on their due dates (Payments, repeated monthly). The running balance's lowest point is flagged. | everything above + the books | An estimate. Metered usage is not forecast. Later card minimums repeat the current one. Banks and cards carry no business, so with a business filter they are still every business account (noted). |

Config (all optional):

```toml
[stripe.metrics]
cogs = [{ category = "Hosting & Infrastructure", products = ["prod_..."] }]  # spend charged to these products
cogs_categories = ["Contractors"]   # spend allocated over every product by revenue share
# cac = 250.00                      # acquisition cost per new customer, for payback
# cac_category = "Advertising"      # or: that category's spend / new customers (12 months)
# spike_factor = 2.0                # refund spike: rate > factor x the 6-month median ...
# spike_min = 50.00                 # ... and refunds of at least this much
# forecast_days = 90                # 7 to 365
```

COGS categories are read from the books for the Stripe account's business. Categories must exist and be expense categories (checked when the feature is on).

**CLI.** `bin/hpbooks stripe metrics` prints the KPI summary and the MRR movement bridge for the focus month (`--month YYYY-MM`, default the last complete month); `--section NAME` prints one section's tables in full; `--json` prints the whole response (or the section).

**API** (read-only, Stripe on): `GET /api/stripe/metrics?start&end&month&business&account` returns

- top level: `ok`, `ready`, `start`, `end`, `month`, `business`, `account`, `currency`, `as_of`, `accounts`, `summary`, `approximations`, and one key per section;
- `summary`: `mrr_cents`, `arr_cents`, `trialing_mrr_cents`, `active_customers`, `free_subscriptions`, `arpa_cents`, `net_new_mrr_cents`, `customer_churn_pct`, `gross_revenue_churn_pct`, `net_revenue_churn_pct`, `nrr_t12m_pct`, `grr_t12m_pct`, `gross_margin_pct`, `effective_fee_pct`, `ltv_cents`, `top10_share_pct`, `hhi`, `recovery_rate_pct`, `at_risk_mrr_cents`, `forecast_low_cents`, `forecast_low_date`;
- `mrr`: the focus month's figures, `bridge`, `by_product`, `months` (MRR, ARR, trialing, customers, subscriptions, free subscriptions, ARPA, usage revenue, and the movement per month);
- `churn`: `month` (the focus month's row), `months`, `nrr_t12m_pct`, `grr_t12m_pct`;
- `cohorts`: `cohorts` (`cohort`, `customers`, `retention` cells `k`, `month`, `customers`, `customers_pct`, `revenue_cents`, `revenue_pct`), `max_k`;
- `margin`: `products`, `totals`, `months`, `cogs`, `links`;
- `fees`: `months` (per method `count`, `gross_cents`, `fees_cents`, `rate_pct`), `range`, `ach_savings` (with `card_rate_pct`, `link_rate_pct`, `link_share_pct`, `ach_history`);
- `capital`: `financings` (`apr_pct`, `effective_annual_pct`, `remaining_cents`, `projected`, `note`, …), `withheld` (`start_date`, `months`, `active_months`, `avg_daily_share_pct`, `avg_monthly_share_pct`, `days`);
- `ltv`: `arpa_cents`, `gross_margin_pct`, `monthly_revenue_churn_pct`, `churn_capped`, `lifetime_months`, `ltv_cents`, `cac_cents`, `cac_source`, `payback_months`, `notes`;
- `concentration`: `top1_pct`, `top5_pct`, `top10_pct`, `hhi`, `top`, `total_cents`, `customers`, window;
- `recovery`: `months` (with `in_progress_invoices`, `in_progress_cents`), `totals`, `at_risk_mrr_cents`, `at_risk_subscriptions`, `collection_rate_pct`;
- `refunds`: `months`, `products` (per product `months`), `spikes`, `spike_factor`, `spike_min_cents`;
- `forecast`: `daily` (`inflow_cents`, `outflow_cents`, `balance_cents`, `lowest`), `weekly` (with signed `renewals_cents`, `in_transit_cents`, `capital_withholding_cents`, `bills_cents`, `cards_cents`), `events` (`date`, `kind`, `label`, `cents`), `lowest`, `opening_cash_cents`, `closing_cents`, the rates and lag used, `totals`, `notes`.

`GET /api/stripe/metrics/<section>` returns the same top-level fields and `summary` (its `forecast_*` fields are null unless the section is `forecast`) with one section. `GET /api/stripe/metrics/export/<table>.<csv|xlsx|pdf>` (same query string) exports a table through the report writers: `summary`, `mrr`, `movement`, `mrr-products`, `churn`, `cohorts`, `cohort-revenue`, `margin`, `margin-months`, `fees`, `fees-methods`, `capital`, `capital-withheld`, `ltv`, `concentration`, `recovery`, `refunds`, `forecast`, `forecast-weekly`, `forecast-events`.

## Privacy

Only balance-transaction fields and the whitelisted billing-object fields are stored. Balance transactions: (id, type, reporting category, amount, fee, net, currency, exchange rate, dates, status, source id, description, fee details, and, from a charges file, the original amount and currency), plus payout amounts, currency, dates, status, method, balance transaction id, failure code and message, and the match result. Customer names, emails, billing details, card details, and bank account details are never stored: a charges file is read for `amount`, `currency`, and `balance_transaction` only, and email addresses inside descriptions and failure messages are masked. Billing objects go through one whitelist (`WHITELIST` in `hpbooks/stripe_objects.py`) before anything reads them: customers keep only id, created, delinquent, and currency; subscriptions their customer id, status, dates, cancellation reason, trial dates, discounts (coupon terms), and items (price, product, quantity, periods); invoices their customer and subscription ids, status, billing reason, amounts, attempts, dates, and lines (amount, discount, price, product, period, proration); invoice payments their invoice, amounts, status, dates, and payment reference; charges their customer id, amount, refunded amount, currency, status, disputed, payment method type, failure code, outcome type and network status, and balance transaction, payment intent, invoice, and refund ids; prices their product, nickname, amount, and interval; products their name and active flag (product and price names are business data); coupons their percent or amount off, currency, duration, months, valid flag, and created date (never the coupon name, which often holds a person's name). Names, emails, phones, addresses, `billing_details`, `shipping`, card details, receipt and hosted invoice URLs, `invoice_pdf`, `account_name`, every `customer_*` field, descriptions, cancellation comments, and metadata are never stored. After a successful import the customers, invoices, charges, subscriptions, and coupons files are rewritten in place to the same whitelisted fields (atomically, mode 600; `--keep-raw` opts out), and the rewritten files re-import to the same rows. The Stripe tables live in the encrypted database. Nothing is printed or logged that holds a key.

## Direct-API mode (optional)

If you would rather not use the connector, `bin/hpbooks stripe sync` calls the Stripe REST API itself (over HTTPS with the Python standard library; no extra package): `GET /v1/balance_transactions` and `GET /v1/payouts` with `created[gte]` / `created[lt]` and `starting_after` paging. It writes the pages verbatim (mode 600, with a `_query` object) to `sync/inbox/<today>/stripe/` and then imports them. The default window is the last 10 days.

It needs a **restricted** key (`rk_live_…`; anything that is not an `rk_` key, such as a secret `sk_…` key, is refused; an `rk_test_…` key is accepted, but its files are marked test mode and the import refuses them) with **read** permission for balance transactions and payouts, the only two endpoints it calls, and nothing else. Put it in a file next to the database, mode 600 (a looser mode is refused), and name the file in `[stripe] secret` (or per account in `[[stripe.accounts]] secret`; each account needs its own key). `*.secret` is gitignored and on the privacy scan's forbidden list. The key is sent only in the `Authorization` header and is never printed, logged, or written to the saved files.

```bash
install -m 600 /dev/null data/stripe.secret && $EDITOR data/stripe.secret
bin/hpbooks stripe sync --from 2026-09-01 --to 2026-09-30
```

## Tests

`tests/test_stripe.py`, `tests/test_stripe_capital.py`, `tests/test_stripe_backfill.py`, and `tests/test_stripe_metrics.py` use synthetic results from `tests/stripe_fake.py` (`acct_TEST…`, `txn_TEST…`, `po_TEST…`, `flxln_TEST…`, `cus_TEST…`, `sub_TEST…`, `in_TEST…`, `ch_TEST…`, `price_TEST…`, `prod_TEST…`, `co_TEST…` ids, round amounts, "Plan A" names, and `PII-MARKER` placeholders where personal data would be, to prove the scrub) and never touches the network; the direct-API test drives a fake `urlopen`. The test config lists two Stripe accounts with the feature off, so the rest of the suite runs with Stripe off; the Stripe tests turn it on with `override(stripe_enabled=True)`.
