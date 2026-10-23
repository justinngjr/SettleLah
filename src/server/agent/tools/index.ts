import "server-only";

import { z } from "zod";

import type { LlmToolDefinition } from "@/server/interpret/client";

import {
  getBalances,
  getFriendLedger,
  interpretReceiptTool,
  listBankProposals,
  listFriendsTool,
  listOpenRequests,
  listPendingClaimsTool,
  listReceipts,
  resolveFriend,
} from "./read";
import { postSplitToGroupTool, sendReminderNowTool } from "./telegram";
import type { Tool, WriteTool } from "./types";
import {
  addCreditTool,
  addFriendTool,
  archiveFriendTool,
  confirmBankMatchTool,
  confirmClaimTool,
  ignoreBankAlertTool,
  reassignBankMatchTool,
  recordPaymentTool,
  rejectClaimTool,
  renameFriendTool,
  saveSplitTool,
} from "./write";

export type { ActionPreview, PreviewRow, PreviewShare } from "./preview";
export { previewHash } from "./preview";
export { ToolError, type ReadTool, type Tool, type ToolContext, type ToolErrorCode, type ToolKind, type WriteTool } from "./types";

/** Every tool the agent may call. Order is the order the model sees them in. */
export const TOOLS: readonly Tool[] = [
  resolveFriend,
  listFriendsTool,
  getBalances,
  getFriendLedger,
  listOpenRequests,
  listPendingClaimsTool,
  listBankProposals,
  listReceipts,
  interpretReceiptTool,
  saveSplitTool,
  addFriendTool,
  renameFriendTool,
  archiveFriendTool,
  recordPaymentTool,
  confirmClaimTool,
  rejectClaimTool,
  addCreditTool,
  confirmBankMatchTool,
  reassignBankMatchTool,
  ignoreBankAlertTool,
  sendReminderNowTool,
  postSplitToGroupTool,
] as readonly Tool[];

export class ToolRegistry {
  private readonly byName: ReadonlyMap<string, Tool>;

  constructor(tools: readonly Tool[] = TOOLS) {
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) throw new Error(`duplicate tool name ${tool.name}`);
      names.add(tool.name);
    }
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  get tools(): readonly Tool[] {
    return Array.from(this.byName.values());
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  getWrite(name: string): WriteTool | undefined {
    const tool = this.byName.get(name);
    return tool?.kind === "write" ? tool : undefined;
  }

  /** OpenAI function definitions; the JSON Schema comes from each tool's zod schema. */
  toLlmTools(): LlmToolDefinition[] {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: `${tool.kind === "write" ? "[WRITE, needs host approval] " : ""}${tool.description}`,
      parameters: toolParameters(tool),
    }));
  }
}

export function toolParameters(tool: Tool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export const defaultRegistry = new ToolRegistry();
