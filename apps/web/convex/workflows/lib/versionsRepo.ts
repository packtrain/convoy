import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { assertDefinitionRunnable } from "./invariants";
import { normalizeWorkflowDefinition } from "./normalize";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for `workflowVersions` plus the version cut (ADR 0006): versions
 * are cut only here, only at run start, and never mutated afterwards.
 */

export async function getWorkflowVersionById(ctx: Ctx, versionId: Id<"workflowVersions">): Promise<Doc<"workflowVersions"> | null> {
  return ctx.db.get("workflowVersions", versionId);
}

async function getLatestWorkflowVersion(ctx: Ctx, workflowId: Id<"workflows">): Promise<Doc<"workflowVersions"> | null> {
  return ctx.db
    .query("workflowVersions")
    .withIndex("by_workflow_and_versionNumber", (q) => q.eq("workflowId", workflowId))
    .order("desc")
    .first();
}

/**
 * Resolve the version a starting run pins (docs/specs/workflow-data-schema.md →
 * Save and version cut): a clean flag reuses `latestVersionId` untouched;
 * otherwise the draft passes full validation, is copied into a new immutable
 * version, and the flag clears. Convex transaction retries serialize
 * concurrent edits and starts, so the flag and numbers cannot race.
 */
export async function cutVersionForRun(
  ctx: MutationCtx,
  workflow: Doc<"workflows">,
  userId: Id<"users">
): Promise<Doc<"workflowVersions">> {
  if (!workflow.dirtySinceLastVersion && workflow.latestVersionId) {
    const pinned = await getWorkflowVersionById(ctx, workflow.latestVersionId);
    if (pinned) {
      return pinned;
    }
  }

  // Re-normalized here (a no-op for anything Save stored) so drafts saved
  // before a normalization rule existed still cut without a migration.
  const definition = normalizeWorkflowDefinition(workflow.draftDefinition);
  await assertDefinitionRunnable(ctx, workflow.projectId, definition);

  const latest = await getLatestWorkflowVersion(ctx, workflow._id);
  const versionId = await ctx.db.insert("workflowVersions", {
    workflowId: workflow._id,
    projectId: workflow.projectId,
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    definition,
    createdBy: userId,
    createdAt: Date.now(),
  });
  await ctx.db.patch("workflows", workflow._id, {
    latestVersionId: versionId,
    dirtySinceLastVersion: false,
  });
  const version = await ctx.db.get("workflowVersions", versionId);
  if (!version) {
    throw new Error("Workflow version vanished mid-transaction");
  }
  return version;
}
