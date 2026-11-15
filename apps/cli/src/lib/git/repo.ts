import { randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
export async function getCheckoutIdentity(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--absolute-git-dir"]);
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
  const originHead = await runGit(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowNonZeroExit: true });
  if (originHead.exitCode === 0) {
    const shortRef = originHead.stdout.trim();
    const separatorIndex = shortRef.indexOf("/");
    return separatorIndex > 0 ? shortRef.slice(separatorIndex + 1) : shortRef;
  }

  const head = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"], {
    allowNonZeroExit: true,
  });
  if (head.exitCode === 0) {
    const name = head.stdout.trim();
    return name.length > 0 && name !== "HEAD" ? name : null;
  }

  return null;
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
