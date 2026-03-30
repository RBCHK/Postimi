import { defineConfig, devices } from "@playwright/test";
import path from "path";

const PORT = process.env.PORT || 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  globalSetup: path.join(__dirname, "tests/clerk-global-setup.ts"),
  testDir: path.join(__dirname, "tests"),
  outputDir: "test-results/",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: [
    {
      command: "npx tsx tests/mocks/start-ai-server.ts",
      url: "http://localhost:4567/health",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command: "npm run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...process.env, ANTHROPIC_BASE_URL: "http://localhost:4567/v1" },
    },
  ],

  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      name: "setup-mobile",
      testMatch: /global-setup\.ts/,
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: process.env.CI ? "chromium" : "webkit",
      },
    },
    {
      name: "desktop",
      testIgnore: /mobile\//,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile-safari",
      testMatch: /mobile\//,
      use: {
        ...devices["iPhone 15 Pro"],
        // WebKit on Linux CI (WebKitGTK) has Clerk auth compatibility issues —
        // use Chromium there for reliable mobile viewport testing.
        // Local macOS uses real WebKit for Safari-accurate testing.
        browserName: process.env.CI ? "chromium" : "webkit",
        storageState: "tests/.auth/mobile-user.json",
      },
      dependencies: ["setup-mobile"],
    },
  ],
});
