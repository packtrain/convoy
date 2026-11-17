import { v, type Infer } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject, type AuthenticatedAccess } from "../lib/access/permissions";
import { getViewableThread } from "../cli/lib/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { validateTaskTypeKey } from "../lib/contracts/taskTypes";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, mapDefined } from "../lib/shared/patch";
import { resolveTaskTypeKey } from "@/lib/tasks/task-types";
import { getActiveTaskById } from "../tasks/lib/tasksRepo";
import { getUsersByIds } from "../users/lib/usersRepo";
import { checkResultStatusValidator, cliMessageAttachmentValidator } from "../lib/contracts/validators";
import { listCheckResultsByPullRequest, listCheckResultsByTask, listCheckResultsOwnedByThread } from "./lib/checkResultsRepo";
import { toAttachedPullRequest, type AttachedPullRequest } from "../lib/contracts/github";
import { findLinkedPullRequest } from "../integrations/github/lib/integrationPullRequestsRepo";
import { listActiveRepositoryLinksForProject } from "../integrations/github/lib/integrationRepositoryLinksRepo";
import { errors } from "./errors";
import { MAX_CHECKLISTS_PER_PROJECT, MAX_CHECKLIST_NAME_LENGTH } from "./lib/constants";
import { listCheckDefinitionsByProject } from "./lib/checkDefinitionsRepo";
import { deriveCheckRows } from "./lib/resolution";
import {
  deleteChecklist,
  findChecklistByNormalizedName,
  findTaskTypeDefault,
  getChecklistById,
  insertChecklist,
  listChecklistsByProject,
  normalizeChecklistName,
  updateChecklist,
  type ChecklistUpdatePatch,
} from "./lib/checklistsRepo";

const checklistValidator = v.object({
  _id: v.id("checklists"),
  name: v.string(),
  checkKeys: v.array(v.string()),
  taskTypeKeys: v.array(v.string()),
  /** The project's Pull request checklist (OS-2400). */
  pullRequests: v.boolean(),
});

const checkResultItemValidator = v.object({
  _id: v.id("checkResults"),
  messageId: v.id("cliMessages"),
  threadId: v.id("cliThreads"),
  threadTitle: v.string(),
  reporterName: v.string(),
  /** The viewer owns the reporting thread, so they may follow a link to it. */
  reportedByViewer: v.boolean(),
  status: checkResultStatusValidator,
  note: v.optional(v.string()),
  value: v.optional(v.string()),
  files: v.array(cliMessageAttachmentValidator),
  artifactId: v.optional(v.id("taskArtifacts")),
  artifactName: v.optional(v.string()),
  /** A PR's result: the head revision it was reported on. */
  headSha: v.optional(v.string()),
  /** Why GitHub has no check run for this PR result (OS-2401). */
  githubPublishError: v.optional(v.string()),
  reportedAt: v.number(),
});

const taskChecksValidator = v.object({
  checklists: v.array(
    v.object({
      _id: v.id("checklists"),
      name: v.string(),
      isDefault: v.boolean(),
      checkKeys: v.array(v.string()),
      taskTypeKeys: v.array(v.string()),
    })
  ),
  /** The checklist in effect; null when the task has no checks. */
  checklistId: v.union(v.id("checklists"), v.null()),
  /** No checklist picked, so a type change moves the task to the new type's default. */
  followsTypeDefault: v.boolean(),
  /** With the checklists' keys, lets the client re-derive rows after a type change. */
  catalog: v.array(v.object({ key: v.string(), label: v.string(), instruction: v.string() })),
  checks: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      instruction: v.string(),
      /** Reported outside the checklist in effect. */
      added: v.boolean(),
      /** Newest first: the first is current, the rest are history. */
      results: v.array(checkResultItemValidator),
    })
  ),
  /** Set when a PR owns the Checks: its current head, null while Convoy has no stored row for it. */
  pullRequest: v.optional(v.object({ headSha: v.union(v.string(), v.null()) })),
});

type TaskChecks = Infer<typeof taskChecksValidator>;

function validateName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  ensure(name).notEq("", errors.CHECKLIST_NAME_REQUIRED);
  ensure(name.length).lte(MAX_CHECKLIST_NAME_LENGTH, errors.checklistNameTooLong(MAX_CHECKLIST_NAME_LENGTH));
  return name;
}

async function validateCheckKeys(ctx: MutationCtx, projectId: Id<"projects">, checkKeys: string[]): Promise<string[]> {
  const catalog = new Set((await listCheckDefinitionsByProject(ctx, projectId)).map((definition) => definition.key));
  const unique = [...new Set(checkKeys)];
  for (const key of unique) {
    ensure(catalog.has(key)).isTrue(errors.checklistUnknownCheck(key));
  }
  return unique;
}

function validateTaskTypeKeys(taskTypeKeys: string[]): string[] {
  const unique = [...new Set(taskTypeKeys)];
  unique.forEach(validateTaskTypeKey);
  return unique;
}

async function assertNameFree(ctx: MutationCtx, projectId: Id<"projects">, name: string, selfId?: Id<"checklists">) {
  const existing = await findChecklistByNormalizedName(ctx, projectId, normalizeChecklistName(name));
  ensure(existing !== null && existing._id !== selfId).isFalse(errors.CHECKLIST_NAME_TAKEN);
}

/** A task type defaults to one checklist, and a project has one Pull request checklist, so claiming either here takes it off any other. */
async function releaseDefaults(
  ctx: MutationCtx,
  checklists: Doc<"checklists">[],
  selfId: Id<"checklists"> | null,
  claim: { taskTypeKeys: string[]; pullRequests: boolean },
  userId: Id<"users">
) {
  for (const other of checklists) {
    if (other._id === selfId) continue;
    const taskTypeKeys = other.taskTypeKeys.filter((key) => !claim.taskTypeKeys.includes(key));
    const releasesPullRequests = claim.pullRequests && other.pullRequests === true;
    if (taskTypeKeys.length === other.taskTypeKeys.length && !releasesPullRequests) continue;
    await updateChecklist(ctx, other._id, { taskTypeKeys, ...(releasesPullRequests ? { pullRequests: false } : {}) }, userId);
  }
}

async function requireChecklist(ctx: MutationCtx, id: Id<"checklists">): Promise<Doc<"checklists">> {
  return ensure(getChecklistById(ctx, id)).notNull(errors.CHECKLIST_NOT_FOUND);
}

/** The project's checklists in name order. */
export const list = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()) },
  returns: v.array(checklistValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth || !(await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.TASK_VIEW))) {
      return [];
    }
    const checklists = await listChecklistsByProject(ctx, args.projectId);
    return checklists.map(({ _id, name, checkKeys, taskTypeKeys, pullRequests }) => ({
      _id,
      name,
      checkKeys,
      taskTypeKeys,
      pullRequests: pullRequests === true,
    }));
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    checkKeys: v.array(v.string()),
    taskTypeKeys: v.array(v.string()),
    pullRequests: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("checklists"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);

    const name = validateName(args.name);
    const checkKeys = await validateCheckKeys(ctx, args.projectId, args.checkKeys);
    const taskTypeKeys = validateTaskTypeKeys(args.taskTypeKeys);

    const checklists = await listChecklistsByProject(ctx, args.projectId);
    ensure(checklists.length).lt(MAX_CHECKLISTS_PER_PROJECT, errors.checklistLimitReached(MAX_CHECKLISTS_PER_PROJECT));
    await assertNameFree(ctx, args.projectId, name);

    const pullRequests = args.pullRequests === true;
    await releaseDefaults(ctx, checklists, null, { taskTypeKeys, pullRequests }, user._id);
    return insertChecklist(ctx, { projectId: args.projectId, name, checkKeys, taskTypeKeys, pullRequests: pullRequests || undefined }, user._id);
  },
});

export const update = mutation({
  args: {
    checklistId: v.id("checklists"),
    name: v.optional(v.string()),
    checkKeys: v.optional(v.array(v.string())),
    taskTypeKeys: v.optional(v.array(v.string())),
    pullRequests: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const checklist = await requireChecklist(ctx, args.checklistId);
    await requireAuthorizedProject(ctx, principal, checklist.projectId, ProjectPermission.PROJECT_UPDATE);

    const name = mapDefined(args.name, validateName);
    if (name !== undefined) {
      await assertNameFree(ctx, checklist.projectId, name, checklist._id);
    }
    const checkKeys = args.checkKeys === undefined ? undefined : await validateCheckKeys(ctx, checklist.projectId, args.checkKeys);
    const taskTypeKeys = mapDefined(args.taskTypeKeys, validateTaskTypeKeys);
    if (taskTypeKeys !== undefined || args.pullRequests) {
      const claim = { taskTypeKeys: taskTypeKeys ?? [], pullRequests: args.pullRequests === true };
      await releaseDefaults(ctx, await listChecklistsByProject(ctx, checklist.projectId), checklist._id, claim, user._id);
    }

    const patch = buildPatch<ChecklistUpdatePatch>({
      name,
      normalizedName: mapDefined(name, normalizeChecklistName),
      checkKeys,
      taskTypeKeys,
      pullRequests: args.pullRequests,
    });
    if (Object.keys(patch).length > 0) {
      await updateChecklist(ctx, checklist._id, patch, user._id);
    }
    return null;
  },
});

/** Sets the default Checklist of each listed task type and the Pull request checklist in one transaction; unlisted types stay. */
export const setDefaults = mutation({
  args: {
    projectId: v.id("projects"),
    taskTypes: v.array(v.object({ key: v.string(), checklistId: v.union(v.id("checklists"), v.null()) })),
    pullRequests: v.union(v.id("checklists"), v.null()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const checklists = await listChecklistsByProject(ctx, args.projectId);
    const ids = new Set(checklists.map((checklist) => checklist._id));
    for (const { key, checklistId } of args.taskTypes) {
      validateTaskTypeKey(key);
      ensure(checklistId === null || ids.has(checklistId)).isTrue(errors.CHECKLIST_NOT_FOUND);
    }
    ensure(args.pullRequests === null || ids.has(args.pullRequests)).isTrue(errors.CHECKLIST_NOT_FOUND);

    const owners = new Map(args.taskTypes.map(({ key, checklistId }) => [key, checklistId]));
    for (const checklist of checklists) {
      const kept = checklist.taskTypeKeys.filter((key) => !owners.has(key) || owners.get(key) === checklist._id);
      const added = [...owners].flatMap(([key, owner]) => (owner === checklist._id && !kept.includes(key) ? [key] : []));
      const pullRequests = args.pullRequests === checklist._id;
      if (kept.length === checklist.taskTypeKeys.length && added.length === 0 && pullRequests === (checklist.pullRequests === true)) continue;
      await updateChecklist(ctx, checklist._id, { taskTypeKeys: [...kept, ...added], pullRequests }, user._id);
    }
    return null;
  },
});

/** Tasks that picked this checklist fall back to their type default on read. */
export const remove = mutation({
  args: { checklistId: v.id("checklists"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const checklist = await requireChecklist(ctx, args.checklistId);
    await requireAuthorizedProject(ctx, principal, checklist.projectId, ProjectPermission.PROJECT_UPDATE);
    await deleteChecklist(ctx, checklist._id);
    return null;
  },
});

/** The selector options, the Checklist in effect, and the derived rows for one owner of results. */
async function loadChecks(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  owner: {
    projectId: Id<"projects">;
    /** Unset follows the type default; a thread has no type, so it passes none. */
    taskTypeKey?: string;
    checklistId: Id<"checklists"> | null | undefined;
    results: Doc<"checkResults">[];
  }
): Promise<TaskChecks> {
  const { projectId, taskTypeKey, results } = owner;
  const [checklists, definitions] = await Promise.all([listChecklistsByProject(ctx, projectId), listCheckDefinitionsByProject(ctx, projectId)]);
  const typeDefault = taskTypeKey === undefined ? null : findTaskTypeDefault(checklists, taskTypeKey);
  // Unset, or a checklist deleted since it was picked, follows the type default.
  const picked = owner.checklistId === null ? null : checklists.find((checklist) => checklist._id === owner.checklistId);
  const current = picked === undefined ? typeDefault : picked;
  const catalog = definitions.map(({ key, label, instruction }) => ({ key, label, instruction }));

  const ownerIds = [...new Set(results.map((result) => result.threadOwnerId))];
  const owners = new Map((await getUsersByIds(ctx, ownerIds)).flatMap((user) => (user ? [[user._id, user.name]] : [])));
  const resultsByKey = new Map<string, Doc<"checkResults">[]>();
  for (const result of results) {
    resultsByKey.set(result.checkKey, [...(resultsByKey.get(result.checkKey) ?? []), result]);
  }
  const reported = [...resultsByKey].map(([key, keyResults]) => ({
    key,
    label: keyResults[0].label,
    results: keyResults.map((result) => ({
      _id: result._id,
      messageId: result.messageId,
      threadId: result.threadId,
      threadTitle: result.threadTitle,
      reporterName: owners.get(result.threadOwnerId) ?? "Unknown",
      reportedByViewer: result.threadOwnerId === viewerId,
      status: result.status,
      note: result.note,
      value: result.value,
      files: result.files,
      artifactId: result.artifactId,
      artifactName: result.artifactName,
      headSha: result.pullRequest?.headSha,
      githubPublishError: result.githubPublishError,
      reportedAt: result.reportedAt,
    })),
  }));

  return {
    checklists: checklists.map(({ _id, name, checkKeys, taskTypeKeys }) => ({
      _id,
      name,
      isDefault: _id === typeDefault?._id,
      checkKeys,
      taskTypeKeys,
    })),
    checklistId: current?._id ?? null,
    followsTypeDefault: picked === undefined && taskTypeKey !== undefined,
    catalog,
    checks: deriveCheckRows(current?.checkKeys ?? [], catalog, reported),
  };
}

async function loadTaskChecks(ctx: QueryCtx, auth: { user: Doc<"users">; principal: AuthenticatedAccess }, taskId: Id<"tasks">) {
  const task = await getActiveTaskById(ctx, taskId);
  if (!task || !(await authorizeProjectAccess(ctx, auth.principal, task.projectId, ProjectPermission.TASK_VIEW))) {
    return null;
  }
  return loadChecks(ctx, auth.user._id, {
    projectId: task.projectId,
    taskTypeKey: resolveTaskTypeKey(task.taskTypeKey),
    checklistId: task.checklistId,
    results: await listCheckResultsByTask(ctx, task._id),
  });
}

/** A task's checklist choice and its derived rows with their results (docs/specs/task-checks.md → Which Checks apply). */
export const getForTask = query({
  args: { taskId: v.id("tasks"), apiKey: v.optional(v.string()) },
  returns: v.union(taskChecksValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    return auth ? loadTaskChecks(ctx, auth, args.taskId) : null;
  },
});

/** The thread's task's Checks, or, with no task, the thread's own Checklist and results (docs/specs/task-checks.md → Ownership). */
export const getForThread = query({
  args: { threadId: v.id("cliThreads"), apiKey: v.optional(v.string()) },
  returns: v.union(taskChecksValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    const viewable = auth ? await getViewableThread(ctx, auth.principal, args.threadId) : null;
    if (!auth || !viewable) {
      return null;
    }
    const { thread } = viewable;
    if (thread.pullRequestChecks && thread.attachedPullRequest) {
      return loadPullRequestChecks(ctx, auth.user._id, thread.projectId, thread.attachedPullRequest);
    }
    if (thread.associatedTaskId) {
      return loadTaskChecks(ctx, auth, thread.associatedTaskId);
    }
    return loadChecks(ctx, auth.user._id, {
      projectId: thread.projectId,
      checklistId: thread.checklistId ?? null,
      results: await listCheckResultsOwnedByThread(ctx, thread._id),
    });
  },
});

/** A PR's Checks: the project's Pull request checklist and the PR's results on every head (OS-2400). */
async function loadPullRequestChecks(
  ctx: QueryCtx,
  viewerId: Id<"users">,
  projectId: Id<"projects">,
  pullRequest: AttachedPullRequest
): Promise<TaskChecks> {
  const [checklists, links, results] = await Promise.all([
    listChecklistsByProject(ctx, projectId),
    listActiveRepositoryLinksForProject(ctx, projectId),
    listCheckResultsByPullRequest(ctx, projectId, pullRequest.ref),
  ]);
  const row = await findLinkedPullRequest(ctx, links, pullRequest);
  const checks = await loadChecks(ctx, viewerId, {
    projectId,
    checklistId: checklists.find((checklist) => checklist.pullRequests)?._id ?? null,
    results,
  });
  return { ...checks, pullRequest: { headSha: row?.headSha ?? null } };
}

/** The Pull request checks of a PR in one of the project's connected repositories (docs/specs/github-integration.md → Pull request checks). */
export const getForPullRequest = query({
  args: { projectId: v.id("projects"), owner: v.string(), name: v.string(), number: v.number() },
  returns: v.union(taskChecksValidator, v.null()),
  handler: async (ctx, args) => {
    // Whoever can read the PR reads its results: project access and the project's own active link.
    const auth = await getOptionalAuthenticatedAccess(ctx);
    const access = auth ? await authorizeProjectAccess(ctx, auth.principal, args.projectId, ProjectPermission.PROJECT_VIEW) : null;
    const links = access ? await listActiveRepositoryLinksForProject(ctx, args.projectId) : [];
    const row = await findLinkedPullRequest(ctx, links, args);
    if (!auth || !row) {
      return null;
    }
    return loadPullRequestChecks(ctx, auth.user._id, args.projectId, toAttachedPullRequest(args));
  },
});
