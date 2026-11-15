import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const toolcraftRoot = fileURLToPath(new URL("../toolcraft", import.meta.url));
const manifestPath = path.join(toolcraftRoot, ".toolcraft-manifest.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listRuntimeFiles(directory: string): Promise<Array<string>> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listRuntimeFiles(entryPath);
      }

      if (!entry.isFile() || entryPath === manifestPath) {
        return [];
      }

      return [path.relative(toolcraftRoot, entryPath).split(path.sep).join("/")];
    }),
  );

  return nestedFiles.flat();
}

describe("shared Toolcraft runtime", () => {
  it("matches the retained generated runtime manifest", async () => {
    const parsedManifest: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    if (!isRecord(parsedManifest) || !isRecord(parsedManifest.files)) {
      throw new Error("Toolcraft runtime manifest is missing its file inventory.");
    }

    const expectedEntries = Object.entries(parsedManifest.files);
    const invalidHashEntry = expectedEntries.find(
      ([, expectedHash]) => typeof expectedHash !== "string",
    );

    if (invalidHashEntry) {
      throw new Error(`Toolcraft runtime manifest has an invalid hash for ${invalidHashEntry[0]}.`);
    }

    const expectedFiles = expectedEntries.map(([relativePath]) => relativePath).sort();
    const actualFiles = (await listRuntimeFiles(toolcraftRoot)).sort();
    const mismatches = await Promise.all(
      expectedEntries.map(async ([relativePath, expectedHash]) => {
        const contents = await fs.readFile(path.join(toolcraftRoot, relativePath));
        const actualHash = crypto.createHash("sha256").update(contents).digest("hex");

        return actualHash === expectedHash ? null : relativePath;
      }),
    );

    expect(actualFiles).toEqual(expectedFiles);
    expect(mismatches.filter((relativePath) => relativePath !== null)).toEqual([]);
  });
});
