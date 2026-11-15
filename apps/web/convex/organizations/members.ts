import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireOrgPermission } from "../lib/access/permissions";
import { getAuthenticatedUser, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { OrgPermission } from "../../lib/authz/permissions";
import { OrgRole } from "../../lib/authz/roles";
import { orgRoleValidator } from "../lib/contracts/validators";
import { organizationMemberListItemValidator } from "./lib/validators";
import {
  getMembership,
  hasOtherOwner,
  listMembershipsForOrganization,
  removeMembershipWithProjectCleanup,
  updateMembershipRole,
} from "./lib/membersRepo";
import { getUsersByIds } from "../users/lib/usersRepo";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { errors } from "./errors";

/**
 * List members of an organization with user details
 */
export const list = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(organizationMemberListItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    // Verify user has access to this organization
    const userMembership = await getMembership(ctx, args.organizationId, user._id);
    if (!userMembership) {
      return [];
    }

    const memberships = await listMembershipsForOrganization(ctx, args.organizationId);

    // Join with users table to get user details
    return join(memberships)
      .on((membership) => membership.userId)
      .with((ids) => getUsersByIds(ctx, ids))
      .select((membership, memberUser) => ({
        _id: memberUser._id,
        name: memberUser.name,
        email: memberUser.email,
        avatarUrl: memberUser.avatarUrl,
        role: membership.role,
      }));
  },
});

/**
 * Update a member's role
 */
export const updateRole = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    newRole: orgRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);
    await requireOrgPermission(ctx, currentUser._id, args.organizationId, OrgPermission.MEMBERS_UPDATE_ROLE);

    const currentUserMembership = await ensure(getMembership(ctx, args.organizationId, currentUser._id)).notNull(
      errors.CURRENT_USER_NOT_MEMBER
    );

    const targetMembership = await ensure(getMembership(ctx, args.organizationId, args.userId)).notNull(errors.TARGET_USER_NOT_MEMBER);

    
    if (currentUserMembership.role !== OrgRole.OWNER) {
      // Business rule: Admins cannot change owner's role
      ensure(targetMembership.role).notEq(OrgRole.OWNER, errors.ONLY_OWNERS_CAN_CHANGE_OWNER_ROLE);
      // Business rule: Admins cannot promote to owner
      ensure(args.newRole).notEq(OrgRole.OWNER, errors.ONLY_OWNERS_CAN_PROMOTE_OWNER);
    }

    // Business rule: Cannot demote yourself as owner unless another owner exists
    if (currentUser._id === args.userId && targetMembership.role === OrgRole.OWNER && args.newRole !== OrgRole.OWNER) {
      const otherOwnerExists = await hasOtherOwner(ctx, args.organizationId, currentUser._id);
      ensure(otherOwnerExists).isTrue(errors.CANNOT_DEMOTE_ONLY_OWNER);
    }

    // Update role
    await updateMembershipRole(ctx, targetMembership._id, args.newRole);

    return null;
  },
});

/**
 * Remove a member from the organization
 */
export const remove = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);

    // Cannot remove yourself
    ensure(currentUser._id).notEq(args.userId, errors.CANNOT_REMOVE_SELF);

    await requireOrgPermission(ctx, currentUser._id, args.organizationId, OrgPermission.MEMBERS_REMOVE);

    const currentUserMembership = await ensure(getMembership(ctx, args.organizationId, currentUser._id)).notNull(
      errors.CURRENT_USER_NOT_MEMBER
    );

    const targetMembership = await ensure(getMembership(ctx, args.organizationId, args.userId)).notNull(errors.TARGET_USER_NOT_MEMBER);

    // Business rule: Admins cannot remove owners
    if (currentUserMembership.role !== OrgRole.OWNER) {
      ensure(targetMembership.role).notEq(OrgRole.OWNER, errors.ONLY_OWNERS_CAN_REMOVE_OWNERS);
    }

    // Remove from organization and cascade project memberships
    await removeMembershipWithProjectCleanup(ctx, targetMembership);

    return null;
  },
});

/**
 * Leave an organization (self-removal)
 */
export const leave = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getAuthenticatedUser(ctx);

    const membership = await ensure(getMembership(ctx, args.organizationId, currentUser._id)).notNull(errors.CURRENT_USER_NOT_MEMBER);

    // Business rule: Owner cannot leave if they're the only owner
    if (membership.role === OrgRole.OWNER) {
      const otherOwnerExists = await hasOtherOwner(ctx, args.organizationId, currentUser._id);
      ensure(otherOwnerExists).isTrue(errors.CANNOT_LEAVE_ONLY_OWNER);
    }

    // Remove membership and cascade project memberships
    await removeMembershipWithProjectCleanup(ctx, membership);

    return null;
  },
});

/**
 * Get current user's role in an organization
 */
export const getMyRole = query({
  args: {
    organizationId: v.id("organizations"),
  },
  returns: v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const membership = await getMembership(ctx, args.organizationId, user._id);

    return membership?.role || null;
  },
});
