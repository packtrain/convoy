import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import {
  getProjectPreferencesByUser,
  insertProjectPreferences,
  listProjectPreferencesByUser,
  updateProjectPreferences,
} from "./lib/userProjectPreferencesRepo";

const DEFAULTS = {
  agentAutoStart: false,
};

const projectPreferencesReturnValidator = v.object({
  agentAutoStart: v.boolean(),
});

export const get = query({
  args: { projectId: v.id("projects") },
  returns: projectPreferencesReturnValidator,
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    // Out of reach reads defaults, so a stale subscription is not an error.
    const access = await authorizeProjectAccess(ctx, user._id, args.projectId, ProjectPermission.PROJECT_VIEW);
    const prefs = access ? await getProjectPreferencesByUser(ctx, user._id, args.projectId) : null;
    return {
      agentAutoStart: prefs?.agentAutoStart ?? DEFAULTS.agentAutoStart,
    };
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
    })
  ),
  handler: async (ctx) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const rows = await listProjectPreferencesByUser(ctx, user._id);

    return rows.map((row) => ({
      projectId: row.projectId,
      agentAutoStart: row.agentAutoStart ?? DEFAULTS.agentAutoStart,
    }));
  },
});

export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    agentAutoStart: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await requireAuthorizedProject(ctx, user._id, args.projectId, ProjectPermission.CLI_THREAD);

    const existing = await getProjectPreferencesByUser(ctx, user._id, args.projectId);
    if (existing) {
      await updateProjectPreferences(ctx, existing._id, { agentAutoStart: args.agentAutoStart });
    } else {
      await insertProjectPreferences(ctx, user._id, args.projectId, { agentAutoStart: args.agentAutoStart });
    }

    return null;
  },
});
