/**
 * User-facing error messages thrown by the projects domain. Specs and tests
 * assert on these strings — keep them in sync with `docs/specs/`.
 */
export const errors = {
  ORGANIZATION_MEMBERSHIP_REQUIRED: "You must be a member of this organization to create a project.",
  ORGANIZATION_NOT_FOUND: "Organization not found",
  ORGANIZATION_FORBIDDEN: "API key cannot access this organization",
  PROJECT_CREATION_SCOPE_REQUIRED: "Project creation requires an unscoped or organization-wide API key",
  PROJECT_ALIAS_INVALID: "Alias must be 2-5 characters, start with a letter, and contain only uppercase letters and numbers",
  PROJECT_ALIAS_TAKEN: "A project with this alias already exists in this organization",
  PROJECT_COLOR_INVALID: "Project color must be one of the supported palette colors",
  PROJECT_NOT_FOUND: "Project not found",
  PROJECT_DELETE_FORBIDDEN: "You don't have permission to delete this project. Contact a project admin.",
  TARGET_NOT_ORG_MEMBER: "User is not a member of this organization. Invite them to the organization first.",
  TARGET_IS_ORG_LEADER: "Only organization owners and admins can manage the project membership of organization owners and admins.",
  ALREADY_PROJECT_MEMBER: "User is already a member of this project.",
  NOT_PROJECT_MEMBER: "User is not a member of this project.",
  requiredStatusesCannotBeDisabled: (statuses: string[]) => `Required statuses cannot be disabled: ${statuses.join(", ")}`,
} as const;
