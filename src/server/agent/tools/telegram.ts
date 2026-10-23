import "server-only";

import { z } from "zod";

import { formatSGD } from "@/domain";
import { listPaymentRequests, listReceiptsById } from "@/server/db";
import { listChats, notifySplit, NotifySplitError, sendReminderNow, TelegramNotConfiguredError, type TelegramDeps } from "@/server/telegram";

import { requireFriend } from "./helpers";
import type { ActionPreview } from "./preview";
import { ToolError, writeTool, type ToolContext } from "./types";

function telegramDeps(ctx: ToolContext): TelegramDeps {
  try {
    return ctx.telegram();
  } catch (error) {
    if (error instanceof TelegramNotConfiguredError) throw new ToolError("unavailable", "Telegram is not set up on this server");
    throw error;
  }
}

export const sendReminderNowTool = writeTool({
  name: "send_reminder_now",
  description: "Send a friend a payment reminder on Telegram right now (ahead of the automatic schedule). The friend needs an open payment request.",
  kind: "write",
  input: z.object({ friendId: z.string().min(1).describe("Friend id from resolve_friend / list_friends") }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friend = await requireFriend(ctx, input.friendId);
    const [request] = await listPaymentRequests(ctx.db, ctx.hostId, { friendId: friend.id, status: "open" });
    if (!request) throw new ToolError("invalid_state", `${friend.displayName} has no open payment request to remind about`);
    telegramDeps(ctx);
    const chats = await listChats(ctx.db, ctx.hostId);
    const channel = friend.privateChatStarted && friend.telegramUserId !== null ? "Telegram private chat" : chats.length > 0 ? `Telegram group${chats[0].title ? ` "${chats[0].title}"` : ""}` : null;
    if (!channel) throw new ToolError("invalid_state", `${friend.displayName} has not started the bot and no Telegram group is linked`);
    return {
      title: `Remind ${friend.displayName}`,
      summary: "Sends them a friendly reminder with the amount and PayNow details.",
      rows: [
        { label: "Amount", value: formatSGD(request.amount), strong: true },
        { label: "Reference", value: request.reference },
        { label: "Via", value: channel },
      ],
      openInApp: `/app/friends/${friend.id}`,
    };
  },
  async run(ctx, input) {
    const [request] = await listPaymentRequests(ctx.db, ctx.hostId, { friendId: input.friendId, status: "open" });
    if (!request) throw new ToolError("invalid_state", "no open payment request for this friend");
    const outcome = await sendReminderNow(telegramDeps(ctx), ctx.hostId, request.id);
    if (outcome !== "sent") throw new ToolError("failed", `reminder not sent: ${outcome}`);
    return { requestId: request.id, outcome };
  },
});

export const postSplitToGroupTool = writeTool({
  name: "post_split_to_group",
  description: "Post a saved split to the host's linked Telegram group: a summary with each person's share and PayNow QR codes for those who owe.",
  kind: "write",
  input: z.object({
    receiptId: z.string().min(1).describe("Receipt id from list_receipts or save_split's result"),
    telegramChatId: z.number().int().optional().describe("Which linked group; omit when the host has exactly one"),
  }),
  async preview(ctx, input): Promise<ActionPreview> {
    const [receipt] = await listReceiptsById(ctx.db, ctx.hostId, [input.receiptId]);
    if (!receipt) throw new ToolError("not_found", `no receipt ${input.receiptId}`);
    telegramDeps(ctx);
    const chats = await listChats(ctx.db, ctx.hostId);
    const chat = input.telegramChatId === undefined ? (chats.length === 1 ? chats[0] : undefined) : chats.find((c) => c.telegramChatId === input.telegramChatId);
    if (!chat) {
      if (chats.length === 0) throw new ToolError("invalid_state", "no Telegram group is linked yet");
      throw new ToolError("ambiguous", "several groups are linked; ask the host which one", chats.map((c) => ({ telegramChatId: c.telegramChatId, title: c.title })));
    }
    return {
      title: `Post to group: ${receipt.title}`,
      summary: "Posts the split summary and PayNow QR codes to the group; friends who owe get payment requests.",
      rows: [
        { label: "Total", value: formatSGD(receipt.total), strong: true },
        { label: "Group", value: chat.title ?? String(chat.telegramChatId) },
      ],
      openInApp: "/app",
    };
  },
  async run(ctx, input) {
    const chats = await listChats(ctx.db, ctx.hostId);
    const chat = input.telegramChatId === undefined ? chats[0] : chats.find((c) => c.telegramChatId === input.telegramChatId);
    if (!chat) throw new ToolError("invalid_state", "Telegram group not linked");
    try {
      const result = await notifySplit({ hostId: ctx.hostId, receiptId: input.receiptId, telegramChatId: chat.telegramChatId }, telegramDeps(ctx));
      return { messageId: result.messageId, requests: result.requests.length };
    } catch (error) {
      if (error instanceof NotifySplitError) throw new ToolError("failed", error.message);
      throw error;
    }
  },
});
