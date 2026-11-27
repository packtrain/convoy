import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  getPrincipalUserId,
  hasProjectAccess,
  requireAuthorizedProject,
  type ProjectAccessPrincipal,
} from "../../lib/access/permissions";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { ensure } from "../../lib/shared/ensure";
import { getActiveTaskById } from "../../tasks/lib/tasksRepo";
import { getMessageById } from "./cliMessagesRepo";
import { getCliProfileById } from "./cliProfilesRepo";
import { getSessionById } from "./cliSessionsRepo";
import { getThreadById } from "../threads/lib/cliThreadsRepo";
import { errors } from "../errors";
import { assertThreadClaimedBySession } from "./claims";

type Ctx = QueryCtx | MutationCtx;

/** Gate workspace reads and writes on the live claim. Spec: cli-worktrees.md. */
export async function requireThreadClaimedBySession(
  ctx: Ctx,
  principal: ProjectAccessPrincipal,
  threadId: Id<"cliThreads">,
  sessionId: Id<"cliSessions">,
) {
  const userId = getPrincipalUserId(principal);
  const { session, profile } = await requireSessionWithProfile(ctx, userId, sessionId);
  const thread = await ensure(getThreadById(ctx, threadId)).notDeleted(errors.THREAD_NOT_FOUND);
  ensure(thread.userId).eq(userId, errors.NOT_AUTHORIZED);
  ensure(thread.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
  await assertThreadClaimedBySession(ctx, thread, sessionId);
  await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
  return { thread, session, profile };
}

export async function getAccessibleThread(
  ctx: Ctx,
  userId: Id<"users">,
  threadId: Id<"cliThreads">
): Promise<Doc<"cliThreads"> | null> {
  const thread = await getThreadById(ctx, threadId);
  if (!thread || thread.isDeleted) {
    return null;
  }
  if (thread.userId !== userId) {
    return null;
  }
  return thread;
}

/**
* Resolve a thread the caller may *read*: the owner, or a project teammate with `CLI_THREAD`
* once shared (OS-1574). A group is shared as a unit (OS-1579) — `sharedAt` sits on the
* container and covers every child. Read paths only; writes stay on `getAccessibleThread` /
* `requireThreadOwnership`, which keeps sharing read-only.
*
* The check order is load-bearing: the shared gate precedes the project check so an unshared
* thread costs a stranger no membership lookup, and the container read is last and only for a
* non-owner — an owner's subscriptions must not depend on a doc every Group child rewrites.
*
* Takes a `ProjectAccessPrincipal`, not a user id, so an API key's scope reaches the project
* check. Bare-`user._id` call sites are legacy and enforce nothing; narrow the parameter to
* `AuthenticatedAccess` once all are converted.
*/
export async function getViewableThread(
  ctx: Ctx,
  principal: ProjectAccessPrincipal,
  threadId: Id<"cliThreads">
): Promise<{ thread: Doc<"cliThreads">; isOwner: boolean } | null> {
  const thread = await getThreadById(ctx, threadId);
  if (!thread || thread.isDeleted) {
    return null;
  }

  const isOwner = thread.userId === getPrincipalUserId(principal);
  if (!isOwner && !(await isSharedForViewer(ctx, thread))) {
    return null;
  }

  const hasAccess = await hasProjectAccess(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
  if (!hasAccess) {
    return null;
  }

  return { thread, isOwner };
}

/**
 * Is this thread covered by a share — its own, or its group's? A deleted or
 * missing container fails closed, so dissolving a group revokes its links.
 *
 * Plain groups only. `share` already rejects run containers (OS-1366), but this
 * is the single seam deciding cross-user reads, so it re-checks rather than
 * leaning on a mutation-side invariant.
 */
export async function isSharedForViewer(ctx: Ctx, thread: Doc<"cliThreads">): Promise<boolean> {
  if (thread.sharedAt !== undefined) {
    return true;
  }
  if (!thread.parentThreadId) {
    return false;
  }
  const container = await getThreadById(ctx, thread.parentThreadId);
  return (
    !!container &&
    !container.isDeleted &&
    container.kind === "group" &&
    container.workflowRunId === undefined &&
    container.sharedAt !== undefined
  );
}

export async function requireThreadOwnership(
  ctx: Ctx,
  userId: Id<"users">,
  threadId: Id<"cliThreads">
): Promise<Doc<"cliThreads">> {
  const thread = await getThreadById(ctx, threadId);
  if (!thread || thread.isDeleted) {
    throw new ConvexError("Thread not found");
  }
  if (thread.userId !== userId) {
    throw new ConvexError("Not authorized");
  }
  return thread;
}

export async function requireMessageOwnership(
  ctx: Ctx,
  userId: Id<"users">,
  messageId: Id<"cliMessages">
): Promise<{ message: Doc<"cliMessages">; thread: Doc<"cliThreads"> }> {
  const message = await getMessageById(ctx, messageId);
  if (!message) {
    throw new ConvexError("Message not found");
  }

  const thread = await getThreadById(ctx, message.threadId);
  if (!thread || thread.isDeleted) {
    throw new ConvexError("Thread not found");
  }

  if (thread.userId !== userId) {
    throw new ConvexError("Not authorized");
  }

  return { message, thread };
}

export async function requireSessionOwnership(
  ctx: Ctx,
  userId: Id<"users">,
  sessionId: Id<"cliSessions">
): Promise<Doc<"cliSessions">> {
  const { session } = await requireSessionWithProfile(ctx, userId, sessionId);
  return session;
}

async function requireSessionWithProfile(
  ctx: Ctx,
  userId: Id<"users">,
  sessionId: Id<"cliSessions">
) {
  const session = await getSessionById(ctx, sessionId);
  if (!session) {
    throw new ConvexError("Session not found");
  }

  const profile = await getCliProfileById(ctx, session.profileId);
  if (!profile || profile.isDeleted) {
    throw new ConvexError("Profile not found");
  }

  if (profile.userId !== userId) {
    throw new ConvexError("Not authorized");
  }

  return { session, profile };
}

export function assertThreadOwnedByUser(
  thread: Doc<"cliThreads">,
  userId: Id<"users">
): void {
  if (thread.userId !== userId) {
    throw new ConvexError("Not authorized");
  }
}

export async function requireMessageClaimedBySession(
  ctx: Ctx,
  messageId: Id<"cliMessages">,
  sessionId: Id<"cliSessions">
): Promise<Doc<"cliMessages">> {
  const message = await getMessageById(ctx, messageId);
  if (!message) {
    throw new ConvexError("Message not found");
  }

  if (message.claimedBySessionId !== sessionId) {
    throw new ConvexError("Message not claimed by this session");
  }

  return message;
}

/**
 * `principal` takes a bare user id or an authenticated access pair (OS-1162).
 * API-key callers must pass the pair: this authorizes a second project
 * permission, so a bare id would resolve the key's scope and then not apply it.
 */
export async function requireAccessibleCliTask(
  ctx: MutationCtx,
  principal: ProjectAccessPrincipal,
  taskId: Id<"tasks">,
  expectedProjectId: Id<"projects">,
): Promise<Doc<"tasks">> {
  const task = await getActiveTaskById(ctx, taskId);
  if (!task || task.isDeleted || task.projectId !== expectedProjectId) {
    throw new ConvexError("Task not found");
  }

  await requireAuthorizedProject(
    ctx,
    principal,
    expectedProjectId,
    ProjectPermission.TASK_VIEW,
    { convexErrorMessage: "Task not found" },
  );

  return task;
}
