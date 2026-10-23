// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { computeDraft, emptyDraft, type DraftParticipant, type ReceiptDraft } from "../../../_lib/receipt-draft";
import { ItemEditor } from "../item-editor";

const HOST = "host-1";
const participants: DraftParticipant[] = [
  { id: HOST, name: "Me", isHost: true },
  { id: "f-sarah", name: "Sarah", isHost: false },
];

function Harness({ onDraft }: { onDraft: (d: ReceiptDraft) => void }) {
  const [draft, setDraft] = useState(() => emptyDraft(participants, "manual"));
  const update = (next: ReceiptDraft) => {
    setDraft(next);
    onDraft(next);
  };
  return <ItemEditor draft={draft} onChange={update} />;
}

describe("ItemEditor (manual mode)", () => {
  it("adds an item shared by everyone, takes a price in dollars and splits equally", async () => {
    const user = userEvent.setup();
    let latest: ReceiptDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);

    await user.type(screen.getByLabelText("Title"), "Lunch");
    await user.click(screen.getByRole("button", { name: /add item/i }));
    await user.type(screen.getByLabelText("Item 1"), "Set lunch");
    const price = screen.getByLabelText("Price (SGD)");
    await user.type(price, "20");
    await user.tab();
    expect(price).toHaveValue("20.00");

    await user.selectOptions(screen.getByLabelText("Charges"), "none");

    expect(latest?.items[0]).toMatchObject({ label: "Set lunch", price: 2000, sharedBy: [HOST, "f-sarah"] });
    const result = computeDraft(latest!, HOST);
    if (!result.ok) throw new Error(result.error);
    expect(result.split.shares.map((s) => s.amount)).toEqual([1000, 1000]);
  });

  it("lets the host untick a sharer, exclude someone and pick a redistribution", async () => {
    const user = userEvent.setup();
    let latest: ReceiptDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);
    await user.click(screen.getByRole("button", { name: /add item/i }));
    const row = screen.getByLabelText("Item 1").closest("li")!;
    await user.click(within(row).getByLabelText(/^Me/));
    expect(latest?.items[0].sharedBy).toEqual(["f-sarah"]);

    const excl = screen.getByText("Pays nothing (e.g. the birthday person)").closest("fieldset")!;
    await user.click(within(excl).getByLabelText(/^Sarah/));
    expect(latest?.excluded).toEqual(["f-sarah"]);
    await user.selectOptions(screen.getByLabelText("Their share goes to the others"), "equal");
    expect(latest?.redistribute).toBe("equal");
  });

  it("supports a treat", async () => {
    const user = userEvent.setup();
    let latest: ReceiptDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);
    await user.selectOptions(screen.getByLabelText("Someone is treating everyone"), HOST);
    expect(latest?.treatedBy).toBe(HOST);
  });
});
