import * as os from "node:os";
import * as path from "node:path";
import { mkdir, readdir, rename, rmdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { toSafeFileName } from "../../lib/file-name.js";

export interface ThreadAttachmentCacheOptions {
  rootDir?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ThreadAttachmentCacheInput {
  threadId: string;
  storageId: string;
  fileName: string;
  url: string;
}

export interface ThreadAttachmentCache {
  ensureLocalPath(input: ThreadAttachmentCacheInput): Promise<string>;
  runGc(): Promise<void>;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getDefaultThreadAttachmentCacheRoot(): string {
  if (typeof process.env.XDG_CACHE_HOME === "string" && process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "convoy", "thread-attachments");
  }
  return path.join(os.homedir(), ".cache", "convoy", "thread-attachments");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function touchFile(filePath: string): Promise<void> {
  const now = new Date();
  try {
    await utimes(filePath, now, now);
  } catch {
    // Ignore touch failures; cache still works without atime refresh.
  }
}

async function removeStaleFilesRecursively(
  rootDir: string,
  nowMs: number,
  ttlMs: number
): Promise<void> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await removeStaleFilesRecursively(entryPath, nowMs, ttlMs);
      try {
        const remaining = await readdir(entryPath);
        if (remaining.length === 0) {
          await rmdir(entryPath);
        }
      } catch {
        // Ignore non-empty or non-removable directories.
      }
      return;
    }

    if (!entry.isFile()) {
      return;
    }

    try {
      const info = await stat(entryPath);
      const lastAccessMs = Math.max(info.atimeMs, info.mtimeMs);
      if (nowMs - lastAccessMs > ttlMs) {
        await unlink(entryPath);
      }
    } catch {
      // Ignore races where files disappear while walking.
    }
  }));
}

export function createThreadAttachmentCache(
  options: ThreadAttachmentCacheOptions = {}
): ThreadAttachmentCache {
  const rootDir = options.rootDir ?? getDefaultThreadAttachmentCacheRoot();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function ensureLocalPath(
    input: ThreadAttachmentCacheInput
  ): Promise<string> {
    const threadDir = path.join(rootDir, sanitizePathSegment(input.threadId));
    const filePath = path.join(
      threadDir,
      `${sanitizePathSegment(input.storageId)}__${toSafeFileName(input.fileName)}`
    );

    if (await fileExists(filePath)) {
      await touchFile(filePath);
      return filePath;
    }

    await mkdir(threadDir, { recursive: true });

    const response = await fetchImpl(input.url);
    if (!response.ok) {
      throw new Error(
        `Failed to download attachment ${input.fileName}: ${response.status}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, buffer);
    await rename(tempPath, filePath);
    await touchFile(filePath);
    return filePath;
  }

  return {
    async ensureLocalPath(input: ThreadAttachmentCacheInput): Promise<string> {
      return ensureLocalPath(input);
    },
    async runGc(): Promise<void> {
      await removeStaleFilesRecursively(rootDir, Date.now(), ttlMs);
    },
  };
}
