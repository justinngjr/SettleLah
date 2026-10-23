# Architecture

SettleLah is a host-only app: the **host** (the person who fronts payments)
signs up, logs receipts, splits them and collects from **friends**. Friends
never create accounts; they are host-owned rows reached via Telegram later.

Three principles shape everything below:

- **Code handles the money.** Every amount is an integer number of cents
  (`bigint` in SQL, `Cents` in TypeScript). `src/domain/` is the only place
  that computes money; SQL helpers mirror it and are tested to agree.
- **Confirm before acting.** LLM interpretations and bank-alert matches are
  _proposals_ (`receipts.interpretation`, `payment_claims`, `bank_alerts`)
  until the host confirms. Only confirmation writes to the ledger.
- **The ledger is append-only.** `ledger_events` can be inserted, never
  updated or deleted (RLS grants + trigger). Corrections are new events.

## Layers

```
src/domain/            pure TS: money, charges, split, rounding, balances (no deps)
src/server/db/         server-only typed data layer over Supabase (this doc)
src/server/interpret/  LLM receipt interpretation -> proposal (uses domain)
src/server/auth/       session helpers + sign-in/out server actions
src/lib/auth/routes.ts route protection rules (pure; shared with src/proxy.ts)
src/lib/supabase/      Supabase clients (browser, server, proxy)
src/proxy.ts           Next 16 proxy: refreshes the session cookie, guards /app and /api
supabase/migrations/   schema, RLS, SQL functions (timestamped)
supabase/tests/        pgTAP tests run by `supabase test db`
```

### Auth model

- Hosts sign in with a Supabase email magic link (`/login` -> email ->
  `/auth/callback`). `public.profiles` is created by a trigger on
  `auth.users` insert, so `profiles.id = auth.uid()`.
- Every other table has `host_id uuid references auth.users on delete
  cascade`. RLS policies are `host_id = (select auth.uid())`; the
  `authenticated` role can `select`/`insert` its own rows (and `update` where
  that makes sense). `anon` has no access.
- The **service role** (Telegram bot, inbound-email webhook, cron) bypasses
  RLS via `createServiceClient()`. It still cannot update/delete
  `ledger_events`: those privileges are revoked from every API role and a
  trigger raises on `UPDATE`/`DELETE` (cascade from a deleted host is the
  only delete that passes).
- Cross-host consistency is enforced with composite foreign keys such as
  `(friend_id, host_id) -> friends (id, host_id)`, so a row can never point at
  another host's friend/receipt/request even if RLS were misconfigured.
- Route protection: `src/lib/auth/routes.ts` is the single allowlist.
  Everything under `/app` and `/api/*` needs a host session except
  `AUTH_ROUTES` and `PUBLIC_API_ROUTES` (empty today; webhooks go there later
  and must verify their own secret). `/api/interpret` derives the host from the
  session and ignores any client-sent `hostId`.

## ER summary

```
auth.users 1──1 profiles
auth.users 1──* friends ──* ledger_events
                 │  └──* payment_requests ──* payment_claims ──? bank_alerts
                 │                      └──* reminders
                 ├──* receipts ──* receipt_shares (participant = host or friend)
                 │      └──? recurring_expenses, telegram_chats
                 ├──* bank_alerts (proposed_friend_id?, proposed_payment_request_id?)
                 └──* inbound_email_routes
```

| Table | Purpose | Key columns / rules | Used by (session) |
| --- | --- | --- | --- |
| `profiles` | One per host. PayNow identity for QR payloads. | `id = auth.uid()`, `display_name`, `paynow_proxy_type` (`mobile`\|`uen`\|null), `paynow_proxy_value`, `paynow_display_name` | Host UI, PayNow |
| `friends` | Host-owned people who owe/are owed. Never deleted, only `archived`. | `display_name`, `telegram_user_id` (unique per host), `telegram_username`, `private_chat_started`, `known_bank_names text[]` (names seen on bank alerts, for matching) | Host UI, Telegram, Bank alerts |
| `telegram_chats` | Group chats the host linked the bot to. | `(host_id, telegram_chat_id)` unique, `title`, `linked_at` | Telegram |
| `receipts` | A logged bill. Totals are the domain's `ReceiptTotals`. | `source` (`manual`\|`llm`), `service_charge_bps`, `gst_bps`, `subtotal`, `service_charge`, `gst`, `total`, `interpretation jsonb` (LLM proposal, audit only), `split_input jsonb` (what the domain was run on), `telegram_chat_id?`, `recurring_expense_id?` | Host UI, Recurring |
| `receipt_shares` | One row per participant of a receipt. `friend_id null` = the host's own share (stored, never owed). | `amount`, `items_subtotal`, `pays_nothing`; shares sum to `receipts.total` (checked in `save_split`) | Host UI |
| `ledger_events` | **Append-only** pairwise ledger host<->friend. Same types and sign convention as `src/domain/balances.ts`: `expense_share` +, `payment`/`credit`/`friend_fronted` −. | `type`, `amount >= 0`, `receipt_id?`, `payment_request_id?`, `bank_alert_id?`, `note`, `created_by` (`host`\|`system`) | Everything that moves money |
| `payment_requests` | "Please pay me X" with a human-safe reference for the PayNow QR / transfer. | `amount > 0`, `reference` unique `SL` + 6 chars from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, `status` (`open`\|`paid`\|`cancelled`), `paid_at`, `cancelled_at` | PayNow, Telegram, Reminders |
| `payment_claims` | A proposal that a request was paid (`friend_button` or `bank_alert`). Host confirms -> `confirm_payment_claim` inserts a `payment` event for the amount actually paid. | `amount` (> 0, nullable: null on a friend-button claim = request amount; bank-alert claims get `bank_alerts.amount` via trigger; set when confirmed), `status` (`pending`\|`confirmed`\|`rejected`), `bank_alert_id` required iff `source = 'bank_alert'`, `resolved_at` | Telegram, Bank alerts, Host UI |
| `reminders` | Reminder schedule per open request. | `stage`, `next_at`, `snoozed_until`, `last_sent_at`, `channel` (`group`\|`private`) | Reminders (cron) |
| `recurring_expenses` | Template for repeating shared costs (rent, Netflix). | `amount`, `cadence` (`monthly`\|`weekly`), `anchor_day`, `participants jsonb` (`[{friendId, weight}]`), `service_charge_bps`, `gst_bps`, `next_run_at`, `active` | Recurring (job runner creates `receipts`) |
| `bank_alerts` | Parsed incoming-transfer emails. Idempotent on `raw_hash` (sha256 of the raw email) per host. | `bank`, `received_at`, `amount`, `payer_name`, `reference?`, `status` (`unmatched`\|`proposed`\|`confirmed`\|`ignored`), `proposed_friend_id?`, `proposed_payment_request_id?` | Bank alerts (parser + matcher) |
| `inbound_email_routes` | Secret token in the host's forwarding address (`<token>@...`). | `token` unique | Bank alerts (inbound webhook) |

Every table has `host_id` indexes plus the lookups each flow needs
(`ledger_events (host_id, friend_id, created_at)`, `payment_requests
(reference)`, `payment_claims (host_id, status)`, `reminders (next_at)`,
`recurring_expenses (next_run_at) where active`, `bank_alerts (host_id, status)`).

## SQL functions (RPC)

All run as the caller (`security invoker`) so RLS applies; `anon` cannot
execute them.

| Function | What it does |
| --- | --- |
| `ledger_signed_amount(type, amount)` | The sign convention, in SQL. |
| `friend_balance(host, friend)` / view `friend_balances` | Sum of signed events. Convenience for SQL/reporting; **the app computes balances with the domain** (`loadLedger` + `allBalances`). `supabase/tests/04_*.sql` and `src/server/db/ledger.test.ts` assert both agree on the same fixture. |
| `save_split(p_receipt jsonb, p_shares jsonb)` | Atomically inserts the receipt, its shares and one `expense_share` event per friend with `amount > 0`. Validates host, share sum = total, at most one host share. Any failure inserts nothing. |
| `confirm_payment_claim(claim_id, p_amount default null)` | Atomically: `payment` event for `coalesce(p_amount, claim.amount, request.amount)` (the host can correct the amount while confirming), claim `confirmed`, linked bank alert `confirmed`. The request becomes `paid` only when confirmed payments linked to it reach `request.amount`; only then are competing pending claims `rejected`. Underpayment leaves it `open` (further claims allowed, balance = remainder); overpayment makes the friend's balance negative, i.e. credit (`creditOf` in the domain). Returns the ledger event id. |
| `reject_payment_claim(claim_id)` | Claim `rejected`; a linked proposed bank alert returns to `unmatched`. |

## Data layer (`src/server/db/`)

`import "server-only"` everywhere. Every function takes a `DbClient` first so
tests pass a mock (`mock-client.test-helpers.ts`).

- `client.ts` — `createDbClient()` (host session, RLS) and
  `createServiceClient()` (service role).
- `friends.ts` — list/get/create/update/archive/unarchive. No hard delete.
- `splits.ts` — `saveSplit(db, hostId, receipt, splitResult, friendMap)`:
  maps a domain `SplitResult` to the `save_split` RPC. `friendMap` maps split
  participant ids to friend ids; the host's participant maps to `hostId`.
- `ledger.ts` — `loadLedger(db, hostId, friendId?) -> Ledger`,
  `listBalances(db, hostId)` (domain maths), `appendLedgerEvent` for manual
  `credit`/`friend_fronted`, `friendBalanceSql` for cross-checks.
- `payments.ts` — `createPaymentRequest` (reference generated client-side,
  retried on unique violation), `cancelPaymentRequest`, `createPaymentClaim`,
  `confirmPaymentClaim`, `rejectPaymentClaim`, listings.
- `database.types.ts` — generated by `supabase gen types typescript --local`;
  CI fails if it drifts from the migrations.

## What later sessions add (code only, no table reshaping)

- **Host UI**: pages over `friends`, `receipts`/`receipt_shares`,
  `listBalances`, `payment_claims` confirm/reject.
- **PayNow**: QR payload from `profiles.paynow_*` + `payment_requests.reference`.
- **Telegram bot**: service-role worker; links `telegram_chats`, fills
  `friends.telegram_user_id`, posts requests, creates `friend_button` claims.
- **Reminders**: cron over `reminders` for `open` requests.
- **Recurring expenses**: job runner that turns due `recurring_expenses` into
  `receipts` via `save_split` and advances `next_run_at`.
- **Bank alerts**: inbound-email webhook keyed by `inbound_email_routes.token`,
  parser -> `bank_alerts`, matcher that proposes a friend/request and creates a
  `bank_alert` claim for the host to confirm.
