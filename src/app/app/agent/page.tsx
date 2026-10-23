import { Suspense } from "react";
import { z } from "zod";

import { Loading, PageIntro } from "@/app/_ui";
import { toActionDto, toMessageDto } from "@/server/agent/http";
import { getConversation, listActions, listMessages } from "@/server/agent/store";

import { requireHost } from "../_lib/host";
import { AgentChat } from "./_components/agent-chat";
import type { ConversationDto } from "./_lib/types";

async function AgentContent({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { host, db } = await requireHost("/app/agent");
  const { conversation: id } = await searchParams;
  let initial: ConversationDto | null = null;
  if (id && z.string().uuid().safeParse(id).success) {
    const conversation = await getConversation(db, host.id, id);
    if (conversation) {
      const now = new Date();
      const [messages, actions] = await Promise.all([listMessages(db, host.id, id), listActions(db, host.id, id)]);
      initial = {
        id: conversation.id,
        title: conversation.title,
        messages: messages.filter((m) => m.role !== "tool" && !(m.role === "assistant" && m.content.length === 0)).map(toMessageDto),
        actions: actions.map((a) => toActionDto(a, now)),
      };
    }
  }
  return <AgentChat initial={initial} />;
}

/** Chat with the assistant; every change it proposes is a card the host approves. */
export default function AgentPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  return (
    <div className="space-y-10">
      <PageIntro label="Agent" title="Ask, then approve.">
        Say what happened in plain words. The assistant reads your data freely and turns every change into a card you approve with one tap.
      </PageIntro>
      <Suspense fallback={<Loading />}>
        <AgentContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
