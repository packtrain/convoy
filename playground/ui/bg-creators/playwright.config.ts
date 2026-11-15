import { defineConfig, devices } from "@playwright/test";

const testPort = 4410;
const testBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  forbidOnly: true,
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: testBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: testBaseUrl,
  },
});
