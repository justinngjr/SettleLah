/**
 * Not a smoke test: captures every main screen at 390/1280px in light and dark
 * for design review. Run with `pnpm screenshots` (needs local Supabase and
 * `.env.local`, like the smoke test); output goes to SCREENSHOT_DIR
 * (default test-results/screens, git-ignored).
 */
import { test, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { adminClient, signInAsNewHost } from "./auth";

test.setTimeout(240_000);

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = process.env.SCREENSHOT_DIR ?? "test-results/screens";
mkdirSync(out, { recursive: true });

const SPLIT_PREVIEW = {
  title: "Save split: Friday dinner at Ah Hua",
  summary: "Saves the receipt and records what each person owes; open payment requests are updated for 2 friends.",
  rows: [
    { label: "Subtotal", value: "$105.50" },
    { label: "Service charge", value: "$10.55" },
    { label: "GST", value: "$10.44" },
    { label: "Total", value: "$126.49", strong: true },
  ],
  shares: [
    { participantId: "host", name: "You", amount: "$45.80", paysNothing: false },
    { participantId: "sarah", name: "Sarah", amount: "$34.89", paysNothing: false },
    { participantId: "ben", name: "Ben", amount: "$45.80", paysNothing: false },
  ],
  openInApp: "/app",
};

async function seedAgentConversation(hostId: string): Promise<string> {
  const admin = adminClient();
  const conversation = await admin.from("agent_conversations").insert({ host_id: hostId, title: "Split this receipt, Sarah skipped drinks" }).select("id").single();
  if (conversation.error) throw conversation.error;
  const id = conversation.data.id as string;
  const messages = [
    { role: "user", content: "Split this receipt, Sarah skipped drinks" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "save_split", arguments: "{}" }] },
    { role: "tool", content: "", tool_call_id: "call_1", tool_result: { pending_action: { status: "pending" } } },
    {
      role: "assistant",
      content: "I read the receipt: chilli crab, cereal prawns, rice and lime juice with 10% service charge and GST. Sarah is not on the lime juice. Approve the card to save it; Sarah and Ben will get payment requests.",
    },
  ];
  for (const message of messages) {
    const inserted = await admin.from("agent_messages").insert({ conversation_id: id, host_id: hostId, ...message });
    if (inserted.error) throw inserted.error;
  }
  const action = await admin.from("agent_actions").insert({
    conversation_id: id,
    host_id: hostId,
    tool_call_id: "call_1",
    tool: "save_split",
    input: { title: "Friday dinner at Ah Hua" },
    preview: SPLIT_PREVIEW,
    preview_hash: "0".repeat(64),
  });
  if (action.error) throw action.error;
  return id;
}

async function markAgentActionExecuted(conversationId: string): Promise<void> {
  const admin = adminClient();
  const now = new Date().toISOString();
  const updated = await admin
    .from("agent_actions")
    .update({ status: "executed", executed_at: now, resolved_at: now, result: { receiptId: "seeded", total: "$126.49" } })
    .eq("conversation_id", conversationId);
  if (updated.error) throw updated.error;
  const note = await admin.from("agent_messages").insert({
    conversation_id: conversationId,
    host_id: (await admin.from("agent_conversations").select("host_id").eq("id", conversationId).single()).data?.host_id,
    role: "user",
    content: 'The host approved "Save split: Friday dinner at Ah Hua" and it executed.',
    tool_result: { kind: "action_result", status: "executed" },
  });
  if (note.error) throw note.error;
  const reply = await admin.from("agent_messages").insert({
    conversation_id: conversationId,
    host_id: (await admin.from("agent_conversations").select("host_id").eq("id", conversationId).single()).data?.host_id,
    role: "assistant",
    content: "Saved. Sarah owes $34.89 and Ben owes $45.80; both have open payment requests now.",
  });
  if (reply.error) throw reply.error;
}

async function main(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Seed: host, friends, one receipt, one open request.
  const { userId } = await signInAsNewHost(page, base);
  await page.waitForURL(/onboarding/);
  await page.getByLabel(/your display name/i).fill("Jun Wei");
  await page.getByRole("textbox", { name: /mobile number/i }).fill("91234567");
  await page.getByLabel(/payee name/i).fill("JUN WEI TAN");
  await page.getByRole("button", { name: /save and continue/i }).click();
  await page.waitForURL(/\/app(\?.*)?$/);
  for (const name of ["Sarah", "Ben", "Priya"]) {
    await page.goto(`${base}/app/friends`);
    await page.getByLabel(/^name$/i).fill(name);
    await page.getByRole("button", { name: /add friend/i }).click();
    await page.getByRole("link", { name }).waitFor();
  }
  await page.goto(`${base}/app/receipts/new`);
  await page.getByText("Sarah", { exact: true }).click();
  await page.getByText("Ben", { exact: true }).click();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /enter items by hand/i }).click();
  await page.getByLabel(/^title$/i).fill("Friday dinner at Ah Hua");
  const items: [string, string][] = [["Chilli crab", "68.00"], ["Cereal prawns", "24.00"], ["Rice x3", "4.50"], ["Lime juice x3", "9.00"]];
  for (let i = 0; i < items.length; i++) {
    await page.getByRole("button", { name: /add item/i }).click();
    await page.getByRole("textbox", { name: `Item ${i + 1}` }).fill(items[i][0]);
    const price = page.getByLabel("Price (SGD)").nth(i);
    await price.fill(items[i][1]);
    await price.blur();
  }
  await page.getByRole("button", { name: /review split/i }).click();
  const sarahLink = page.getByRole("link", { name: /Sarah/ });
  const confirmUrl = page.url();
  // Capture confirm screen before saving.
  const shots: Array<[string, () => Promise<void>]> = [];
  void confirmUrl;

  const capture = async (name: string) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${out}/${name}-${width}-${scheme}.png`, fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
  };

  await capture("05-confirm");
  await page.getByRole("button", { name: /confirm and save/i }).click();
  await page.waitForURL(/\/app\?saved/);
  await sarahLink.first().waitFor();
  await capture("02-home");

  await page.goto(`${base}/app/friends`);
  await page.getByRole("link", { name: "Sarah" }).waitFor();
  await capture("03-friends");

  await page.getByRole("link", { name: "Sarah" }).click();
  await page.getByText(/reference/i).first().waitFor();
  await capture("06-friend-detail");

  await page.goto(`${base}/app/receipts/new`);
  await page.getByText("Participants").waitFor();
  await capture("04a-receipt-participants");
  await page.getByText("Sarah", { exact: true }).click();
  await page.getByRole("button", { name: /continue/i }).click();
  await capture("04b-receipt-mode");
  await page.getByRole("button", { name: /from a photo/i }).click();
  await capture("04c-receipt-llm");
  await page.getByRole("button", { name: /back/i }).click();
  await page.getByRole("button", { name: /enter items by hand/i }).click();
  await page.getByRole("button", { name: /add item/i }).click();
  await page.getByRole("textbox", { name: "Item 1" }).fill("Kopi");
  await capture("04d-receipt-manual");

  await page.goto(`${base}/app/inbox`);
  await page.getByText("Marked as paid").waitFor();
  await capture("07-inbox");

  await page.goto(`${base}/app/recurring`);
  await page.getByText(/nothing repeats yet/i).waitFor();
  await capture("10a-recurring-empty");
  await page.goto(`${base}/app/recurring/new`);
  await page.getByLabel(/^title$/i).waitFor();
  await page.getByLabel(/^title$/i).fill("Netflix");
  await page.getByLabel(/amount/i).fill("17.90");
  await page.getByLabel("Sarah").check();
  await page.getByLabel("Ben").check();
  await capture("10b-recurring-new");
  await page.getByRole("button", { name: /start this recurring expense/i }).click();
  await page.waitForURL(/\/app\/recurring$/);
  await page.getByRole("link", { name: /Netflix/ }).waitFor();
  await capture("10c-recurring-list");
  await page.getByRole("link", { name: /Netflix/ }).click();
  await page.getByRole("button", { name: /^pause$/i }).waitFor();
  await capture("10d-recurring-detail");
  await page.goto(`${base}/app/agent`);
  await page.getByText(/example prompts|who still owes me/i).first().waitFor();
  await capture("08a-agent-empty");
  // A conversation with a pending split card, then the same card executed (seeded; no LLM in screenshots).
  const conversationId = await seedAgentConversation(userId);
  await page.goto(`${base}/app/agent?conversation=${conversationId}`);
  await page.getByRole("button", { name: /approve/i }).waitFor();
  await capture("08b-agent-pending");
  await markAgentActionExecuted(conversationId);
  await page.goto(`${base}/app/agent?conversation=${conversationId}`);
  await page.getByText(/^Executed$/).waitFor();
  await capture("08c-agent-executed");
  await page.goto(`${base}/app/settings`);
  await page.getByText(/sign out/i).waitFor();
  await capture("09-settings");

  // Signed-out screens.
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await fresh.newPage();
  const page2 = p2;
  await page2.goto(`${base}/login`);
  for (const scheme of ["light", "dark"] as const) {
    await page2.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 1280]) {
      await page2.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page2.screenshot({ path: `${out}/00-login-${width}-${scheme}.png`, fullPage: true });
    }
  }
  // Onboarding + empty home for a brand-new host.
  await signInAsNewHost(page2, base);
  await page2.waitForURL(/onboarding/);
  await page2.getByLabel(/your display name/i).waitFor();
  for (const scheme of ["light", "dark"] as const) {
    await page2.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 1280]) {
      await page2.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page2.screenshot({ path: `${out}/01-onboarding-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page2.getByLabel(/your display name/i).fill("New Host");
  await page2.getByRole("textbox", { name: /mobile number/i }).fill("98765432");
  await page2.getByLabel(/payee name/i).fill("NEW HOST");
  await page2.getByRole("button", { name: /save and continue/i }).click();
  await page2.waitForURL(/\/app(\?.*)?$/);
  await page2.getByText(/nobody owes you/i).waitFor();
  for (const scheme of ["light", "dark"] as const) {
    await page2.emulateMedia({ colorScheme: scheme });
    for (const width of [390, 1280]) {
      await page2.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page2.screenshot({ path: `${out}/02-home-empty-${width}-${scheme}.png`, fullPage: true });
    }
  }
  void shots;
  await fresh.close();
  await context.close();
  console.log(`screenshots written to ${out}`);
}

test("capture screenshots", async ({ browser }) => {
  await main(browser);
});
