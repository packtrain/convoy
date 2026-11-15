import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { WorkflowDefinition } from "../../lib/contracts/workflowDefinition";

type Ctx = QueryCtx | MutationCtx;

export type WorkflowUpdatePatch = Partial<
  Pick<Doc<"workflows">, "name" | "description" | "category" | "color" | "draftDefinition" | "dirtySinceLastVersion">
>;

/** Active workflows, newest-edited first. */
export async function listActiveWorkflowsByProject(ctx: QueryCtx, projectId: Id<"projects">): Promise<Doc<"workflows">[]> {
  return ctx.db
    .query("workflows")
    .withIndex("by_project_and_isDeleted_and_updatedAt", (q) => q.eq("projectId", projectId).eq("isDeleted", false))
    .order("desc")
    .collect();
}

export async function getWorkflowById(ctx: Ctx, workflowId: Id<"workflows">): Promise<Doc<"workflows"> | null> {
  return ctx.db.get("workflows", workflowId);
}

export async function insertWorkflow(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    name: string;
    description?: string;
    category?: string;
    color?: string;
    draftDefinition: WorkflowDefinition;
  },
  userId: Id<"users">
): Promise<Id<"workflows">> {
  const now = Date.now();

  return ctx.db.insert("workflows", {
    projectId: args.projectId,
    name: args.name,
    description: args.description,
    category: args.category,
    color: args.color,
    draftDefinition: args.draftDefinition,
    dirtySinceLastVersion: true,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export async function patchWorkflow(
  ctx: MutationCtx,
  workflowId: Id<"workflows">,
  patch: WorkflowUpdatePatch,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("workflows", workflowId, {
    ...patch,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
}

export async function softDeleteWorkflow(ctx: MutationCtx, workflowId: Id<"workflows">, userId: Id<"users">): Promise<void> {
  const now = Date.now();

  await ctx.db.patch("workflows", workflowId, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });
}
