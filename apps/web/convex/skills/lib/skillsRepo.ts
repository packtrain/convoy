import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** `sourceSkillId` is absent on purpose: install provenance is insert-only. */
export type SkillUpdatePatch = Partial<
  Pick<Doc<"skills">, "name" | "normalizedName" | "description" | "category" | "installedVersion" | "locallyEdited" | "source">
>;

/**
 * Unbounded on purpose, matching `listActiveOrganizationSlashCommands`. Ceiling:
 * ~500 Skills per org is ~150 KB re-sent on every file write (each bumps the
 * parent `version`). Paginate or move to a search index past that.
 */
export async function listActiveOrganizationSkills(ctx: QueryCtx, organizationId: Id<"organizations">): Promise<Doc<"skills">[]> {
  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_organizationId_and_isDeleted_and_normalizedName", (q) =>
      q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false)
    )
    .collect();
}

/** Same ceiling as the organization list, per project. */
export async function listActiveProjectSkills(ctx: QueryCtx, projectId: Id<"projects">): Promise<Doc<"skills">[]> {
  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_projectId_and_isDeleted_and_normalizedName", (q) => q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false))
    .collect();
}

/** `undefined` category means no filter; `null` means Skills with no category. */
export type SkillCategoryFilter = string | null | undefined;

/** Name-ordered pages, so "load more" extends the list the user is reading. */
export async function paginateActiveOrganizationSkills(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  category: SkillCategoryFilter,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"skills">>> {
  if (category === undefined) {
    return ctx.db
      .query("skills")
      .withIndex("by_scope_and_organizationId_and_isDeleted_and_normalizedName", (q) =>
        q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false)
      )
      .paginate(paginationOpts);
  }

  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_organizationId_and_isDeleted_and_category", (q) =>
      q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false).eq("category", category ?? undefined)
    )
    .paginate(paginationOpts);
}

export async function paginateActiveProjectSkills(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  category: SkillCategoryFilter,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"skills">>> {
  if (category === undefined) {
    return ctx.db
      .query("skills")
      .withIndex("by_scope_and_projectId_and_isDeleted_and_normalizedName", (q) =>
        q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false)
      )
      .paginate(paginationOpts);
  }

  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_projectId_and_isDeleted_and_category", (q) =>
      q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false).eq("category", category ?? undefined)
    )
    .paginate(paginationOpts);
}

export async function getSkillById(ctx: Ctx, skillId: Id<"skills">): Promise<Doc<"skills"> | null> {
  return ctx.db.get("skills", skillId);
}

export async function getActiveOrganizationSkillByNormalizedName(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  normalizedName: string
): Promise<Doc<"skills"> | null> {
  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_organizationId_and_isDeleted_and_normalizedName", (q) =>
      q.eq("scope", "organization").eq("organizationId", organizationId).eq("isDeleted", false).eq("normalizedName", normalizedName)
    )
    .unique();
}

export async function getActiveProjectSkillByNormalizedName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string
): Promise<Doc<"skills"> | null> {
  return ctx.db
    .query("skills")
    .withIndex("by_scope_and_projectId_and_isDeleted_and_normalizedName", (q) =>
      q.eq("scope", "project").eq("projectId", projectId).eq("isDeleted", false).eq("normalizedName", normalizedName)
    )
    .unique();
}

type SkillColumns = {
  organizationId: Id<"organizations">;
  name: string;
  normalizedName: string;
  description?: string;
  category?: string;
  /** Install provenance, on a project copy only (docs/specs/skills.md#scope-and-install-model). */
  sourceSkillId?: Id<"skills">;
  installedVersion?: number;
  /** Git provenance, on a Skill copied from a repository (docs/specs/skills.md#git-sources). */
  source?: Doc<"skills">["source"];
};

async function insertSkill(
  ctx: MutationCtx,
  args: SkillColumns & { scope: Doc<"skills">["scope"]; projectId?: Id<"projects"> },
  userId: Id<"users">
): Promise<Id<"skills">> {
  const now = Date.now();

  return ctx.db.insert("skills", {
    ...args,
    version: 1,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export async function insertOrganizationSkill(ctx: MutationCtx, args: SkillColumns, userId: Id<"users">): Promise<Id<"skills">> {
  return insertSkill(ctx, { ...args, scope: "organization" }, userId);
}

export async function insertProjectSkill(
  ctx: MutationCtx,
  args: SkillColumns & { projectId: Id<"projects"> },
  userId: Id<"users">
): Promise<Id<"skills">> {
  return insertSkill(ctx, { ...args, scope: "project" }, userId);
}

/**
 * A file write is a save of the Skill, so it bumps the Skill's version too. Only
 * a save that stored something calls this: a no-op must not advertise a phantom
 * update to every installed copy (docs/specs/skills.md#versioning-and-refresh).
 */
export async function bumpSkillVersion(
  ctx: MutationCtx,
  skill: Doc<"skills">,
  patch: SkillUpdatePatch,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("skills", skill._id, {
    ...patch,
    version: skill.version + 1,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
}

export async function softDeleteSkill(ctx: MutationCtx, skillId: Id<"skills">, userId: Id<"users">): Promise<void> {
  const now = Date.now();

  await ctx.db.patch("skills", skillId, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: userId,
    updatedAt: now,
    updatedBy: userId,
  });
}
