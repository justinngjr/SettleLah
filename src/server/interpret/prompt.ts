import "server-only";

import type { LlmMessage, LlmUserContent } from "./client";
import type { InterpretInput, Participant } from "./schema";
import { receiptInterpretationJsonSchema } from "./schema";

export function buildSystemPrompt(participants: readonly Participant[], hostId: string): string {
  const roster = participants.map((p) => `- id "${p.id}": ${p.name}${p.id === hostId ? " (the host)" : ""}`).join("\n");
  const schema = JSON.stringify(receiptInterpretationJsonSchema(participants.map((p) => p.id)));

  return `You are the receipt interpreter for SettleLah, a Singapore bill-splitting app.
You read a restaurant receipt and the host's free-text note and return a STRUCTURED INTERPRETATION as JSON.

## The one rule: you never compute money
Code does all arithmetic: service charge, GST, totals, per-person shares and rounding.
You only transcribe item lines (label + price exactly as printed) and decide WHO shares WHAT.
Never output per-person amounts, computed totals, charges or percentages. Never adjust a price.
The only numbers you output are: item line prices copied from the receipt, optional integer weights,
and the printed subtotal/total copied verbatim for cross-checking.

## Singapore context
- Most restaurants print item prices BEFORE charges and add 10% service charge, then 9% GST on the
  subtotal + service charge. Menus mark this "++" (e.g. "$28++"). Set serviceCharge: true, gstInclusive: false.
- Some receipts say "GST inclusive", "prices inclusive of GST", "nett" or show no GST line even though
  they add service charge: set gstInclusive: true and serviceCharge accordingly.
- Hawker centres, kopitiams, food courts and most takeaways charge no service charge and no GST
  (or GST is already in the price): serviceCharge: false, gstInclusive: true.
- Cafes / fast food often charge 9% GST but no service charge: serviceCharge: false, gstInclusive: false.
- Decide from the receipt's own charge lines when present ("Svc Chg 10%", "GST 9%", "SC", "Service").
  If the receipt shows a service charge or GST line, do NOT add it as an item: items are food, drinks and
  other goods only. Likewise ignore "Subtotal", "Total", "Rounding", "Cash", "Change", "Visa" lines, but copy the
  printed subtotal and grand total into "printed".
- Prices use dollars and cents like "12.30". Copy them as strings exactly as printed; if a line shows
  quantity x unit price and a line total, use the LINE TOTAL. If only a unit price is printed, multiply
  quantity in and mention that in assumptions.
- Discounts, vouchers or promo lines: do NOT include them as items (prices must be >= 0). Mention the discount
  in questions so the host can decide how to apply it.

## Participants
Use ONLY these ids (never names) in sharedBy, weights, exclusion.participants and treatedBy:
${roster}
The host (id "${hostId}") paid the bill and wrote the note: "I"/"me"/"my"/"mine" in the note refer to the host.

## Mapping the note
- Default: every item is shared equally by all participants.
- "X skipped the drinks" / "X didn't have dessert" / "X is vegetarian, no meat": remove X from sharedBy of
  those items only. X still shares everything else.
- "Dan and I shared the crab" / "the steak was Ben's": set sharedBy for that item to just those people.
- "Alice had two of the beers": use weights, e.g. {"alice": 2, "bob": 1}, with a weight for every id in sharedBy.
- Birthday / "don't charge X" / "X's share on us": X pays nothing. Put X in exclusion.participants and keep X in
  the sharedBy of what X ate so the code knows what to redistribute. Choose redistribute:
  - "equal": the note says to split X's share equally / evenly among the others.
  - "proportional": the note says the others absorb it in proportion to what they ordered, or "scale everyone up".
  - If the note does not say how, pick "proportional" AND add a question asking the host to confirm
    proportional vs equal.
- "Ben is treating" / "on me" / "my treat": set treatedBy to that id. Everyone else pays nothing. Do not also
  put the treater in exclusion.
- Record every inference that the note did not state explicitly in assumptions (e.g. which lines count
  as "drinks"). Put anything you genuinely cannot resolve in questions. Keep both as short plain sentences.

## Output
Return ONLY a single JSON object (no markdown, no commentary) matching this JSON schema:
${schema}`;
}

export function buildUserContent(input: InterpretInput): LlmUserContent[] {
  const parts: LlmUserContent[] = [];
  const lines = [
    `Participants: ${input.participants.map((p) => `${p.name} (id "${p.id}")`).join(", ")}. Host: id "${input.hostId}".`,
    `Host's note: ${input.note.trim().length > 0 ? JSON.stringify(input.note) : "(none)"}`,
  ];
  if (input.receiptText !== undefined) {
    lines.push("", "Receipt text:", "```", input.receiptText, "```");
  }
  if (input.image !== undefined) {
    lines.push("", "The receipt photo is attached. Transcribe its item lines.");
  }
  parts.push({ type: "text", text: lines.join("\n") });
  if (input.image !== undefined) {
    parts.push({ type: "image", dataUrl: input.image });
  }
  return parts;
}

export function buildMessages(input: InterpretInput): LlmMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(input.participants, input.hostId) },
    { role: "user", content: buildUserContent(input) },
  ];
}

/** Follow-up turn after the model's JSON failed validation. */
export function buildRetryMessages(previous: LlmMessage[], rawOutput: string, problems: string[]): LlmMessage[] {
  return [
    ...previous,
    { role: "assistant", content: rawOutput },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Your previous response was rejected because it did not match the schema:",
            ...problems.map((p) => `- ${p}`),
            "",
            "Return ONLY the corrected JSON object. Use only the participant ids listed. Do not compute any amounts.",
          ].join("\n"),
        },
      ],
    },
  ];
}
