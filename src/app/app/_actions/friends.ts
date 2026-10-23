"use server";

import { revalidatePath } from "next/cache";

import { archiveFriend, createFriend, unarchiveFriend, updateFriend } from "@/server/db";

import { requireHost } from "../_lib/host";

export interface FriendFormState {
  readonly error?: string;
  readonly ok?: boolean;
}

function cleanName(formData: FormData): string | null {
  const name = String(formData.get("displayName") ?? "").trim();
  return name.length > 0 && name.length <= 80 ? name : null;
}

export async function addFriend(_prev: FriendFormState, formData: FormData): Promise<FriendFormState> {
  const name = cleanName(formData);
  if (name === null) return { error: "Name: enter a name (up to 80 characters)." };
  const { host, db } = await requireHost("/app/friends");
  try {
    await createFriend(db, host.id, { displayName: name });
  } catch (error) {
    console.error("[addFriend]", error);
    return { error: "Could not add this friend. Try again." };
  }
  revalidatePath("/app/friends");
  return { ok: true };
}

export async function renameFriend(_prev: FriendFormState, formData: FormData): Promise<FriendFormState> {
  const name = cleanName(formData);
  const friendId = String(formData.get("friendId") ?? "");
  if (name === null) return { error: "Name: enter a name (up to 80 characters)." };
  const { host, db } = await requireHost("/app/friends");
  try {
    await updateFriend(db, host.id, friendId, { displayName: name });
  } catch (error) {
    console.error("[renameFriend]", error);
    return { error: "Could not rename this friend. Try again." };
  }
  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
  return { ok: true };
}

export async function setFriendArchived(formData: FormData): Promise<void> {
  const friendId = String(formData.get("friendId") ?? "");
  const archived = formData.get("archived") === "true";
  const { host, db } = await requireHost("/app/friends");
  if (archived) await archiveFriend(db, host.id, friendId);
  else await unarchiveFriend(db, host.id, friendId);
  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
}
