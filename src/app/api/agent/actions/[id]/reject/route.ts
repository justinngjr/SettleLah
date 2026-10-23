import "server-only";

import { z } from "zod";

import { followUp, rejectAction } from "@/server/agent/actions";
import { errorResponse, loopEventToStream, sseResponse, toActionDto, withAgent } from "@/server/agent/http";

type Params = { params: Promise<{ id: string }> };

/** POST -> text/event-stream: `action` (rejected / already), then the assistant's reply, then `done`. */
export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorResponse(404, "not_found", "unknown action");
  return withAgent("api/agent/actions/reject", async ({ deps, ctx }) => {
    const outcome = await rejectAction(ctx, id);
    if (outcome.kind === "not_found") return errorResponse(404, "not_found", "unknown action");
    return sseResponse(async (emit) => {
      emit({ type: "action", action: toActionDto(outcome.action, ctx.now), outcome: outcome.kind === "rejected" ? "rejected" : "already" });
      if (outcome.kind === "rejected") {
        await followUp(ctx, deps, outcome.action.conversationId, (event) => emit(loopEventToStream(event, ctx.now)));
      } else {
        emit({ type: "done", reason: "none" });
      }
    });
  });
}
