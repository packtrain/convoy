import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { CliAdvertisedCatalog, CliType } from "../../lib/contracts/validators";
import { sameStoredValue } from "../../lib/shared/patch";

type Ctx = QueryCtx | MutationCtx;

/** The catalog a profile advertises for one runtime, or null when it advertises none. */
export async function getRuntimeCatalog(
  ctx: Ctx,
  args: { profileId: Id<"cliProfiles">; cliType: CliType }
): Promise<Doc<"cliRuntimeCatalogs"> | null> {
  return ctx.db
    .query("cliRuntimeCatalogs")
    .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", args.profileId).eq("cliType", args.cliType))
    .unique();
}

/** Every catalog of the caller's profiles in one project — the composer's read. */
export async function listRuntimeCatalogsByProjectAndUser(
  ctx: Ctx,
  args: { projectId: Id<"projects">; userId: Id<"users"> }
): Promise<Doc<"cliRuntimeCatalogs">[]> {
  return ctx.db
    .query("cliRuntimeCatalogs")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", args.projectId).eq("userId", args.userId))
    .collect();
}

/** Every runtime catalog of one profile (index prefix, so no full scan). */
export async function listRuntimeCatalogsByProfile(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliRuntimeCatalogs">[]> {
  return ctx.db
    .query("cliRuntimeCatalogs")
    .withIndex("by_profile_and_cliType", (q) => q.eq("profileId", profileId))
    .collect();
}

/**
 * Make a profile's catalogs match a registration: known upserts (unchanged writes
 * nothing), empty clears, **unknown** leaves the stored row alone, and a runtime
 * absent from the registration loses it. See `docs/specs/cli-opencode-runtime.md`.
 */
export async function replaceRuntimeCatalogs(
  ctx: MutationCtx,
  args: {
    profileId: Id<"cliProfiles">;
    projectId: Id<"projects">;
    userId: Id<"users">;
    catalogs: readonly CliAdvertisedCatalog[];
    now: number;
  }
): Promise<void> {
  const existing = await listRuntimeCatalogsByProfile(ctx, args.profileId);
  const keep = new Set(args.catalogs.map((catalog) => catalog.cliType));

  for (const catalog of args.catalogs) {
    if (catalog.models === undefined) {
      continue;
    }

    const row = existing.find((entry) => entry.cliType === catalog.cliType);
    if (catalog.models.length === 0) {
      if (row) {
        await ctx.db.delete("cliRuntimeCatalogs", row._id);
      }
      continue;
    }
    if (!row) {
      await ctx.db.insert("cliRuntimeCatalogs", {
        profileId: args.profileId,
        projectId: args.projectId,
        userId: args.userId,
        cliType: catalog.cliType,
        models: catalog.models,
        reportedAt: args.now,
      });
      continue;
    }
    if (sameStoredValue(catalog.models, row.models)) {
      continue;
    }
    await ctx.db.patch("cliRuntimeCatalogs", row._id, { models: catalog.models, reportedAt: args.now });
  }

  for (const row of existing) {
    if (!keep.has(row.cliType)) {
      await ctx.db.delete("cliRuntimeCatalogs", row._id);
    }
  }
}

/** Drop a deleted profile's catalogs (at most one row per runtime). */
export async function deleteRuntimeCatalogsByProfile(ctx: MutationCtx, profileId: Id<"cliProfiles">): Promise<void> {
  const rows = await listRuntimeCatalogsByProfile(ctx, profileId);
  for (const row of rows) {
    await ctx.db.delete("cliRuntimeCatalogs", row._id);
  }
}
