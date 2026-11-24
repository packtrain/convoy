import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { getOrgMembership } from "../../lib/accessRepo";
import { deleteLinkedAccount, findLinkedAccount } from "../../integrations/github/lib/integrationLinkedAccountsRepo";

type Ctx = QueryCtx | MutationCtx;

/**
 * Delegates to `lib/accessRepo` so permission checks and the organization domain
 * share one DB implementation; arg order follows this repo's `(ctx, scopeId, userId)`.
 */
export async function getMembership(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  userId: Id<"users">
): Promise<Doc<"organizationMembers"> | null> {
  return getOrgMembership(ctx, userId, organizationId);
}

export async function listMembershipsForUser(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"organizationMembers">[]> {
  return ctx.db
    .query("organizationMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

export async function listMembershipsForOrganization(
  ctx: Ctx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationMembers">[]> {
  return ctx.db
    .query("organizationMembers")
    .withIndex("by_organization_and_role", (q) =>
      q.eq("organizationId", organizationId)
    )
    .collect();
}

/**
 * True when the organization has an owner other than the excluded user.
 * The role is index-backed; the user exclusion cannot be (no `neq` in
 * indexes), so the small owner set is checked in memory.
 */
export async function hasOtherOwner(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  excludeUserId: Id<"users">
): Promise<boolean> {
  const owners = await ctx.db
    .query("organizationMembers")
    .withIndex("by_organization_and_role", (q) =>
      q.eq("organizationId", organizationId).eq("role", "owner")
    )
    .collect();

  return owners.some((owner) => owner.userId !== excludeUserId);
}

/** Insert an org membership, stamping `joinedAt`. */
export async function insertMembership(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  role: Doc<"organizationMembers">["role"]
): Promise<Id<"organizationMembers">> {
  return ctx.db.insert("organizationMembers", {
    organizationId,
    userId,
    role,
    joinedAt: Date.now(),
  });
}

export async function updateMembershipRole(
  ctx: MutationCtx,
  membershipId: Id<"organizationMembers">,
  role: Doc<"organizationMembers">["role"]
): Promise<void> {
  await ctx.db.patch("organizationMembers", membershipId, { role });
}

/**
 * Delete an org membership and cascade-delete the user's memberships in all
 * active projects of that organization, and their Linked GitHub account there.
 */
export async function removeMembershipWithProjectCleanup(
  ctx: MutationCtx,
  membership: Doc<"organizationMembers">
): Promise<void> {
  await ctx.db.delete("organizationMembers", membership._id);
  const linkedAccount = await findLinkedAccount(ctx, membership.organizationId, membership.userId);
  if (linkedAccount) {
    await deleteLinkedAccount(ctx, linkedAccount._id);
  }

  const orgProjects = await ctx.db
    .query("projects")
    .withIndex("by_organization_and_isDeleted_and_isArchived", (q) =>
      q.eq("organizationId", membership.organizationId).eq("isDeleted", false)
    )
    .collect();

  for (const project of orgProjects) {
    const projectMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_and_user", (q) =>
        q.eq("projectId", project._id).eq("userId", membership.userId)
      )
      .unique();

    if (projectMembership) {
      await ctx.db.delete("projectMembers", projectMembership._id);
    }
  }
}
