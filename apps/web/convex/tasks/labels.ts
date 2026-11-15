import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  getAuthenticatedAccess,
  getOptionalAuthenticatedAccess,
} from "../lib/access/auth";
import {
  authorizeProjectAccess,
  requireAuthorizedProject,
} from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { EXTENDED_COLOR_PALETTE } from "@/lib/colors/palette";
import { buildPatch, mapDefined } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { MAX_LABELS_PER_PROJECT, MAX_LABEL_NAME_LENGTH } from "./lib/constants";
import { projectLabelValidator } from "./lib/validators";
import {
  deleteLabel,
  findLabelByNormalizedName,
  getLabelById,
  getLastLabelByRank,
  insertLabel,
  listLabelsByProject,
  listTasksByLabel,
  normalizeLabelName,
  updateLabel,
} from "./lib/taskLabelsRepo";
import { patchTask } from "./lib/tasksRepo";
import { appendRank, validateRank } from "./lib/ranking";
import { archiveTasksByIds } from "./lib/lifecycle";
import { logTaskActivity } from "./lib/activity/logger";

const DEFAULT_LABEL_COLOR = "#3b82f6"; // blue, from the extended palette

function validateLabelName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  ensure(normalized).notEq("", errors.LABEL_NAME_REQUIRED);
  ensure(normalized.length).lte(MAX_LABEL_NAME_LENGTH, errors.labelNameTooLong(MAX_LABEL_NAME_LENGTH));
  return normalized;
}

// Labels use the extended palette — the settings and board color pickers must
// pass palette="extended" to match.
function validateLabelColor(color: string): string {
  ensure(EXTENDED_COLOR_PALETTE.some((supported) => supported === color)).isTrue(errors.LABEL_COLOR_INVALID);
  return color;
}

function isOtherLabel(existing: Doc<"projectLabels"> | null, existingId?: Doc<"projectLabels">["_id"]): boolean {
  return existing !== null && existing._id !== existingId;
}

async function requireLabelExists(ctx: Parameters<typeof getLabelById>[0], labelId: Doc<"projectLabels">["_id"]): Promise<Doc<"projectLabels">> {
  return ensure(getLabelById(ctx, labelId)).notNull(errors.LABEL_NOT_FOUND);
}

/** Labels for a project, in rank order (= board column order). Bounded by the per-project cap. */
export const list = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(projectLabelValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }

    const access = await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) {
      return [];
    }

    const labels = await listLabelsByProject(ctx, args.projectId);
    return labels.map((label) => ({
      _id: label._id,
      _creationTime: label._creationTime,
      projectId: label.projectId,
      name: label.name,
      color: label.color,
      rank: label.rank,
    }));
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    color: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("projectLabels"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);

    const name = validateLabelName(args.name);
    const color = args.color === undefined ? DEFAULT_LABEL_COLOR : validateLabelColor(args.color);

    const labels = await listLabelsByProject(ctx, args.projectId);
    ensure(labels.length).lt(MAX_LABELS_PER_PROJECT, errors.labelLimitReached(MAX_LABELS_PER_PROJECT));

    const existing = await findLabelByNormalizedName(ctx, args.projectId, normalizeLabelName(name));
    ensure(existing).isNull(errors.LABEL_NAME_TAKEN);

    const lastLabel = await getLastLabelByRank(ctx, args.projectId);
    const rank = appendRank(lastLabel?.rank);

    return insertLabel(ctx, { projectId: args.projectId, name, color, rank }, user._id);
  },
});

export const update = mutation({
  args: {
    labelId: v.id("projectLabels"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const label = await requireLabelExists(ctx, args.labelId);
    await requireAuthorizedProject(ctx, principal, label.projectId, ProjectPermission.PROJECT_UPDATE);

    const name = mapDefined(args.name, validateLabelName);
    if (name !== undefined) {
      const existing = await findLabelByNormalizedName(ctx, label.projectId, normalizeLabelName(name));
      ensure(isOtherLabel(existing, label._id)).isFalse(errors.LABEL_NAME_TAKEN);
    }

    const patch = buildPatch<Parameters<typeof updateLabel>[2]>({
      name,
      normalizedName: mapDefined(name, normalizeLabelName),
      color: mapDefined(args.color, validateLabelColor),
    });
    if (Object.keys(patch).length > 0) {
      // Rename does NOT touch tasks — they reference the label by id.
      await updateLabel(ctx, label._id, patch, user._id);
    }

    return null;
  },
});

/** Client computes the LexoRank between neighbors, same contract as task reorder. */
export const reorder = mutation({
  args: {
    labelId: v.id("projectLabels"),
    rank: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const label = await requireLabelExists(ctx, args.labelId);
    await requireAuthorizedProject(ctx, principal, label.projectId, ProjectPermission.PROJECT_UPDATE);

    await updateLabel(ctx, label._id, { rank: validateRank(args.rank, errors.LABEL_RANK_INVALID) }, user._id);

    return null;
  },
});

/**
 * Hard-delete a label, resolving every referencing task in the same
 * transactional mutation so no dangling `labelId` can survive — including on
 * soft-deleted and archived tasks. History survives via the activity log,
 * which stores the label name/color, not just the id.
 */
export const remove = mutation({
  args: {
    labelId: v.id("projectLabels"),
    resolution: v.union(v.literal("clear"), v.literal("reassign"), v.literal("archiveTasks")),
    reassignToLabelId: v.optional(v.id("projectLabels")),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({ affectedTaskIds: v.array(v.id("tasks")) }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const label = await requireLabelExists(ctx, args.labelId);
    await requireAuthorizedProject(ctx, principal, label.projectId, ProjectPermission.PROJECT_UPDATE);

    let reassignTo: Doc<"projectLabels"> | null = null;
    if (args.resolution === "reassign") {
      const targetId = await ensure(args.reassignToLabelId)
        .notNull(errors.LABEL_REASSIGN_TARGET_REQUIRED)
        .notEq(args.labelId, errors.LABEL_REASSIGN_TARGET_INVALID);
      reassignTo = await requireLabelExists(ctx, targetId);
      ensure(reassignTo.projectId).eq(label.projectId, errors.LABEL_DIFFERENT_PROJECT);
    }

    // ponytail: single-mutation resolution; move to scheduler batches if
    // projects exceed ~5k tasks per label.
    const tasks = await listTasksByLabel(ctx, label.projectId, args.labelId);
    const oldLabel = { id: label._id, name: label.name, color: label.color };
    const newLabel = reassignTo ? { id: reassignTo._id, name: reassignTo.name, color: reassignTo.color } : undefined;
    for (const task of tasks) {
      await patchTask(ctx, task._id, { labelId: reassignTo?._id });
      if (!task.isDeleted) {
        await logTaskActivity.labelChanged(ctx, { taskId: task._id, userId: user._id, oldLabel, newLabel });
      }
    }

    if (args.resolution === "archiveTasks") {
      const idsToArchive = tasks.filter((task) => !task.isDeleted && !task.isArchived).map((task) => task._id);
      if (idsToArchive.length > 0) {
        await archiveTasksByIds(ctx, user._id, idsToArchive);
      }
    }

    await deleteLabel(ctx, label._id);

    return { affectedTaskIds: tasks.map((task) => task._id) };
  },
});
