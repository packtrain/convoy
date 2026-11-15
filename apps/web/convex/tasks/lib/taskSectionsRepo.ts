import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { MAX_SECTIONS_PER_PROJECT } from "./constants";

type Ctx = QueryCtx | MutationCtx;

export async function getSectionById(ctx: Ctx, sectionId: Id<"taskSections">): Promise<Doc<"taskSections"> | null> {
  return ctx.db.get("taskSections", sectionId);
}

/** Sections of one List in rank order. */
export async function listSectionsByList(ctx: Ctx, projectId: Id<"projects">, listKey: string): Promise<Doc<"taskSections">[]> {
  return ctx.db
    .query("taskSections")
    .withIndex("by_project_and_listKey_and_rank", (q) => q.eq("projectId", projectId).eq("listKey", listKey))
    .take(MAX_SECTIONS_PER_PROJECT);
}

/** Sections of every List in a project, grouped by listKey then rank. */
export async function listSectionsByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"taskSections">[]> {
  return ctx.db
    .query("taskSections")
    .withIndex("by_project_and_listKey_and_rank", (q) => q.eq("projectId", projectId))
    .take(MAX_SECTIONS_PER_PROJECT);
}

/** Guard for task writes: the section must belong to the task's project and List. */
export async function assertSectionInList(
  ctx: Ctx,
  args: { projectId: Id<"projects">; listKey: string | undefined; sectionId: Id<"taskSections"> }
): Promise<Doc<"taskSections">> {
  const section = await ensure(getSectionById(ctx, args.sectionId)).notNull(errors.SECTION_NOT_FOUND);
  ensure(section.projectId === args.projectId && section.listKey === args.listKey).isTrue(errors.SECTION_DIFFERENT_LIST);
  return section;
}

/** ALL tasks in a section, including soft-deleted and archived ones. */
export async function listTasksBySection(ctx: Ctx, sectionId: Id<"taskSections">): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_sectionId", (q) => q.eq("sectionId", sectionId))
    .collect();
}

export async function insertSection(
  ctx: MutationCtx,
  props: { projectId: Id<"projects">; listKey: string; name: string; color?: string; rank: string },
  createdBy: Id<"users">
): Promise<Id<"taskSections">> {
  const now = Date.now();
  return ctx.db.insert("taskSections", {
    ...props,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export type SectionUpdatePatch = { name?: string; color?: string; rank?: string };

export async function updateSection(
  ctx: MutationCtx,
  sectionId: Id<"taskSections">,
  patch: SectionUpdatePatch,
  updatedBy: Id<"users">
): Promise<void> {
  await ctx.db.patch("taskSections", sectionId, { ...patch, updatedBy, updatedAt: Date.now() });
}

export async function deleteSection(ctx: MutationCtx, sectionId: Id<"taskSections">): Promise<void> {
  await ctx.db.delete("taskSections", sectionId);
}
