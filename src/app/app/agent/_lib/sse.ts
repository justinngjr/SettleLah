import type { AgentStreamEvent } from "./types";

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * POSTs and reads the `text/event-stream` reply, calling `onEvent` per event.
 * Non-stream responses (401/404/503, ...) become `AgentApiError`.
 */
export async function streamAgentEvents(url: string, body: unknown, onEvent: (event: AgentStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body ?? {}),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    let code = "http_error";
    let message = `Request failed (${response.status}).`;
    try {
      const parsed = (await response.json()) as Partial<ApiErrorBody>;
      if (parsed.error) ({ code, message } = parsed.error);
    } catch {
      /* not JSON */
    }
    throw new AgentApiError(response.status, code, message);
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseBlock(block);
      if (event) onEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
  const tail = parseBlock(buffer);
  if (tail) onEvent(tail);
}

export function parseBlock(block: string): AgentStreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as AgentStreamEvent;
  } catch {
    return null;
  }
}
