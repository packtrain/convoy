import { mkdtempSync } from "node:fs";
import { rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createThreadAttachmentCache } from "./thread-attachment-cache.js";

describe("thread-attachment-cache", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
    tempDirs.length = 0;
  });

  test("reuses deterministic cache path across runs", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "convoy-cache-"));
    tempDirs.push(rootDir);
    const fetchMock = vi.fn(async () => {
      return new Response("file-bytes", { status: 200 });
    });

    const cache = createThreadAttachmentCache({ rootDir, fetchImpl: fetchMock as typeof fetch });
    const firstPath = await cache.ensureLocalPath({
      threadId: "thread_1",
      storageId: "storage_1",
      fileName: "screen shot.png",
      url: "https://example.test/file",
    });
    const secondPath = await cache.ensureLocalPath({
      threadId: "thread_1",
      storageId: "storage_1",
      fileName: "screen shot.png",
      url: "https://example.test/file",
    });

    expect(firstPath).toBe(secondPath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("gc removes files older than ttl", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "convoy-cache-"));
    tempDirs.push(rootDir);
    const cache = createThreadAttachmentCache({
      rootDir,
      ttlMs: 1_000,
      fetchImpl: (async () => new Response("file-bytes", { status: 200 })) as typeof fetch,
    });

    const filePath = await cache.ensureLocalPath({
      threadId: "thread_1",
      storageId: "storage_1",
      fileName: "old.txt",
      url: "https://example.test/file",
    });

    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(filePath, staleDate, staleDate);
    await cache.runGc();

    await expect(stat(filePath)).rejects.toThrow();
  });

  test("sanitizes control and reserved characters in cache file names", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "convoy-cache-"));
    tempDirs.push(rootDir);

    const cache = createThreadAttachmentCache({
      rootDir,
      fetchImpl: (async () => new Response("file-bytes", { status: 200 })) as typeof fetch,
    });

    const filePath = await cache.ensureLocalPath({
      threadId: "thread_1",
      storageId: "storage_1",
      fileName: "bad:name\u0001?.txt",
      url: "https://example.test/file",
    });

    expect(filePath).toContain("storage_1__bad_name__.txt");
  });
});
