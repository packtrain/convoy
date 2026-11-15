import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "./exec.js";

/**
 * Workspace file index + search for composer @-file mentions (OS-1144).
 * Modeled on t3code's workspaceEntries (docs/analysis/t3code-file-mentions.md).
 */

const INDEX_CACHE_TTL_MS = 15_000;
const INDEX_CACHE_MAX_KEYS = 4;
const MAX_INDEX_ENTRIES = 25_000;
const DEFAULT_SEARCH_LIMIT = 50;

/** Directories the fs-walk fallback never descends into (t3code's list). */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
  ".convex",
]);

// Caching the promise (not the result) also dedupes concurrent builds.
const indexCache = new Map<string, { expiresAt: number; files: Promise<string[]> }>();

async function listFilesViaGit(cwd: string): Promise<string[]> {
  // Tracked + untracked-but-not-ignored files, NUL-separated.
  const { stdout } = await runGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  return stdout.split("\0").filter((path) => path.length > 0);
}

async function listFilesViaWalk(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length > 0 && files.length < MAX_INDEX_ENTRIES) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(join(cwd, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relPath = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          queue.push(relPath);
        }
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }
  return files;
}

async function buildIndex(cwd: string): Promise<string[]> {
  let files: string[];
  try {
    files = await listFilesViaGit(cwd);
  } catch {
    // Not a git repo (or transient git failure) — walk the filesystem.
    files = await listFilesViaWalk(cwd);
  }
  return files.slice(0, MAX_INDEX_ENTRIES);
}

function getIndex(cwd: string): Promise<string[]> {
  const now = Date.now();
  const cached = indexCache.get(cwd);
  if (cached && cached.expiresAt > now) {
    return cached.files;
  }

  const files = buildIndex(cwd);
  indexCache.set(cwd, { expiresAt: now + INDEX_CACHE_TTL_MS, files });
  // ponytail: crude size cap via oldest-inserted eviction, fine for ≤ a few cwds.
  while (indexCache.size > INDEX_CACHE_MAX_KEYS) {
    const oldestKey = indexCache.keys().next().value as string;
    indexCache.delete(oldestKey);
  }
  return files;
}

function basename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/** t3code's basename-first ranking: lower score sorts first. */
function scoreMatch(path: string, query: string): number {
  const base = basename(path);
  if (base === query) return 0;
  if (path === query) return 1;
  if (base.startsWith(query)) return 2;
  if (path.startsWith(query)) return 3;
  if (path.includes(`/${query}`)) return 4;
  return 5;
}

/**
 * Search the workspace file index. An empty query returns the top entries
 * alphabetically (the bare-`@` menu). Case-insensitive substring match with
 * basename-first ranking.
 */
export async function searchWorkspaceFiles(cwd: string, query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<string[]> {
  const files = await getIndex(cwd);
  const normalized = query.trim().replace(/^[@./]+/, "").toLowerCase();

  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const lower = path.toLowerCase();
    if (normalized.length > 0 && !lower.includes(normalized)) {
      continue;
    }
    scored.push({ path, score: normalized.length > 0 ? scoreMatch(lower, normalized) : 5 });
  }

  scored.sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return scored.slice(0, limit).map((entry) => entry.path);
}

/** Test hook: drop all cached indexes. */
export function clearWorkspaceFileIndexCache(): void {
  indexCache.clear();
}
