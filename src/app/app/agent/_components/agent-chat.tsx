"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, cx, Notice } from "@/app/_ui";

import { prepareReceiptImage } from "../../_lib/image";
import { AgentApiError, streamAgentEvents } from "../_lib/sse";
import type { ActionDto, AgentStreamEvent, ConversationDto, MessageDto } from "../_lib/types";
import { ActionCard } from "./action-card";

export const EXAMPLE_PROMPTS: readonly string[] = [
  "Split this receipt, Sarah skipped drinks",
  "Who still owes me?",
  "Ben paid me $25 cash",
  "Remind Dan about dinner",
];

const TOOL_LABELS: Readonly<Record<string, string>> = {
  resolve_friend: "Looking up friends…",
  list_friends: "Looking up friends…",
  get_balances: "Reading balances…",
  get_friend_ledger: "Reading the ledger…",
  list_open_requests: "Checking open requests…",
  list_pending_claims: "Checking the inbox…",
  list_bank_proposals: "Checking bank alerts…",
  list_receipts: "Looking at recent receipts…",
  list_recurring: "Checking recurring splits…",
  interpret_receipt: "Reading the receipt…",
};

type TimelineItem = { kind: "message"; at: string; message: MessageDto } | { kind: "action"; at: string; action: ActionDto };

export interface AgentChatProps {
  /** Preloaded conversation (tests, deep links). */
  readonly initial?: ConversationDto | null;
}

export function AgentChat({ initial = null }: AgentChatProps) {
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [messages, setMessages] = useState<MessageDto[]>(() => [...(initial?.messages ?? [])]);
  const [actions, setActions] = useState<ActionDto[]>(() => [...(initial?.actions ?? [])]);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((message): TimelineItem => ({ kind: "message", at: message.createdAt, message })),
      ...actions.map((action): TimelineItem => ({ kind: "action", at: action.createdAt, action })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, actions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [timeline.length, busy]);

  const upsertAction = useCallback((action: ActionDto) => {
    setActions((current) => (current.some((a) => a.id === action.id) ? current.map((a) => (a.id === action.id ? action : a)) : [...current, action]));
  }, []);

  const handleEvent = useCallback(
    (event: AgentStreamEvent) => {
      switch (event.type) {
        case "conversation":
          setConversationId(event.id);
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("conversation", event.id);
            window.history.replaceState(null, "", url);
          }
          return;
        case "message":
          // The stored copy of what the host just typed replaces the optimistic local one.
          setMessages((current) =>
            current.some((m) => m.id === event.message.id)
              ? current
              : [...current.filter((m) => !(m.id.startsWith("local-user-") && m.content === event.message.content)), event.message],
          );
          return;
        case "text":
          setMessages((current) => [
            ...current,
            { id: `local-${Date.now()}-${current.length}`, role: "assistant", content: event.text, system: false, createdAt: new Date().toISOString() },
          ]);
          return;
        case "tool":
          setBusy(TOOL_LABELS[event.name] ?? (event.ok ? "Preparing a card…" : "Thinking…"));
          return;
        case "action":
          upsertAction(event.action);
          return;
        case "done":
          return;
        case "error":
          setError({ status: 500, message: event.message });
          return;
      }
    },
    [upsertAction],
  );

  const run = useCallback(
    async (url: string, body: unknown, label: string) => {
      setBusy(label);
      setError(null);
      try {
        await streamAgentEvents(url, body, handleEvent);
      } catch (e) {
        if (e instanceof AgentApiError) setError({ status: e.status, message: e.message });
        else setError({ status: 0, message: e instanceof Error ? e.message : "Something went wrong." });
      } finally {
        setBusy(null);
      }
    },
    [handleEvent],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      const localUser: MessageDto = { id: `local-user-${Date.now()}`, role: "user", content: message, system: false, createdAt: new Date().toISOString() };
      setMessages((current) => [...current, localUser]);
      setDraft("");
      const attached = image;
      setImage(null);
      setImageName(null);
      await run("/api/agent/chat", { ...(conversationId ? { conversationId } : {}), message, ...(attached ? { image: attached } : {}) }, "Thinking…");
    },
    [busy, conversationId, image, run],
  );

  const approve = useCallback((id: string) => void run(`/api/agent/actions/${id}/approve`, {}, "Running the action…"), [run]);
  const reject = useCallback((id: string) => void run(`/api/agent/actions/${id}/reject`, {}, "Rejecting…"), [run]);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await prepareReceiptImage(file));
      setImageName(file.name);
    } catch (e) {
      setError({ status: 0, message: e instanceof Error ? e.message : "Could not read the photo." });
    }
  };

  const unavailable = error?.status === 503;

  return (
    <div className="space-y-8">
      {timeline.length === 0 ? (
        <div className="space-y-6 rounded-xl border border-line p-6">
          <p className="measure text-ink-soft">
            Ask for anything you could do in the app. Reading is instant; every change becomes a card you approve first.
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="Example prompts">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="rounded-lg border border-line bg-paper-raised px-3 py-2 text-sm text-ink hover:bg-paper-sunken"
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="space-y-6" aria-live="polite" aria-label="Conversation">
          {timeline.map((item) =>
            item.kind === "message" ? (
              <li key={item.message.id} className="space-y-1">
                <p className="label">{item.message.system ? "App" : item.message.role === "user" ? "You" : "Agent"}</p>
                <p className={cx("measure whitespace-pre-wrap", item.message.system ? "text-sm text-ink-mute" : "text-ink")}>{item.message.content}</p>
              </li>
            ) : (
              <li key={item.action.id}>
                <ActionCard action={item.action} busy={busy !== null} onApprove={approve} onReject={reject} />
              </li>
            ),
          )}
        </ol>
      )}

      {busy ? (
        <p className="label" role="status">
          {busy}
        </p>
      ) : null}

      {error ? (
        <Notice role="alert">
          {unavailable
            ? "The assistant is not available right now. You can still log a receipt, record payments on a friend's page and manage friends from the app screens."
            : error.message}
        </Notice>
      ) : null}

      <form
        className="hairline space-y-4 pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor="agent-message" className="label">
          Message
        </label>
        <textarea
          id="agent-message"
          name="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="e.g. Who still owes me?"
          className="w-full rounded-lg border border-line bg-paper-raised px-4 py-3 text-ink placeholder:text-ink-mute focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          disabled={busy !== null}
        />
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(event) => void attach(event.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy !== null || draft.trim().length === 0}>
            Send
          </Button>
          <Button type="button" variant="tertiary" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {image ? "Change photo" : "Attach a receipt photo"}
          </Button>
          {imageName ? (
            <span className="text-sm text-ink-mute">
              {imageName}{" "}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => {
                  setImage(null);
                  setImageName(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                remove
              </button>
            </span>
          ) : null}
        </div>
      </form>
      <div ref={endRef} />
    </div>
  );
}
