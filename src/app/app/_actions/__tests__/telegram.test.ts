import { beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "host-1";

const TelegramNotConfiguredError = vi.hoisted(() => class TelegramNotConfiguredError extends Error {})();

const mocks = vi.hoisted(() => ({
  requireHost: vi.fn(),
  createHostLinkToken: vi.fn(),
  createGroupLinkToken: vi.fn(),
  approveBinding: vi.fn(),
  rejectBinding: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));


vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("../../_lib/host", () => ({ requireHost: mocks.requireHost }));
vi.mock("@/server/telegram", () => ({
  createHostLinkToken: mocks.createHostLinkToken,
  createGroupLinkToken: mocks.createGroupLinkToken,
  approveBinding: mocks.approveBinding,
  rejectBinding: mocks.rejectBinding,
}));
vi.mock("@/server/telegram/deps", () => ({ TelegramNotConfiguredError }));

import { addBotToGroup, connectTelegram, resolveBindingRequest } from "../telegram";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHost.mockResolvedValue({ host: { id: HOST }, db: {} });
});

describe("Telegram connect links", () => {
  it("connectTelegram mints a host token for the signed-in host and redirects to the deep link", async () => {
    mocks.createHostLinkToken.mockResolvedValue("https://t.me/settlelah_bot?start=host_abc");
    await expect(connectTelegram()).rejects.toThrow("NEXT_REDIRECT:https://t.me/settlelah_bot?start=host_abc");
    expect(mocks.createHostLinkToken).toHaveBeenCalledWith(HOST);
  });

  it("addBotToGroup mints a group token and redirects to the startgroup link", async () => {
    mocks.createGroupLinkToken.mockResolvedValue("https://t.me/settlelah_bot?startgroup=grp_abc");
    await expect(addBotToGroup()).rejects.toThrow("NEXT_REDIRECT:https://t.me/settlelah_bot?startgroup=grp_abc");
    expect(mocks.createGroupLinkToken).toHaveBeenCalledWith(HOST);
  });

  it("sends the host back to settings with a notice when the bot is not configured", async () => {
    mocks.createHostLinkToken.mockRejectedValue(new TelegramNotConfiguredError("no bot"));
    await expect(connectTelegram()).rejects.toThrow("NEXT_REDIRECT:/app/settings?telegram=unconfigured");
  });
});

describe("resolveBindingRequest", () => {
  it("approves for the host and revalidates inbox + friends", async () => {
    mocks.approveBinding.mockResolvedValue({ kind: "approved", binding: {}, friend: {} });
    const result = await resolveBindingRequest({}, form({ bindingId: "b1", decision: "approve" }));
    expect(result).toEqual({ ok: true, done: "approved" });
    expect(mocks.approveBinding).toHaveBeenCalledWith(HOST, "b1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/inbox");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/friends");
  });

  it("rejects", async () => {
    mocks.rejectBinding.mockResolvedValue({ kind: "rejected", binding: {} });
    expect(await resolveBindingRequest({}, form({ bindingId: "b1", decision: "reject" }))).toEqual({ ok: true, done: "rejected" });
    expect(mocks.rejectBinding).toHaveBeenCalledWith(HOST, "b1");
  });

  it("explains conflicts and stale requests", async () => {
    mocks.approveBinding.mockResolvedValue({ kind: "conflict", binding: {}, boundTo: { displayName: "Ben" } });
    expect((await resolveBindingRequest({}, form({ bindingId: "b1", decision: "approve" }))).error).toMatch(/already linked to Ben/);
    mocks.approveBinding.mockResolvedValue({ kind: "already_resolved", binding: {} });
    expect((await resolveBindingRequest({}, form({ bindingId: "b1", decision: "approve" }))).error).toMatch(/already handled/);
    mocks.approveBinding.mockResolvedValue({ kind: "not_found" });
    expect((await resolveBindingRequest({}, form({ bindingId: "b1", decision: "approve" }))).error).toMatch(/no longer exists/);
  });
});
