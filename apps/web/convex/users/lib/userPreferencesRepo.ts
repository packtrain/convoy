import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

type ThreadSortBy = NonNullable<Doc<"userPreferences">["threadSortBy"]>;
type CliFavoriteCombos = NonNullable<Doc<"userPreferences">["cliFavoriteCombos"]>;

export type UserPreferencesPatch = {
  threadSortBy?: ThreadSortBy;
  threadCompactLayout?: boolean;
  threadGroupDone?: boolean;
  pullRequestCompactLayout?: boolean;
  cliFavoriteCombos?: CliFavoriteCombos;
  sectionHeaderStyle?: Doc<"userPreferences">["sectionHeaderStyle"];
  sectionColorStyle?: Doc<"userPreferences">["sectionColorStyle"];
};

export async function getPreferencesByUser(ctx: Ctx, userId: Id<"users">): Promise<Doc<"userPreferences"> | null> {
  return ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/** Patch preferences, stamping `updatedAt`. */
export async function updatePreferences(
  ctx: MutationCtx,
  preferencesId: Id<"userPreferences">,
  patch: UserPreferencesPatch
): Promise<void> {
  await ctx.db.patch("userPreferences", preferencesId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

/** Insert a user's preferences row, stamping `updatedAt`. */
export async function insertPreferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  preferences: Required<UserPreferencesPatch>
): Promise<Id<"userPreferences">> {
  return ctx.db.insert("userPreferences", {
    userId,
    ...preferences,
    updatedAt: Date.now(),
  });
}
