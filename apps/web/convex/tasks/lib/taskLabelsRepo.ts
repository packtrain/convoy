import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

type Ctx = QueryCtx | MutationCtx;

export function normalizeLabelName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export async function getLabelById(ctx: Ctx, labelId: Id<"projectLabels">): Promise<Doc<"projectLabels"> | null> {
  return ctx.db.get("projectLabels", labelId);
}

/** All labels for a project, pre-sorted by rank via the index. Bounded by the per-project label cap. */
export async function listLabelsByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"projectLabels">[]> {
  return ctx.db
    .query("projectLabels")
    .withIndex("by_project_and_rank", (q) => q.eq("projectId", projectId))
    .collect();
}

/** Last (highest-ranked) label of a project, for append-to-end rank computation. */
export async function getLastLabelByRank(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"projectLabels"> | null> {
  return ctx.db
    .query("projectLabels")
    .withIndex("by_project_and_rank", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
}

export async function findLabelByNormalizedName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string
): Promise<Doc<"projectLabels"> | null> {
  return ctx.db
    .query("projectLabels")
    .withIndex("by_project_and_normalizedName", (q) => q.eq("projectId", projectId).eq("normalizedName", normalizedName))
    .unique();
}

/** Guard for task create/update: the label must exist and belong to the task's project. */
export async function assertLabelInProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  labelId: Id<"projectLabels">
): Promise<Doc<"projectLabels">> {
  const label = await ensure(getLabelById(ctx, labelId)).notNull(errors.LABEL_NOT_FOUND);
  ensure(label.projectId).eq(projectId, errors.LABEL_DIFFERENT_PROJECT);
  return label;
}

/** ALL tasks referencing a label — including soft-deleted and archived ones, so delete resolution leaves no dangling labelId. */
export async function listTasksByLabel(ctx: Ctx, projectId: Id<"projects">, labelId: Id<"projectLabels">): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_labelId", (q) => q.eq("projectId", projectId).eq("labelId", labelId))
    .collect();
}

/**
 * Insert a label, computing `normalizedName` and stamping audit fields.
 * Callers pass only validated user-supplied props.
 */
export async function insertLabel(
  ctx: MutationCtx,
  props: {
    projectId: Id<"projects">;
    name: string;
    color: string;
    rank: string;
  },
  createdBy: Id<"users">
): Promise<Id<"projectLabels">> {
  const now = Date.now();
  return ctx.db.insert("projectLabels", {
    projectId: props.projectId,
    name: props.name,
    normalizedName: normalizeLabelName(props.name),
    color: props.color,
    rank: props.rank,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export type LabelUpdatePatch = {
  name?: string;
  normalizedName?: string;
  color?: string;
  rank?: string;
};

/** Patch a label, stamping `updatedBy`/`updatedAt` so callers never repeat them. */
export async function updateLabel(
  ctx: MutationCtx,
  labelId: Id<"projectLabels">,
  patch: LabelUpdatePatch,
  updatedBy: Id<"users">
): Promise<void> {
  await ctx.db.patch("projectLabels", labelId, {
    ...patch,
    updatedBy,
    updatedAt: Date.now(),
  });
}

export async function deleteLabel(ctx: MutationCtx, labelId: Id<"projectLabels">): Promise<void> {
  await ctx.db.delete("projectLabels", labelId);
}
