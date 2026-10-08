# Daily Finance MCP sync

hpbooks does not call Finance MCP itself. An agent (or you) pulls transactions and drops the raw responses in `sync/inbox/`. `bin/hpbooks import` then loads them. Those files are gitignored.

For the first load, pull the history you want (for example from January 1 of the current year) into a dated folder such as `sync/inbox/seed/` in date windows, and import it the same way. Daily runs after that pull a short overlapping window and import it.

## Accounts and tools

The account list comes from the database. Print it, with the tool and inbox file prefix for each account, before every run:

```bash
bin/hpbooks accounts sync-list            # business and personal, sync-enabled, not excluded or closed
bin/hpbooks accounts sync-list --json     # same, for an agent
```

Pull **per scope**: business accounts exactly as below (same commands and file names), personal accounts into `sync/inbox/YYYY-MM-DD/personal/<last4-or-label>_<page>.json` (the `file_prefix` column already includes `personal/`). Excluded accounts and accounts with daily sync turned off are not listed; do not pull them.

Pass one account per request. Use `date_from` and `date_to`. Do not use `start_date` / `end_date`.

Cash and investment accounts use `finance_query_account_transactions`. Liability accounts (cards, loans, mortgages) use `finance_query_liability_transactions`.

`sync-list` is the authoritative list of accounts, tools, and file prefixes. A business account's `file_prefix` is its last 4 (or a short label such as `paypal` for an account without one); a personal account's prefix starts with `personal/`.

If an aggregator has no history for an account before some date (a newly opened card, say), pulls before that day come back empty; that is expected.

## Fetch

Each day, pull the last 10 days for every account. Overlap is intentional: that is how a pending transaction drops out of a later pull and the posted transaction with a new id gets matched.

Use `limit` 500.

1. First call, one account:
   - cash: `finance_query_account_transactions`
   - cards: `finance_query_liability_transactions`
   - `account_ids`: `[<that account id>]`
   - `date_from`: 10 days ago (`YYYY-MM-DD`)
   - `date_to`: today
   - `limit`: `500`
2. Save the tool result **verbatim** (do not reshape it) to:

   `sync/inbox/YYYY-MM-DD/<account>_<page>.json`

   `<account>` is the account's `file_prefix` from `accounts sync-list` (its last 4, or a label such as `paypal`). `<page>` starts at 1. For a personal account, use its `file_prefix` from `accounts sync-list`, which puts the file in the `personal/` subfolder: `sync/inbox/YYYY-MM-DD/personal/1111_1.json`.

   The result is often:

   ```json
   {"format":"csv","csv":"id,account_id,date,amount,direction,currency,name,merchant_name,description,pending,category\n...","row_count":N,"next_cursor":"..."}
   ```

   Card results use a `liability_id` column instead of `account_id` and may omit `category`. Save them verbatim. You may add a `_query` object (`account_ids`, `date_from`, `date_to`) so an account that returned no rows still closes out pending transactions in that window. One file may contain several accounts; the importer groups them.

3. Pagination: the tool says pass `cursor` alone to page. The next call is only:

   ```json
   {"cursor": "<next_cursor>", "limit": 500}
   ```

   Do not repeat `account_ids` or the dates on later pages. Write page 2, page 3, and so on, until `next_cursor` is null or empty. Do not drop pages and do not edit the CSV text.

## Daily run checklist

1. Run `bin/hpbooks accounts sync-list --json`. For each account it lists (business and personal), call its `tool` with `date_from` = today minus 10 days, `date_to` = today, and `limit` 500.
2. Save page 1 verbatim as `sync/inbox/YYYY-MM-DD/<file_prefix>_1.json` (business files at the top of the day folder, personal ones under `personal/`).
3. While `next_cursor` is set, call again with only `{"cursor": "<next_cursor>", "limit": 500}` and save the next page.
4. Import the directory. It reads the business files and the `personal/` subfolder; each account's scope decides how its rows are classified, and the output shows rows per scope:

   ```bash
   bin/hpbooks import sync/inbox/YYYY-MM-DD/
   ```

   An account id the database does not know is skipped and named in the output. Register it with `accounts discover` (below), then import again.

5. Stripe, only when `features.stripe = true`: save each configured Stripe account's balance transactions and payouts from the Stripe connector into `sync/inbox/YYYY-MM-DD/stripe/` (see [Daily Stripe sync](#daily-stripe-sync)). If they were saved before step 4, the import above already read them; otherwise import them now, then check the payouts:

   ```bash
   bin/hpbooks stripe import sync/inbox/YYYY-MM-DD/stripe/
   bin/hpbooks stripe reconcile
   ```

6. Refresh the WHMCS billing copy. This always runs after the Finance import, so the PayPal reconciliation uses the same day's ledger (see [Daily WHMCS sync](#daily-whmcs-sync)):

   ```bash
   bin/hpbooks whmcs sync
   ```

7. Refresh posted balances from Finance. Call `finance_list_accounts` with `class` `cash`, then `liability` (and `investment` if personal investment accounts are synced). Save the results as `sync/inbox/YYYY-MM-DD/accounts/finance_list_accounts.json` (in the `accounts/` subfolder, which `import` does not read; a JSON list of the tool results is fine). For every sync-enabled account of both scopes, record that row's `current_balance` (do not use `available_balance`). On a card or loan, `current_balance` is the amount owed and is entered as a positive number. The as-of date is today, because `current_balance` is the posted balance:

   ```bash
   bin/hpbooks balances set <last4-or-label> --balance <current_balance> --as-of YYYY-MM-DD --source finance
   ```

   Run it once per account, business and personal; `balances set` accepts any registered account. Skip excluded accounts. Each `balances set` appends an anchor and an audit row; it does not edit transactions.

   Instead of one `balances set` per personal account you can run `bin/hpbooks accounts discover sync/inbox/YYYY-MM-DD/accounts/finance_list_accounts.json --as-of YYYY-MM-DD`. It records a finance anchor for every non-excluded account in the file (skipping one already recorded with the same date and amount), registers any new account as personal, and never changes an existing account's scope.

8. Look at what still needs a human:

   ```bash
   bin/hpbooks review --year YYYY
   bin/hpbooks transfers
   bin/hpbooks reconcile --year YYYY
   bin/hpbooks pnl --year YYYY --by month
   bin/hpbooks personal review
   bin/hpbooks personal transfers          # ambiguous personal transfer pairs to confirm
   bin/hpbooks personal budgets --alerts
   ```

## New personal accounts

1. Save the `finance_list_accounts` result (all classes) and preview: `bin/hpbooks accounts discover <file> --dry-run`. The table shows last 4 only.
2. Register: `bin/hpbooks accounts discover <file>`. New accounts become `personal` (use `--scope` for something else); fix any with `bin/hpbooks accounts set-scope <last4> business|excluded`.
3. `bin/hpbooks accounts sync-list --scope personal` now includes them.

### History backfill for a newly discovered personal account

Pull from the start of the period you keep books for, or the earliest date Finance has, in date windows (for example one calendar month per request, `limit` 500, paging with `{"cursor": ..., "limit": 500}` only) so no window hits the page limit unnoticed. Add a `_query` object (`account_ids`, `date_from`, `date_to`) to each saved page so empty windows still close out pending rows. Save the pages under `sync/inbox/backfill-<last4>/personal/<last4>_<n>.json` and run `bin/hpbooks import sync/inbox/backfill-<last4>/`, then `bin/hpbooks personal reclassify`. The import is idempotent, so overlapping windows are fine.

The importer is idempotent. Importing the same file again reports `unchanged` and does not duplicate rows. A pending transaction that disappears from a later pull is marked superseded. If a posted transaction in the new file matches it (same account, amount equal or within 20%, date within 7 days), a manual classification is copied onto the posted row.

`needs_review` is the queue of genuinely ambiguous items (IRS payments, card payments that matched no card, unknown merchants). Fix one with:

```bash
bin/hpbooks classify <id-prefix> --tag general --category "Software & Licenses" --note "confirmed" --rule
```

`--rule` stores a rule and applies it to the other non-manual rows that match.

## Daily WHMCS sync

Only when `features.whmcs = true` in the config. `hpbooks whmcs sync` refreshes the WHMCS billing copy. It needs nothing staged in `sync/inbox/`: it opens the SSH tunnels itself (the ports and key from `[whmcs]` in the config), reads every configured brand read-only, writes only the `whmcs_*` tables in the encrypted database, and closes the tunnels it opened. A tunnel that is already open is reused and left open.

Run it once a day, after the Finance MCP import so the PayPal reconciliation sees the same day's ledger:

```bash
bin/hpbooks whmcs sync      # exit status 1 if any brand failed
bin/hpbooks whmcs status    # last good sync per brand and the recent log
bin/hpbooks whmcs reconcile # PayPal: matched, WHMCS only, PayPal only, per month
```

If a billing server's firewall lets in only some addresses, a tunnel can time out. The command retries each tunnel up to 12 times, 5 seconds apart, and a brand that still fails is logged with its error while the other brands go ahead. Running it again later is safe: the sync is a full refresh keyed by (brand, WHMCS id).

Placeholder credit is not imported. A `tblcredit` row at or above `whmcs.placeholder_credit_cents` ($1,000,000 by default) (either sign) is skipped, and a client or invoice credit that large is stored as 0. The sync output shows `skipped_placeholder_credit=N` when anything was skipped, and the sync log records the counts under `placeholder_credit`. Because the sync is a full refresh, rows imported before this rule are removed on the next run.

Nothing in the sync output, the sync log, or the audit log contains customer names, emails, or the MySQL password.

## Daily Stripe sync

Only when `features.stripe = true` in the config, with one `[[stripe.accounts]]` entry per Stripe account (see [docs/stripe.md](../docs/stripe.md)). hpbooks never calls Stripe here: Grok Bot reads Stripe with the Stripe connector and saves every result verbatim. Do it after the Finance pull, the same day:

1. Call `list_available_accounts_or_orgs`. For each `[[stripe.accounts]]` entry, pick the `stripe_context` whose id equals its `stripe_account`, and that context's `livemode`. Use live mode for real books; never mix test and live data.
2. For each configured account, call `stripe_api_read` with that `stripe_context` and `livemode`, `stripe_api_operation_id: "GetBalanceTransactions"`, and

   ```json
   {"limit": 100, "created": {"gte": <unix start of today minus 10 days, books time zone>, "lt": <unix start of tomorrow>}}
   ```

   Save the result verbatim as `sync/inbox/YYYY-MM-DD/stripe/<name>_1.json` (`<name>` is the entry's `name`). While `has_more` is true, call again with the same parameters plus `"starting_after": "<id of the last item in data>"` and save `<name>_2.json`, `<name>_3.json`, and so on.
3. The same for `stripe_api_operation_id: "GetPayouts"` with `{"limit": 100, "created": {...same...}}` → `<name>_payouts_1.json`, `<name>_payouts_2.json`, … Optionally call `GetBalance` and save `<name>_balance.json`.
4. Never call `stripe_api_write` or any tool that changes Stripe.
5. Import and check the payouts:

   ```bash
   bin/hpbooks import sync/inbox/YYYY-MM-DD/        # reads stripe/ too when Stripe is on
   # or: bin/hpbooks stripe import sync/inbox/YYYY-MM-DD/stripe/
   bin/hpbooks stripe reconcile                     # payouts vs bank deposits, and bank-only deposits
   ```

You may add a `_query` object to each saved file (`stripe_account`, `livemode`, `created_gte`, `created_lt`); the import refuses a file whose `stripe_account` is not the entry's `stripe_account`, and any file marked `livemode: false` (in `_query` or in the results). The import is idempotent: the overlapping 10-day window updates rows in place (a `pending` charge that became `available` is updated, not duplicated).

### Stripe insights (billing objects)

For the business analytics (`bin/hpbooks stripe metrics`; see [docs/stripe.md](../docs/stripe.md#business-analytics)), pull the billing objects too, with the same `stripe_context`, `livemode`, and read-only `stripe_api_read`, `"limit": 100`, paging with `"starting_after": "<id of the last item in data>"` while `has_more` is true, each page saved verbatim with a running number:

| `stripe_api_operation_id` | Daily parameters | Save as |
| --- | --- | --- |
| `GetSubscriptions` | `{"limit": 100, "status": "all", "expand": ["data.discounts", "data.items.data.discounts"]}` (every page; statuses change) | `stripe/<name>_subscriptions_<n>.json` |
| `GetInvoices` | `{"limit": 100, "created": {...same 10-day window...}}` | `stripe/<name>_invoices_<n>.json` |
| `GetInvoicePayments` | `{"limit": 100}` (or `"invoice": "in_…"` for each new invoice) | `stripe/<name>_invoice_payments_<n>.json` |
| `GetCharges` | `{"limit": 100, "created": {...same...}}` | `stripe/<name>_charges_<n>.json` |
| `GetCustomers` | `{"limit": 100}` (weekly is enough) | `stripe/<name>_customers_<n>.json` |
| `GetCoupons` | `{"limit": 100}` (every page; small) | `stripe/<name>_coupons_<n>.json` |
| `GetPrices`, `GetProducts` | `{"limit": 100}` (weekly is enough) | `stripe/<name>_prices_<n>.json`, `stripe/<name>_products_<n>.json` |

Ask for the discounts expanded, `"expand": ["data.discounts", "data.items.data.discounts"]`, and pull `GetCoupons` in full every time. An expanded discount still names its coupon by id only (`"source": {"type": "coupon", "coupon": "<coupon id>"}`), and the import looks the terms up in the coupons file. Without the expand, or for a coupon missing from the coupons file, MRR and the forecast take the discounted share of the subscription's most recent paid invoice, (line amount − discount) / line amount, and say so in the approximations.

Backfill once, into `sync/inbox/backfill-stripe/stripe/`: subscriptions with `status: all` in full; invoices and charges month by month by `created` from the books' start date (as in the payout backfill below); invoice payments, customers, prices, products, and coupons in full. Then `bin/hpbooks stripe import sync/inbox/backfill-stripe/stripe/` and `bin/hpbooks stripe metrics`.

The import keeps only the fields the metrics need and then **rewrites the customers, invoices, charges, subscriptions, and coupons files in place** to those fields (no names, emails, phones, addresses, billing details, receipt or invoice URLs, descriptions, or metadata stay on disk). Use `--keep-raw` to skip that. A file from an older pull never overwrites newer data, so re-running an old folder is safe. Never call `stripe_api_write`.

### First Stripe load (backfill payouts)

Pull everything from the date the books start, one calendar month per window, so payouts reconcile against the bank history you already imported:

1. For each `[[stripe.accounts]]` entry and each month from the books' start date to today: `GetBalanceTransactions` **and** `GetPayouts` with `{"limit": 100, "created": {"gte": <unix start of the 1st of the month>, "lt": <unix start of the 1st of the next month>}}` (books time zone), paging each window with `"starting_after": "<id of the last item in data>"` while `has_more` is true.
2. Save the pages with one running number per account across all months: `sync/inbox/backfill-stripe/stripe/<name>_<n>.json` for balance transactions and `<name>_payouts_<n>.json` for payouts.
3. Import and reconcile:

   ```bash
   bin/hpbooks stripe import sync/inbox/backfill-stripe/stripe/
   bin/hpbooks stripe reconcile --from <books start> --rows
   ```

The import is idempotent, so overlapping windows and a second run (for example older months pulled later) are fine. Payouts are matched by their own arrival date, never today's. Expect **matched** for payouts whose deposit is in the bank history, **no_bank_history** for payouts that arrived before the first imported row of their bank account(s) (they match once older bank history is imported), and **in_transit** only for the last few days. Stripe-looking deposits the rules booked as revenue before Stripe was on pair automatically when their payout is imported; anything still under **bank only** needs a look. Details: [docs/stripe.md](../docs/stripe.md#backfill-payouts).
