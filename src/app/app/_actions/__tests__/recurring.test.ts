import { beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "host-1";
const db = { tag: "db" };

const RecurringInputError = vi.hoisted(() => class RecurringInputError extends Error {})();

const mocks = vi.hoisted(() => ({
  requireHost: vi.fn(),
  createRecurring: vi.fn(),
  updateRecurring: vi.fn(),
  pauseRecurring: vi.fn(),
  resumeRecurring: vi.fn(),
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
vi.mock("@/server/db", () => ({
  createRecurring: mocks.createRecurring,
  updateRecurring: mocks.updateRecurring,
  pauseRecurring: mocks.pauseRecurring,
  resumeRecurring: mocks.resumeRecurring,
  RecurringInputError,
}));

import { parseRecurringForm, saveRecurring, setRecurringActive } from "../recurring";

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

const valid = {
  title: "Netflix",
  amount: "17.90",
  cadence: "monthly",
  anchorDay: "31",
  participant: [HOST, "f-sarah"],
  "weight_f-sarah": "2",
  telegramChatId: "-1001",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHost.mockResolvedValue({ host: { id: HOST }, db });
  mocks.createRecurring.mockResolvedValue({ id: "r1" });
  mocks.updateRecurring.mockResolvedValue({ id: "r1" });
});

describe("parseRecurringForm", () => {
  it("converts dollars with fromDollars and reads participants, weights and the optional group", () => {
    expect(parseRecurringForm(form(valid))).toEqual({
      title: "Netflix",
      amount: 1790,
      cadence: "monthly",
      anchorDay: 31,
      participants: [
        { id: HOST, weight: 1 },
        { id: "f-sarah", weight: 2 },
      ],
      telegramChatId: -1001,
    });
    expect(parseRecurringForm(form({ ...valid, telegramChatId: "" })).telegramChatId).toBeNull();
  });
});

describe("saveRecurring", () => {
  it("creates for the signed-in host and redirects to the list", async () => {
    await expect(saveRecurring({}, form(valid))).rejects.toThrow("NEXT_REDIRECT:/app/recurring");
    expect(mocks.createRecurring).toHaveBeenCalledWith(db, HOST, expect.objectContaining({ amount: 1790, anchorDay: 31 }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/recurring");
  });

  it("edits when a recurringExpenseId is present and stays on the page", async () => {
    const result = await saveRecurring({}, form({ ...valid, recurringExpenseId: "r1" }));
    expect(result).toEqual({ ok: true });
    expect(mocks.updateRecurring).toHaveBeenCalledWith(db, HOST, "r1", expect.objectContaining({ title: "Netflix" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/recurring/r1");
  });

  it("explains bad dollars and repository validation errors without saving", async () => {
    expect(await saveRecurring({}, form({ ...valid, amount: "17.999" }))).toEqual({ error: "Amount: enter dollars like 17.90." });
    expect(mocks.createRecurring).not.toHaveBeenCalled();
    mocks.createRecurring.mockRejectedValue(new RecurringInputError("Participants: choose at least one person."));
    expect(await saveRecurring({}, form(valid))).toEqual({ error: "Participants: choose at least one person." });
  });
});

describe("setRecurringActive", () => {
  it("pauses and resumes for the host", async () => {
    await setRecurringActive(form({ recurringExpenseId: "r1", active: "false" }));
    expect(mocks.pauseRecurring).toHaveBeenCalledWith(db, HOST, "r1");
    await setRecurringActive(form({ recurringExpenseId: "r1", active: "true" }));
    expect(mocks.resumeRecurring).toHaveBeenCalledWith(db, HOST, "r1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/recurring/r1");
  });
});
