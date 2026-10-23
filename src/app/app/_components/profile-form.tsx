"use client";

import { useActionState, useState } from "react";

import { Button, Field, Label, Notice } from "@/app/_ui";
import type { Profile } from "@/server/db/profiles";

import { saveProfile } from "../_actions/profile";
import { EMPTY_PROFILE_STATE } from "../_lib/profile-validation";

export function ProfileForm({
  profile,
  next,
  submitLabel,
}: {
  profile: Profile | null;
  /** Where to go after a successful save; omit to stay and show "Saved". */
  next?: string;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(saveProfile, EMPTY_PROFILE_STATE);
  const [proxyType, setProxyType] = useState<"mobile" | "uen">(profile?.paynowProxyType ?? "mobile");

  return (
    <form action={action} className="space-y-12">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field
        label="Your display name"
        name="displayName"
        defaultValue={profile?.displayName ?? ""}
        required
        autoComplete="name"
        placeholder="e.g. Jia Wei"
        error={state.errors.displayName ?? null}
      />

      <fieldset className="space-y-6">
        <legend className="label">PayNow proxy</legend>
        <div className="flex flex-wrap gap-6">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="paynowProxyType"
              value="mobile"
              checked={proxyType === "mobile"}
              onChange={() => setProxyType("mobile")}
            />
            Mobile number
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="paynowProxyType" value="uen" checked={proxyType === "uen"} onChange={() => setProxyType("uen")} />
            UEN
          </label>
        </div>
        <Field
          label={proxyType === "mobile" ? "Mobile number" : "UEN"}
          name="paynowProxyValue"
          defaultValue={profile?.paynowProxyValue ?? ""}
          required
          inputMode={proxyType === "mobile" ? "tel" : "text"}
          autoComplete={proxyType === "mobile" ? "tel" : "off"}
          placeholder={proxyType === "mobile" ? "9123 4567" : "201912345K"}
          error={state.errors.paynowProxyValue ?? null}
        />
      </fieldset>

      <Field
        label="Payee name shown by banks"
        name="paynowDisplayName"
        defaultValue={profile?.paynowDisplayName ?? profile?.displayName ?? ""}
        required
        placeholder="e.g. TAN JIA WEI"
        hint="Up to 25 letters and digits, as your bank prints it."
        error={state.errors.paynowDisplayName ?? null}
      />

      {state.errors.form ? <Notice role="alert">{state.errors.form}</Notice> : null}
      {state.saved && !pending ? <Notice>Saved.</Notice> : null}

      <div>
        <Label className="sr-only">Actions</Label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
