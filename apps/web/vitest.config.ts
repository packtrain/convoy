import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
    setupFiles: ["./convex-testing/setup.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        "convex/testing/**",
        "convex/schema.ts",
        "convex/_generated/**",
        "**/*.test.ts",
      ],
    },
  },
});
