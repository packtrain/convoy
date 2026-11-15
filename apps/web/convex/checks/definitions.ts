import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, mapDefined } from "../lib/shared/patch";
import { errors } from "./errors";
import { MAX_CHECKS_PER_PROJECT, MAX_CHECK_INSTRUCTION_LENGTH } from "./lib/constants";
import { validateCheckKey, validateCheckLabel } from "./lib/naming";
import {
  deleteCheckDefinition,
  findCheckDefinitionByKey,
  getCheckDefinitionById,
  insertCheckDefinition,
  listCheckDefinitionsByProject,
  updateCheckDefinition,
  type CheckDefinitionUpdatePatch,
} from "./lib/checkDefinitionsRepo";
import { listChecklistsByProject, updateChecklist } from "./lib/checklistsRepo";

const checkDefinitionValidator = v.object({
  _id: v.id("checkDefinitions"),
  key: v.string(),
  label: v.string(),
  instruction: v.string(),
});

function validateInstruction(raw: string): string {
  const instruction = raw.trim();
  ensure(instruction.length).lte(MAX_CHECK_INSTRUCTION_LENGTH, errors.checkInstructionTooLong(MAX_CHECK_INSTRUCTION_LENGTH));
  return instruction;
}

async function requireCheckDefinition(
  ctx: Parameters<typeof getCheckDefinitionById>[0],
  id: Id<"checkDefinitions">
): Promise<Doc<"checkDefinitions">> {
  return ensure(getCheckDefinitionById(ctx, id)).notNull(errors.CHECK_NOT_FOUND);
}

/** The project's check catalog in key order. */
export const list = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()) },
  returns: v.array(checkDefinitionValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth || !(await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW))) {
      return [];
    }
    const definitions = await listCheckDefinitionsByProject(ctx, args.projectId);
    return definitions.map(({ _id, key, label, instruction }) => ({ _id, key, label, instruction }));
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    key: v.string(),
    label: v.string(),
    instruction: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("checkDefinitions"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);

    const key = validateCheckKey(args.key);
    const label = validateCheckLabel(args.label);
    const instruction = validateInstruction(args.instruction);

    const definitions = await listCheckDefinitionsByProject(ctx, args.projectId);
    ensure(definitions.length).lt(MAX_CHECKS_PER_PROJECT, errors.checkLimitReached(MAX_CHECKS_PER_PROJECT));
    await ensure(findCheckDefinitionByKey(ctx, args.projectId, key)).isNull(errors.CHECK_KEY_TAKEN);

    return insertCheckDefinition(ctx, { projectId: args.projectId, key, label, instruction }, user._id);
  },
});

/** The key is immutable: checklists and results reference it. */
export const update = mutation({
  args: {
    checkId: v.id("checkDefinitions"),
    label: v.optional(v.string()),
    instruction: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const definition = await requireCheckDefinition(ctx, args.checkId);
    await requireAuthorizedProject(ctx, principal, definition.projectId, ProjectPermission.PROJECT_UPDATE);

    const patch = buildPatch<CheckDefinitionUpdatePatch>({
      label: mapDefined(args.label, validateCheckLabel),
      instruction: mapDefined(args.instruction, validateInstruction),
    });
    if (Object.keys(patch).length > 0) {
      await updateCheckDefinition(ctx, definition._id, patch, user._id);
    }
    return null;
  },
});

/** Deletes a Check and drops its key from every checklist in the project. */
export const remove = mutation({
  args: { checkId: v.id("checkDefinitions"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const definition = await requireCheckDefinition(ctx, args.checkId);
    await requireAuthorizedProject(ctx, principal, definition.projectId, ProjectPermission.PROJECT_UPDATE);

    const checklists = await listChecklistsByProject(ctx, definition.projectId);
    for (const checklist of checklists) {
      if (checklist.checkKeys.includes(definition.key)) {
        const checkKeys = checklist.checkKeys.filter((key) => key !== definition.key);
        await updateChecklist(ctx, checklist._id, { checkKeys }, user._id);
      }
    }
    await deleteCheckDefinition(ctx, definition._id);
    return null;
  },
});
