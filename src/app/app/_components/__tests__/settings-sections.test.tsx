// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../_actions/bank", () => ({ setAutoConfirmBankAlerts: vi.fn() }));
vi.mock("../../_actions/telegram", () => ({ connectTelegram: vi.fn(), addBotToGroup: vi.fn() }));

import { BankAlertsSettings, TelegramSettings } from "../settings-sections";

describe("BankAlertsSettings", () => {
  it("shows the forwarding address, Gmail steps, the allowlist and the auto-confirm rule (default off)", () => {
    render(<BankAlertsSettings forwardingAddress="tok123@in.settlelah.app" senderAllowlist={["dbs.com"]} autoConfirm={false} lastAlertAtLabel={null} />);
    expect(screen.getByText("tok123@in.settlelah.app")).toBeInTheDocument();
    expect(screen.getByText(/ibanking.alert@dbs.com/)).toBeInTheDocument();
    expect(screen.getByText(/dbs.com are accepted/)).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.getByText(/all four hold/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /turn auto-confirm on/i })).toBeInTheDocument();
  });

  it("offers to turn auto-confirm off when it is on and shows the last alert", () => {
    render(<BankAlertsSettings forwardingAddress={null} senderAllowlist={["dbs.com", "posb.com.sg"]} autoConfirm lastAlertAtLabel="2 Jan, 9:15 am" />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("2 Jan, 9:15 am")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /turn auto-confirm off/i })).toBeInTheDocument();
    expect(screen.getByText(/not set up on this server/)).toBeInTheDocument();
  });
});

describe("TelegramSettings", () => {
  const chats = [{ id: "c1", title: "Flatmates", telegramChatId: -1001, linkedAtLabel: "1 Jan" }];

  it("shows linked state, the connect and add-to-group actions, and the linked groups", () => {
    render(<TelegramSettings configured botUsername="settlelah_bot" linked linkedUsername="junwei" chats={chats} showUnconfiguredNotice={false} />);
    expect(screen.getByText("Linked as @junwei")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /relink your telegram/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /add the bot to a group/i })).toBeEnabled();
    expect(screen.getByText("Flatmates")).toBeInTheDocument();
  });

  it("disables linking and explains when the bot is not configured", () => {
    render(<TelegramSettings configured={false} botUsername={null} linked={false} linkedUsername={null} chats={[]} showUnconfiguredNotice={false} />);
    expect(screen.getByText("Not linked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect your telegram/i })).toBeDisabled();
    expect(screen.getByText(/not configured on this server/)).toBeInTheDocument();
    expect(screen.getByText(/No groups linked/)).toBeInTheDocument();
  });
});
