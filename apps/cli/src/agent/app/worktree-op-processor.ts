import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";
import { getContentType } from "../../lib/content-type.js";
import { uploadToStorage } from "../../lib/storage-upload.js";
import {
  describeRepositories,
  diffBetweenRefs,
  diffWorkingTree,
  findBranchFork,
  listBranchRefs,
  listCommits,
  listWorktrees,
  readCommitPatch,
  readFileAtRef,
  readWorkingFile,
  readWorkingFileBytes,
  removeWorktree,
  revertToCheckpoint,
  revertWorkingFile,
  revertWorkingTree,
  searchWorkspaceFiles,
  listRepositoryPaths,
  repoRelativePath,
  type BranchRef,
} from "../../lib/git/index.js";

export type PendingWorktreeOp = FunctionReturnType<typeof api.cli.worktreeOps.listPending>[number];

/** Ref item shape stored in a rescan op's resultJson (`{ refs: [...] }`). */
export interface WorktreeOpRef {
  name: string;
  isCurrent: boolean;
  remoteOnly: boolean;
}

export interface WorktreeOpProcessor {
  /** Fulfill newly observed pending ops (deduped per op id). */
  enqueue(ops: PendingWorktreeOp[]): void;
  /** Scan the given repo paths and sync their worktrees to the profile. */
  scanAndSync(parentPaths: string[]): Promise<void>;
  /** A configured folder's repos by relative path ([] for a single-repo folder); syncs them in the background. Throws when the folder can't be scanned. */
  syncRepos(folder: string): Promise<string[]>;
}

/**
 * Collapse `origin/x` remote refs onto local `x` refs: local branches keep
 * their name, remote-only branches surface once with `remoteOnly: true`.
 */
export function dedupeBranchRefs(refs: BranchRef[]): WorktreeOpRef[] {
  const localNames = new Set(refs.filter((ref) => !ref.isRemote).map((ref) => ref.name));
  const seen = new Set<string>();
  const deduped: WorktreeOpRef[] = [];

  for (const ref of refs) {
    const name = ref.isRemote ? ref.name.slice("origin/".length) : ref.name;
    if (seen.has(name) || (ref.isRemote && localNames.has(name))) {
      continue;
    }
    seen.add(name);
    deduped.push({
      name,
      isCurrent: ref.isCurrent,
      remoteOnly: ref.isRemote,
    });
  }

  return deduped;
}

/**
 * Fulfills web-enqueued worktree ops (rescan refs, remove worktree) and keeps
 * the profile's worktree path entries in sync with disk.
 */
export function createWorktreeOpProcessor(client: ConvoyClient, sessionId: string, profileId: string): WorktreeOpProcessor {
  const typedSessionId = sessionId as Id<"cliSessions">;
  const typedProfileId = profileId as Id<"cliProfiles">;
  const inFlightOpIds = new Set<string>();

  async function scanAndSync(parentPaths: string[]): Promise<void> {
    const scans = await Promise.all(
      parentPaths.map(async (parentPath) => {
        try {
          return { parentPath, worktrees: await listWorktrees(parentPath) };
        } catch {
          // Not a git repo, or a transient git failure — exclude the path
          // from the scan entirely so its synced entries are never pruned
          // on bad data.
          return null;
        }
      })
    );

    const successful = scans.filter((scan): scan is NonNullable<(typeof scans)[number]> => scan !== null);
    if (successful.length === 0) {
      return;
    }

    await client.mutation(api.cli.worktrees.sync, {
      profileId: typedProfileId,
      sessionId: typedSessionId,
      scannedParentPaths: successful.map((scan) => scan.parentPath),
      worktrees: successful.flatMap((scan) =>
        scan.worktrees
          .filter((wt) => !wt.isMain && wt.branch !== null)
          .map((wt) => ({
            parentPath: scan.parentPath,
            path: wt.path,
            branch: wt.branch as string,
          }))
      ),
    });
  }

  // Per folder: the list last sent, and the publish chain, so publishes never overlap.
  const sentRepos = new Map<string, string>();
  const publishes = new Map<string, Promise<void>>();
  async function publishRepos(folder: string, paths: string[]): Promise<void> {
    const repos = (await describeRepositories(folder, paths)).map(({ path, relativePath, gitRemoteUrl, branch }) => ({ path, relativePath, gitRemoteUrl, branch }));
    const key = JSON.stringify(repos);
    if (sentRepos.get(folder) === key) return;
    await client.mutation(api.cli.profiles.syncRepos, { profileId: typedProfileId, sessionId: typedSessionId, path: folder, repos });
    sentRepos.set(folder, key);
  }
  /** Spec: docs/specs/cli-multi-repo-projects.md#when-it-runs. The local scan answers; git and the server run behind it. */
  async function syncRepos(folder: string): Promise<string[]> {
    const found = await listRepositoryPaths(folder);
    const paths = found.length === 1 && found[0] === folder ? [] : found;
    const next = (publishes.get(folder) ?? Promise.resolve()).then(() => publishRepos(folder, paths)).catch((error: unknown) => {
      console.error(chalk.yellow(`[Repos] Sync failed for ${folder}: ${error instanceof Error ? error.message : String(error)}`));
    });
    publishes.set(folder, next);
    return paths.map((path) => repoRelativePath(folder, path));
  }

  async function completeOp(
    opId: PendingWorktreeOp["_id"],
    outcome: { resultJson?: string; error?: string; storageId?: Id<"_storage"> }
  ): Promise<void> {
    await client.mutation(api.cli.worktreeOps.complete, {
      opId,
      sessionId: typedSessionId,
      ...outcome,
    });
  }

  async function handleRescan(op: PendingWorktreeOp): Promise<void> {
    const refs = dedupeBranchRefs(await listBranchRefs(op.path));
    await scanAndSync([op.path]);
    await completeOp(op._id, { resultJson: JSON.stringify({ refs }) });
  }

  async function handleRemove(op: PendingWorktreeOp): Promise<void> {
    if (!op.parentPath) {
      await completeOp(op._id, { error: "Missing parent repository path" });
      return;
    }
    await removeWorktree({ parentPath: op.parentPath, worktreePath: op.path });
    await scanAndSync([op.parentPath]);
    await completeOp(op._id, {});
  }

  // File ops (OS-1143): read a file / one-file patch from checkpoint refs.
  // Checkpoint refs are shared across worktrees of the same repo, so running
  // git in the op's path entry works regardless of where the run executed.
  // Without postRef the file is read from disk (OS-2041).
  async function handleReadFile(op: PendingWorktreeOp): Promise<void> {
    if (!op.filePath) {
      await completeOp(op._id, { error: "Missing file path" });
      return;
    }
    const result = op.postRef
      ? await readFileAtRef(op.path, op.postRef, op.filePath)
      : await readWorkingFile(op.path, op.filePath);
    await completeOp(op._id, { resultJson: JSON.stringify(result) });
  }

  // Download (OS-2050): the bytes go to file storage, the op carries the id.
  async function handleDownloadFile(op: PendingWorktreeOp): Promise<void> {
    if (!op.filePath) {
      await completeOp(op._id, { error: "Missing file path" });
      return;
    }
    const bytes = await readWorkingFileBytes(op.path, op.filePath);
    const uploadUrl = await client.mutation(api.cli.worktreeOps.generateUploadUrl, { opId: op._id, sessionId: typedSessionId });
    const storageId = await uploadToStorage(uploadUrl, bytes, getContentType(op.filePath));
    await completeOp(op._id, { storageId });
  }

  // No filePath → whole-run diff (the sidebar viewer renders all files).
  async function handleDiffFile(op: PendingWorktreeOp): Promise<void> {
    if (!op.preRef || !op.postRef) {
      await completeOp(op._id, { error: "Missing checkpoint refs" });
      return;
    }
    const result = await diffBetweenRefs(op.path, op.preRef, op.postRef, op.filePath);
    await completeOp(op._id, { resultJson: JSON.stringify(result) });
  }

  // Composer @-file mentions (OS-1144): search the workspace file index.
  async function handleSearchFiles(op: PendingWorktreeOp): Promise<void> {
    if (op.query === undefined) {
      await completeOp(op._id, { error: "Missing search query" });
      return;
    }
    const files = await searchWorkspaceFiles(op.path, op.query);
    await completeOp(op._id, { resultJson: JSON.stringify({ files }) });
  }

  // Worktree changes view (OS-2036): the uncommitted working tree as one patch; "vs main" diffs from the fork point (OS-2596).
  async function handleWorktreeChanges(op: PendingWorktreeOp): Promise<void> {
    const fork = op.scope === "branch" ? await findBranchFork(op.path) : undefined;
    if (op.scope === "branch" && !fork) {
      await completeOp(op._id, { error: "No default branch to compare with" });
      return;
    }
    const result = await diffWorkingTree(op.path, fork?.hash);
    await completeOp(op._id, { resultJson: JSON.stringify(result) });
  }

  // Commit history (OS-2534): one page of `git log`, and one commit's patch in postRef.
  async function handleGitLog(op: PendingWorktreeOp): Promise<void> {
    const page = await listCommits(op.path, op.cursor, { scope: op.scope });
    await completeOp(op._id, { resultJson: JSON.stringify(page) });
  }

  async function handleCommitPatch(op: PendingWorktreeOp): Promise<void> {
    if (!op.postRef) {
      await completeOp(op._id, { error: "Missing commit hash" });
      return;
    }
    const result = await readCommitPatch(op.path, op.postRef);
    await completeOp(op._id, { resultJson: JSON.stringify(result) });
  }

  // Worktree changes view (OS-2043): discard one file's uncommitted changes.
  async function handleRevertWorkingFile(op: PendingWorktreeOp): Promise<void> {
    if (!op.filePath) {
      await completeOp(op._id, { error: "Missing file path" });
      return;
    }
    await revertWorkingFile(op.path, op.filePath);
    await completeOp(op._id, {});
  }

  // Revert all (OS-2234): only the files the user saw when confirming.
  async function handleRevertWorkingTree(op: PendingWorktreeOp): Promise<void> {
    if (!op.filePaths?.length) {
      await completeOp(op._id, { error: "Missing file paths" });
      return;
    }
    await revertWorkingTree(op.path, op.filePaths);
    await completeOp(op._id, {});
  }

  async function handleRevertRun(op: PendingWorktreeOp): Promise<void> {
    if (!op.preRef) {
      await completeOp(op._id, { error: "Missing checkpoint ref" });
      return;
    }
    // revertFile restores one file (OS-1156); revertRun the whole run.
    if (op.kind === "revertFile" && !op.filePath) {
      await completeOp(op._id, { error: "Missing file path" });
      return;
    }
    await revertToCheckpoint(op.path, op.preRef, op.kind === "revertFile" ? op.filePath : undefined, {
      allowLegacy: op.allowLegacyCheckpoint === true,
    });
    await completeOp(op._id, {});
  }

  async function handleOp(op: PendingWorktreeOp): Promise<void> {
    try {
      if (op.kind === "rescan") {
        await handleRescan(op);
      } else if (op.kind === "readFile") {
        await handleReadFile(op);
      } else if (op.kind === "diffFile") {
        await handleDiffFile(op);
      } else if (op.kind === "revertRun" || op.kind === "revertFile") {
        await handleRevertRun(op);
      } else if (op.kind === "searchFiles") {
        await handleSearchFiles(op);
      } else if (op.kind === "worktreeChanges") {
        await handleWorktreeChanges(op);
      } else if (op.kind === "revertWorkingFile") {
        await handleRevertWorkingFile(op);
      } else if (op.kind === "revertWorkingTree") {
        await handleRevertWorkingTree(op);
      } else if (op.kind === "downloadFile") {
        await handleDownloadFile(op);
      } else if (op.kind === "gitLog") {
        await handleGitLog(op);
      } else if (op.kind === "commitPatch") {
        await handleCommitPatch(op);
      } else if (op.kind === "remove") {
        await handleRemove(op);
      } else {
        // A kind added after this CLI shipped: fail it with the fix, never
        // fall through to another handler.
        const kind: string = op.kind;
        await completeOp(op._id, { error: `Unsupported operation "${kind}" — update @useconvoy/cli` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Worktree] ${op.kind} failed for ${op.path}: ${message}`));
      await completeOp(op._id, { error: message }).catch(() => {});
    }
  }

  return {
    enqueue(ops: PendingWorktreeOp[]): void {
      for (const op of ops) {
        const opId = op._id as string;
        if (inFlightOpIds.has(opId)) {
          continue;
        }
        inFlightOpIds.add(opId);
        // Release the id once the op settles: a completed op leaves
        // listPending (real dedup), while one whose completion failed gets
        // re-delivered by the subscription and retried instead of being
        // permanently skipped. Also keeps the set from growing unbounded.
        void handleOp(op).finally(() => {
          inFlightOpIds.delete(opId);
        });
      }
    },
    scanAndSync,
    syncRepos,
  };
}
