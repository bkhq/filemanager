import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run --cwd apps/fm-web build && rm -rf .tmp/e2e-root && bun apps/fm-api/src/index.ts",
    url: `http://127.0.0.1:${PORT}/api/fm/mounts`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      FM_ROOT: ".tmp/e2e-root",
      FM_STATIC: "apps/fm-web/dist",
    },
  },
});
