import { Suspense } from "react";

import { Loading, PageIntro } from "@/app/_ui";
import { safeNextPath } from "@/lib/auth/routes";
import { getProfile } from "@/server/db";

import { ProfileForm } from "../_components/profile-form";
import { requireHost } from "../_lib/host";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function OnboardingForm({ searchParams }: { searchParams: SearchParams }) {
  const [{ host, db }, params] = await Promise.all([requireHost("/app/onboarding"), searchParams]);
  const profile = await getProfile(db, host.id);
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next);
  return <ProfileForm profile={profile} next={next} submitLabel="Save and continue" />;
}

export default function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-16">
      <PageIntro label="Welcome" title="Set up your PayNow">
        Friends pay you by scanning a QR code, so we need the PayNow mobile number or UEN the money should land in.
      </PageIntro>
      <Suspense fallback={<Loading />}>
        <OnboardingForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
