import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 1000, width: 1280 } },
    },
  ],
  testDir: "apps/web/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "NEXT_PUBLIC_ODSAY_API_KEY=playwright-test npm run dev -- --hostname 127.0.0.1 --port 3000",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
});
