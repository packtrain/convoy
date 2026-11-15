import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getProjectById(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<Doc<"projects"> | null> {
  return ctx.db.get("projects", projectId);
}

export async function getOrgMembership(
  ctx: Ctx,
  userId: Id<"users">,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationMembers"> | null> {
  return ctx.db
    .query("organizationMembers")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId)
    )
    .unique();
}

export async function getProjectMembership(
  ctx: Ctx,
  userId: Id<"users">,
  projectId: Id<"projects">
): Promise<Doc<"projectMembers"> | null> {
  return ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) =>
      q.eq("projectId", projectId).eq("userId", userId)
    )
    .unique();
}

export async function listProjectMembershipsForUser(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"projectMembers">[]> {
  return ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}
