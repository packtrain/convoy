export { GitCommandError, runGit, type GitResult } from "./exec.js";
export {
  capturePreRunCheckpoint,
  captureRunDiffSummary,
  checkpointRef,
  diffBetweenRefs,
  readFileAtRef,
  revertToCheckpoint,
  type FileAtRef,
  type FileDiff,
  type RunDiffFile,
  type RunDiffSummary,
} from "./checkpoint.js";
export { COMMIT_PAGE_SIZE, findBranchFork, listCommits, readCommitPatch, type CommitPage, type CommitPatch, type CommitSummary } from "./history.js";
export { clearWorkspaceFileIndexCache, searchWorkspaceFiles } from "./file-index.js";
export { diffWorkingTree, readWorkingFile, readWorkingFileBytes, revertWorkingFile, revertWorkingTree } from "./working-tree.js";
export { branchExists, getCurrentBranch, getDefaultBranch, getGitRemoteUrl, isWorkingTreeDirty, listBranchRefs, type BranchRef } from "./repo.js";
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
