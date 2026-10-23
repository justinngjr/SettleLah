/** Wire types shared by the agent API routes and the chat UI. Plain JSON, no server imports. */

export interface PreviewRowDto {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}

export interface PreviewShareDto {
  readonly participantId: string;
  readonly name: string;
  readonly amount: string;
  readonly paysNothing: boolean;
}

export interface ActionPreviewDto {
  readonly title: string;
  readonly summary: string;
  readonly rows: readonly PreviewRowDto[];
  readonly shares?: readonly PreviewShareDto[];
  readonly warnings?: readonly string[];
  readonly openInApp: string | null;
}

export type ActionStatusDto = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

export interface ActionDto {
  readonly id: string;
  readonly conversationId: string;
  readonly tool: string;
  readonly preview: ActionPreviewDto;
  readonly status: ActionStatusDto;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly executedAt: string | null;
  readonly error: string | null;
  /** Set by the approve endpoint when the card changed and must be approved again. */
  readonly needsReapproval?: boolean;
}

export interface MessageDto {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  /** For `user` rows written by the app (action outcomes), not by the host. */
  readonly system: boolean;
  readonly createdAt: string;
}

export interface ConversationDto {
  readonly id: string;
  readonly title: string | null;
  readonly messages: readonly MessageDto[];
  readonly actions: readonly ActionDto[];
}

export type ApproveOutcomeKind = "executed" | "already" | "stale_preview" | "expired" | "failed" | "not_found";

/** Server-sent events from /api/agent/chat and the approve/reject endpoints. */
export type AgentStreamEvent =
  | { readonly type: "conversation"; readonly id: string }
  | { readonly type: "message"; readonly message: MessageDto }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly name: string; readonly ok: boolean }
  | { readonly type: "action"; readonly action: ActionDto; readonly outcome?: ApproveOutcomeKind | "rejected" }
  | { readonly type: "done"; readonly reason: "reply" | "max_steps" | "timeout" | "none" }
  | { readonly type: "error"; readonly code: string; readonly message: string };
