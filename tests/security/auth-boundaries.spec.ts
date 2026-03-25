import { test, expect } from "@playwright/test";

// All tests use native fetch with redirect: "manual" to avoid
// Playwright's request context which inherits storageState cookies.

test.describe("API auth boundaries", () => {
  // Clerk middleware redirects unauthenticated requests (307) rather than returning 401 directly.
  // We verify the raw response (without following redirects) is not 200.
  test("POST /api/chat without auth is rejected", async ({ baseURL }) => {
    const response = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], contentType: "Reply" }),
      redirect: "manual",
    });
    expect(response.status).not.toBe(200);
  });

  test("POST /api/strategist without auth is rejected", async ({ baseURL }) => {
    const response = await fetch(`${baseURL}/api/strategist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      redirect: "manual",
    });
    expect(response.status).not.toBe(200);
  });
});

test.describe("Cron route auth boundaries", () => {
  const cronRoutes = [
    "/api/cron/x-import",
    "/api/cron/strategist",
    "/api/cron/researcher",
    "/api/cron/followers-snapshot",
    "/api/cron/trend-snapshot",
    "/api/cron/daily-insight",
  ];

  for (const route of cronRoutes) {
    test(`GET ${route} without Bearer token returns 401`, async ({ baseURL }) => {
      const response = await fetch(`${baseURL}${route}`, { redirect: "manual" });
      expect(response.status).toBe(401);
    });

    test(`GET ${route} with wrong Bearer token returns 401`, async ({ baseURL }) => {
      const response = await fetch(`${baseURL}${route}`, {
        headers: { Authorization: "Bearer wrong-token-value" },
        redirect: "manual",
      });
      expect(response.status).toBe(401);
    });
  }
});
