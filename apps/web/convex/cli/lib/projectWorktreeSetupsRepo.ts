import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { toRepoKey } from "./normalize";
import type { CliExecutionWorkspace } from "./validators";

type Ctx = QueryCtx | MutationCtx;

export async function getWorktreeSetupById(ctx: Ctx, id: Id<"projectWorktreeSetups">): Promise<Doc<"projectWorktreeSetups"> | null> {
  return ctx.db.get("projectWorktreeSetups", id);
}

/** A project's setups in repo-key order, at most `limit`. */
export async function listWorktreeSetupsByProject(ctx: Ctx, projectId: Id<"projects">, limit: number): Promise<Doc<"projectWorktreeSetups">[]> {
  return ctx.db
    .query("projectWorktreeSetups")
    .withIndex("by_projectId_and_repoKey", (q) => q.eq("projectId", projectId))
    .take(limit);
}

export async function findWorktreeSetup(ctx: Ctx, projectId: Id<"projects">, repoKey: string): Promise<Doc<"projectWorktreeSetups"> | null> {
  return ctx.db
    .query("projectWorktreeSetups")
    .withIndex("by_projectId_and_repoKey", (q) => q.eq("projectId", projectId).eq("repoKey", repoKey))
    .unique();
}

/** The setup of the repo a workspace's worktree comes from, read by run start and the older-CLI gate alike. */
export async function findWorktreeSetupForWorkspace(
  ctx: Ctx,
  projectId: Id<"projects">,
  workspace: CliExecutionWorkspace,
): Promise<{ repoKey: string; setup: Doc<"projectWorktreeSetups"> } | null> {
  const repoKey = toRepoKey(workspace.worktree?.parentGitRemoteUrl);
  const setup = repoKey ? await findWorktreeSetup(ctx, projectId, repoKey) : null;
  return repoKey && setup ? { repoKey, setup } : null;
}

export async function insertWorktreeSetup(
  ctx: MutationCtx,
  props: { projectId: Id<"projects">; repoKey: string; script: string },
  createdBy: Id<"users">,
): Promise<Id<"projectWorktreeSetups">> {
  const now = Date.now();
  return ctx.db.insert("projectWorktreeSetups", { ...props, revision: 1, createdBy, updatedBy: createdBy, createdAt: now, updatedAt: now });
}

/** Replaces the script and bumps `revision`. */
export async function updateWorktreeSetupScript(
  ctx: MutationCtx,
  setup: Doc<"projectWorktreeSetups">,
  script: string,
  updatedBy: Id<"users">,
): Promise<number> {
  const revision = setup.revision + 1;
  await ctx.db.patch("projectWorktreeSetups", setup._id, { script, revision, updatedBy, updatedAt: Date.now() });
  return revision;
}

/** Leaves approval rows behind; a recreated setup gets a new `_id`, so they never match again. */
export async function deleteWorktreeSetup(ctx: MutationCtx, id: Id<"projectWorktreeSetups">): Promise<void> {
  await ctx.db.delete("projectWorktreeSetups", id);
}

export async function findWorktreeSetupApproval(
  ctx: Ctx,
  userId: Id<"users">,
  setupId: Id<"projectWorktreeSetups">,
): Promise<Doc<"projectWorktreeSetupApprovals"> | null> {
  return ctx.db
    .query("projectWorktreeSetupApprovals")
    .withIndex("by_userId_and_setupId", (q) => q.eq("userId", userId).eq("setupId", setupId))
    .unique();
}

export async function upsertWorktreeSetupApproval(
  ctx: MutationCtx,
  userId: Id<"users">,
  setupId: Id<"projectWorktreeSetups">,
  revision: number,
): Promise<void> {
  const approvedAt = Date.now();
  const existing = await findWorktreeSetupApproval(ctx, userId, setupId);
  if (existing) {
    await ctx.db.patch("projectWorktreeSetupApprovals", existing._id, { revision, approvedAt });
  } else {
    await ctx.db.insert("projectWorktreeSetupApprovals", { userId, setupId, revision, approvedAt });
  }
}
