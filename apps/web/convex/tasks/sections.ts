import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { EXTENDED_COLOR_PALETTE } from "@/lib/colors/palette";
import { buildPatch, clearable, mapDefined } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { MAX_SECTIONS_PER_PROJECT, MAX_SECTION_NAME_LENGTH } from "./lib/constants";
import { getDefaultListKey, resolveOptionalProjectTaskList } from "./lib/lists/resolution";
import {
  getSectionById,
  insertSection,
  listSectionsByList,
  listSectionsByProject,
  updateSection,
  type SectionUpdatePatch,
} from "./lib/taskSectionsRepo";
import { appendRank, validateRank } from "./lib/ranking";
import { removeSection } from "./lib/lifecycle";
import { taskSectionValidator, toTaskSection } from "./lib/validators";

function validateSectionName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  ensure(normalized).notEq("", errors.SECTION_NAME_REQUIRED);
  ensure(normalized.length).lte(MAX_SECTION_NAME_LENGTH, errors.sectionNameTooLong(MAX_SECTION_NAME_LENGTH));
  return normalized;
}

function validateSectionColor(color: string): string {
  ensure(EXTENDED_COLOR_PALETTE.some((supported) => supported === color)).isTrue(errors.SECTION_COLOR_INVALID);
  return color;
}

/** Missing listRef means the project default List, like tasks.core.listByProject. */
async function resolveListKey(ctx: QueryCtx, project: Doc<"projects">, listRef: string | undefined, activeOnly: boolean) {
  if (!listRef) return getDefaultListKey(project);
  return (await resolveOptionalProjectTaskList(ctx, { projectId: project._id, listRef, activeOnly }))?.listKey ?? null;
}

async function requireSection(ctx: QueryCtx, sectionId: Id<"taskSections">) {
  return ensure(getSectionById(ctx, sectionId)).notNull(errors.SECTION_NOT_FOUND);
}

/** Sections of one List in rank order. */
export const list = query({
  args: { projectId: v.id("projects"), listRef: v.optional(v.string()) },
  returns: v.array(taskSectionValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) return [];
    const access = await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) return [];
    const listKey = await resolveListKey(ctx, access.project, args.listRef, false);
    if (!listKey) return [];
    const sections = await listSectionsByList(ctx, args.projectId, listKey);
    return sections.map(toTaskSection);
  },
});

/** Sections of every List, for the move menu's destination-section step. */
export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(v.object({ ...taskSectionValidator.fields, listKey: v.string() })),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) return [];
    const access = await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW);
    if (!access) return [];
    const sections = await listSectionsByProject(ctx, args.projectId);
    return sections.map((section) => ({ ...toTaskSection(section), listKey: section.listKey }));
  },
});

/** Appends a section to the end of the List. */
export const create = mutation({
  args: {
    projectId: v.id("projects"),
    listRef: v.optional(v.string()),
    name: v.string(),
    color: v.optional(v.string()),
  },
  returns: v.id("taskSections"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const { project } = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.LIST_MANAGE);
    const listKey = await ensure(resolveListKey(ctx, project, args.listRef, true)).notNull(errors.LIST_NOT_FOUND);
    const name = validateSectionName(args.name);
    const color = mapDefined(args.color, validateSectionColor);
    const sections = await listSectionsByProject(ctx, args.projectId);
    ensure(sections.length).lt(MAX_SECTIONS_PER_PROJECT, errors.sectionLimitReached(MAX_SECTIONS_PER_PROJECT));
    const rank = appendRank(sections.findLast((section) => section.listKey === listKey)?.rank);
    return insertSection(ctx, { projectId: args.projectId, listKey, name, color, rank }, user._id);
  },
});

/** Rename and/or recolor; `color: null` clears it. */
export const update = mutation({
  args: {
    sectionId: v.id("taskSections"),
    name: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const section = await requireSection(ctx, args.sectionId);
    await requireAuthorizedProject(ctx, principal, section.projectId, ProjectPermission.LIST_MANAGE);
    const patch = buildPatch<SectionUpdatePatch>({
      name: mapDefined(args.name, validateSectionName),
      color: clearable(args.color, validateSectionColor),
    });
    if (Object.keys(patch).length > 0) await updateSection(ctx, section._id, patch, user._id);
    return null;
  },
});

/** Client computes the LexoRank between neighbors, same contract as label reorder. */
export const reorder = mutation({
  args: { sectionId: v.id("taskSections"), rank: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const section = await requireSection(ctx, args.sectionId);
    await requireAuthorizedProject(ctx, principal, section.projectId, ProjectPermission.LIST_MANAGE);
    await updateSection(ctx, section._id, { rank: validateRank(args.rank, errors.SECTION_RANK_INVALID) }, user._id);
    return null;
  },
});

/** Hard-deletes a section; its tasks move to No section in the same mutation. */
export const remove = mutation({
  args: { sectionId: v.id("taskSections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    const section = await requireSection(ctx, args.sectionId);
    await requireAuthorizedProject(ctx, principal, section.projectId, ProjectPermission.LIST_MANAGE);
    await removeSection(ctx, section._id);
    return null;
  },
});
