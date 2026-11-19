/** First @useconvoy/cli that reads a message's `pr(github):` line (docs/specs/github-integration.md). */
export const ATTACHED_PULL_REQUEST_MIN_CLI_VERSION = "0.142.0";

function parts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** False for CLIs older than `min`, including ones too old to report a version. */
export function isCliVersionAtLeast(appVersion: string | undefined, min: string): boolean {
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

export function supportsAttachedPullRequest(appVersion: string | undefined): boolean {
  return isCliVersionAtLeast(appVersion, ATTACHED_PULL_REQUEST_MIN_CLI_VERSION);
}
