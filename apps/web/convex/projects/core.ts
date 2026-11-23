import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel";
import {
  getAuthenticatedUser,
  getAuthenticatedAccess,
  getOptionalAuthenticatedAccess,
  getOptionalAuthenticatedUser,
} from "../lib/access/auth";
import {
  hasOrgPermission,
  requireOrganizationManage,
  requireOrgPermission,
  authorizeProjectAccess,
  filterProjectsByAccess,
  apiKeyScopeAllowsProject,
  apiKeyScopeAllowsOrganization,
} from "../lib/access/permissions";
import { getOrgMembership } from "../lib/accessRepo";
import { OrgPermission, ProjectPermission, hasProjectPermission } from "../../lib/authz/permissions";
import type { ProjectRole } from "../../lib/authz/roles";
import {
  statusValidator,
  taskTableColumnValidator,
  projectViewModeValidator,
  boardGroupByValidator,
  listGroupByValidator,
  boardRowGroupByValidator,
} from "../lib/contracts/validators";
import { PROJECT_COLOR_PALETTE } from "../../lib/colors/palette";
import { getDisabledTaskStatuses, getInvalidRequiredDisabledStatuses } from "../../lib/tasks/status-policy";
import { normalizeHiddenTaskTableColumns } from "../../lib/tasks/task-table-columns";
import { createInboxList, getTaskListById } from "../tasks/lib/taskListsRepo";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { buildPatch, clearable, mapDefined } from "../lib/shared/patch";
import {
  orgManagedProjectValidator,
  projectNavRowValidator,
  projectValidator,
  toOrgManagedProject,
  type ProjectNavRow,
} from "./lib/validators";
import {
  getActiveProjectByAlias,
  getActiveProjectById,
  getProjectById,
  hasOtherActiveProjectWithAlias,
  insertProject,
  listActiveProjectsByOrganization,
  normalizeProjectId,
  initializeProjectLists,
  softDeleteProject,
  updateProject,
  type ProjectUpdatePatch,
} from "./lib/projectsRepo";
import { insertMembership, listMembershipsForUser } from "./lib/membersRepo";
import { requireProjectAdministration } from "./lib/permissions";
import { getUserById, getUsersByIds } from "../users/lib/usersRepo";
import { listMembershipsForUser as listOrgMembershipsForUser } from "../organizations/lib/membersRepo";
import { getActiveOrganizationsByIds } from "../organizations/lib/organizationsRepo";
import { errors } from "./errors";

type ProjectNameSortable = {
  _id: string;
  name: string;
  alias: string;
};

function compareLexicographic(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

const projectNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareProjectsByName(a: ProjectNameSortable, b: ProjectNameSortable): number {
  const byName = projectNameCollator.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }

  const byAlias = compareLexicographic(a.alias, b.alias);
  if (byAlias !== 0) {
    return byAlias;
  }

  return compareLexicographic(a._id, b._id);
}

// Alias validation regex: uppercase + numbers, starts with letter, 2-5 chars
const ALIAS_REGEX = /^[A-Z][A-Z0-9]{1,4}$/;

function validateProjectColor(color: string): string {
  ensure(PROJECT_COLOR_PALETTE.some((supported) => supported === color)).isTrue(errors.PROJECT_COLOR_INVALID);
  return color;
}

export const listByOrganization = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(projectNavRowValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    // Check org membership first
    const orgMembership = await getOrgMembership(ctx, user._id, args.organizationId);
    if (!orgMembership) {
      return [];
    }

    // Includes archived rows: callers resolve the current or selected project
    // from this list, so each navigation caller drops them (docs/specs/project-archive.md).
    const projects = await listActiveProjectsByOrganization(ctx, args.organizationId);

    // Efficiently filter projects by access (one query for all memberships)
    const accessibleProjects = await filterProjectsByAccess(
      ctx,
      user._id,
      orgMembership,
      projects,
      ProjectPermission.PROJECT_VIEW
    );

    // Entry links that omit the `list` param land on the project's default
    // List, so nav rows carry that List's own default-view override (OS-1566).
    return Promise.all(
      accessibleProjects.sort(compareProjectsByName).map(async (project): Promise<ProjectNavRow> => {
        const defaultList = project.defaultListId
          ? await getTaskListById(ctx, project.defaultListId)
          : null;
        if (!defaultList?.defaultViewMode) {
          return project;
        }

        return {
          ...project,
          defaultListView: {
            defaultViewMode: defaultList.defaultViewMode,
            ...(defaultList.defaultListGroupBy === undefined ? {} : { defaultListGroupBy: defaultList.defaultListGroupBy }),
            ...(defaultList.defaultBoardRowGroupBy === undefined ? {} : { defaultBoardRowGroupBy: defaultList.defaultBoardRowGroupBy }),
            ...(defaultList.defaultBoardGroupBy === undefined
              ? {}
              : { defaultBoardGroupBy: defaultList.defaultBoardGroupBy }),
          },
        };
      })
    );
  },
});

/**
 * Every project in the org, for the org-settings Projects section (OS-1534).
 * Deliberately skips `filterProjectsByAccess`: this is the recovery path into a
 * project with no members, so it must list projects the caller cannot open.
 * Metadata only — listing a project is a management handle, not an access grant.
 */
export const listAllForOrganization = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(orgManagedProjectValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    if (!(await hasOrgPermission(ctx, user._id, args.organizationId, OrgPermission.PROJECTS_MANAGE_ALL))) {
      return [];
    }

    const projects = await listActiveProjectsByOrganization(ctx, args.organizationId);

    // Left join: a project whose creator's user doc is gone must still be listed.
    const rows = await join(projects)
      .on((project) => project.createdBy)
      .with((ids) => getUsersByIds(ctx, ids))
      .selectAll(toOrgManagedProject);

    return rows.sort(compareProjectsByName);
  },
});

/**
 * One project's management metadata, for the org-settings project detail page.
 * Same authority and same metadata-only contract as `listAllForOrganization`:
 * an owner/admin can open this for a project they are not a member of.
 */
export const getForOrganizationManagement = query({
  args: { projectId: v.id("projects") },
  returns: v.union(orgManagedProjectValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const project = await getActiveProjectById(ctx, args.projectId);
    if (!project) {
      return null;
    }

    if (!(await hasOrgPermission(ctx, user._id, project.organizationId, OrgPermission.PROJECTS_MANAGE_ALL))) {
      return null;
    }

    return toOrgManagedProject(project, await getUserById(ctx, project.createdBy));
  },
});

export const getById = query({
  args: { id: v.string(), apiKey: v.optional(v.string()) },
  returns: v.union(projectValidator, v.null()),
  handler: async (ctx, args) => {
    // Validate and normalize the ID - returns null if invalid
    const projectId = normalizeProjectId(ctx, args.id);
    if (!projectId) {
      return null;
    }

    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }
    const { principal } = auth;

    // Check project access (handles org membership + project membership)
    const access = await authorizeProjectAccess(ctx, principal, projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return null;
    }

    return access.project;
  },
});

export const create = mutation({
  args: {
    apiKey: v.optional(v.string()),
    organizationId: v.id("organizations"),
    name: v.string(),
    alias: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Check if user has permission to create projects in this org
    await requireOrganizationManage(ctx, principal, args.organizationId, {
      managePermission: OrgPermission.PROJECT_CREATE,
      errors: {
        organizationNotFound: errors.ORGANIZATION_NOT_FOUND,
        organizationForbidden: errors.ORGANIZATION_FORBIDDEN,
        projectScopedKey: errors.PROJECT_CREATION_SCOPE_REQUIRED,
        membershipRequired: errors.ORGANIZATION_MEMBERSHIP_REQUIRED,
      },
    });

    const alias = args.alias.toUpperCase();
    ensure(alias).regex(ALIAS_REGEX, errors.PROJECT_ALIAS_INVALID);

    // Check alias uniqueness within organization. Soft-deleted projects keep
    // their alias row, so an alias can map to several documents; an active one
    // is the only conflict.
    await ensure(getActiveProjectByAlias(ctx, args.organizationId, alias)).isNull(errors.PROJECT_ALIAS_TAKEN);

    const projectId = await insertProject(
      ctx,
      {
        organizationId: args.organizationId,
        name: args.name,
        alias,
        description: args.description,
        color: args.color,
      },
      user._id
    );

    // Every project owns a persisted default "Inbox" List (OS-842).
    const inboxListId = await createInboxList(ctx, {
      projectId,
      userId: user._id,
    });
    await initializeProjectLists(ctx, projectId, inboxListId, user._id);

    // Add creator as project admin
    await insertMembership(ctx, projectId, user._id, "project-admin");

    return projectId;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    // null means "clear the color", undefined means "don't change"
    color: v.optional(v.union(v.string(), v.null())),
    disabledStatuses: v.optional(v.array(statusValidator)),
    hiddenTaskTableColumns: v.optional(v.array(taskTableColumnValidator)),
    defaultViewMode: v.optional(projectViewModeValidator),
    defaultBoardGroupBy: v.optional(boardGroupByValidator),
    defaultListGroupBy: v.optional(listGroupByValidator),
    defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    showArtifactsCount: v.optional(v.boolean()),
    publishPullRequestChecks: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Project-admin, or an org admin managing the project from org settings.
    await requireProjectAdministration(ctx, user._id, args.id, ProjectPermission.PROJECT_UPDATE);

    // Only provided fields end up in the patch (updatedAt is stamped by the repo)
    const patch = buildPatch<ProjectUpdatePatch>({
      name: args.name,
      description: args.description,
      color: clearable(args.color, validateProjectColor),
      disabledStatuses: mapDefined(args.disabledStatuses, (disabledStatuses) => {
        const invalidRequiredStatuses = getInvalidRequiredDisabledStatuses(disabledStatuses);
        ensure(invalidRequiredStatuses.length).eq(0, errors.requiredStatusesCannotBeDisabled(invalidRequiredStatuses));
        return getDisabledTaskStatuses({ disabledStatuses });
      }),
      hiddenTaskTableColumns: mapDefined(args.hiddenTaskTableColumns, normalizeHiddenTaskTableColumns),
      defaultViewMode: args.defaultViewMode,
      defaultBoardGroupBy: args.defaultBoardGroupBy,
      defaultListGroupBy: args.defaultListGroupBy,
      defaultBoardRowGroupBy: args.defaultBoardRowGroupBy,
      showArtifactsCount: args.showArtifactsCount,
      publishPullRequestChecks: args.publishPullRequestChecks,
    });

    await updateProject(ctx, args.id, patch);

    return null;
  },
});

export const getByAlias = query({
  args: {
    organizationId: v.id("organizations"),
    alias: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(projectValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }
    const { principal } = auth;

    const project = await getActiveProjectByAlias(ctx, args.organizationId, args.alias.toUpperCase());
    if (!project) {
      return null;
    }

    const access = await authorizeProjectAccess(ctx, principal, project, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return null;
    }

    return access.project;
  },
});

export const updateAlias = mutation({
  args: {
    id: v.id("projects"),
    alias: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const project = await requireProjectAdministration(ctx, user._id, args.id, ProjectPermission.PROJECT_UPDATE);

    const alias = args.alias.toUpperCase();
    ensure(alias).regex(ALIAS_REGEX, errors.PROJECT_ALIAS_INVALID);

    // Check alias uniqueness within organization (excluding current project)
    await ensure(hasOtherActiveProjectWithAlias(ctx, project.organizationId, alias, args.id)).isFalse(
      errors.PROJECT_ALIAS_TAKEN
    );

    await updateProject(ctx, args.id, { alias });

    return null;
  },
});

/** Spec: docs/specs/project-archive.md */
export const setArchived = mutation({
  args: { apiKey: v.optional(v.string()), id: v.id("projects"), isArchived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireProjectAdministration(ctx, principal, args.id, ProjectPermission.PROJECT_ARCHIVE);
    await updateProject(ctx, args.id, { isArchived: args.isArchived });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const project = await getProjectById(ctx, args.id);
    if (!project || project.isDeleted) {
      return null; // Already deleted or doesn't exist
    }

    await requireOrgPermission(ctx, user._id, project.organizationId, OrgPermission.PROJECT_DELETE, {
      convexErrorMessage: errors.PROJECT_DELETE_FORBIDDEN,
    });
    await softDeleteProject(ctx, args.id, user._id);
    await ctx.scheduler.runAfter(0, internal.integrations.github.core.disconnectProject, { projectId: args.id });

    return null;
  },
});

/**
 * List all projects the user has access to.
 * Useful for MCP clients to discover available projects.
 * Includes role and permissions for each project.
 */
export const listAccessible = query({
  args: {
    apiKey: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      name: v.string(),
      alias: v.string(),
      organizationId: v.id("organizations"),
      organizationName: v.string(),
      organizationSlug: v.string(),
      role: v.object({
        name: v.string(),
        permissions: v.array(v.string()),
      }),
    })
  ),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) return [];
    const { user, principal } = auth;

    const orgMemberships =
      principal.apiKeyScope?.kind === "organization"
        ? await getOrgMembership(ctx, user._id, principal.apiKeyScope.organizationId).then((membership) =>
            membership ? [membership] : []
          )
        : await listOrgMembershipsForUser(ctx, user._id);

    // Join memberships with their active organizations. Org membership scopes
    // *which* orgs are searched; project access comes from the rows below.
    const orgsWithMembership = await join(orgMemberships)
      .on((membership) => membership.organizationId)
      .with((ids) => getActiveOrganizationsByIds(ctx, ids))
      .select((membership, org) => ({ org }));

    const orgMap = new Map<Id<"organizations">, Doc<"organizations">>();
    for (const { org } of orgsWithMembership) {
      orgMap.set(org._id, org);
    }

    // Get user's project memberships for role lookup (one query)
    const projectMemberships = await listMembershipsForUser(ctx, user._id);
    const projectRoleMap = new Map(projectMemberships.map((m) => [m.projectId, m.role as ProjectRole]));

    // Fetch projects for all orgs in parallel
    const projectsByOrg = await Promise.all(
      [...orgMap.keys()].map((orgId) => listActiveProjectsByOrganization(ctx, orgId))
    );

    // Helper to get role info for a project (returns null if no access).
    // Org role is not consulted: the project row is the only grant (OS-1536).
    function getRoleInfo(projectId: Id<"projects">): { name: string; permissions: string[] } | null {
      const projectRole = projectRoleMap.get(projectId);
      if (!projectRole) {
        return null; // No access
      }
      if (!hasProjectPermission(projectRole, ProjectPermission.PROJECT_VIEW)) {
        return null; // No view permission
      }

      if (projectRole === "project-admin") {
        return { name: "project-admin", permissions: ["*"] };
      }
      if (projectRole === "member") {
        return { name: "member", permissions: ["TASK_CREATE", "TASK_UPDATE", "TASK_DELETE"] };
      }
      // viewer
      return { name: "viewer", permissions: [] };
    }

    // Flatten, filter by access, and format results
    const results: Array<{
      _id: Id<"projects">;
      name: string;
      alias: string;
      organizationId: Id<"organizations">;
      organizationName: string;
      organizationSlug: string;
      role: { name: string; permissions: string[] };
    }> = [];

    for (const projects of projectsByOrg) {
      for (const project of projects) {
        const org = orgMap.get(project.organizationId)!;
        if (!apiKeyScopeAllowsOrganization(principal.apiKeyScope, org._id)) {
          continue;
        }
        if (!apiKeyScopeAllowsProject(principal.apiKeyScope, project)) {
          continue;
        }
        const roleInfo = getRoleInfo(project._id);

        if (roleInfo) {
          results.push({
            _id: project._id,
            name: project.name,
            alias: project.alias,
            organizationId: org._id,
            organizationName: org.name,
            organizationSlug: org.slug,
            role: roleInfo,
          });
        }
      }
    }

    return results.sort(compareProjectsByName);
  },
});
