import { expect, test } from "@playwright/test";

import { signInAsNewHost } from "./auth";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toBeVisible();
});

test("manual receipt → confirm → balance appears", async ({ page, baseURL }) => {
  await signInAsNewHost(page, baseURL!);

  // First login lands on onboarding.
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel(/your display name/i).fill("Host Tester");
  await page.getByRole("textbox", { name: /mobile number/i }).fill("91234567");
  await page.getByLabel(/payee name/i).fill("HOST TESTER");
  await page.getByRole("button", { name: /save|continue/i }).click();
  await expect(page).toHaveURL(/\/app(\?.*)?$/);

  // Add a friend.
  await page.goto("/app/friends");
  await page.getByLabel(/^name$/i).fill("Sarah");
  await page.getByRole("button", { name: /add friend/i }).click();
  await expect(page.getByRole("link", { name: "Sarah" })).toBeVisible();

  // Log a manual receipt: one item 20.00 shared by host + Sarah, no charges.
  await page.goto("/app/receipts/new");
  await page.getByText("Sarah", { exact: true }).click();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /enter items by hand/i }).click();
  await page.getByLabel(/^title$/i).fill("Smoke dinner");
  await page.getByRole("button", { name: /add item/i }).click();
  await page.getByLabel(/^item 1$/i).fill("Set lunch");
  await page.getByLabel(/price/i).fill("20.00");
  await page.getByLabel(/price/i).blur();
  await page.getByLabel(/^charges$/i).selectOption("none");
  await page.getByRole("button", { name: /review split/i }).click();

  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await expect(page.getByText("$20.00").first()).toBeVisible();
  const confirm = page.getByRole("button", { name: /confirm and save/i });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Home shows the balance.
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByText("$10.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Sarah/ })).toBeVisible();
});

test("recurring expense → cron run → friend's balance appears", async ({ page, baseURL, request }) => {
  await signInAsNewHost(page, baseURL!);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel(/your display name/i).fill("Recurring Host");
  await page.getByRole("textbox", { name: /mobile number/i }).fill("91234567");
  await page.getByLabel(/payee name/i).fill("RECURRING HOST");
  await page.getByRole("button", { name: /save|continue/i }).click();
  await expect(page).toHaveURL(/\/app(\?.*)?$/);

  await page.goto("/app/friends");
  await page.getByLabel(/^name$/i).fill("Ben");
  await page.getByRole("button", { name: /add friend/i }).click();
  await expect(page.getByRole("link", { name: "Ben" })).toBeVisible();

  // Monthly on the 1st, shared by host + Ben: Ben owes half of 17.90 = 8.95.
  await page.goto("/app/recurring/new");
  await page.getByLabel(/^title$/i).fill("Netflix");
  await page.getByLabel(/amount/i).fill("17.90");
  await page.getByLabel("Ben").check();
  await page.getByRole("button", { name: /start this recurring expense/i }).click();
  await expect(page).toHaveURL(/\/app\/recurring$/);
  await expect(page.getByRole("link", { name: /Netflix/ })).toBeVisible();
  await expect(page.getByText(/^Next /)).toBeVisible();

  // Nothing is due yet, so the runner charges nothing...
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "CRON_SECRET not set in .env.local");
  const unauthorized = await request.get("/api/cron/recurring");
  expect(unauthorized.status()).toBe(401);
  const idle = await request.get("/api/cron/recurring", { headers: { authorization: `Bearer ${secret}` } });
  expect(idle.ok()).toBeTruthy();

  // ...until the schedule is in the past. The friend's share then lands on their balance.
  await page.getByRole("link", { name: /Netflix/ }).click();
  const id = page.url().split("/").pop()!;
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const backdated = await admin.from("recurring_expenses").update({ next_run_at: "2026-01-01T01:00:00Z" }).eq("id", id);
  expect(backdated.error).toBeNull();

  const run = await request.get("/api/cron/recurring", { headers: { authorization: `Bearer ${secret}` } });
  expect(run.ok()).toBeTruthy();
  const summary = (await run.json()) as { charged: number; alreadyRan: number };
  expect(summary.charged).toBe(1);
  const again = await request.get("/api/cron/recurring", { headers: { authorization: `Bearer ${secret}` } });
  const second = (await again.json()) as { charged: number };
  expect(second.charged).toBe(0);

  await page.goto("/app");
  await expect(page.getByText("$8.95").first()).toBeVisible();
  await page.goto(`/app/recurring/${id}`);
  await expect(page.getByText("2026-01")).toBeVisible();
});
