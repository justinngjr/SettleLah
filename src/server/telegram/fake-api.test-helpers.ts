import { InputFile, type Transformer } from "grammy";
import type { Message, Update, User } from "grammy/types";

export interface ApiCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

/** Records every Bot API call and answers it locally. `blocked` chat ids answer 403 like a user who blocked the bot. */
export class FakeTelegram {
  readonly calls: ApiCall[] = [];
  readonly blocked = new Set<number>();
  private nextMessageId = 1;

  transformer: Transformer = (_prev, method, payload) => this.handle(method, payload as Record<string, unknown> | undefined) as never;

  private async handle(method: string, payload: Record<string, unknown> | undefined): Promise<unknown> {
    const p = payload ?? {};
    this.calls.push({ method, payload: p });
    if ((method === "sendMessage" || method === "sendPhoto") && this.blocked.has(p.chat_id as number)) {
      return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    }
    if (method === "sendMessage" || method === "sendPhoto") {
      const chatId = p.chat_id as number;
      const message: Message = {
        message_id: this.nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: chatId > 0 ? { id: chatId, type: "private", first_name: "x" } : { id: chatId, type: "supergroup", title: "Group" },
        ...(method === "sendMessage" ? { text: p.text as string } : { caption: p.caption as string, photo: [] }),
      } as Message;
      return { ok: true, result: message };
    }
    return { ok: true, result: true };
  }

  sent(method?: string): ApiCall[] {
    return this.calls.filter((c) => (method ? c.method === method : c.method === "sendMessage" || c.method === "sendPhoto"));
  }

  sentTo(chatId: number): ApiCall[] {
    return this.sent().filter((c) => c.payload.chat_id === chatId);
  }

  lastToast(): string | undefined {
    const call = [...this.calls].reverse().find((c) => c.method === "answerCallbackQuery");
    return call?.payload.text as string | undefined;
  }

  clear(): void {
    this.calls.length = 0;
  }
}

export function textOf(call: ApiCall): string {
  return (call.payload.text ?? call.payload.caption ?? "") as string;
}

export function isPhoto(call: ApiCall): boolean {
  return call.method === "sendPhoto" && call.payload.photo instanceof InputFile;
}

export function buttons(call: ApiCall): { text: string; callback_data?: string; url?: string }[] {
  const markup = call.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
}

let updateId = 1;

export function user(id: number, username?: string, firstName = `User${id}`): User {
  return { id, is_bot: false, first_name: firstName, username };
}

export function textUpdate(from: User, chatId: number, text: string, title = "Group"): Update {
  const chat = chatId > 0 ? { id: chatId, type: "private" as const, first_name: from.first_name } : { id: chatId, type: "supergroup" as const, title };
  const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : [];
  return { update_id: updateId++, message: { message_id: 9000 + updateId, date: 0, chat, from, text, entities } as Update["message"] };
}

export function callbackUpdate(from: User, chatId: number, data: string, messageText = "msg"): Update {
  const chat = chatId > 0 ? { id: chatId, type: "private" as const, first_name: from.first_name } : { id: chatId, type: "supergroup" as const, title: "Group" };
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: "ci",
      data,
      message: { message_id: 7000 + updateId, date: 0, chat, text: messageText } as NonNullable<Update["callback_query"]>["message"],
    },
  };
}
