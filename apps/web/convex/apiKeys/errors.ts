/**
 * User-facing error messages thrown by the apiKeys domain. Specs and tests
 * assert on these strings — keep them in sync with `docs/specs/`.
 */
export const errors = {
  WORKER_SETUP_KEY_REQUIRED: "Use a manual setup key to issue worker credentials.",
  WORKER_KEY_IMMUTABLE: "Worker keys cannot be edited. Delete and reissue through project registration.",
  WORKER_KEY_SCOPE_REQUIRED: "Issuing a worker key requires an unscoped or organization-wide API key",
  API_KEY_NAME_REQUIRED: "API key name is required",
  EXPIRY_NOT_IN_FUTURE: "Expiration date must be in the future",
  EXPIRY_TOO_FAR: "API keys can expire at most 1 year from creation",
  API_KEY_NOT_FOUND: "API key not found",
  ORG_NOT_FOUND: "Organization not found",
  NOT_ORG_MEMBER: "Not a member of this organization",
  PROJECT_NOT_FOUND: "Project not found",
  PROJECT_ORG_MISMATCH: "Selected projects must belong to the selected organization",
  apiKeyNameTooLong: (max: number) => `API key name must be ${max} characters or less`,
} as const;
