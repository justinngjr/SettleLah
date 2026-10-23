import { Suspense } from "react";

import { Button, Loading, PageIntro, Section } from "@/app/_ui";
import { signOut } from "@/server/auth/actions";
import { getProfile } from "@/server/db";
import { getOrCreateInboundRoute, getReconcileSettings, inboundEmailConfigFromEnv, listBankAlerts } from "@/server/reconcile";
import { getHostProfile, listChats } from "@/server/telegram/db";
import { telegramConfigFromEnv } from "@/server/telegram/env";

import { ProfileForm } from "../_components/profile-form";
import { BankAlertsSettings, TelegramSettings } from "../_components/settings-sections";
import { formatDateTime } from "../_lib/format";
import { requireHost } from "../_lib/host";

async function SettingsContent({ telegramNotice }: { telegramNotice: boolean }) {
  const { host, db } = await requireHost("/app/settings");
  const inbound = inboundEmailConfigFromEnv();
  const telegram = telegramConfigFromEnv();
  const [profile, route, reconcile, lastAlerts, hostProfile, chats] = await Promise.all([
    getProfile(db, host.id),
    inbound ? getOrCreateInboundRoute(db, host.id) : Promise.resolve(null),
    getReconcileSettings(db, host.id),
    listBankAlerts(db, host.id, { limit: 1 }),
    getHostProfile(db, host.id),
    listChats(db, host.id),
  ]);
  return (
    <>
      <Section title="Profile and PayNow" meta={host.email ?? undefined}>
        <ProfileForm profile={profile} submitLabel="Save changes" />
      </Section>
      <Section title="Telegram">
        <TelegramSettings
          configured={telegram !== undefined}
          botUsername={telegram?.username ?? null}
          linked={hostProfile?.telegramUserId !== null && hostProfile?.telegramUserId !== undefined}
          linkedUsername={hostProfile?.telegramUsername ?? null}
          chats={chats.map((c) => ({ id: c.id, title: c.title, telegramChatId: c.telegramChatId, linkedAtLabel: formatDateTime(c.linkedAt) }))}
          showUnconfiguredNotice={telegramNotice}
        />
      </Section>
      <Section title="Bank alerts">
        <BankAlertsSettings
          forwardingAddress={inbound && route ? `${route.token}@${inbound.domain}` : null}
          senderAllowlist={inbound?.senderAllowlist ?? ["dbs.com"]}
          autoConfirm={reconcile.autoConfirmBankAlerts}
          lastAlertAtLabel={lastAlerts[0] ? formatDateTime(lastAlerts[0].receivedAt) : null}
        />
      </Section>
      <Section title="Session">
        <form action={signOut}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </Section>
    </>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ telegram?: string }> }) {
  const params = await searchParams;
  return (
    <div className="space-y-16">
      <PageIntro label="Settings" title="Settings">
        Your name, where friends pay you, Telegram, bank alerts, and your session.
      </PageIntro>
      <Suspense fallback={<Loading />}>
        <SettingsContent telegramNotice={params.telegram === "unconfigured"} />
      </Suspense>
    </div>
  );
}
