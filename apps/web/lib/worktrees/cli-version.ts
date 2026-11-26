import { isCliVersionAtLeast as atLeast } from "@/lib/threads/cli-version";

/** First @useconvoy/cli that answers `worktreeChanges` (OS-2036). */
export const WORKTREE_CHANGES_MIN_CLI_VERSION = "0.77.0";
/** First @useconvoy/cli that answers `readFile` without a checkpoint ref (OS-2041). */
export const WORKTREE_OPEN_FILE_MIN_CLI_VERSION = "0.82.0";
/** First @useconvoy/cli that uploads a file for `downloadFile` (OS-2050). */
export const WORKTREE_DOWNLOAD_MIN_CLI_VERSION = "0.83.0";
/** First @useconvoy/cli that answers `revertWorkingTree` (OS-2234). */
export const WORKTREE_REVERT_ALL_MIN_CLI_VERSION = "0.125.0";
/** First @useconvoy/cli that answers `gitLog` and `commitPatch` (OS-2534). */
export const WORKTREE_HISTORY_MIN_CLI_VERSION = "0.171.0";

/** First @useconvoy/cli that walks `gitLog` in the branch scope (OS-2595). */
export const WORKTREE_BRANCH_HISTORY_MIN_CLI_VERSION = "0.176.0";

export function supportsWorktreeChanges(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_CHANGES_MIN_CLI_VERSION);
}

export function supportsWorktreeOpenFile(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_OPEN_FILE_MIN_CLI_VERSION);
}

export function supportsWorktreeDownload(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_DOWNLOAD_MIN_CLI_VERSION);
}

export function supportsWorktreeRevertAll(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_REVERT_ALL_MIN_CLI_VERSION);
}

export function supportsWorktreeHistory(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_HISTORY_MIN_CLI_VERSION);
}

export function supportsBranchHistory(appVersion: string | undefined): boolean {
  return atLeast(appVersion, WORKTREE_BRANCH_HISTORY_MIN_CLI_VERSION);
}
