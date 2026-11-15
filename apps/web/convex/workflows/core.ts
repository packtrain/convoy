import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { ProjectPermission } from "../../lib/authz/permissions";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { workflowDefinitionValidator } from "../lib/contracts/workflowDefinition";
import { buildPatch, changedFields, clearable, mapClearable, mapDefined, sameStoredValue } from "../lib/shared/patch";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { assertDefinitionRunnable, assertDefinitionStructure } from "./lib/invariants";
import {
  normalizeOptionalWorkflowCategory,
  normalizeOptionalWorkflowDescription,
  normalizeWorkflowColor,
  normalizeWorkflowDefinition,
  normalizeWorkflowName,
} from "./lib/normalize";
import {
  getWorkflowById,
  insertWorkflow,
  listActiveWorkflowsByProject,
  patchWorkflow,
  softDeleteWorkflow,
  type WorkflowUpdatePatch,
} from "./lib/workflowsRepo";
import { toWorkflow, toWorkflowSummary, workflowSummaryValidator, workflowValidator } from "./lib/validators";

export const listByProject = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()) },
  returns: v.array(workflowSummaryValidator),
  handler: async (ctx, args) => {
    const caller = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!caller) {
      return [];
    }

    const access = await authorizeProjectAccess(ctx, caller.principal, args.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return [];
    }

    const workflows = await listActiveWorkflowsByProject(ctx, args.projectId);
    return workflows.map(toWorkflowSummary);
  },
});

export const get = query({
  args: { workflowId: v.id("workflows"), apiKey: v.optional(v.string()) },
  returns: v.union(workflowValidator, v.null()),
  handler: async (ctx, args) => {
    const caller = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!caller) {
      return null;
    }

    const workflow = await getWorkflowById(ctx, args.workflowId);
    if (!workflow || workflow.isDeleted) {
      return null;
    }

    const access = await authorizeProjectAccess(ctx, caller.principal, workflow.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return null;
    }

    return toWorkflow(workflow);
  },
});

/**
 * Dry run of the version-cut checks (workflow-data-schema.md → Save and version
 * cut) on the stored draft or a supplied definition; nothing is written.
 */
export const validate = query({
  args: { workflowId: v.id("workflows"), definition: v.optional(workflowDefinitionValidator), apiKey: v.optional(v.string()) },
  returns: v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), error: v.string() })),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const workflow = await ensure(getWorkflowById(ctx, args.workflowId)).notDeleted(errors.WORKFLOW_NOT_FOUND);
    const access = await authorizeProjectAccess(ctx, principal, workflow.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      throw new ConvexError(errors.WORKFLOW_NOT_FOUND);
    }

    try {
      await assertDefinitionRunnable(ctx, workflow.projectId, normalizeWorkflowDefinition(args.definition ?? workflow.draftDefinition));
      return { ok: true as const };
    } catch (error) {
      if (error instanceof ConvexError) {
        return { ok: false as const, error: String(error.data) };
      }
      throw error;
    }
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    color: v.optional(v.string()),
    definition: workflowDefinitionValidator,
    apiKey: v.optional(v.string()),
  },
  returns: v.id("workflows"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.TASK_UPDATE);

    const definition = normalizeWorkflowDefinition(args.definition);
    assertDefinitionStructure(definition);

    return insertWorkflow(
      ctx,
      {
        projectId: args.projectId,
        name: normalizeWorkflowName(args.name),
        description: normalizeOptionalWorkflowDescription(args.description),
        category: normalizeOptionalWorkflowCategory(args.category),
        color: args.color === undefined ? undefined : normalizeWorkflowColor(args.color),
        draftDefinition: definition,
      },
      user._id
    );
  },
});

export const update = mutation({
  args: {
    workflowId: v.id("workflows"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    category: v.optional(v.union(v.string(), v.null())),
    color: v.optional(v.union(v.string(), v.null())),
    definition: v.optional(workflowDefinitionValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const workflow = await ensure(getWorkflowById(ctx, args.workflowId)).notDeleted(errors.WORKFLOW_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, workflow.projectId, ProjectPermission.TASK_UPDATE);

    const definition = args.definition === undefined ? undefined : normalizeWorkflowDefinition(args.definition);
    if (definition !== undefined) {
      assertDefinitionStructure(definition);
    }
    // The editor re-sends every field on every save, so the flag is decided by
    // comparing values, never by which fields the client sent: a rename-only
    // save with the definition re-sent unchanged must leave it clear.
    const definitionChanged = definition !== undefined && !sameStoredValue(definition, workflow.draftDefinition);

    const patch = buildPatch<WorkflowUpdatePatch>({
      name: mapDefined(args.name, normalizeWorkflowName),
      description: mapClearable(args.description, normalizeOptionalWorkflowDescription),
      category: mapClearable(args.category, normalizeOptionalWorkflowCategory),
      color: clearable(args.color, normalizeWorkflowColor),
    });

    // The definition stays out of buildPatch/changedFields so a near-cap
    // draft isn't re-serialized for a comparison already made above.
    if (!definitionChanged && changedFields(patch, workflow).length === 0) {
      return null;
    }
    if (definitionChanged) {
      patch.draftDefinition = definition;
      patch.dirtySinceLastVersion = true;
    }

    await patchWorkflow(ctx, args.workflowId, patch, user._id);

    return null;
  },
});

export const remove = mutation({
  args: { workflowId: v.id("workflows"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const workflow = await ensure(getWorkflowById(ctx, args.workflowId)).notDeleted(errors.WORKFLOW_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, workflow.projectId, ProjectPermission.TASK_UPDATE);

    await softDeleteWorkflow(ctx, args.workflowId, user._id);

    // Soft delete cancels active runs; version and run history are kept
    // (docs/specs/workflows.md → Versioning).
    await ctx.runMutation(internal.workflows.runs.core.cancelRunsForDeletedWorkflow, {
      workflowId: args.workflowId,
      projectId: workflow.projectId,
      canceledBy: user._id,
    });

    return null;
  },
});
