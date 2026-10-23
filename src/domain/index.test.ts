import { describe, expect, it } from "vitest";

import {
  appendEvent,
  balanceOf,
  formatSGD,
  fromDollars,
  outstandingRequest,
  SG_STANDARD_CHARGES,
  splitReceipt,
  type Ledger,
} from "./index";

describe("domain public API, end to end", () => {
  it("splits the worked-example dinner and asks each friend for the right amount", () => {
    const everyone = ["alex", "sarah", "ben", "chloe", "dan"];
    const drinkers = ["alex", "ben", "chloe", "dan"];
    const { totals, shares } = splitReceipt({
      participants: everyone,
      charges: SG_STANDARD_CHARGES,
      items: [
        { label: "Sharing platter", price: fromDollars("58.90"), sharedBy: everyone },
        { label: "Truffle pasta", price: fromDollars("18.53"), sharedBy: everyone },
        { label: "Margherita pizza", price: fromDollars("15.00"), sharedBy: everyone },
        { label: "Drinks ×4", price: fromDollars("26.00"), sharedBy: drinkers },
      ],
    });

    expect(formatSGD(totals.subtotal)).toBe("$118.43");
    expect(formatSGD(totals.serviceCharge)).toBe("$11.84");
    expect(formatSGD(totals.gst)).toBe("$11.72");
    expect(formatSGD(totals.total)).toBe("$141.99");
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(totals.total);

    // Alex is the host: friends' shares become ledger entries against each friend.
    // Sarah has $20.00 credit carried over from last month.
    let ledger: Ledger = [{ type: "credit", friendId: "sarah", amount: fromDollars("20.00"), note: "last month" }];
    for (const share of shares) {
      if (share.participantId !== "alex") {
        ledger = appendEvent(ledger, { type: "expense_share", friendId: share.participantId, amount: share.amount });
      }
    }

    expect(formatSGD(balanceOf(ledger, "sarah"))).toBe("$2.16");
    expect(outstandingRequest(ledger, "sarah")).toBe(fromDollars("22.16") - fromDollars("20.00"));
    expect(formatSGD(outstandingRequest(ledger, "ben"))).toBe("$29.96");
    expect(formatSGD(outstandingRequest(ledger, "dan"))).toBe("$29.95");
    expect(balanceOf(ledger, "alex")).toBe(0);
  });
});
