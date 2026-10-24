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

- Hosts sign in with Supabase "Sign in with Google" (OAuth, PKCE: `/login`
  -> Google -> `/auth/callback?code=...`). No emails are sent. `public.profiles`
  is created by a trigger on `auth.users` insert, so `profiles.id = auth.uid()`;
  `handle_new_user` prefills `display_name` from the provider's
  `raw_user_meta_data` (`display_name`, then `full_name`, then `name`).
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
| `recurring_expenses` | Template for repeating shared costs (rent, Netflix). | `amount`, `cadence` (`monthly`\|`weekly`), `anchor_day`, `participants jsonb` (`[{id, weight}]`, `id` = friend id or the host's id), `telegram_chat_id?` (group to post each run to), `next_run_at`, `active` | Recurring (runner creates `receipts`) |
| `recurring_runs` | One row per `(recurring_expense_id, period_key)`: the runner's idempotency key. | `period_key` (`YYYY-MM` monthly, `YYYY-MM-DD` weekly, Singapore calendar), `receipt_id?`, `ran_at`. Hosts read, only the service role writes; `on delete restrict` means an expense that has run cannot be deleted (pause it). | Recurring |
| `bank_alerts` | Parsed incoming-transfer emails; the raw email is never stored. Idempotent on `raw_hash` (sha256 of from+subject+text) per host. | `bank`, `received_at`, `amount` (0 when ignored/unparsed), `payer_name`, `reference?`, `sender?`, `subject?`, `status` (`unmatched`\|`proposed`\|`confirmed`\|`ignored`), `reason?` (`sender_not_verified`, `unsupported_format`, `parse_failed`, `ambiguous`, `no_candidates`, `host_ignored`), `proposed_friend_id?`, `proposed_payment_request_id?` (both required when `proposed`), `match_confidence?` (`strong`\|`weak`), `match_reason?` | Bank alerts (parser + matcher), Host UI inbox |
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
| `run_recurring_expense(expense_id, period_key, p_receipt, p_shares, next_run_at)` | **Service role only.** Locks the expense, inserts the `recurring_runs` row (returns `null` and writes nothing if the period already ran), calls `save_split` with `recurringExpenseId` and the expense's `telegram_chat_id`, records the receipt on the run and advances `next_run_at`. One transaction. Refuses paused expenses and a `hostId` that does not own the expense. |

Trigger functions (`handle_new_user`, `set_updated_at`, `ledger_events_immutable`,
`payment_claims_default_amount`) have EXECUTE revoked from `public`, `anon` and
`authenticated` (`20261023000650_harden_trigger_functions.sql`) so they are not
reachable via `/rest/v1/rpc`; `supabase/tests/08_*.sql` asserts it.

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
- `recurring.ts` — `listRecurring`, `getRecurring`, `createRecurring`,
  `updateRecurring`, `pauseRecurring`, `resumeRecurring`, `deleteRecurring`
  (refuses once there are runs), `listRecurringRuns`; for the runner
  `listDueRecurring` (the one cross-host query) and `runRecurringExpense`
  (the RPC). Validation (`RecurringInputError`) covers title, positive integer
  cents, cadence/anchor ranges, participants owned by the host, linked group.
  Creating / changing the schedule / resuming computes `next_run_at` with the
  domain's `nextRunAt` from "now", so paused periods are never back-charged.
- `database.types.ts` — generated by `supabase gen types typescript --local`;
  CI fails if it drifts from the migrations.

## What later sessions add (code only, no table reshaping)

- **Host UI**: pages over `friends`, `receipts`/`receipt_shares`,
  `listBalances`, `payment_claims` confirm/reject.
- **PayNow**: QR payload from `profiles.paynow_*` + `payment_requests.reference`.
- **Telegram bot + reminders**: done, see below.
- **Recurring expenses**: done, see "Recurring expenses" below.
- **Bank alerts**: implemented in `src/server/reconcile/` + `src/domain/reconcile.ts`;
  see "Bank-email reconciliation" below. The host UI (`/app/inbox`,
  `/app/settings`) uses the same server functions through server actions
  (`src/app/app/_actions/bank.ts`, `src/app/app/_lib/bank-proposals.ts`).

## Recurring expenses (`src/server/recurring/`, `src/server/db/recurring.ts`)

A recurring expense is a split that repeats on a schedule, so it uses the
same balance system: each run is an ordinary receipt, every friend's share is
an `expense_share` on the ledger (credit they hold is netted off by
`outstandingRequest`), and anyone short gets the normal payment request and
reminders. Nothing new is messaged.

- Screens: `/app/recurring` (list), `/app/recurring/new`, `/app/recurring/[id]`
  (edit, pause/resume, past runs). Amounts are entered in dollars and converted
  with `fromDollars`; participants can carry weights; an optional linked
  Telegram group is stored on the expense.
- Runner `runDueRecurring(deps)`: for every active expense with
  `next_run_at <= now`, compute `periodKeyFor(cadence, next_run_at)`, build the
  shares with `recurringCharge` (host never absorbs the cent; archived friends
  are dropped), call `run_recurring_expense` (atomic, idempotent), then
  `refreshPaymentRequests` for the owing friends and, if a group is linked and
  Telegram is configured, `notifySplit`. A failed post is reported in the
  summary but the charge stands. One expense failing never stops the rest.
- `GET /api/cron/recurring` (public in `PUBLIC_API_ROUTES`, requires
  `Authorization: Bearer $CRON_SECRET`, constant-time), once a day in
  `vercel.json` (02:30 UTC, about 10:30 Singapore; Vercel Hobby only allows daily
  crons, so the runner catches up on every period that came due since the last
  run, charging each exactly once). Runs due at 09:00 Singapore on the anchor day; monthly anchors
  past a short month fall on its last day (`nextRunAt`).
- Tests: `src/server/recurring/runner.test.ts` (idempotency, month-end
  anchors, notify only with a group), `src/server/db/recurring.test.ts`,
  `supabase/tests/07_recurring_runs.sql` (atomicity, cross-host, no delete
  with runs, RLS), e2e in `e2e/smoke.spec.ts`.

## Bank-email reconciliation (`src/server/reconcile/`, `src/domain/reconcile.ts`)

Trust first: the app never logs into a bank or reads a mailbox. The host sets
up a Gmail/Outlook filter that forwards only DBS/POSB incoming-transfer alert
emails to `<token>@INBOUND_EMAIL_DOMAIN` (`inbound_email_routes.token`). An
email provider (Cloudflare Email Workers / Postmark / Mailgun; mapping in the
README) POSTs each forwarded message to the webhook. Confirm before acting: a
parsed alert is a *proposal* and nothing hits the ledger until the host taps
confirm, except the opt-in auto-confirm case below.

Per-host setting: `profiles.auto_confirm_bank_alerts boolean default false`
(migration `20261023000400_reconcile_settings.sql`, which also adds the
`bank_alerts` columns `sender`, `subject`, `reason`, `match_confidence`,
`match_reason` and the "proposed needs friend + request" check).

### Pipeline (`ingestInboundEmail`)

1. `X-Inbound-Secret` is compared in constant time with `INBOUND_EMAIL_SECRET`
   (401), the body is validated (400). 503 when the env vars are unset.
2. The token is the local part of the recipient at `INBOUND_EMAIL_DOMAIN`;
   `inbound_email_routes` (not revoked) gives the `host_id`. This is the only
   query not filtered by host; every later query is `.eq("host_id", hostId)`
   even though the webhook uses the service role. Unknown token -> 404.
3. `raw_hash = sha256(from + "\n" + subject + "\n" + text)`; an existing
   `(host_id, raw_hash)` row is returned as `duplicate` (also on a racing
   insert). The raw email is never stored, only parsed fields + sender + subject + hash.
4. Sender verification: the original sender must be at an allowlisted domain
   (`INBOUND_EMAIL_SENDER_ALLOWLIST`, default `dbs.com`), found in `from`
   (filter auto-forward keeps the bank as sender), in `x-original-sender` /
   `x-original-from` / `reply-to` / `resent-sender` headers, or in the first
   `From:` line of a manually forwarded block. Otherwise -> `ignored` /
   `sender_not_verified` with `amount = 0`.
5. Parser: `BankAlertParser { bank, canParse(email), parse(email) -> { amount: Cents, payerName, reference?, receivedAt } }`;
   `dbsParser` covers DBS and POSB (both send from `dbs.com`). Amounts go
   through the domain `fromDollars` (no floats). No parser -> `ignored` /
   `unsupported_format`; parse failure -> `unmatched` / `parse_failed`.
   Never a 500 for a bad email.
6. Matcher `matchBankAlert(alert, openRequests, friends)` (pure, `src/domain/reconcile.ts`):
   (a) `reference`: the alert's free-text reference contains an open request's
   `SLxxxxxx` reference as a token -> strong; (b) `known_name_and_amount`: payer
   name (normalised: caps, punctuation stripped) is in a friend's
   `known_bank_names` and that friend has an open request for exactly the
   amount -> strong; (c) `amount_only`: exactly one open request for the amount
   -> weak. Two or more hits in the deciding tier -> `unmatched` / `ambiguous`
   (`match_reason` = the tier); the host picks. No hit -> `no_candidates`.
7. Auto-confirm (`canAutoConfirm`): only when the proposal came from tier (a),
   the amount equals the request amount exactly, and the payer name is already
   in that friend's `known_bank_names`; and only if the host's
   `auto_confirm_bank_alerts` is on. It then runs the same confirm path as the
   host's tap.

### Host endpoints (session cookie; RLS client + explicit host filter)

All return `{ error: { code, message, details? } }` on failure with codes
`unauthenticated` 401, `invalid_json`/`invalid_input` 400, `not_found` 404,
`invalid_state` 409, `not_configured` 503, `internal_error` 500.

| Endpoint | Request | Response |
| -------- | ------- | -------- |
| `GET /api/reconcile/address` | – | `{ address, token, domain, createdAt, configured }`; creates the route on first call. 503 if `INBOUND_EMAIL_DOMAIN` is unset. |
| `GET /api/reconcile/alerts` | `?status=proposed,unmatched` (default) `&limit=50` | `{ alerts: BankAlert[] }` newest first. `BankAlert` = camelCase of the row: `id, bank, receivedAt, amount, payerName, reference, sender, subject, status, reason, proposedFriendId, proposedPaymentRequestId, matchConfidence, matchReason, createdAt`. |
| `POST /api/reconcile/alerts/:id/confirm` | `{ paymentRequestId? }` (defaults to the proposed request; required for an unmatched alert) | `{ alert, claimId, ledgerEventId, paymentRequest }`. Creates a `payment_claims` row (`source = bank_alert`, `bank_alert_id`, `amount` = alert amount) and calls `confirm_payment_claim(claim, alert.amount)`: exactly one `payment` ledger event for the actual amount, alert `confirmed`, request `paid` only when covered (underpayment stays `open`, overpayment becomes credit). Then appends `payer_name` to the friend's `known_bank_names`. |
| `POST /api/reconcile/alerts/:id/reassign` | `{ paymentRequestId }` (must be `open`) | `{ alert }` now `proposed` for that request's friend, `match_reason = "host"`. No ledger write. |
| `POST /api/reconcile/alerts/:id/ignore` | `{ reason? }` | `{ alert }` with status `ignored`, `reason` default `host_ignored`. Hash kept so a re-delivery stays a duplicate. |
| `GET /api/reconcile/settings` / `PATCH` | `{ autoConfirmBankAlerts }` | `{ autoConfirmBankAlerts }` |

Webhook: `POST /api/inbound-email` (public, in `PUBLIC_API_ROUTES`) ->
`{ outcome: "duplicate" | "ignored" | "unmatched" | "proposed" | "confirmed", alertId, ledgerEventId? }`.

Host UI (Session E) wiring: show `GET /alerts` as the inbox; a `proposed` row
renders the friend/request with `matchConfidence`/`matchReason` and a confirm
button; an `unmatched` row shows `reason` and lets the host pick a request
(`reassign` or `confirm` with `paymentRequestId`) or `ignore`.

## Telegram bot and reminder cron (`src/server/telegram/`)

Friends never sign up: everything they do happens in Telegram. The bot runs
with the service role, and every query filters by the host resolved from the
link token, the linked group chat (`telegram_chats`) or the host's own
`profiles.telegram_user_id`. Two things always wait for one host tap before
anything changes: binding a Telegram user to a friend, and every "I've paid".

### Schema added (`20261023000500_telegram_links.sql`)

- `profiles.telegram_user_id` (unique) / `telegram_username`: the host's own
  Telegram account, so the bot can DM approval prompts.
- `telegram_link_tokens`: deep-link tokens stored as `sha256` hex
  (`token_hash`), `kind` `host` | `group` | `friend`, `expires_at`
  (24 h for host/group, 30 days for the friend link on a split message),
  `single_use` (host/group) consumed with a conditional update on `used_at`.
- `telegram_binding_requests`: "@user says they are Sarah", `status`
  `pending` | `approved` | `rejected`, `via_private_chat`, `host_message_id`
  (null = queued for the web inbox because the host has no Telegram DM yet).
- `payment_requests.receipt_id` (same-host FK) so a split's requests and
  group chat can be found again; `reminders.escalated_at` so the host is
  told exactly once.

### Server functions for the host UI (`src/server/telegram/index.ts`)

All take the signed-in host's id first and an optional `TelegramDeps`
(defaults to `depsFromEnv()`: service client + real Bot API; tests inject a
fake db and a grammY API transformer). They throw
`TelegramNotConfiguredError` when the Telegram env is unset.

| Function | Returns / effect |
| --- | --- |
| `createHostLinkToken(hostId)` | `https://t.me/<bot>?start=host_<token>`; the host opens it once to link their own Telegram user |
| `createGroupLinkToken(hostId)` | `https://t.me/<bot>?startgroup=grp_<token>`; adding the bot to a group with it links the group to the host |
| `listLinkedChats(hostId)` | `LinkedChat[]` (`telegramChatId`, `title`, `linkedAt`) |
| `notifySplit({ hostId, receiptId, telegramChatId })` | Posts the split to a linked group: one summary message (title, total, each share, `tg://user?id=` mention when bound, "That's me (Name)" button per unbound friend, "Get private reminders" URL button) and then, per friend who owes, the PayNow QR (PNG from `buildPayNowPayload` via `qrcode`) with "I've paid" / "Remind me later" — privately when `private_chat_started`, else as a reply in the group. Creates the `open` payment requests for the receipt's shares if the host has not, sets `receipts.telegram_chat_id`, and records reminder stage 0 as sent |
| `listPendingBindings(hostId)` | Binding requests waiting for the host (for the web inbox when the host has no Telegram) |
| `approveBinding(hostId, bindingId)` / `rejectBinding(hostId, bindingId)` | Same as the Approve / Reject buttons: approve sets `friends.telegram_user_id` (+ `private_chat_started` if the friend came via a private `/start`); reject changes nothing |

Pending `friend_button` claims from "I've paid" already surface through
`listPendingClaims`; confirming them from the web uses `confirmPaymentClaim`.

### Routes, env, cron

- `POST /api/telegram/webhook` (public in `PUBLIC_API_ROUTES`): 503 until
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
  are set; 401 unless `X-Telegram-Bot-Api-Secret-Token` matches
  (constant-time). Register with `pnpm telegram:set-webhook <public-url>`.
- `GET /api/cron/reminders` (public, requires `Authorization: Bearer
  $CRON_SECRET`), scheduled once a day in `vercel.json` (02:30 UTC, about 10:30 Singapore, inside the
  10:00-21:00 send window; Vercel Hobby only allows daily crons, so a reminder
  due earlier waits for the next run). For each
  `open` request it loads/creates the `reminders` row, asks the domain
  (`nextReminder`) and acts: `send` (copy from `reminderMessage`, QR again
  only on stage 0, persisted with `afterSent`), `paused` (pending claim),
  `done`, `escalate_to_host` (one DM, guarded by `escalated_at`). Concurrent
  runs are safe: a send is only performed after a compare-and-set on
  `(stage, last_sent_at)` succeeds.
- A 403 from Telegram when DMing a friend sets `private_chat_started =
  false` and falls back to the group for that message and later ones.

### Bot interactions

- `/start host_<token>` (private) links the host; queued binding prompts are
  then delivered. `/start grp_<token>` (in a group) links the group.
- `/start fr_<token>` (private, from the split message) either turns on
  private reminders for an already-bound friend or offers "That's me" buttons
  for the unbound friends on that receipt.
- "That's me" (group or private) -> host DM "Link @user to Sarah? [Approve]
  [Reject]"; the friend record is untouched until Approve.
- "I've paid" -> `createPaymentClaim` (`friend_button`, amount null = request
  amount) + host DM [Confirm] [Not received] -> `confirmPaymentClaim` (one
  `payment` ledger event) / `rejectPaymentClaim`. "Remind me later" ->
  `afterSnooze`. Only the bound friend (`from.id`) can act on a request;
  anyone else gets a toast.

## AI agent (`src/server/agent/`, `/app/agent`)

The host chats with an assistant that can do anything the host app can do, with two rules enforced in code:

- **Nothing writes without approval.** Tools are `{ name, description, input (zod), kind: "read" | "write", run, preview? }` and only wrap existing repository / reconcile / telegram functions. The loop (`loop.ts`) runs read tools and returns their results to the model; a write tool call only gets `preview()` computed and stored as a pending `agent_actions` row (an action card). `actions.ts#approveAction` is the single caller of a write tool's `run`: it atomically moves the row `pending -> approved` (the lock; one winner), re-validates the input, re-runs `preview` and compares `preview_hash`, and only executes when the card the host saw is still what would happen. Executed / rejected outcomes are appended to the transcript as data for the model's follow-up reply.
- **Code handles the money.** Tool inputs carry amounts only as printed dollar strings parsed with `fromDollars`; `save_split` builds the same `SplitInput` as the Confirm screen and persists through `saveSplit` + `refreshPaymentRequests`.

Schema (`20261023000700_agent_core.sql`): `agent_conversations`, `agent_messages` (role user|assistant|tool, `tool_calls` / `tool_result` jsonb, identity `seq`), `agent_actions` (tool, input, preview, `preview_hash`, status pending|approved|rejected|executed|failed|expired, `expires_at = created + 30 min`, result/error, executed_at). Composite `(id, host_id)` FKs and per-host RLS like every other table; the host cannot delete messages or actions directly.

Model access reuses `LlmCaller` (`LLM_*` env) with native OpenAI tool calls, falling back per `(baseURL, model)` to a JSON protocol when a provider rejects `tools`. Tool results and anything the model reads are wrapped as delimited data and the system prompt treats instructions inside data as text. Routes: `POST /api/agent/chat` (SSE), `GET /api/agent/conversations/:id`, `POST /api/agent/actions/:id/approve|reject` (SSE). Chat-only today; `runTurn` only needs a message in the transcript, so a proactive trigger can reuse it.
