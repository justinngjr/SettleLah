import "server-only";

import { z } from "zod";

import { approveAction, followUp } from "@/server/agent/actions";
import { errorResponse, loopEventToStream, sseResponse, toActionDto, withAgent } from "@/server/agent/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST -> text/event-stream. First an `action` event with the outcome
 * (`executed`, `already`, `stale_preview` = approve again, `expired`, `failed`),
 * then, after an execution, the assistant's follow-up `text` events; `done` last.
 * Approving twice executes once. Another host's action is a 404 (RLS).
 */
export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorResponse(404, "not_found", "unknown action");
  return withAgent("api/agent/actions/approve", async ({ deps, ctx }) => {
    const outcome = await approveAction(ctx, id);
    if (outcome.kind === "not_found") return errorResponse(404, "not_found", "unknown action");
    return sseResponse(async (emit) => {
      emit({ type: "action", action: toActionDto(outcome.action, ctx.now, outcome.kind === "stale_preview"), outcome: outcome.kind });
      if (outcome.kind === "executed" || outcome.kind === "failed") {
        await followUp(ctx, deps, outcome.action.conversationId, (event) => emit(loopEventToStream(event, ctx.now)));
      } else {
        emit({ type: "done", reason: "none" });
      }
    });
  });
}
