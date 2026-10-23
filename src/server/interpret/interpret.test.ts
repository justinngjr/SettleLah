import { beforeEach, describe, expect, it } from "vitest";

import { allocateRemainder, NO_CHARGES, SG_GST_ONLY, SG_STANDARD_CHARGES, splitReceipt } from "@/domain";

import { LlmRequestError } from "./client";
import { InterpretError } from "./errors";
import {
  ALL_IDS,
  DINNER_INPUT,
  DINNER_INTERPRETATION,
  DINNER_TOTALS,
  lastUserText,
  LIVE_INPUT,
  LIVE_INTERPRETATION,
  PARTICIPANTS,
  reply,
  scriptedLlm,
  type Step,
} from "./fixtures.test-helpers";
import {
  extractJson,
  interpretReceipt,
  knownResponseFormat,
  resetResponseFormatCache,
  stripReasoning,
  toChargePolicy,
  validateOutput,
} from "./interpret";

const DEPS = { model: "primary" };
const WITH_FALLBACK = { model: "primary", fallbackModel: "backup" };

beforeEach(() => {
  resetResponseFormatCache();
});

const throwing =
  (status?: number): Step =>
  () => {
    throw new LlmRequestError(`provider said ${status ?? "nothing"}`, status);
  };

async function expectInterpretError(promise: Promise<unknown>, code: InterpretError["code"]): Promise<InterpretError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InterpretError);
    expect((error as InterpretError).code).toBe(code);
    return error as InterpretError;
  }
  throw new Error(`expected InterpretError ${code}`);
}

describe("interpretReceipt: happy paths", () => {
  it("(a) 'Sarah skipped the drinks' excludes Sarah from drink lines and shares sum to the computed total", async () => {
    const { llm, requests } = scriptedLlm([reply(DINNER_INTERPRETATION)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("primary");
    expect(requests[0].responseFormat.type).toBe("json_schema");
    expect(result.model).toBe("primary");
    expect(result.llm).toEqual({ responseFormat: "json_schema", attempts: 1 });

    const drinks = result.splitInput.items.filter((i) => /Juice|Beer/.test(i.label ?? ""));
    expect(drinks).toHaveLength(2);
    for (const drink of drinks) expect(drink.sharedBy).not.toContain("sarah");
    expect(result.splitInput.items.map((i) => i.price)).toEqual([8800, 2800, 600, 1800, 2400]);
    expect(result.splitInput.charges).toEqual(SG_STANDARD_CHARGES);
    expect(result.splitInput.participants).toEqual(ALL_IDS);

    expect(result.split.totals).toEqual(DINNER_TOTALS);
    const sum = result.split.shares.reduce((acc, share) => acc + share.amount, 0);
    expect(sum).toBe(result.split.totals.total);
    expect(result.split.shares.map((s) => s.participantId)).toEqual(ALL_IDS);
    const byId = Object.fromEntries(result.split.shares.map((s) => [s.participantId, s]));
    expect(byId.sarah.amount).toBeLessThan(byId.alice.amount);
    expect(byId.sarah.itemsSubtotal).toBe(2440); // (88 + 28 + 6) / 5
    expect(byId.sarah.paysNothing).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.interpretation).toEqual(DINNER_INTERPRETATION);
  });

  it("(b) 'Ben's birthday, split his share equally' maps to an equal exclusion and Ben pays nothing", async () => {
    const interpretation = {
      ...DINNER_INTERPRETATION,
      exclusion: { participants: ["ben"], redistribute: "equal" },
      assumptions: ["Ben's shares are split equally among the other four."],
    };
    const { llm } = scriptedLlm([reply(interpretation)]);
    const result = await interpretReceipt(
      { ...DINNER_INPUT, note: "it's Ben's birthday, split his share equally" },
      { llm, ...DEPS },
    );

    expect(result.splitInput.exclusion).toEqual({ participants: ["ben"], redistribute: "equal" });
    const ben = result.split.shares.find((s) => s.participantId === "ben");
    expect(ben).toMatchObject({ amount: 0, paysNothing: true });
    const sum = result.split.shares.reduce((acc, share) => acc + share.amount, 0);
    expect(sum).toBe(DINNER_TOTALS.total);
    expect(result.warnings).toEqual([]);
  });

  it("(c) an ambiguous redistribution note surfaces a non-empty questions list and defaults to proportional", async () => {
    const interpretation = {
      ...DINNER_INTERPRETATION,
      exclusion: { participants: ["ben"], redistribute: "proportional" },
      questions: ["Should Ben's share be split equally among the others or in proportion to what each ordered?"],
    };
    const { llm } = scriptedLlm([reply(interpretation)]);
    const result = await interpretReceipt(
      { ...DINNER_INPUT, note: "don't charge Ben, it's his birthday" },
      { llm, ...DEPS },
    );

    expect(result.interpretation.questions.length).toBeGreaterThan(0);
    expect(result.splitInput.exclusion?.redistribute).toBe("proportional");
    expect(result.split.shares.reduce((acc, s) => acc + s.amount, 0)).toBe(DINNER_TOTALS.total);
  });

  it("(d) a printed total that differs from the computed total adds a warning and adjusts nothing", async () => {
    const interpretation = { ...DINNER_INTERPRETATION, printed: { subtotal: "164.00", total: "196.60" } };
    const { llm } = scriptedLlm([reply(interpretation)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });

    expect(result.split.totals.total).toBe(DINNER_TOTALS.total);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Printed total \$196\.60 differs from computed total \$196\.64 \(-\$0\.04\)/);
  });

  it("treats: everyone but the treater pays nothing", async () => {
    const { llm } = scriptedLlm([reply({ ...DINNER_INTERPRETATION, treatedBy: "alice" })]);
    const result = await interpretReceipt({ ...DINNER_INPUT, note: "my treat" }, { llm, ...DEPS });
    const alice = result.split.shares.find((s) => s.participantId === "alice");
    expect(alice?.amount).toBe(DINNER_TOTALS.total);
    expect(result.split.shares.filter((s) => s.participantId !== "alice").every((s) => s.paysNothing)).toBe(true);
  });

  it("accepts a receipt image instead of text and forwards it as an image part", async () => {
    const image = `data:image/png;base64,${Buffer.from("not really a png").toString("base64")}`;
    const { llm, requests } = scriptedLlm([reply(DINNER_INTERPRETATION)]);
    await interpretReceipt({ image, note: "", participants: [...PARTICIPANTS], hostId: "alice" }, { llm, ...DEPS });
    const user = requests[0].messages[1];
    expect(user.role).toBe("user");
    if (user.role !== "user") throw new Error("unreachable");
    expect(user.content).toContainEqual({ type: "image", dataUrl: image });
  });

  it("warns when a participant is on no item", async () => {
    const interpretation = {
      ...DINNER_INTERPRETATION,
      items: DINNER_INTERPRETATION.items.map((i) => ({ ...i, sharedBy: i.sharedBy.filter((id) => id !== "mei") })),
    };
    const { llm } = scriptedLlm([reply(interpretation)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });
    expect(result.warnings).toEqual([expect.stringContaining("Mei is not on any item")]);
    expect(result.split.shares.find((s) => s.participantId === "mei")?.amount).toBe(0);
  });
});

describe("interpretReceipt: host-aware rounding (live smoke-test case)", () => {
  /**
   * Independent derivation, in cents. Items: Chicken Rice 1200 + Laksa 750 shared
   * by all 5 (390 each); Crab 3600 by alex+dan (1800 each); Kopi 690 + Lime 560
   * by alex, ben, chloe, dan (312.5 each). Subtotal 6800 -> SC 680 -> GST
   * round(0.09 * 7480 = 673.2) = 673 -> total 8153.
   * Own subtotals: alex 2502.5, ben 702.5, chloe 702.5, dan 2502.5, sarah 390.
   * Ben excluded with "equal": his 702.5 is split 175.625 to each of the 4 payers,
   * giving weights alex 2678.125, chloe 878.125, dan 2678.125, sarah 565.625
   * (x8 to stay integral: 21425, 7025, 21425, 4525; sum 54400).
   */
  const WEIGHTS_X8 = { alex: BigInt(21425), ben: BigInt(0), chloe: BigInt(7025), dan: BigInt(21425), sarah: BigInt(4525) };
  const WEIGHT_SUM_X8 = BigInt(54400);
  const TOTAL = BigInt(8153);
  const floorShare = (id: keyof typeof WEIGHTS_X8) => Number((TOTAL * WEIGHTS_X8[id]) / WEIGHT_SUM_X8);

  it("gives every leftover cent to friends, never the host, and matches the hand-derived shares", async () => {
    const { llm } = scriptedLlm([reply(LIVE_INTERPRETATION)]);
    const result = await interpretReceipt(LIVE_INPUT, { llm, ...DEPS });

    expect(result.split.totals).toEqual({ subtotal: 6800, serviceCharge: 680, gst: 673, total: 8153 });
    expect(result.warnings).toEqual([]);

    const amounts = Object.fromEntries(result.split.shares.map((s) => [s.participantId, s.amount]));
    // Floors: alex 3210, chloe 1052, dan 3210, sarah 678 -> 8150, so 3 cents are left over.
    expect([floorShare("alex"), floorShare("chloe"), floorShare("dan"), floorShare("sarah")]).toEqual([3210, 1052, 3210, 678]);
    expect(amounts.alex).toBe(floorShare("alex")); // the host gets no extra cent
    expect(amounts.dan).toBe(floorShare("dan") + 1);
    expect(amounts.chloe).toBe(floorShare("chloe") + 1);
    expect(amounts.sarah).toBe(floorShare("sarah") + 1);
    expect(amounts).toEqual({ alex: 3210, ben: 0, chloe: 1053, dan: 3211, sarah: 679 });
    expect(Object.values(amounts).reduce((a, b) => a + b, 0)).toBe(8153);

    // The default largest-remainder policy would have made the host absorb a cent instead of Sarah.
    const byDefault = splitReceipt({ ...result.splitInput, remainderPolicy: allocateRemainder });
    const defaults = Object.fromEntries(byDefault.shares.map((s) => [s.participantId, s.amount]));
    expect(defaults).toEqual({ alex: 3211, ben: 0, chloe: 1053, dan: 3211, sarah: 678 });
  });

  it("uses the request's hostId for the remainder policy", async () => {
    const { llm } = scriptedLlm([reply(LIVE_INTERPRETATION)]);
    const result = await interpretReceipt({ ...LIVE_INPUT, hostId: "dan" }, { llm, ...DEPS });
    const amounts = Object.fromEntries(result.split.shares.map((s) => [s.participantId, s.amount]));
    expect(amounts).toEqual({ alex: 3211, ben: 0, chloe: 1053, dan: 3210, sarah: 679 });
  });
});

describe("interpretReceipt: reasoning blocks", () => {
  const json = JSON.stringify(DINNER_INTERPRETATION);

  it("ignores a <think>…</think> block whose text contains braces", async () => {
    const text = `<think>The note says {Sarah skipped} drinks... so sharedBy = {alice, ben}. Let me output } now.</think>\n${json}`;
    const { llm } = scriptedLlm([reply(text)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });
    expect(result.llm.attempts).toBe(1);
    expect(result.split.totals).toEqual(DINNER_TOTALS);
  });

  it("handles an unterminated leading <think> by skipping to the first { after it", async () => {
    const text = `<think>Thinking about drinks and crab, no braces here\n${json}`;
    const { llm } = scriptedLlm([reply(text)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });
    expect(result.llm.attempts).toBe(1);
  });

  it("stripReasoning covers paired, stray-close and unterminated forms and fenced JSON after them", () => {
    expect(stripReasoning("<think>a { b } c</think> {\"x\":1}")).toBe('{"x":1}');
    expect(stripReasoning("<THINK>one</THINK>\n<think>two {}</think>\n```json\n{\"x\":1}\n```")).toBe('```json\n{"x":1}\n```');
    expect(stripReasoning("reasoning without opening tag { } </think>\n{\"x\":1}")).toBe('{"x":1}');
    expect(stripReasoning("<think>never closed\n{\"x\":1}")).toBe('{"x":1}');
    expect(stripReasoning("<think>never closed and no json")).toBe("");
    expect(stripReasoning('{"x":1}')).toBe('{"x":1}');
    expect(extractJson("<think>{not json}</think>```json\n{\"x\":[1]}\n```")).toEqual({ x: [1] });
  });
});

describe("interpretReceipt: remembers accepted response formats", () => {
  const rejectJsonSchema: Step = (request) => {
    if (request.responseFormat.type === "json_schema") throw new LlmRequestError("unsupported", 400);
    return { text: JSON.stringify(DINNER_INTERPRETATION) };
  };

  it("skips json_schema for a (baseURL, model) that rejected it before", async () => {
    const { llm, requests } = scriptedLlm([rejectJsonSchema, rejectJsonSchema, rejectJsonSchema]);
    const provider = { ...llm, baseURL: "https://soclaas.example/v1" };
    expect(knownResponseFormat(provider, "primary")).toBeUndefined();

    await interpretReceipt(DINNER_INPUT, { llm: provider, ...DEPS });
    expect(knownResponseFormat(provider, "primary")).toBe("json_object");

    const second = await interpretReceipt(DINNER_INPUT, { llm: provider, ...DEPS });
    expect(requests.map((r) => r.responseFormat.type)).toEqual(["json_schema", "json_object", "json_object"]);
    expect(second.llm.responseFormat).toBe("json_object");
  });

  it("keys the memory by provider and model", async () => {
    const { llm, requests } = scriptedLlm([rejectJsonSchema, rejectJsonSchema, reply(DINNER_INTERPRETATION), reply(DINNER_INTERPRETATION)]);
    const providerA = { ...llm, baseURL: "https://a.example/v1" };
    const providerB = { ...llm, baseURL: "https://b.example/v1" };
    await interpretReceipt(DINNER_INPUT, { llm: providerA, ...DEPS });
    await interpretReceipt(DINNER_INPUT, { llm: providerA, model: "other" });
    await interpretReceipt(DINNER_INPUT, { llm: providerB, ...DEPS });
    expect(requests.map((r) => [r.model, r.responseFormat.type])).toEqual([
      ["primary", "json_schema"],
      ["primary", "json_object"],
      ["other", "json_schema"],
      ["primary", "json_schema"],
    ]);
    expect(knownResponseFormat(providerA, "primary")).toBe("json_object");
    expect(knownResponseFormat(providerA, "other")).toBe("json_schema");
    expect(knownResponseFormat(providerB, "primary")).toBe("json_schema");
  });
});

describe("interpretReceipt: validation retry", () => {
  it("(e) retries once with the error appended when the first response is not valid JSON", async () => {
    const { llm, requests } = scriptedLlm([reply("Sure! Here is the split: {not json"), reply(DINNER_INTERPRETATION)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });

    expect(requests).toHaveLength(2);
    expect(result.llm.attempts).toBe(2);
    const retry = requests[1].messages;
    expect(retry).toHaveLength(4);
    expect(retry[2]).toEqual({ role: "assistant", content: "Sure! Here is the split: {not json" });
    expect(lastUserText(requests[1])).toMatch(/rejected because it did not match the schema/);
    expect(lastUserText(requests[1])).toMatch(/not valid JSON/);
  });

  it("retries with zod issues when the JSON has the wrong shape", async () => {
    const bad = { ...DINNER_INTERPRETATION, items: [{ label: "Crab", price: 88, sharedBy: ALL_IDS }] };
    const { llm, requests } = scriptedLlm([reply(bad), reply(DINNER_INTERPRETATION)]);
    await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });
    expect(lastUserText(requests[1])).toMatch(/items\.0\.price/);
  });

  it("(f) fails with a typed invalid_output error when the output is invalid twice and there is no fallback model", async () => {
    const { llm, requests } = scriptedLlm([reply("nope"), reply("{}")]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...DEPS }), "invalid_output");
    expect(requests).toHaveLength(2);
    expect(error.details).toMatchObject({ model: "primary", problems: expect.arrayContaining([expect.stringContaining("items")]) });
  });

  it("(g) an unknown participant id is a typed error, not silently dropped", async () => {
    const bad = {
      ...DINNER_INTERPRETATION,
      items: [...DINNER_INTERPRETATION.items, { label: "Dessert", price: "9.00", sharedBy: ["sara"] }],
    };
    const { llm, requests } = scriptedLlm([reply(bad), reply(bad)]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...DEPS }), "unknown_participant");
    expect(requests).toHaveLength(2);
    expect(lastUserText(requests[1])).toMatch(/"sara" is not a participant id/);
    expect(error.details).toMatchObject({ problems: [expect.stringContaining('"sara"')] });
  });

  it("a negative or unparsable price is an invalid_price error", async () => {
    const bad = { ...DINNER_INTERPRETATION, items: [{ label: "Voucher", price: "-5.00", sharedBy: ALL_IDS }] };
    const { llm } = scriptedLlm([reply(bad), reply(bad)]);
    await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...DEPS }), "invalid_price");
  });

  it("a domain rejection (treater also excluded) is a split_failed error", async () => {
    const bad = { ...DINNER_INTERPRETATION, treatedBy: "ben", exclusion: { participants: ["ben"], redistribute: "equal" } };
    const { llm } = scriptedLlm([reply(bad)]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...DEPS }), "split_failed");
    expect(error.message).toMatch(/cannot both treat and be excluded/);
  });

  it("rejects bad input before calling the model", async () => {
    const { llm, requests } = scriptedLlm([]);
    await expectInterpretError(interpretReceipt({ note: "", participants: [], hostId: "a" }, { llm, ...DEPS }), "invalid_input");
    await expectInterpretError(
      interpretReceipt(
        { receiptText: "x", note: "", participants: [{ id: "a", name: "A" }, { id: "a", name: "B" }], hostId: "a" },
        { llm, ...DEPS },
      ),
      "invalid_input",
    );
    const strangerHost = await expectInterpretError(
      interpretReceipt({ ...DINNER_INPUT, hostId: "zoe" }, { llm, ...DEPS }),
      "invalid_input",
    );
    expect(strangerHost.details).toEqual([expect.objectContaining({ path: ["hostId"] })]);
    expect(requests).toHaveLength(0);
  });
});

describe("interpretReceipt: response_format fallback", () => {
  it("(h) steps down to json_object when the provider rejects json_schema with 400", async () => {
    const steps: Step[] = [
      (request) => {
        if (request.responseFormat.type === "json_schema") throw new LlmRequestError("response_format not supported", 400);
        return { text: JSON.stringify(DINNER_INTERPRETATION) };
      },
    ];
    const { llm, requests } = scriptedLlm([steps[0], steps[0]]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });

    expect(requests.map((r) => r.responseFormat.type)).toEqual(["json_schema", "json_object"]);
    expect(result.llm).toEqual({ responseFormat: "json_object", attempts: 1 });
    expect(result.split.totals).toEqual(DINNER_TOTALS);
  });

  it("falls all the way to plain text and keeps that format for the validation retry", async () => {
    const step: Step = (request) => {
      if (request.responseFormat.type !== "text") throw new LlmRequestError("bad request", 400);
      return { text: request.messages.length === 2 ? "```json\n{}\n```" : "```json\n" + JSON.stringify(DINNER_INTERPRETATION) + "\n```" };
    };
    const { llm, requests } = scriptedLlm([step, step, step, step]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...DEPS });
    expect(requests.map((r) => r.responseFormat.type)).toEqual(["json_schema", "json_object", "text", "text"]);
    expect(result.llm).toEqual({ responseFormat: "text", attempts: 2 });
  });

  it("a 400 in plain-text mode is our fault: llm_request_failed with no model fallback", async () => {
    const { llm, requests } = scriptedLlm([throwing(400), throwing(400), throwing(400)]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK }), "llm_request_failed");
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.model === "primary")).toBe(true);
    expect(error.details).toMatchObject({ status: 400, providerFailure: false });
  });
});

describe("interpretReceipt: fallback model", () => {
  it("primary 5xx -> fallback model succeeds, with the model recorded and a warning", async () => {
    const { llm, requests } = scriptedLlm([throwing(503), reply(DINNER_INTERPRETATION)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK });

    expect(requests.map((r) => r.model)).toEqual(["primary", "backup"]);
    expect(requests[1].responseFormat.type).toBe("json_schema");
    expect(result.model).toBe("backup");
    expect(result.warnings).toEqual([expect.stringMatching(/Primary model primary failed .*provider said 503.*fallback model backup/)]);
    expect(result.split.totals).toEqual(DINNER_TOTALS);
  });

  it.each([404, 429, 500, undefined])("primary failing with status %s falls back", async (status) => {
    const { llm, requests } = scriptedLlm([throwing(status), reply(DINNER_INTERPRETATION)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK });
    expect(requests.map((r) => r.model)).toEqual(["primary", "backup"]);
    expect(result.model).toBe("backup");
  });

  it("primary invalid twice -> fallback model succeeds", async () => {
    const { llm, requests } = scriptedLlm([reply("??"), reply("{}"), reply(DINNER_INTERPRETATION)]);
    const result = await interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK });

    expect(requests.map((r) => r.model)).toEqual(["primary", "primary", "backup"]);
    expect(requests[2].messages).toHaveLength(2); // fresh conversation, no stale retry context
    expect(result.model).toBe("backup");
    expect(result.llm.attempts).toBe(1);
    expect(result.warnings[0]).toMatch(/invalid_output/);
  });

  it("both models fail -> typed error from the fallback that also records the primary failure", async () => {
    const { llm, requests } = scriptedLlm([throwing(502), reply("x"), reply("y")]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK }), "invalid_output");
    expect(requests.map((r) => r.model)).toEqual(["primary", "backup", "backup"]);
    expect(error.message).toMatch(/after primary model failed: llm_request_failed/);
    expect(error.details).toMatchObject({ model: "backup", primary: { code: "llm_request_failed" } });
  });

  it("401 -> no fallback", async () => {
    const { llm, requests } = scriptedLlm([throwing(401)]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK }), "llm_request_failed");
    expect(requests).toHaveLength(1);
    expect(error.details).toMatchObject({ status: 401, providerFailure: false });
  });

  it.each([403, 413, 422])("%s -> no fallback either", async (status) => {
    const { llm, requests } = scriptedLlm([throwing(status)]);
    await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...WITH_FALLBACK }), "llm_request_failed");
    expect(requests).toHaveLength(1);
  });

  it("no fallback model configured -> provider failure is a typed error after one model", async () => {
    const { llm, requests } = scriptedLlm([throwing(503)]);
    const error = await expectInterpretError(interpretReceipt(DINNER_INPUT, { llm, ...DEPS }), "llm_request_failed");
    expect(requests).toHaveLength(1);
    expect(error.details).toMatchObject({ model: "primary", status: 503, providerFailure: true });
  });
});

describe("helpers", () => {
  it("toChargePolicy maps the four combinations", () => {
    expect(toChargePolicy({ serviceCharge: true, gstInclusive: false })).toEqual(SG_STANDARD_CHARGES);
    expect(toChargePolicy({ serviceCharge: false, gstInclusive: false })).toEqual(SG_GST_ONLY);
    expect(toChargePolicy({ serviceCharge: false, gstInclusive: true })).toEqual(NO_CHARGES);
    expect(toChargePolicy({ serviceCharge: true, gstInclusive: true })).toEqual({ serviceChargeBps: 1000, gstBps: 0 });
  });

  it("extractJson tolerates fences and surrounding prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":[1,2]} hope that helps')).toEqual({ a: [1, 2] });
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });

  it("validateOutput accepts null for optional fields", () => {
    const result = validateOutput(
      JSON.stringify({ ...DINNER_INTERPRETATION, exclusion: null, treatedBy: null, printed: null }),
      new Set(ALL_IDS),
    );
    expect(result.ok).toBe(true);
  });
});
