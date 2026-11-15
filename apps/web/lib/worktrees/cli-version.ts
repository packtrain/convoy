/** First @useconvoy/cli that answers `worktreeChanges` (OS-2036). */
export const WORKTREE_CHANGES_MIN_CLI_VERSION = "0.77.0";
/** First @useconvoy/cli that answers `readFile` without a checkpoint ref (OS-2041). */
export const WORKTREE_OPEN_FILE_MIN_CLI_VERSION = "0.82.0";
/** First @useconvoy/cli that uploads a file for `downloadFile` (OS-2050). */
export const WORKTREE_DOWNLOAD_MIN_CLI_VERSION = "0.83.0";
/** First @useconvoy/cli that answers `revertWorkingTree` (OS-2234). */
export const WORKTREE_REVERT_ALL_MIN_CLI_VERSION = "0.125.0";

function parts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** False for CLIs older than `min`, including ones too old to report a version. */
function atLeast(appVersion: string | undefined, min: string): boolean {
  if (!appVersion) {
    return false;
  }
  const have = parts(appVersion);
  const need = parts(min);
  for (let i = 0; i < need.length; i++) {
    if ((have[i] ?? 0) !== need[i]) {
      return (have[i] ?? 0) > need[i];
    }
  }
  return true;
}

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
