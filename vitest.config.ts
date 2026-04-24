import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Raised from the default 5s — several tests exercise real crypto /
    // date-parsing loops + dynamic imports. 20s gives headroom without
    // hiding runaway tests.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      exclude: [
        // Next.js route entry points — exercised by E2E, not unit tests.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        // Generated Prisma client — not our code.
        "src/generated/**",
        // Test scaffolding itself.
        "src/**/__tests__/**",
        "src/**/*.test.ts",
      ],
      // No thresholds yet — current coverage is below enforceable numbers.
      // Add thresholds once baseline is reported.
    },
  },
});
