import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { ConversationDto } from "@/app/app/agent/_lib/types";
import { errorResponse, toActionDto, toMessageDto } from "@/server/agent/http";
import { getConversation, listActions, listMessages } from "@/server/agent/store";
import { getHost } from "@/server/auth/session";
import { createDbClient } from "@/server/db";

type Params = { params: Promise<{ id: string }> };

/** GET -> { id, title, messages, actions } for reloading a chat. Tool messages are omitted. */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorResponse(404, "not_found", "unknown conversation");
  const host = await getHost();
  if (!host) return errorResponse(401, "unauthenticated", "sign in required");
  try {
    const db = await createDbClient();
    const conversation = await getConversation(db, host.id, id);
    if (!conversation) return errorResponse(404, "not_found", "unknown conversation");
    const now = new Date();
    const [messages, actions] = await Promise.all([listMessages(db, host.id, id), listActions(db, host.id, id)]);
    const body: ConversationDto = {
      id: conversation.id,
      title: conversation.title,
      messages: messages.filter((m) => m.role !== "tool" && !(m.role === "assistant" && m.content.length === 0)).map(toMessageDto),
      actions: actions.map((a) => toActionDto(a, now)),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[api/agent/conversations]", error);
    return errorResponse(500, "internal_error", "something went wrong");
  }
}
