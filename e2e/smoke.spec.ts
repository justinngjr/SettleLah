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
