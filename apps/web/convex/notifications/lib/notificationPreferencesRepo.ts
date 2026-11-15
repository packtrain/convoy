import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function listPreferencesByUser(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"notificationPreferences">[]> {
  return await ctx.db
    .query("notificationPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

export async function insertPreference(
  ctx: MutationCtx,
  row: {
    userId: Id<"users">;
    type: Doc<"notificationPreferences">["type"];
    channel: Doc<"notificationPreferences">["channel"];
    enabled: boolean;
  }
): Promise<Id<"notificationPreferences">> {
  return await ctx.db.insert("notificationPreferences", row);
}

export async function setPreferenceEnabled(
  ctx: MutationCtx,
  id: Id<"notificationPreferences">,
  enabled: boolean
): Promise<void> {
  await ctx.db.patch("notificationPreferences", id, { enabled });
}

export async function deletePreference(
  ctx: MutationCtx,
  id: Id<"notificationPreferences">
): Promise<void> {
  await ctx.db.delete("notificationPreferences", id);
}
