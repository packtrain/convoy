import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { changedFields } from "../../lib/shared/patch";
import type { AgentAppearance } from "./validators";

type Ctx = QueryCtx | MutationCtx;

export type AgentUpdatePatch = Partial<
  Pick<Doc<"agents">, "name" | "normalizedName" | "description" | "prompt" | "category" | "appearance">
>;

export async function listActiveAgentsByOrganization(ctx: QueryCtx, organizationId: Id<"organizations">): Promise<Doc<"agents">[]> {
  return ctx.db
    .query("agents")
    .withIndex("by_organization_and_isDeleted_and_normalizedName", (q) => q.eq("organizationId", organizationId).eq("isDeleted", false))
    .collect();
}

export async function getAgentById(ctx: Ctx, agentId: Id<"agents">): Promise<Doc<"agents"> | null> {
  return ctx.db.get("agents", agentId);
}

export async function getActiveAgentByNormalizedName(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  normalizedName: string
): Promise<Doc<"agents"> | null> {
  return ctx.db
    .query("agents")
    .withIndex("by_organization_and_isDeleted_and_normalizedName", (q) =>
      q.eq("organizationId", organizationId).eq("isDeleted", false).eq("normalizedName", normalizedName)
    )
    .unique();
}

export async function insertAgent(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    normalizedName: string;
    description?: string;
    prompt?: string;
    category?: string;
    appearance: AgentAppearance;
  },
  userId: Id<"users">
): Promise<Id<"agents">> {
  const now = Date.now();

  return ctx.db.insert("agents", {
    organizationId: args.organizationId,
    name: args.name,
    normalizedName: args.normalizedName,
    description: args.description,
    prompt: args.prompt,
    category: args.category,
    appearance: args.appearance,
    version: 1,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

/**
 * Patch a template only when a value actually changed, bumping `version` when it
 * does so installed copies can detect the update (OS-1759). Every field here is
 * template-owned, so any real change is worth a bump — and a no-op save must not
 * advertise a phantom update to every project that installed this template.
 */
export async function patchAgentIfChanged(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  patch: AgentUpdatePatch,
  userId: Id<"users">
): Promise<boolean> {
  if (changedFields(patch, agent).length === 0) {
    return false;
  }

  await ctx.db.patch("agents", agent._id, {
    ...patch,
    version: agentVersion(agent) + 1,
    updatedBy: userId,
    updatedAt: Date.now(),
  });

  return true;
}

/** Rows written before `version` existed count as version 1. */
export function agentVersion(agent: Pick<Doc<"agents">, "version"> | null): number {
  return agent?.version ?? 1;
}

export async function softDeleteAgent(ctx: MutationCtx, agentId: Id<"agents">, userId: Id<"users">): Promise<void> {
  const now = Date.now();

  await ctx.db.patch("agents", agentId, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });
}
