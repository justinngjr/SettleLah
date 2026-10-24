import { existsSync, readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Pick up the local Supabase keys the way Next does, without adding dotenv.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

/**
 * Smoke tests against a local Supabase (`supabase start`) and the Next dev
 * server. Run with `pnpm e2e`; the host is signed in through the Supabase
 * admin API (see e2e/auth.ts), so no Google account or mailbox is needed.
 *
 * `pnpm screenshots` (SCREENSHOTS=1) runs only e2e/screenshots.spec.ts, which
 * captures every screen for design review instead of asserting anything.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: process.env.SCREENSHOTS ? /screenshots\.spec\.ts$/ : /smoke\.spec\.ts$/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
