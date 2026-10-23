import { Button, Notice, Row, Rows } from "@/app/_ui";

import { setAutoConfirmBankAlerts } from "../_actions/bank";
import { addBotToGroup, connectTelegram } from "../_actions/telegram";

export interface BankSettingsProps {
  /** `<token>@<domain>`, or null when the inbound email webhook is not configured on this server. */
  readonly forwardingAddress: string | null;
  readonly senderAllowlist: readonly string[];
  readonly autoConfirm: boolean;
  readonly lastAlertAtLabel: string | null;
}

export function BankAlertsSettings({ forwardingAddress, senderAllowlist, autoConfirm, lastAlertAtLabel }: BankSettingsProps) {
  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <p className="label">Your forwarding address</p>
        {forwardingAddress ? (
          <p className="amount break-all text-lg">{forwardingAddress}</p>
        ) : (
          <Notice>Bank-email forwarding is not set up on this server yet (INBOUND_EMAIL_DOMAIN). Ask whoever runs it.</Notice>
        )}
        <p className="measure text-sm text-ink-soft">
          Only you can use this address. Emails are matched to your open requests by reference, amount and payer name; nothing is
          recorded until you confirm in the inbox (unless you turn on auto-confirm below).
        </p>
      </div>

      <div className="space-y-4">
        <p className="label">Gmail filter for DBS / POSB alerts</p>
        <ol className="measure list-decimal space-y-2 pl-5 text-ink-soft">
          <li>In Gmail, open Settings › Forwarding and POP/IMAP › Add a forwarding address, paste the address above and confirm it.</li>
          <li>Open Settings › Filters and Blocked Addresses › Create a new filter.</li>
          <li>
            From: <span className="amount">ibanking.alert@dbs.com</span>, Subject: <span className="amount">Transaction Alerts</span>
            (POSB alerts come from the same sender).
          </li>
          <li>Choose “Forward it to” and pick the address above; also tick “Never send it to Spam”.</li>
          <li>Create the filter. New incoming-transfer alerts show up in your inbox here within a minute.</li>
        </ol>
        <p className="measure text-sm text-ink-soft">
          Only emails originally sent from {senderAllowlist.join(", ")} are accepted; the allowlist is configurable by whoever runs this
          server (INBOUND_EMAIL_SENDER_ALLOWLIST).
        </p>
      </div>

      <form action={setAutoConfirmBankAlerts} className="space-y-4">
        <input type="hidden" name="autoConfirm" value={autoConfirm ? "false" : "true"} />
        <Rows>
          <Row term="Auto-confirm exact matches">{autoConfirm ? "On" : "Off"}</Row>
          <Row term="Last alert received">{lastAlertAtLabel ?? "None yet"}</Row>
        </Rows>
        <p className="measure text-sm text-ink-soft">
          Off by default. When on, an alert is recorded as a payment without you only if all four hold: the transfer reference equals an
          open request’s reference, the amount equals that request exactly, the payer name is one you have already confirmed for that
          friend, and this switch is on. Anything else still waits in your inbox.
        </p>
        <Button type="submit" variant="secondary" arrow={false}>
          {autoConfirm ? "Turn auto-confirm off" : "Turn auto-confirm on"}
        </Button>
      </form>
    </div>
  );
}

export interface TelegramSettingsProps {
  readonly configured: boolean;
  readonly botUsername: string | null;
  readonly linkedUsername: string | null;
  readonly linked: boolean;
  readonly chats: readonly { readonly id: string; readonly title: string | null; readonly telegramChatId: number; readonly linkedAtLabel: string }[];
  readonly showUnconfiguredNotice: boolean;
}

export function TelegramSettings({ configured, botUsername, linkedUsername, linked, chats, showUnconfiguredNotice }: TelegramSettingsProps) {
  return (
    <div className="space-y-10">
      {!configured || showUnconfiguredNotice ? (
        <Notice role={showUnconfiguredNotice ? "alert" : "status"}>
          The Telegram bot is not configured on this server (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET).
          Linking and group posts are unavailable until it is.
        </Notice>
      ) : null}

      <div className="space-y-4">
        <Rows>
          <Row term="Your Telegram">{linked ? (linkedUsername ? `Linked as @${linkedUsername}` : "Linked") : "Not linked"}</Row>
          {botUsername ? <Row term="Bot">@{botUsername}</Row> : null}
        </Rows>
        <p className="measure text-sm text-ink-soft">
          {linked
            ? "Friends’ “I paid” taps and link requests reach you as private messages from the bot. You can relink any time."
            : "Link your own account so the bot can message you privately when a friend marks a payment or asks to be linked."}
        </p>
        <form action={connectTelegram}>
          <Button type="submit" disabled={!configured}>
            {linked ? "Relink your Telegram" : "Connect your Telegram"}
          </Button>
        </form>
      </div>

      <div className="space-y-4">
        <p className="label">Groups</p>
        {chats.length === 0 ? (
          <p className="measure text-ink-soft">No groups linked. Add the bot to the group you split bills in; it posts each split and lets friends tap “I paid”.</p>
        ) : (
          <ul className="divide-y divide-line">
            {chats.map((chat) => (
              <li key={chat.id} className="flex flex-wrap items-baseline justify-between gap-4 py-3">
                <span className="text-ink">{chat.title ?? `Group ${chat.telegramChatId}`}</span>
                <span className="label">Linked {chat.linkedAtLabel}</span>
              </li>
            ))}
          </ul>
        )}
        <form action={addBotToGroup}>
          <Button type="submit" variant="secondary" disabled={!configured}>
            Add the bot to a group
          </Button>
        </form>
      </div>
    </div>
  );
}
