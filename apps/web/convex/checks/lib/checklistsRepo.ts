import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

type Ctx = QueryCtx | MutationCtx;

export function normalizeChecklistName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export async function getChecklistById(ctx: Ctx, id: Id<"checklists">): Promise<Doc<"checklists"> | null> {
  return ctx.db.get("checklists", id);
}

/** The project's checklists in name order. Bounded by MAX_CHECKLISTS_PER_PROJECT. */
export async function listChecklistsByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"checklists">[]> {
  return ctx.db
    .query("checklists")
    .withIndex("by_projectId_and_normalizedName", (q) => q.eq("projectId", projectId))
    .collect();
}

export async function findChecklistByNormalizedName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string
): Promise<Doc<"checklists"> | null> {
  return ctx.db
    .query("checklists")
    .withIndex("by_projectId_and_normalizedName", (q) => q.eq("projectId", projectId).eq("normalizedName", normalizedName))
    .unique();
}

export { findTaskTypeDefault } from "./resolution";

/** Guard for picking a task's checklist: it must exist in the task's project. */
export async function assertChecklistInProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  checklistId: Id<"checklists">
): Promise<Doc<"checklists">> {
  const checklist = await ensure(getChecklistById(ctx, checklistId)).notNull(errors.CHECKLIST_NOT_FOUND);
  ensure(checklist.projectId).eq(projectId, errors.CHECKLIST_DIFFERENT_PROJECT);
  return checklist;
}

export async function insertChecklist(
  ctx: MutationCtx,
  props: { projectId: Id<"projects">; name: string; checkKeys: string[]; taskTypeKeys: string[] },
  createdBy: Id<"users">
): Promise<Id<"checklists">> {
  const now = Date.now();
  return ctx.db.insert("checklists", {
    ...props,
    normalizedName: normalizeChecklistName(props.name),
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export type ChecklistUpdatePatch = {
  name?: string;
  normalizedName?: string;
  checkKeys?: string[];
  taskTypeKeys?: string[];
};

export async function updateChecklist(
  ctx: MutationCtx,
  id: Id<"checklists">,
  patch: ChecklistUpdatePatch,
  updatedBy: Id<"users">
): Promise<void> {
  await ctx.db.patch("checklists", id, { ...patch, updatedBy, updatedAt: Date.now() });
}

export async function deleteChecklist(ctx: MutationCtx, id: Id<"checklists">): Promise<void> {
  await ctx.db.delete("checklists", id);
}
