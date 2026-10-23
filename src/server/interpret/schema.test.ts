import { describe, expect, it } from "vitest";

import { PARTICIPANTS } from "./fixtures.test-helpers";
import { buildSystemPrompt } from "./prompt";
import { base64DecodedBytes, InterpretInputSchema, receiptInterpretationJsonSchema } from "./schema";

const participants = [...PARTICIPANTS];

describe("InterpretInputSchema", () => {
  it("requires image or receiptText", () => {
    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice" }).success).toBe(false);
    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", receiptText: "Rice 1.00" }).success).toBe(true);
  });

  it("accepts jpeg/png/webp data URLs up to 5 MB and rejects others", () => {
    const small = `data:image/webp;base64,${Buffer.alloc(1024).toString("base64")}`;
    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", image: small }).success).toBe(true);

    const gif = `data:image/gif;base64,${Buffer.alloc(16).toString("base64")}`;
    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", image: gif }).success).toBe(false);

    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", image: "https://example.com/r.png" }).success).toBe(false);

    const exactly5mb = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024).toString("base64")}`;
    expect(InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", image: exactly5mb }).success).toBe(true);

    const over = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`;
    const result = InterpretInputSchema.safeParse({ note: "", participants, hostId: "alice", image: over });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toMatch(/5 MB/);
  });

  it("base64DecodedBytes matches Buffer for every padding case", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100]) {
      expect(base64DecodedBytes(Buffer.alloc(n, 1).toString("base64"))).toBe(n);
    }
  });

  it("requires hostId to be one of the participants", () => {
    const base = { note: "", receiptText: "x", participants };
    expect(InterpretInputSchema.safeParse({ ...base, hostId: "alice" }).success).toBe(true);
    expect(InterpretInputSchema.safeParse(base).success).toBe(false);
    const stranger = InterpretInputSchema.safeParse({ ...base, hostId: "zoe" });
    expect(stranger.success).toBe(false);
    if (!stranger.success) {
      expect(stranger.error.issues).toEqual([
        expect.objectContaining({ path: ["hostId"], message: "hostId must be one of the participant ids" }),
      ]);
    }
  });

  it("rejects duplicate or empty participant ids", () => {
    expect(InterpretInputSchema.safeParse({ note: "", receiptText: "x", participants: [] }).success).toBe(false);
    expect(
      InterpretInputSchema.safeParse({
        note: "",
        receiptText: "x",
        participants: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("receiptInterpretationJsonSchema", () => {
  it("constrains participant ids to the roster and has no $schema key", () => {
    const schema = receiptInterpretationJsonSchema(["alice", "ben"]) as {
      $schema?: string;
      properties: { items: { items: { properties: { sharedBy: { items: { enum: string[] } } } } }; treatedBy: unknown };
      required: string[];
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.items.items.properties.sharedBy.items.enum).toEqual(["alice", "ben"]);
    expect(schema.required).toEqual(["items", "charges", "assumptions", "questions"]);
  });
});

describe("buildSystemPrompt", () => {
  it("lists the participant ids, forbids computing money and explains the redistribution question", () => {
    const prompt = buildSystemPrompt(participants, "alice");
    for (const p of participants) expect(prompt).toContain(`id "${p.id}": ${p.name}`);
    expect(prompt).toContain('id "alice": Alice (the host)');
    expect(prompt).toContain('The host (id "alice") paid the bill');
    expect(prompt).toMatch(/never compute money/i);
    expect(prompt).toMatch(/Never output per-person amounts/);
    expect(prompt).toMatch(/10% service charge/);
    expect(prompt).toMatch(/9% GST/);
    expect(prompt).toMatch(/\+\+/);
    expect(prompt).toMatch(/Hawker/);
    expect(prompt).toMatch(/If the note does not say how, pick "proportional" AND add a question/);
    expect(prompt).toContain('"redistribute"');
  });
});
