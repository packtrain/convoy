/**
 * User-facing error messages thrown by the agents domain. Specs and tests
 * assert on these strings.
 */
export const errors = {
  ORGANIZATION_NOT_FOUND: "Organization not found",
  ORGANIZATION_MEMBERSHIP_REQUIRED: "Not a member of this organization",
  AGENT_NOT_FOUND: "Agent not found",
  PROJECT_AGENT_NOT_FOUND: "Project agent not found",
  AGENT_NAME_REQUIRED: "Agent name is required",
  AGENT_NAME_DUPLICATE: "An agent with this name already exists",
  AGENT_COLOR_INVALID: "Agent color must be one of the supported palette colors",
  AGENT_PROJECT_MISMATCH: "Agent must belong to the same organization as the project",
  PROJECT_AGENT_HAS_LOCAL_EDITS: "This project agent has local changes that updating would overwrite",
  PROJECT_AGENT_DIFFERENT_PROJECT: "Project agent must belong to the thread's project",
} as const;

export function duplicateAgentName(name: string): string {
  return `An agent named "${name}" already exists`;
}
