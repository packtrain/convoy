import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { normalizeChecklistName } from "../../checks/lib/checklistsRepo";
import { should, throwInvalidParams } from "../lib/should";
import { resolveTaskIdOrRef } from "../lib/tasks/resolution";
import { pickChecklist, toMcpTaskCheck } from "../lib/tasks/resources";
import type { ToolHandler } from "./context";

/** Resolve a check ID or key to a check ID. */
async function resolveCheckId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string
): Promise<Id<"checkDefinitions">> {
  const checks = await ctx.runQuery(api.checks.definitions.list, { projectId, apiKey });
  const check = checks.find((c) => c._id === identifier || c.key === identifier);
  if (!check) {
    throwInvalidParams(`checkId "${identifier}" does not match any check in the project (use list_checks for discovery)`);
  }
  return check._id;
}

/** Resolve a checklist ID or exact (case/whitespace-insensitive) name to a checklist ID. */
export async function resolveChecklistId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string,
  key: string
): Promise<Id<"checklists">> {
  const checklists = await ctx.runQuery(api.checks.checklists.list, { projectId, apiKey });
  const normalized = normalizeChecklistName(identifier);
  const checklist = checklists.find((c) => c._id === identifier || normalizeChecklistName(c.name) === normalized);
  if (!checklist) {
    throwInvalidParams(`${key} "${identifier}" does not match any checklist in the project (use list_checklists for discovery)`);
  }
  return checklist._id;
}

export const handleListChecks: ToolHandler = async ({ ctx, apiKey, getProjectId }) => {
  const projectId = await getProjectId();
  return { checks: await ctx.runQuery(api.checks.definitions.list, { projectId, apiKey }) };
};

/** The Checks that apply to a task, or to a thread (its task's, or its own with no task), with instructions (docs/specs/task-checks.md → Agents). */
export const handleGetChecks: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  if ((args.taskId === undefined) === (args.threadId === undefined)) {
    throwInvalidParams("Pass exactly one of taskId or threadId");
  }
  const forThread = async (threadId: Id<"cliThreads">) => {
    const thread = await ctx.runQuery(api.cli.threads.summaries.getSummary, { threadId, apiKey });
    if (!thread) throwInvalidParams("Thread not found");
    // A thread with no task has its own Checks (OS-2293).
    return { taskId: thread.associatedTaskId ?? null, taskChecks: await ctx.runQuery(api.checks.checklists.getForThread, { threadId, apiKey }) };
  };
  const forTask = async () => {
    const taskId = await resolveTaskIdOrRef(ctx, apiKey, should.beString(args, "taskId"), "taskId", getProjectId);
    return { taskId, taskChecks: await ctx.runQuery(api.checks.checklists.getForTask, { taskId, apiKey }) };
  };
  const { taskId, taskChecks } = args.threadId !== undefined ? await forThread(should.beId<"cliThreads">(args, "threadId")) : await forTask();
  if (!taskChecks) throwInvalidParams("Task not found");
  return {
    taskId,
    checklist: pickChecklist(taskChecks.checklists, taskChecks.checklistId),
    checks: taskChecks.checks.map((check) => ({
      ...toMcpTaskCheck(check),
      ...(check.instruction && { instruction: check.instruction }),
    })),
  };
};

export const handleCreateCheck: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const checkId = await ctx.runMutation(api.checks.definitions.create, {
    projectId,
    key: should.beTrimmedString(args, "key"),
    label: should.beTrimmedString(args, "label"),
    instruction: should.beOptionalString(args, "instruction") ?? "",
    apiKey,
  });
  return { checkId };
};

export const handleUpdateCheck: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  if (args.key !== undefined) {
    throwInvalidParams("A check's key cannot change; delete the check and create a new one");
  }
  const projectId = await getProjectId();
  const checkId = await resolveCheckId(ctx, apiKey, projectId, should.beTrimmedString(args, "checkId"));
  const label = should.beOptionalString(args, "label");
  const instruction = should.beOptionalString(args, "instruction");
  await ctx.runMutation(api.checks.definitions.update, {
    checkId,
    ...(label !== undefined && { label }),
    ...(instruction !== undefined && { instruction }),
    apiKey,
  });
  return { checkId };
};

export const handleDeleteCheck: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const checkId = await resolveCheckId(ctx, apiKey, projectId, should.beTrimmedString(args, "checkId"));
  await ctx.runMutation(api.checks.definitions.remove, { checkId, apiKey });
  return { checkId };
};

export const handleListChecklists: ToolHandler = async ({ ctx, apiKey, getProjectId }) => {
  const projectId = await getProjectId();
  return { checklists: await ctx.runQuery(api.checks.checklists.list, { projectId, apiKey }) };
};

export const handleCreateChecklist: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const checklistId = await ctx.runMutation(api.checks.checklists.create, {
    projectId,
    name: should.beTrimmedString(args, "name"),
    checkKeys: should.beOptionalStringArray(args, "checkKeys") ?? [],
    taskTypeKeys: should.beOptionalStringArray(args, "taskTypeKeys") ?? [],
    apiKey,
  });
  return { checklistId };
};

export const handleUpdateChecklist: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const checklistId = await resolveChecklistId(ctx, apiKey, projectId, should.beTrimmedString(args, "checklistId"), "checklistId");
  const name = should.beOptionalString(args, "name");
  const checkKeys = should.beOptionalStringArray(args, "checkKeys");
  const taskTypeKeys = should.beOptionalStringArray(args, "taskTypeKeys");
  await ctx.runMutation(api.checks.checklists.update, {
    checklistId,
    ...(name !== undefined && { name }),
    ...(checkKeys !== undefined && { checkKeys }),
    ...(taskTypeKeys !== undefined && { taskTypeKeys }),
    apiKey,
  });
  return { checklistId };
};

export const handleDeleteChecklist: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const checklistId = await resolveChecklistId(ctx, apiKey, projectId, should.beTrimmedString(args, "checklistId"), "checklistId");
  await ctx.runMutation(api.checks.checklists.remove, { checklistId, apiKey });
  return { checklistId };
};
