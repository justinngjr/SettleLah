import "server-only";

import { z } from "zod";

import { runTurn } from "@/server/agent/loop";
import { errorResponse, loopEventToStream, sseResponse, toMessageDto, withAgent } from "@/server/agent/http";
import { appendMessage, createConversation, getConversation } from "@/server/agent/store";
import { base64DecodedBytes } from "@/server/interpret/schema";

export const dynamic = "force-dynamic";

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(8000),
  image: z
    .string()
    .refine((url) => IMAGE_DATA_URL.test(url), { message: "image must be a jpeg/png/webp data URL" })
    .refine((url) => base64DecodedBytes(url.slice(url.indexOf(",") + 1)) <= MAX_IMAGE_BYTES, { message: "image must be at most 5 MB" })
    .optional(),
});

/**
 * POST { conversationId?, message, image? } -> text/event-stream of
 * `conversation`, `message`, `text`, `tool`, `action`, `done` / `error` events.
 * 401 signed out, 503 when the LLM is not configured.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "request body must be JSON");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "invalid_input", "invalid request body", parsed.error.issues);
  const { conversationId, message, image } = parsed.data;

  return withAgent(
    "api/agent/chat",
    async ({ host, db, deps, ctx }) => {
      const conversation = conversationId
        ? await getConversation(db, host.id, conversationId)
        : await createConversation(db, host.id, message.length > 60 ? `${message.slice(0, 57)}…` : message);
      if (!conversation) return errorResponse(404, "not_found", "unknown conversation");
      const stored = await appendMessage(db, host.id, conversation.id, { role: "user", content: message });

      return sseResponse(async (emit) => {
        emit({ type: "conversation", id: conversation.id });
        emit({ type: "message", message: toMessageDto(stored) });
        await runTurn(ctx, deps, conversation.id, (event) => emit(loopEventToStream(event, ctx.now)));
      });
    },
    image ? { attachedImage: image } : {},
  );
}
