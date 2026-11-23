import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  canArchiveProject,
  hasOrgPermission,
  hasProjectPermission,
  OrgPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import { ProjectRole } from "@/lib/authz/roles";

/** Shared copy for every read-only tooltip and note (docs/specs/read-only-viewer-ux.md). */
export const VIEW_ONLY_REASON = "You have view-only access to this project";

/**
 * The caller's capabilities in one project. Every flag is false while the role
 * loads. Pass `organizationId` for the org-role flags a project role cannot answer.
 */
export function useProjectPermissions(
  projectId: Id<"projects"> | null,
  organizationId?: Id<"organizations"> | null
) {
  const myRole = useQuery(
    api.projects.members.getMyRole,
    projectId ? { projectId } : "skip"
  );
  const orgRole = useQuery(
    api.organizations.members.getMyRole,
    organizationId ? { organizationId } : "skip"
  );
  const canUpdateTask = hasProjectPermission(myRole, ProjectPermission.TASK_UPDATE);

  return {
    myRole,
    canEditProject: myRole === ProjectRole.PROJECT_ADMIN,
    canManageMembers: myRole === ProjectRole.PROJECT_ADMIN,
    canManageLists: hasProjectPermission(
      myRole,
      ProjectPermission.LIST_MANAGE
    ),
    canPinLists: myRole === ProjectRole.PROJECT_ADMIN,
    canManageProjectAgents: hasProjectPermission(
      myRole,
      ProjectPermission.AGENTS_MANAGE
    ),
    canManageSlashCommands: hasProjectPermission(
      myRole,
      ProjectPermission.SLASH_COMMANDS_MANAGE
    ),
    // Workflows take the spec's "task write access" bar (docs/specs/workflows.md).
    canManageWorkflows: canUpdateTask,
    canCreateTask: hasProjectPermission(myRole, ProjectPermission.TASK_CREATE),
    canUpdateTask,
    canDeleteTask: hasProjectPermission(myRole, ProjectPermission.TASK_DELETE),
    canComment: hasProjectPermission(myRole, ProjectPermission.COMMENT_CREATE),
    canUseThreads: hasProjectPermission(myRole, ProjectPermission.CLI_THREAD),
    // Null only once the role is known to be writable, so nothing flashes enabled.
    readOnlyReason: canUpdateTask ? null : VIEW_ONLY_REASON,
    orgRole,
    canDeleteProject: hasOrgPermission(orgRole, OrgPermission.PROJECT_DELETE),
    canArchiveProject: canArchiveProject(myRole, orgRole),
    isLoading: myRole === undefined,
  };
}
