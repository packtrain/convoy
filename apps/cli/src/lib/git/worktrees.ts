import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { GitCommandError, runGit } from "./exec.js";
import { branchExists, getCheckoutIdentity, getGitDirectoryIdentity, getCurrentBranch, getDefaultBranch, getGitRemoteUrl, isWorkingTreeDirty } from "./repo.js";

export interface ExecutionWorktree {
  parentPath?: string;
  parentGitRemoteUrl?: string;
  repositoryId?: string;
  worktreeId?: string;
}

export async function workingDirectoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

async function repositoryIdentity(path: string): Promise<string> {
  const common = await runGit(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return getGitDirectoryIdentity(common.stdout.trim());
}

/** Resolve deleted/moved worktrees without changing working files or branches. Spec: cli-worktrees.md. */
export async function resolveExecutionWorkspace(path: string, worktree?: ExecutionWorktree): Promise<{
  path: string;
  repositoryId?: string;
  worktreeId?: string;
  branch: string | null;
}> {
  const exists = await workingDirectoryExists(path);
  if (!worktree) {
    if (!exists) throw new Error(`Working directory no longer exists: ${path}. No verified parent checkout is available.`);
    return { path, branch: null };
  }
  const parent = worktree.parentPath;
  if (!parent || !(await workingDirectoryExists(parent))) {
    throw new Error(`Cannot recover working directory ${path}: the original parent checkout is unavailable.`);
  }
  const inside = await runGit(parent, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.stdout.trim() !== "true") throw new Error("The original parent path is no longer a repository checkout.");
  const repositoryId = await repositoryIdentity(parent);
  if (worktree.repositoryId && repositoryId !== worktree.repositoryId) {
    throw new Error("The parent checkout no longer matches this thread's repository.");
  }
  if (!worktree.repositoryId && worktree.parentGitRemoteUrl && await getGitRemoteUrl(parent) !== worktree.parentGitRemoteUrl) {
    throw new Error("The parent checkout's Git remote no longer matches this thread's repository.");
  }
  // A removed worktree's folder can be recreated by a process still running in it; treat it as gone.
  const isCheckout = exists && (await runGit(path, ["rev-parse", "--is-inside-work-tree"], { allowNonZeroExit: true })).exitCode === 0;
  if (isCheckout) {
    if (await repositoryIdentity(path) !== repositoryId) throw new Error("The working directory belongs to a different repository.");
    const worktreeId = await getCheckoutIdentity(path);
    if (worktree.worktreeId && worktreeId !== worktree.worktreeId) throw new Error("The original worktree was replaced by another checkout.");
    return { path, repositoryId, worktreeId, branch: await getCurrentBranch(path) };
  }
  // A move preserves Git's administrative directory, even if its branch changed.
  const candidates = await listWorktrees(parent);
  if (worktree.worktreeId) {
    for (const candidate of candidates) {
      if (candidate.isMain || !(await workingDirectoryExists(candidate.path))) continue;
      if (await getCheckoutIdentity(candidate.path) === worktree.worktreeId && await repositoryIdentity(candidate.path) === repositoryId) {
        return { path: candidate.path, repositoryId, worktreeId: worktree.worktreeId, branch: candidate.branch };
      }
    }
  }
  return { path: parent, repositoryId, branch: await getCurrentBranch(parent) };
}

/** Identify `target` as a linked worktree of `current`'s repository. Spec: cli-worktrees.md#agent-driven-worktree-move. */
export async function inspectWorktreeMoveTarget(current: string, target: string): Promise<{
  path: string;
  repositoryId: string;
  worktreeId: string;
  branch: string;
}> {
  if (!(await workingDirectoryExists(current))) throw new Error(`The thread's checkout ${current} is not on this machine.`);
  if (!(await workingDirectoryExists(target))) throw new Error(`Not a directory: ${target}`);
  const notWorktree = new Error(`${target} is not a linked worktree of the thread's repository.`);
  if ((await runGit(target, ["rev-parse", "--is-inside-work-tree"], { allowNonZeroExit: true })).exitCode !== 0) throw notWorktree;
  const worktreeId = await getCheckoutIdentity(target);
  // Git's own listing gives the path discovery will report, and proves the repository matches.
  for (const candidate of await listWorktrees(current)) {
    if (candidate.isMain || await getCheckoutIdentity(candidate.path) !== worktreeId) continue;
    if (!candidate.branch) throw new Error(`${candidate.path} has a detached HEAD. Check out a branch there first.`);
    return { path: candidate.path, repositoryId: await repositoryIdentity(candidate.path), worktreeId, branch: candidate.branch };
  }
  throw notWorktree;
}

export interface WorktreeInfo {
  path: string;
  /** Checked-out branch (short name), or null when detached/bare. */
  branch: string | null;
  /** The main working tree (the repo checkout itself, always listed first). */
  isMain: boolean;
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: { path?: string; branch: string | null } = { branch: null };

  const flush = () => {
    if (current.path !== undefined) {
      worktrees.push({
        path: current.path,
        branch: current.branch,
        isMain: worktrees.length === 0,
      });
    }
    current = { branch: null };
  };

  for (const line of porcelain.split("\n")) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    }
  }
  flush();

  return worktrees;
}

/** Worktrees of the repo at `parentPath` (including the main checkout) whose directory exists on this machine. */
export async function listWorktrees(parentPath: string): Promise<WorktreeInfo[]> {
  const result = await runGit(parentPath, ["worktree", "list", "--porcelain"]);
  const worktrees = parseWorktreeList(result.stdout);
  const present = await Promise.all(worktrees.map((wt) => workingDirectoryExists(wt.path)));
  return worktrees.filter((_, index) => present[index]);
}

/**
 * Default on-disk location for Convoy-created worktrees: a sibling folder
 * `<repo>-worktrees/<branch>` next to the parent repo (v2 config will make
 * this overridable).
 */
export function buildDefaultWorktreePath(parentPath: string, branch: string): string {
  const container = `${basename(parentPath)}-worktrees`;
  const dirName = branch.replace(/\//g, "-");
  return join(dirname(parentPath), container, dirName);
}

export interface CreateWorktreeInput {
  parentPath: string;
  branch: string;
  baseRef?: string;
  startFromOrigin?: boolean;
}

export interface CreateWorktreeResult {
  path: string;
  /** True when an existing worktree for this branch was reused. */
  reused: boolean;
  /** The ref the new branch was based on (absent when reused/attached). */
  baseRef?: string;
}

/**
* Create (or idempotently reuse) a worktree for `branch`.
*
* - A worktree already on `branch` is reused as-is (retry path).
* - An existing local branch without one gets a worktree attached (`baseRef` ignored).
* - Otherwise a new branch is created from `baseRef` (default: the repo's default branch,
*   falling back to HEAD), optionally after fetching so the base is `origin/<baseRef>`.
*
* The v2 seam: custom create commands will replace this body based on local CLI config.
*/
export async function createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
  const { parentPath, branch } = input;

  const existing = await listWorktrees(parentPath);
  const match = existing.find((wt) => !wt.isMain && wt.branch === branch);
  if (match) {
    return { path: match.path, reused: true };
  }

  const targetPath = buildDefaultWorktreePath(parentPath, branch);
  if (existing.some((wt) => wt.path === targetPath)) {
    throw new GitCommandError(`Worktree directory already exists on another branch: ${targetPath}`, ["worktree", "add"], null, "");
  }
  await mkdir(dirname(targetPath), { recursive: true });

  if (await branchExists(parentPath, branch)) {
    await runGit(parentPath, ["worktree", "add", targetPath, branch]);
    return { path: targetPath, reused: false };
  }

  let baseRef = input.baseRef ?? (await getDefaultBranch(parentPath)) ?? "HEAD";
  if (input.startFromOrigin && baseRef !== "HEAD") {
    await runGit(parentPath, ["fetch", "origin", baseRef], {
      timeoutMs: 120_000,
    });
    baseRef = `origin/${baseRef}`;
  }

  await runGit(parentPath, ["worktree", "add", targetPath, "-b", branch, baseRef]);
  return { path: targetPath, reused: false, baseRef };
}

/**
 * Remove a worktree. Refuses when the worktree has uncommitted changes —
 * surfacing the error instead of forcing is deliberate (destructive op).
 */
export async function removeWorktree(input: { parentPath: string; worktreePath: string }): Promise<void> {
  const dirty = await isWorkingTreeDirty(input.worktreePath).catch(() => false);
  if (dirty) {
    throw new GitCommandError("Worktree has uncommitted changes", ["worktree", "remove"], null, "");
  }

  // Deleting an installed node_modules can take minutes; a kill mid-delete leaves a half-removed tree.
  await runGit(input.parentPath, ["worktree", "remove", input.worktreePath], { timeoutMs: 10 * 60_000 });
}
