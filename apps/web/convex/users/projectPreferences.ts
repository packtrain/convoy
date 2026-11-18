import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { getAuthenticatedUser, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import {
  getProjectPreferencesByUser,
  insertProjectPreferences,
  listProjectPreferencesByUser,
  updateProjectPreferences,
} from "./lib/userProjectPreferencesRepo";

const projectPreferencesReturnValidator = v.object({
  agentAutoStart: v.boolean(),
  guideAutoStart: v.boolean(),
});

/** A stored row, or none, with every choice defaulting to Ask each time. */
function toProjectPreferences(row: Doc<"userProjectPreferences"> | null) {
  return { agentAutoStart: row?.agentAutoStart ?? false, guideAutoStart: row?.guideAutoStart ?? false };
}

export const get = query({
  args: { projectId: v.id("projects") },
  returns: projectPreferencesReturnValidator,
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    // Out of reach reads defaults, so a stale subscription is not an error.
    const access = await authorizeProjectAccess(ctx, user._id, args.projectId, ProjectPermission.PROJECT_VIEW);
    return toProjectPreferences(access ? await getProjectPreferencesByUser(ctx, user._id, args.projectId) : null);
  },
});

/**
 * The current user's stored per-project preference rows (only projects the
 * user has made a choice for). The client joins these with
 * `projects.core.listAccessible` for the user-settings management list.
 */
export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      projectId: v.id("projects"),
      agentAutoStart: v.boolean(),
      guideAutoStart: v.boolean(),
    })
  ),
  handler: async (ctx) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const rows = await listProjectPreferencesByUser(ctx, user._id);

    return rows.map((row) => ({ projectId: row.projectId, ...toProjectPreferences(row) }));
  },
});

/** Sets the choices passed; the others keep their stored value. */
export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    agentAutoStart: v.optional(v.boolean()),
    guideAutoStart: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, ...patch }) => {
    const user = await getAuthenticatedUser(ctx);
    await requireAuthorizedProject(ctx, user._id, projectId, ProjectPermission.CLI_THREAD);

    const existing = await getProjectPreferencesByUser(ctx, user._id, projectId);
    if (existing) {
      await updateProjectPreferences(ctx, existing._id, patch);
    } else {
      await insertProjectPreferences(ctx, user._id, projectId, patch);
    }

    return null;
  },
});
