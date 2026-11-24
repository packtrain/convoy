import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AgentAppearance, ProjectAgentAutomation } from "./validators";

type Ctx = QueryCtx | MutationCtx;

export type ProjectAgentUpdatePatch = Partial<
  Pick<
    Doc<"projectAgents">,
    | "sourceAgentId"
    | "name"
    | "normalizedName"
    | "description"
    | "prompt"
    | "category"
    | "appearance"
    | "automation"
    | "installedVersion"
    | "locallyEdited"
  >
>;

export async function listActiveProjectAgentsByProject(ctx: QueryCtx, projectId: Id<"projects">): Promise<Doc<"projectAgents">[]> {
  return ctx.db
    .query("projectAgents")
    .withIndex("by_project_and_isDeleted_and_normalizedName", (q) => q.eq("projectId", projectId).eq("isDeleted", false))
    .collect();
}

export async function getProjectAgentById(ctx: Ctx, projectAgentId: Id<"projectAgents">): Promise<Doc<"projectAgents"> | null> {
  return ctx.db.get("projectAgents", projectAgentId);
}

export async function getProjectAgentsByIds(ctx: Ctx, projectAgentIds: Id<"projectAgents">[]): Promise<(Doc<"projectAgents"> | null)[]> {
  return Promise.all(projectAgentIds.map((projectAgentId) => getProjectAgentById(ctx, projectAgentId)));
}

export async function getActiveProjectAgentByNormalizedName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string
): Promise<Doc<"projectAgents"> | null> {
  return ctx.db
    .query("projectAgents")
    .withIndex("by_project_and_isDeleted_and_normalizedName", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("normalizedName", normalizedName)
    )
    .unique();
}

export async function insertProjectAgent(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    sourceAgentId?: Id<"agents">;
    name: string;
    normalizedName: string;
    description?: string;
    prompt?: string;
    category?: string;
    appearance: AgentAppearance;
    automation?: ProjectAgentAutomation;
    installedVersion?: number;
    locallyEdited?: boolean;
  },
  userId: Id<"users">
): Promise<Id<"projectAgents">> {
  const now = Date.now();

  return ctx.db.insert("projectAgents", {
    projectId: args.projectId,
    sourceAgentId: args.sourceAgentId,
    name: args.name,
    normalizedName: args.normalizedName,
    description: args.description,
    prompt: args.prompt,
    category: args.category,
    appearance: args.appearance,
    automation: args.automation,
    installedVersion: args.installedVersion,
    locallyEdited: args.locallyEdited,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export async function patchProjectAgent(
  ctx: MutationCtx,
  projectAgentId: Id<"projectAgents">,
  patch: ProjectAgentUpdatePatch,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("projectAgents", projectAgentId, {
    ...patch,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
}

export async function softDeleteProjectAgent(ctx: MutationCtx, projectAgentId: Id<"projectAgents">, userId: Id<"users">): Promise<void> {
  const now = Date.now();

  await ctx.db.patch("projectAgents", projectAgentId, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });
}
