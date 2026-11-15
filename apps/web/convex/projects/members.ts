import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { hasOrgPermission } from "../lib/access/permissions";
import { getOrgMembership } from "../lib/accessRepo";
import { getAuthenticatedUser, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { OrgPermission, ProjectPermission } from "../../lib/authz/permissions";
import { OrgRole } from "../../lib/authz/roles";
import { buildProjectInvitationEmail } from "../../lib/emails/catalog";
import { buildProjectUrl } from "../../lib/emails/links";
import { sendTransactionalEmail } from "../lib/notifications/email";
import { projectRoleValidator, orgRoleValidator } from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { getUserById, getUsersByIds } from "../users/lib/usersRepo";
import { listMembershipsForOrganization } from "../organizations/lib/membersRepo";
import { requireActiveOrganization } from "../organizations/lib/organizationsRepo";
import { getActiveProjectById } from "./lib/projectsRepo";
import {
  authorizeProjectAuthority,
  requireAuthorityOverMember,
  requireProjectAdministration,
} from "./lib/permissions";
import {
  deleteMembership,
  getMembership,
  insertMembership,
  listMembershipsForProject,
  updateMembershipRole,
} from "./lib/membersRepo";
import { errors } from "./errors";

/**
 * List all members of a project with user details.
 * Returns empty array if user doesn't have access.
 */
export const list = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("projectMembers"),
      userId: v.id("users"),
      role: projectRoleValidator,
      addedAt: v.number(),
      // Joined user data
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const project = await authorizeProjectAuthority(ctx, user._id, args.projectId, ProjectPermission.PROJECT_VIEW);
    if (!project) {
      return [];
    }

    const memberships = await listMembershipsForProject(ctx, args.projectId);

    // Join with users table and sort
    const membersWithUsers = await join(memberships)
      .on((membership) => membership.userId)
      .with((ids) => getUsersByIds(ctx, ids))
      .select((membership, userDoc) => ({
        _id: membership._id,
        userId: membership.userId,
        role: membership.role,
        addedAt: membership.addedAt,
        name: userDoc.name,
        email: userDoc.email,
        avatarUrl: userDoc.avatarUrl,
      }));

    // Sort by role (project-admin first) then name
    const roleOrder: Record<string, number> = { "project-admin": 0, member: 1, viewer: 2 };
    return membersWithUsers.sort((a, b) => {
      const roleCompare = roleOrder[a.role] - roleOrder[b.role];
      if (roleCompare !== 0) return roleCompare;
      return a.name.localeCompare(b.name);
    });
  },
});

/**
 * Get current user's role in a project (for permission checks in UI).
 * The `projectMembers` row is the only source — an org owner/admin with no row
 * gets null (OS-1536). Org-settings surfaces pass their own `canManage` instead.
 */
export const getMyRole = query({
  args: { projectId: v.id("projects") },
  returns: v.union(projectRoleValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const project = await getActiveProjectById(ctx, args.projectId);
    if (!project) {
      return null;
    }

    const orgMembership = await getOrgMembership(ctx, user._id, project.organizationId);
    if (!orgMembership) {
      return null;
    }

    const projectMembership = await getMembership(ctx, args.projectId, user._id);

    return projectMembership?.role || null;
  },
});

/**
 * Users assignable to tasks in this project — its explicit members (OS-1536).
 * Sorted with the current user first, then by role and name.
 */
export const listAssignable = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
      role: projectRoleValidator,
    })
  ),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const project = await authorizeProjectAuthority(ctx, user._id, args.projectId, ProjectPermission.PROJECT_VIEW);
    if (!project) {
      return [];
    }

    const projectMembers = await listMembershipsForProject(ctx, args.projectId);
    const users = await join(projectMembers)
      .on((projectMember) => projectMember.userId)
      .with((ids) => getUsersByIds(ctx, ids))
      .select((projectMember, userDoc) => ({
        _id: projectMember.userId,
        name: userDoc.name,
        email: userDoc.email,
        avatarUrl: userDoc.avatarUrl,
        role: projectMember.role,
      }));

    // Sort: current user first, then by role, then by name
    const roleOrder: Record<string, number> = {
      "project-admin": 0,
      member: 1,
      viewer: 2,
    };

    return users.sort((a, b) => {
      // Current user first
      if (a._id === user._id) return -1;
      if (b._id === user._id) return 1;

      // Then by role
      const aOrder = roleOrder[a.role] ?? 3;
      const bOrder = roleOrder[b.role] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;

      // Then by name
      return a.name.localeCompare(b.name);
    });
  },
});

/**
 * List org members who are NOT yet project members (for the "Add member" dialog).
 * Excludes users already in the project.
 */
export const listEligibleToAdd = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
      orgRole: orgRoleValidator,
    })
  ),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const project = await authorizeProjectAuthority(ctx, user._id, args.projectId, ProjectPermission.PROJECT_MEMBERS_ADD);
    if (!project) {
      return [];
    }

    const orgMembers = await listMembershipsForOrganization(ctx, project.organizationId);
    const currentProjectMembers = await listMembershipsForProject(ctx, args.projectId);

    const currentMemberUserIds = new Set(currentProjectMembers.map((m) => m.userId));

    // Only org-level authority may manage an owner's/admin's project membership,
    // so don't offer them as targets to anyone else.
    const canTargetOrgLeaders = await hasOrgPermission(
      ctx,
      user._id,
      project.organizationId,
      OrgPermission.PROJECTS_MANAGE_ALL
    );

    const eligibleMembers = orgMembers.filter(
      (m) =>
        !currentMemberUserIds.has(m.userId) &&
        (canTargetOrgLeaders || (m.role !== OrgRole.OWNER && m.role !== OrgRole.ADMIN))
    );

    const membersWithUsers = await join(eligibleMembers)
      .on((orgMember) => orgMember.userId)
      .with((ids) => getUsersByIds(ctx, ids))
      .select((orgMember, userDoc) => ({
        _id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        avatarUrl: userDoc.avatarUrl,
        orgRole: orgMember.role,
      }));

    // Sort by name
    return membersWithUsers.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Add an org member to a project.
 * Cannot add non-org members or users already in the project.
 */
export const add = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: projectRoleValidator,
  },
  returns: v.id("projectMembers"),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);

    const project = await requireProjectAdministration(
      ctx,
      currentUser._id,
      args.projectId,
      ProjectPermission.PROJECT_MEMBERS_ADD
    );

    // Verify target user is an org member
    await ensure(getOrgMembership(ctx, args.userId, project.organizationId)).notNull(errors.TARGET_NOT_ORG_MEMBER);

    await requireAuthorityOverMember(ctx, currentUser._id, project, args.userId);

    // Check target user not already a project member
    await ensure(getMembership(ctx, args.projectId, args.userId)).isNull(errors.ALREADY_PROJECT_MEMBER);

    const membershipId = await insertMembership(ctx, args.projectId, args.userId, args.role);

    const [organization, addedUser] = await Promise.all([
      requireActiveOrganization(ctx, project.organizationId),
      getUserById(ctx, args.userId),
    ]);

    if (addedUser?.email) {
      await sendTransactionalEmail(ctx, {
        to: addedUser.email,
        template: buildProjectInvitationEmail({
          organizationName: organization.name,
          projectName: project.name,
          projectUrl: buildProjectUrl(organization.slug, project.alias),
          addedByName: currentUser.name || currentUser.email || "Someone",
          role: args.role,
        }),
      });
    }

    return membershipId;
  },
});

/**
 * Change a project member's role.
 */
export const updateRole = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: projectRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);

    const project = await requireProjectAdministration(
      ctx,
      currentUser._id,
      args.projectId,
      ProjectPermission.PROJECT_MEMBERS_ADD
    );

    const targetMembership = await ensure(getMembership(ctx, args.projectId, args.userId)).notNull(errors.NOT_PROJECT_MEMBER);

    await requireAuthorityOverMember(ctx, currentUser._id, project, args.userId);

    await updateMembershipRole(ctx, targetMembership._id, args.role);

    return null;
  },
});

/**
 * Remove a member from a project.
 */
export const remove = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);

    const project = await requireProjectAdministration(
      ctx,
      currentUser._id,
      args.projectId,
      ProjectPermission.PROJECT_MEMBERS_REMOVE
    );

    const targetMembership = await ensure(getMembership(ctx, args.projectId, args.userId)).notNull(errors.NOT_PROJECT_MEMBER);

    await requireAuthorityOverMember(ctx, currentUser._id, project, args.userId);

    await deleteMembership(ctx, targetMembership._id);

    return null;
  },
});
