import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getCheckDefinitionById(ctx: Ctx, id: Id<"checkDefinitions">): Promise<Doc<"checkDefinitions"> | null> {
  return ctx.db.get("checkDefinitions", id);
}

/** The project's catalog in key order. Bounded by MAX_CHECKS_PER_PROJECT. */
export async function listCheckDefinitionsByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"checkDefinitions">[]> {
  return ctx.db
    .query("checkDefinitions")
    .withIndex("by_projectId_and_key", (q) => q.eq("projectId", projectId))
    .collect();
}

export async function findCheckDefinitionByKey(ctx: Ctx, projectId: Id<"projects">, key: string): Promise<Doc<"checkDefinitions"> | null> {
  return ctx.db
    .query("checkDefinitions")
    .withIndex("by_projectId_and_key", (q) => q.eq("projectId", projectId).eq("key", key))
    .unique();
}

export async function insertCheckDefinition(
  ctx: MutationCtx,
  props: { projectId: Id<"projects">; key: string; label: string; instruction: string; showInPullRequestList?: boolean },
  createdBy: Id<"users">
): Promise<Id<"checkDefinitions">> {
  const now = Date.now();
  return ctx.db.insert("checkDefinitions", { ...props, createdBy, updatedBy: createdBy, createdAt: now, updatedAt: now });
}

export type CheckDefinitionUpdatePatch = { label?: string; instruction?: string; showInPullRequestList?: boolean };

export async function updateCheckDefinition(
  ctx: MutationCtx,
  id: Id<"checkDefinitions">,
  patch: CheckDefinitionUpdatePatch,
  updatedBy: Id<"users">
): Promise<void> {
  await ctx.db.patch("checkDefinitions", id, { ...patch, updatedBy, updatedAt: Date.now() });
}

export async function deleteCheckDefinition(ctx: MutationCtx, id: Id<"checkDefinitions">): Promise<void> {
  await ctx.db.delete("checkDefinitions", id);
}
