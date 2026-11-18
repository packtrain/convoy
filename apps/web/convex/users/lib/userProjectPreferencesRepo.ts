import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type UserProjectPreferencesPatch = {
  agentAutoStart?: boolean;
  guideAutoStart?: boolean;
};

export async function getProjectPreferencesByUser(
  ctx: Ctx,
  userId: Id<"users">,
  projectId: Id<"projects">
): Promise<Doc<"userProjectPreferences"> | null> {
  return ctx.db
    .query("userProjectPreferences")
    .withIndex("by_user_and_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
    .first();
}

/** All of a user's per-project preference rows (bounded; ~one per project). */
export async function listProjectPreferencesByUser(ctx: Ctx, userId: Id<"users">): Promise<Doc<"userProjectPreferences">[]> {
  return ctx.db
    .query("userProjectPreferences")
    .withIndex("by_user_and_project", (q) => q.eq("userId", userId))
    .take(500);
}

/** Patch a user's per-project preferences, stamping `updatedAt`. */
export async function updateProjectPreferences(
  ctx: MutationCtx,
  preferencesId: Id<"userProjectPreferences">,
  patch: UserProjectPreferencesPatch
): Promise<void> {
  await ctx.db.patch("userProjectPreferences", preferencesId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

/** Insert a user's per-project preferences row, stamping `updatedAt`. */
export async function insertProjectPreferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  preferences: UserProjectPreferencesPatch
): Promise<Id<"userProjectPreferences">> {
  return ctx.db.insert("userProjectPreferences", {
    userId,
    projectId,
    ...preferences,
    updatedAt: Date.now(),
  });
}
