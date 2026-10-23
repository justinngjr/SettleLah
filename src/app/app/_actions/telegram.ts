"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { approveBinding, createGroupLinkToken, createHostLinkToken, rejectBinding } from "@/server/telegram";
import { TelegramNotConfiguredError } from "@/server/telegram/deps";

import { requireHost } from "../_lib/host";

export interface TelegramFormState {
  readonly error?: string;
  readonly ok?: boolean;
  readonly done?: "approved" | "rejected";
}

/** Mints a one-time host link token and sends the browser to the bot's deep link. */
export async function connectTelegram(): Promise<void> {
  const { host } = await requireHost("/app/settings");
  let url: string;
  try {
    url = await createHostLinkToken(host.id);
  } catch (error) {
    if (error instanceof TelegramNotConfiguredError) redirect("/app/settings?telegram=unconfigured");
    throw error;
  }
  redirect(url);
}

/** Mints a group link token; the deep link opens Telegram's "add bot to group" picker. */
export async function addBotToGroup(): Promise<void> {
  const { host } = await requireHost("/app/settings");
  let url: string;
  try {
    url = await createGroupLinkToken(host.id);
  } catch (error) {
    if (error instanceof TelegramNotConfiguredError) redirect("/app/settings?telegram=unconfigured");
    throw error;
  }
  redirect(url);
}

export async function resolveBindingRequest(_prev: TelegramFormState, formData: FormData): Promise<TelegramFormState> {
  const bindingId = String(formData.get("bindingId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const { host } = await requireHost("/app/inbox");
  try {
    const outcome = decision === "approve" ? await approveBinding(host.id, bindingId) : await rejectBinding(host.id, bindingId);
    revalidatePath("/app/inbox");
    revalidatePath("/app/friends");
    switch (outcome.kind) {
      case "approved":
        return { ok: true, done: "approved" };
      case "rejected":
        return { ok: true, done: "rejected" };
      case "conflict":
        return { error: `That Telegram account is already linked to ${outcome.boundTo.displayName}. Reject this request or unlink them first.` };
      case "already_resolved":
        return { error: "This request was already handled." };
      case "not_found":
        return { error: "This request no longer exists." };
    }
  } catch (error) {
    if (error instanceof TelegramNotConfiguredError) return { error: "Telegram is not configured on this server." };
    console.error("[resolveBindingRequest]", error);
    return { error: "Could not update this request. Try again." };
  }
}
