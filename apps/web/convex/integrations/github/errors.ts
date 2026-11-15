/**
 * User-facing error messages thrown by the integrations domain. Keep them in
 * sync with `docs/specs/github-integration.md`.
 */
export const errors = {
  NOT_CONFIGURED: "GitHub integration is not configured on this deployment",
  SETUP_NOT_FOUND: "This GitHub connection request is no longer valid. Start again from Integrations settings.",
  SETUP_EXPIRED: "This GitHub connection request expired. Start again from Integrations settings.",
  SETUP_ALREADY_USED: "This GitHub connection request was already used. Start again from Integrations settings.",
  SETUP_NOT_AUTHORIZED: "Authorize with GitHub before choosing a repository",
  GITHUB_AUTHORIZATION_FAILED: "GitHub did not authorize this connection. Start again from Integrations settings.",
  REPOSITORY_ADMIN_REQUIRED: "You need admin access to this repository on GitHub to connect it",
  REPOSITORY_NOT_INSTALLED: "The Convoy GitHub App is not installed on this repository",
  TOO_MANY_REPOSITORIES: "A project can connect up to 100 repositories",
  CONNECTION_NOT_FOUND: "Repository connection not found",
  NOT_CONNECTED: "This project has no connected repository",
  STILL_CONNECTED: "Disconnect this repository before deleting its pull requests",
  GITHUB_UNAVAILABLE: "GitHub could not be reached. Try again in a moment.",
  GITHUB_RATE_LIMITED: "GitHub is limiting requests from Convoy. Try again in a few minutes.",
  PULL_REQUEST_NOT_FOUND: "GitHub has no pull request with this number in the connected repository",
  PULL_REQUEST_CHANGED: "The pull request changed while loading. Refresh to load the new revision.",
  FILE_NOT_FOUND: "GitHub has no file at this path in this revision",
  ACCESS_REMOVED: "GitHub access to this repository was removed",
  CURSOR_INVALID: "Invalid repository list cursor",
} as const;
