import { OrgRole, ProjectRole } from "./roles";

// Organization-level permissions
export const OrgPermission = {
  // Organization management
  ORG_UPDATE: "org:update",
  ORG_DELETE: "org:delete",

  // Member management
  MEMBERS_INVITE: "members:invite",
  MEMBERS_REMOVE: "members:remove",
  MEMBERS_UPDATE_ROLE: "members:update_role",

  // Project management
  PROJECT_CREATE: "project:create",
  PROJECT_DELETE: "project:delete",
  // List every project in the org and manage its members, including projects
  // the caller is not a member of (OS-1534).
  PROJECTS_MANAGE_ALL: "projects:manage_all",

  // Slash command management
  SLASH_COMMANDS_MANAGE: "slash_commands:manage",

  // Agent template management
  AGENTS_MANAGE: "agents:manage",

  // Skill management
  SKILLS_MANAGE: "skills:manage",
} as const;

export type OrgPermission = (typeof OrgPermission)[keyof typeof OrgPermission];

// Project-level permissions
export const ProjectPermission = {
  // Project settings
  PROJECT_VIEW: "project:view",
  PROJECT_UPDATE: "project:update",
  PROJECT_ARCHIVE: "project:archive",

  // Project member management
  PROJECT_MEMBERS_ADD: "project_members:add",
  PROJECT_MEMBERS_REMOVE: "project_members:remove",

  // Task operations
  TASK_VIEW: "task:view",
  TASK_CREATE: "task:create",
  TASK_UPDATE: "task:update",
  TASK_DELETE: "task:delete",

  // Slash command management
  SLASH_COMMANDS_MANAGE: "slash_commands:manage",

  // List operations
  LIST_MANAGE: "list:manage",
  LIST_PIN: "list:pin",

  // Project agent management
  AGENTS_MANAGE: "project_agents:manage",

  // Project skill management
  SKILLS_MANAGE: "project_skills:manage",

  // Comment operations
  COMMENT_CREATE: "comment:create",
  COMMENT_UPDATE_OWN: "comment:update_own",
  COMMENT_DELETE_OWN: "comment:delete_own",
  COMMENT_DELETE_ANY: "comment:delete_any",

  // CLI thread operations
  CLI_THREAD: "cli:thread",
} as const;

export type ProjectPermission =
  (typeof ProjectPermission)[keyof typeof ProjectPermission];

// Organization role -> permission mappings
const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
  [OrgRole.OWNER]: [
    OrgPermission.ORG_UPDATE,
    OrgPermission.ORG_DELETE,
    OrgPermission.MEMBERS_INVITE,
    OrgPermission.MEMBERS_REMOVE,
    OrgPermission.MEMBERS_UPDATE_ROLE,
    OrgPermission.PROJECT_CREATE,
    OrgPermission.PROJECT_DELETE,
    OrgPermission.PROJECTS_MANAGE_ALL,
    OrgPermission.SLASH_COMMANDS_MANAGE,
    OrgPermission.AGENTS_MANAGE,
    OrgPermission.SKILLS_MANAGE,
  ],
  [OrgRole.ADMIN]: [
    OrgPermission.ORG_UPDATE,
    OrgPermission.MEMBERS_INVITE,
    OrgPermission.MEMBERS_REMOVE,
    OrgPermission.MEMBERS_UPDATE_ROLE,
    OrgPermission.PROJECT_CREATE,
    OrgPermission.PROJECT_DELETE,
    OrgPermission.PROJECTS_MANAGE_ALL,
    OrgPermission.SLASH_COMMANDS_MANAGE,
    OrgPermission.AGENTS_MANAGE,
    OrgPermission.SKILLS_MANAGE,
  ],
  [OrgRole.MEMBER]: [OrgPermission.PROJECT_CREATE],
} as const;

// Project role -> permission mappings
const PROJECT_ROLE_PERMISSIONS: Record<
  ProjectRole,
  readonly ProjectPermission[]
> = {
  [ProjectRole.PROJECT_ADMIN]: [
    ProjectPermission.PROJECT_VIEW,
    ProjectPermission.PROJECT_UPDATE,
    ProjectPermission.PROJECT_ARCHIVE,
    ProjectPermission.PROJECT_MEMBERS_ADD,
    ProjectPermission.PROJECT_MEMBERS_REMOVE,
    ProjectPermission.TASK_VIEW,
    ProjectPermission.TASK_CREATE,
    ProjectPermission.TASK_UPDATE,
    ProjectPermission.TASK_DELETE,
    ProjectPermission.SLASH_COMMANDS_MANAGE,
    ProjectPermission.LIST_MANAGE,
    ProjectPermission.LIST_PIN,
    ProjectPermission.AGENTS_MANAGE,
    ProjectPermission.SKILLS_MANAGE,
    ProjectPermission.COMMENT_CREATE,
    ProjectPermission.COMMENT_UPDATE_OWN,
    ProjectPermission.COMMENT_DELETE_OWN,
    ProjectPermission.COMMENT_DELETE_ANY,
    ProjectPermission.CLI_THREAD,
  ],
  [ProjectRole.MEMBER]: [
    ProjectPermission.PROJECT_VIEW,
    ProjectPermission.TASK_VIEW,
    ProjectPermission.TASK_CREATE,
    ProjectPermission.TASK_UPDATE,
    ProjectPermission.TASK_DELETE,
    ProjectPermission.SLASH_COMMANDS_MANAGE,
    ProjectPermission.LIST_MANAGE,
    ProjectPermission.AGENTS_MANAGE,
    ProjectPermission.SKILLS_MANAGE,
    ProjectPermission.COMMENT_CREATE,
    ProjectPermission.COMMENT_UPDATE_OWN,
    ProjectPermission.COMMENT_DELETE_OWN,
    ProjectPermission.CLI_THREAD,
  ],
  [ProjectRole.VIEWER]: [
    ProjectPermission.PROJECT_VIEW,
    ProjectPermission.TASK_VIEW,
  ],
} as const;

// Check if an organization role has a specific permission
export function hasOrgPermission(
  role: OrgRole | null | undefined,
  permission: OrgPermission
): boolean {
  if (!role) {
    return false;
  }

  return ORG_ROLE_PERMISSIONS[role].includes(permission);
}

// Check if a project role has a specific permission
export function hasProjectPermission(
  role: ProjectRole | null | undefined,
  permission: ProjectPermission
): boolean {
  if (!role) {
    return false;
  }

  return PROJECT_ROLE_PERMISSIONS[role].includes(permission);
}

// Get all permissions for an organization role
export function getOrgPermissions(role: OrgRole): readonly OrgPermission[] {
  return ORG_ROLE_PERMISSIONS[role];
}

// Get all permissions for a project role
export function getProjectPermissions(
  role: ProjectRole
): readonly ProjectPermission[] {
  return PROJECT_ROLE_PERMISSIONS[role];
}

// Prefix of the ConvexError a project permission denial throws; the web UI
// swaps it for friendly copy (docs/specs/read-only-viewer-ux.md, Soft failures).
export const PERMISSION_DENIED = "Permission denied";
