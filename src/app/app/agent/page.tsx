import { PageIntro } from "@/app/_ui";

import { requireHost } from "../_lib/host";
import { AgentChat } from "./_components/agent-chat";

/** Chat with the assistant; every change it proposes is a card the host approves. */
export default async function AgentPage() {
  await requireHost("/app/agent");
  return (
    <div className="space-y-10">
      <PageIntro label="Agent" title="Ask, then approve.">
        Say what happened in plain words. The assistant reads your data freely and turns every change into a card you approve with one tap.
      </PageIntro>
      <AgentChat />
    </div>
  );
}
