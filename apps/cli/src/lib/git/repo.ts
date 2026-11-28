import { randomUUID } from "node:crypto";
import { link, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { runGit } from "./exec.js";

/** Persistent local identity survives moves and remounts. Spec: cli-worktrees.md. */
export async function getGitDirectoryIdentity(directory: string): Promise<string> {
  const path = join(directory, "convoy-identity");
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const identity = randomUUID();
  const temporary = `${path}.${identity}`;
  try {
    await writeFile(temporary, identity, { flag: "wx" });
    try {
      await link(temporary, path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
    return await readFile(path, "utf8");
  } finally {
    await rm(temporary, { force: true });
  }
}

/** The checkout identity differs between linked worktrees and their parent. */
export async function getCheckoutIdentity(cwd: string, timeoutMs?: number): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--absolute-git-dir"], { timeoutMs });
  return getGitDirectoryIdentity(result.stdout.trim());
}

/**
 * Get the git remote "origin" URL for a directory.
 * Returns null if the directory is not a git repo or has no origin remote.
 */
export async function getGitRemoteUrl(dir: string): Promise<string | null> {
  try {
    const result = await runGit(dir, ["remote", "get-url", "origin"]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The repo's default branch name (without the remote prefix): `origin/HEAD`
 * when known, falling back to the currently checked-out branch. Returns null
 * for detached HEAD in a repo with no `origin/HEAD` ref.
 */
export async function getDefaultBranch(dir: string): Promise<string | null> {
  const originHead = await getOriginHeadBranch(dir);
  if (originHead !== null) return originHead;

  const head = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"], {
    allowNonZeroExit: true,
  });
  if (head.exitCode === 0) {
    const name = head.stdout.trim();
    return name.length > 0 && name !== "HEAD" ? name : null;
  }

  return null;
}

/** The branch `origin/HEAD` points at, with no fallback; null when it is unset. */
export async function getOriginHeadBranch(dir: string): Promise<string | null> {
  const originHead = await runGit(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowNonZeroExit: true });
  if (originHead.exitCode !== 0) return null;
  const shortRef = originHead.stdout.trim();
  const separatorIndex = shortRef.indexOf("/");
  return separatorIndex > 0 ? shortRef.slice(separatorIndex + 1) : shortRef;
}

/**
 * The currently checked-out branch (short name). Returns null for detached
 * HEAD, non-Git directories, and any git failure — callers treat "no branch"
 * as absent display metadata, never an error.
 */
export async function getCurrentBranch(dir: string): Promise<string | null> {
  try {
    const result = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"], { allowNonZeroExit: true });
    if (result.exitCode !== 0) {
      return null;
    }
    const name = result.stdout.trim();
    return name.length > 0 && name !== "HEAD" ? name : null;
  } catch {
    return null;
  }
}

/** Whether a local branch with this exact name exists. */
export async function branchExists(dir: string, branch: string): Promise<boolean> {
  const result = await runGit(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowNonZeroExit: true });
  return result.exitCode === 0;
}

/** Whether the working tree has uncommitted changes (staged, unstaged, or untracked). */
export async function isWorkingTreeDirty(dir: string): Promise<boolean> {
  const result = await runGit(dir, ["status", "--porcelain"]);
  return result.stdout.trim().length > 0;
}

export interface BranchRef {
  /** Short refname, e.g. "main" or "origin/feat/x". */
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

const MAX_BRANCH_REFS = 500;

/**
 * Local branches plus `origin/*` remote branches, most recently committed
 * first, capped at {@link MAX_BRANCH_REFS}. `origin/HEAD` is excluded.
 */
export async function listBranchRefs(dir: string): Promise<BranchRef[]> {
  const result = await runGit(dir, [
    "for-each-ref",
    "--format=%(HEAD)%09%(refname:short)",
    "--sort=-committerdate",
    `--count=${MAX_BRANCH_REFS}`,
    "refs/heads",
    "refs/remotes/origin",
  ]);

  const refs: BranchRef[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [headMarker, name] = line.split("\t");
    if (!name || name === "origin/HEAD" || name === "origin") {
      continue;
    }
    refs.push({
      name,
      isCurrent: headMarker === "*",
      isRemote: name.startsWith("origin/"),
    });
  }
  return refs;
}

export interface DiscoveredRepo {
  path: string;
  /** "." when the folder is the repo itself; `/`-separated. */
  relativePath: string;
  gitRemoteUrl?: string;
  branch?: string;
}

const MAX_DISCOVERED_REPOS = 128;
const DISCOVERY_CONCURRENCY = 8;

/**
 * The git repos in a project folder, with remote and branch. Throws when the
 * folder or a folder below it can't be read. Spec: docs/specs/cli-multi-repo-projects.md#discovery
 */
export async function discoverRepositories(folder: string): Promise<DiscoveredRepo[]> {
  return describeRepositories(folder, await listRepositoryPaths(folder));
}

/** Remote and branch for repo paths `listRepositoryPaths` found (two git calls each). */
export function describeRepositories(folder: string, paths: string[]): Promise<DiscoveredRepo[]> {
  return mapLimited(paths, (repo) => describeRepo(folder, repo));
}

/** Repo paths only, from `stat`/`readdir` (no git): the folder itself if it is one, else its children and grandchildren. */
export async function listRepositoryPaths(folder: string): Promise<string[]> {
  await stat(folder);
  if ((await gitEntryKind(folder)) !== null) return [folder];
  const children = await childFolders(folder);
  const childKinds = await mapLimited(children, gitEntryKind);
  const plain = children.filter((_, i) => childKinds[i] === null);
  const grandchildren = (await mapLimited(plain, childFolders)).flat();
  const grandchildKinds = await mapLimited(grandchildren, gitEntryKind);
  // ponytail: two levels only, as t3code; deeper layouts register a subfolder instead.
  return [
    ...children.filter((_, i) => childKinds[i] === "directory"),
    ...grandchildren.filter((_, i) => grandchildKinds[i] === "directory"),
  ].sort().slice(0, MAX_DISCOVERED_REPOS);
}

/** A multi-repo folder's repo paths; null when `cwd` is a repo itself or holds none (git's own lookup applies). */
export async function folderRepoPaths(cwd: string): Promise<string[] | null> {
  // Child repos win over a checkout the folder sits inside: that one's tree doesn't see their files.
  const paths = await listRepositoryPaths(cwd).catch(() => []);
  return paths.length === 0 || paths[0] === cwd ? null : paths;
}

/**
 * A repo or worktree thread's checkouts in its project folder: its own plus the folder's repos, minus the
 * main checkout its worktree shares refs with (one ref name per run can't serve both). Spec: cli-thread-run-diffs.md#multi-repo-folders
 */
export async function folderCheckoutPaths(folder: string, cwd: string): Promise<string[] | null> {
  const repos = await folderRepoPaths(folder);
  if (!repos) return null;
  const main = await sharedMainCheckout(cwd);
  const mainRelative = main ? repoRelativePath(await realpath(folder), main) : undefined;
  return [...repos.filter((path) => path !== cwd && repoRelativePath(folder, path) !== mainRelative), cwd].sort();
}

/** The main checkout of a linked worktree; undefined for a main checkout or a non-repo. */
async function sharedMainCheckout(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { allowNonZeroExit: true });
  const [gitDir, commonDir] = result.stdout.trim().split("\n");
  return result.exitCode === 0 && commonDir && gitDir !== commonDir && basename(commonDir) === ".git" ? dirname(commonDir) : undefined;
}

/** Each repo's checked-out branch, by relative path; absent for detached HEAD. */
export function readRepoBranches(folder: string, paths: string[]): Promise<{ repo: string; branch?: string }[]> {
  return mapLimited(paths, async (path) => {
    const branch = await getCurrentBranch(path);
    return { repo: repoRelativePath(folder, path), ...(branch ? { branch } : {}) };
  });
}

/** `/`-separated path of a repo inside the folder; "." for the folder itself. */
export function repoRelativePath(folder: string, repo: string): string {
  return relative(folder, repo).split(sep).join("/") || ".";
}

async function describeRepo(folder: string, repo: string): Promise<DiscoveredRepo> {
  const [remote, branch] = await Promise.all([getGitRemoteUrl(repo), getCurrentBranch(repo)]);
  const gitRemoteUrl = remote ? withoutCredentials(remote) : undefined;
  return { path: repo, relativePath: repoRelativePath(folder, repo), ...(gitRemoteUrl ? { gitRemoteUrl } : {}), ...(branch ? { branch } : {}) };
}

/** A URL remote's user and token never leave the machine. */
function withoutCredentials(remote: string): string {
  try {
    const url = new URL(remote);
    if (!url.username && !url.password) return remote;
    url.username = ""; url.password = "";
    return url.href;
  } catch {
    return remote; // scp-style `git@host:path` has no secret
  }
}

/** A `.git` directory is a repo; a `.git` file is a linked worktree or submodule. Other stat errors throw. */
async function gitEntryKind(folder: string): Promise<"directory" | "file" | null> {
  try {
    return (await stat(join(folder, ".git"))).isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function childFolders(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && !entry.name.endsWith("-worktrees"))
    .map((entry) => join(folder, entry.name));
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = DISCOVERY_CONCURRENCY): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}
