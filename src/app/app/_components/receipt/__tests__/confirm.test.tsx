// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { splitReceipt } from "@/domain";

import { draftToSplitInput, emptyDraft, type DraftParticipant, type ReceiptDraft } from "../../../_lib/receipt-draft";
import { ConfirmScreen } from "../confirm";

vi.mock("../../../_actions/receipts", () => ({ saveReceipt: vi.fn() }));

const HOST = "host-1";
const participants: DraftParticipant[] = [
  { id: HOST, name: "Me", isHost: true },
  { id: "f-sarah", name: "Sarah", isHost: false },
  { id: "f-ben", name: "Ben", isHost: false },
];

function baseDraft(patch: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    ...emptyDraft(participants, "llm"),
    title: "Dinner",
    charges: "none",
    items: [
      { id: "a", label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah"] },
      { id: "b", label: "Tea", price: 400, sharedBy: ["f-ben"] },
    ],
    ...patch,
  };
}

function Harness({ initial, save }: { initial: ReceiptDraft; save: (p: unknown) => Promise<{ ok: true; receiptId: string } | { ok: false; error: string }> }) {
  const [draft, setDraft] = useState(initial);
  return <ConfirmScreen draft={draft} hostId={HOST} onChange={setDraft} onBack={() => {}} onSaved={() => {}} save={save as never} />;
}

describe("ConfirmScreen", () => {
  it("shows the domain's totals and shares", () => {
    const draft = baseDraft();
    render(<Harness initial={draft} save={vi.fn()} />);
    const split = splitReceipt(draftToSplitInput(draft, HOST));
    expect(split.totals.total).toBe(1400);
    expect(screen.getByText("Total").closest("div")).toHaveTextContent("$14.00");
    const shares = within(screen.getByText("Each person pays").parentElement!);
    expect(shares.getByText("Sarah").closest("div")).toHaveTextContent("$5.00");
    expect(shares.getByText("Ben").closest("div")).toHaveTextContent("$4.00");
    expect(screen.getByRole("button", { name: /confirm and save/i })).toBeEnabled();
  });

  it("disables Confirm until every question is acknowledged", async () => {
    const user = userEvent.setup();
    render(<Harness initial={baseDraft({ questions: ["Who had the tea?", "Any GST?"] })} save={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: /confirm and save/i });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/2 open questions/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Who had the tea?"));
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/1 open question/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Any GST?"));
    expect(confirm).toBeEnabled();
  });

  it("re-splits when an assignment is edited", async () => {
    const user = userEvent.setup();
    render(<Harness initial={baseDraft()} save={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /edit items/i }));
    // Give Ben a share of the rice: 1000 / 3 => host 333, Sarah 333/334, Ben 334/333 + 400.
    const riceRow = screen.getByLabelText("Item 1").closest("li")!;
    await user.click(within(riceRow).getByLabelText(/^Ben/));
    await user.click(screen.getByRole("button", { name: /done editing/i }));

    const hostRow = screen.getByText("Me (you)").closest("div")!;
    expect(hostRow).toHaveTextContent("$3.33");
    expect(screen.getByText("Total").closest("div")).toHaveTextContent("$14.00");
  });

  it("sends the computed total to the server and shows a server error", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: false, error: "The total changed while confirming." });
    render(<Harness initial={baseDraft()} save={save} />);
    await user.click(screen.getByRole("button", { name: /confirm and save/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedTotal: 1400, title: "Dinner", source: "llm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The total changed while confirming.");
  });

  it("lists warnings and assumptions as text, not numbers to trust", () => {
    render(<Harness initial={baseDraft({ warnings: ["Printed total differs"], assumptions: ["Tea is Ben's"] })} save={vi.fn()} />);
    expect(screen.getByText("Printed total differs")).toBeInTheDocument();
    expect(screen.getByText("Tea is Ben's")).toBeInTheDocument();
  });
});

describe("ConfirmScreen Telegram group picker", () => {
  const chats = [{ telegramChatId: -1001, title: "Flatmates" }];

  it("is hidden without linked groups and sends null", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, receiptId: "r1" });
    render(<Harness initial={baseDraft()} save={save} />);
    expect(screen.queryByLabelText(/post to a telegram group/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /confirm and save/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ telegramChatId: null }));
  });

  it("sends the chosen group with the payload", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, receiptId: "r1" });
    const onSaved = vi.fn();
    render(<ConfirmScreen draft={baseDraft()} hostId={HOST} chats={chats} onChange={() => {}} onBack={() => {}} onSaved={onSaved} save={save as never} />);
    await userEvent.selectOptions(screen.getByLabelText(/post to a telegram group/i), "-1001");
    await userEvent.click(screen.getByRole("button", { name: /confirm and save/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ telegramChatId: -1001 }));
    expect(onSaved).toHaveBeenCalledWith("r1");
  });

  it("shows a non-blocking error when the post fails and lets the host continue", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, receiptId: "r1", notifyError: "The split is saved, but it was not posted to the group." });
    const onSaved = vi.fn();
    render(<ConfirmScreen draft={baseDraft()} hostId={HOST} chats={chats} onChange={() => {}} onBack={() => {}} onSaved={onSaved} save={save as never} />);
    await userEvent.selectOptions(screen.getByLabelText(/post to a telegram group/i), "-1001");
    await userEvent.click(screen.getByRole("button", { name: /confirm and save/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/saved, but it was not posted/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm and save/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSaved).toHaveBeenCalledWith("r1");
  });
});
