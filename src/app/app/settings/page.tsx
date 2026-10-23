import { Suspense } from "react";

import { Button, Loading, PageIntro, Section } from "@/app/_ui";
import { signOut } from "@/server/auth/actions";
import { getProfile } from "@/server/db";

import { ProfileForm } from "../_components/profile-form";
import { requireHost } from "../_lib/host";

async function SettingsContent() {
  const { host, db } = await requireHost("/app/settings");
  const profile = await getProfile(db, host.id);
  return (
    <>
      <Section title="Profile and PayNow" meta={host.email ?? undefined}>
        <ProfileForm profile={profile} submitLabel="Save changes" />
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

export default function SettingsPage() {
  return (
    <div className="space-y-16">
      <PageIntro label="Settings" title="Settings">
        Your name, where friends pay you, and your session.
      </PageIntro>
      <Suspense fallback={<Loading />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
