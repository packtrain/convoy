export { GitCommandError, runGit, type GitResult } from "./exec.js";
export {
  capturePreRunCheckpoint,
  captureRunBaseline,
  captureRunChanges,
  captureRunDiffSummary,
  checkpointRef,
  diffBetweenRefs,
  readFileAtRef,
  revertToCheckpoint,
  type FileAtRef,
  type FileDiff,
  type RunBaseline,
  type RunDiffFile,
  type RunDiffSummary,
} from "./checkpoint.js";
export { COMMIT_PAGE_SIZE, findBranchFork, listCommits, readCommitPatch, type CommitPage, type CommitPatch, type CommitSummary } from "./history.js";
export { clearWorkspaceFileIndexCache, searchWorkspaceFiles } from "./file-index.js";
export { diffWorkingTree, readWorkingFile, readWorkingFileBytes, revertWorkingFile, revertWorkingTree } from "./working-tree.js";
export { branchExists, describeRepositories, discoverRepositories, getCurrentBranch, listRepositoryPaths, repoRelativePath, getDefaultBranch, getGitRemoteUrl, isWorkingTreeDirty, listBranchRefs, type BranchRef, type DiscoveredRepo } from "./repo.js";
export {
  buildDefaultWorktreePath,
  createWorktree,
  listWorktrees,
  parseWorktreeList,
  removeWorktree,
  type CreateWorktreeInput,
  type CreateWorktreeResult,
  type WorktreeInfo,
} from "./worktrees.js";
