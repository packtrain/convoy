import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("schema index names", () => {
  test("stay within Convex's 64-character limit", () => {
    const schemaPath = fileURLToPath(new URL("./schema.ts", import.meta.url));
    const schemaSource = readFileSync(schemaPath, "utf8");
    const indexNames = Array.from(
      schemaSource.matchAll(/\.index\("([^"]+)"/g),
      (match) => match[1],
    );

    expect(indexNames.length).toBeGreaterThan(0);

    for (const indexName of indexNames) {
      expect(
        indexName.length,
        `Index name "${indexName}" exceeds Convex's 64-character limit`,
      ).toBeLessThanOrEqual(64);
    }
  });

  test("cliMessages stores only canonical run identity", () => {
    const schemaPath = fileURLToPath(new URL("./schema.ts", import.meta.url));
    const schemaSource = readFileSync(schemaPath, "utf8");

    expect(schemaSource).not.toContain("batchId: v.optional(v.string())");
    expect(schemaSource).not.toContain("by_thread_and_batchId_and_createdAt");
  });
});
