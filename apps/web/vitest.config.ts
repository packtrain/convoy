import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [
    {
      // Convex bundles `import m from "x.wasm"` as a WebAssembly.Module; Convex Auth's
      // password hashing relies on it.
      name: "wasm-module",
      enforce: "pre",
      load(id) {
        if (!id.endsWith(".wasm")) return null;
        return `import { readFileSync } from "node:fs"; export default new WebAssembly.Module(readFileSync(${JSON.stringify(id)}));`;
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    server: {
      deps: {
        inline: ["convex-test", "password-hash-wasm"],
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
