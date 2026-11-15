import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { IntegrationProvider } from "../../../lib/contracts/integrations";

type Ctx = QueryCtx | MutationCtx;

export const SETUP_TTL_MS = 10 * 60 * 1000;

export async function getSetupById(ctx: Ctx, id: Id<"integrationSetups">): Promise<Doc<"integrationSetups"> | null> {
  return ctx.db.get("integrationSetups", id);
}

export async function findSetupByIdString(ctx: Ctx, id: string): Promise<Doc<"integrationSetups"> | null> {
  const setupId = ctx.db.normalizeId("integrationSetups", id);
  return setupId ? ctx.db.get("integrationSetups", setupId) : null;
}

export async function getSetupByStateHash(
  ctx: Ctx,
  provider: IntegrationProvider,
  stateHash: string
): Promise<Doc<"integrationSetups"> | null> {
  return ctx.db
    .query("integrationSetups")
    .withIndex("by_provider_and_stateHash", (q) => q.eq("provider", provider).eq("stateHash", stateHash))
    .unique();
}

/** Starting a setup replaces the user's earlier setups for this project. */
export async function replaceSetup(
  ctx: MutationCtx,
  props: { userId: Id<"users">; projectId: Id<"projects">; provider: IntegrationProvider; stateHash: string }
): Promise<{ setupId: Id<"integrationSetups">; expiresAt: number }> {
  const earlier = await ctx.db
    .query("integrationSetups")
    .withIndex("by_provider_and_userId_and_projectId", (q) =>
      q.eq("provider", props.provider).eq("userId", props.userId).eq("projectId", props.projectId)
    )
    .take(10);
  for (const setup of earlier) {
    await ctx.db.delete("integrationSetups", setup._id);
  }
  const expiresAt = Date.now() + SETUP_TTL_MS;
  const setupId = await ctx.db.insert("integrationSetups", { ...props, expiresAt, status: "pending", github: {} });
  return { setupId, expiresAt };
}

export async function updateSetup(
  ctx: MutationCtx,
  id: Id<"integrationSetups">,
  patch: Partial<Pick<Doc<"integrationSetups">, "status" | "github">>
): Promise<void> {
  await ctx.db.patch("integrationSetups", id, patch);
}

export async function deleteSetup(ctx: MutationCtx, id: Id<"integrationSetups">): Promise<void> {
  await ctx.db.delete("integrationSetups", id);
}
