import { defineConfig, devices } from "@playwright/test";
import * as nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig("apps/web");

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const baseUrl = new URL(baseURL);
const webServerPort = (process.env.PLAYWRIGHT_WEB_SERVER_PORT ?? baseUrl.port) || "3000";
const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== "1";

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
    baseURL,
    trace: "on-first-retry",
  },
  webServer: shouldStartWebServer
    ? {
        command: `NEXT_PUBLIC_ODSAY_API_KEY=playwright-test npm run dev -- --hostname 127.0.0.1 --port ${webServerPort}`,
        reuseExistingServer: true,
        timeout: 120_000,
        url: baseURL,
      }
    : undefined,
});
