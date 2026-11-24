import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ProjectRole } from "../../../lib/authz/roles";
import { getProjectMembership } from "../../lib/accessRepo";

type Ctx = QueryCtx | MutationCtx;

/**
 * Delegates to `lib/accessRepo` so permission checks and the domain share one DB
 * implementation; arg order follows this repo's `(ctx, scopeId, userId)`.
 */
export async function getMembership(
  ctx: Ctx,
  projectId: Id<"projects">,
  userId: Id<"users">
): Promise<Doc<"projectMembers"> | null> {
  return getProjectMembership(ctx, userId, projectId);
}

export async function listMembershipsForProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"projectMembers">[]> {
  return ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId))
    .collect();
}

export async function listMembershipsForUser(ctx: Ctx, userId: Id<"users">): Promise<Doc<"projectMembers">[]> {
  return ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

/** Insert a project membership, stamping `addedAt`. */
export async function insertMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
  role: ProjectRole
): Promise<Id<"projectMembers">> {
  return ctx.db.insert("projectMembers", {
    projectId,
    userId,
    role,
    addedAt: Date.now(),
  });
}

export async function updateMembershipRole(
  ctx: MutationCtx,
  membershipId: Id<"projectMembers">,
  role: ProjectRole
): Promise<void> {
  await ctx.db.patch("projectMembers", membershipId, { role });
}

export async function deleteMembership(ctx: MutationCtx, membershipId: Id<"projectMembers">): Promise<void> {
  await ctx.db.delete("projectMembers", membershipId);
}
