import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  TaskAssigneeActivityValue,
  TaskDelegatedAgentDetails,
  TaskUserAssigneeDetails,
} from "../../lib/contracts/taskAssignees";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { getProjectAgentById, getProjectAgentsByIds } from "../../agents/lib/projectAgentsRepo";
import { getUserById, getUsersByIds } from "../../users/lib/usersRepo";
import { errors } from "../errors";
import type { AssigneeIdInput } from "./validators";

type Ctx = QueryCtx | MutationCtx;

const DELETED_AGENT_APPEARANCE = { color: AGENT_COLOR_PALETTE[0] };

/**
 * Split assignment model (OS-1335): `assigneeId` is the human accountable for
 * the task, `delegatedToAgentId` the agent executing it. An agent never owns a
 * task.
 */
export type TaskAssigneeSplit = {
  assigneeId: Id<"users"> | undefined;
  delegatedToAgentId: Id<"projectAgents"> | undefined;
};

/** Tri-state mutation args: `undefined` = don't change, `null` = clear. */
export type TaskAssigneeSplitArgs = {
  assigneeId?: Id<"users"> | null;
  delegatedToAgentId?: Id<"projectAgents"> | null;
};

/** Swap the `"me"` assignee arg for the caller's user ID. */
export function resolveMeAssignee(
  assigneeId: AssigneeIdInput | undefined,
  callerId: Id<"users">
): Id<"users"> | null | undefined {
  return assigneeId === "me" ? callerId : assigneeId;
}

export function hasAssigneeSplitUpdate(args: TaskAssigneeSplitArgs): boolean {
  return args.assigneeId !== undefined || args.delegatedToAgentId !== undefined;
}

export function getTaskAssigneeSplit(
  task: Pick<Doc<"tasks">, "assigneeId" | "delegatedToAgentId">
): TaskAssigneeSplit {
  return { assigneeId: task.assigneeId, delegatedToAgentId: task.delegatedToAgentId };
}

/** Merge provided tri-state args over the current split. */
export function resolveAssigneeSplit(current: TaskAssigneeSplit, args: TaskAssigneeSplitArgs): TaskAssigneeSplit {
  return {
    assigneeId: args.assigneeId === undefined ? current.assigneeId : (args.assigneeId ?? undefined),
    delegatedToAgentId:
      args.delegatedToAgentId === undefined ? current.delegatedToAgentId : (args.delegatedToAgentId ?? undefined),
  };
}

/**
 * Auto-set-owner rule (OS-1335): delegating a task with no owner assigns the
 * acting user as owner, unless the same call explicitly set `assigneeId`
 * (including `null`, the escape hatch that keeps the task ownerless).
 */
export function applyAutoSetOwner(args: {
  splitArgs: TaskAssigneeSplitArgs;
  currentAssigneeId: Id<"users"> | undefined;
  actingUserId: Id<"users">;
}): TaskAssigneeSplitArgs {
  const { splitArgs, currentAssigneeId, actingUserId } = args;
  const isDelegating = splitArgs.delegatedToAgentId !== undefined && splitArgs.delegatedToAgentId !== null;
  const ownerExplicit = splitArgs.assigneeId !== undefined;
  if (!isDelegating || ownerExplicit || currentAssigneeId !== undefined) {
    return splitArgs;
  }
  return { ...splitArgs, assigneeId: actingUserId };
}

export async function assertAssignableProjectAgent(
  ctx: Ctx,
  projectId: Id<"projects">,
  delegatedToAgentId: Id<"projectAgents"> | null | undefined
): Promise<void> {
  if (delegatedToAgentId == null) {
    return;
  }

  const projectAgent = await getProjectAgentById(ctx, delegatedToAgentId);
  if (!projectAgent || projectAgent.isDeleted) {
    throw new ConvexError(errors.PROJECT_AGENT_ASSIGNEE_NOT_FOUND);
  }

  if (projectAgent.projectId !== projectId) {
    throw new ConvexError(errors.PROJECT_AGENT_ASSIGNEE_DIFFERENT_PROJECT);
  }
}

function buildUserAssigneeDetails(userId: Id<"users">, user: Doc<"users"> | null): TaskUserAssigneeDetails {
  return {
    type: "user",
    userId,
    name: user?.name ?? null,
    avatarUrl: user?.avatarUrl ?? null,
  };
}

function buildDelegatedAgentDetails(
  projectAgentId: Id<"projectAgents">,
  projectAgent: Doc<"projectAgents"> | null
): TaskDelegatedAgentDetails {
  return {
    type: "projectAgent",
    projectAgentId,
    name: projectAgent && !projectAgent.isDeleted ? projectAgent.name : "Deleted agent",
    appearance: projectAgent && !projectAgent.isDeleted ? projectAgent.appearance : DELETED_AGENT_APPEARANCE,
    isDeleted: projectAgent?.isDeleted ?? true,
  };
}

export function userAssigneeDetailsToActivityValue(
  assignee: TaskUserAssigneeDetails
): TaskAssigneeActivityValue | undefined {
  if (!assignee) {
    return undefined;
  }
  return {
    type: "user",
    userId: assignee.userId,
    name: assignee.name ?? undefined,
  };
}

export async function hydrateTaskAssigneeUser(
  ctx: Ctx,
  assigneeId: Id<"users"> | undefined
): Promise<TaskUserAssigneeDetails> {
  if (!assigneeId) {
    return null;
  }
  const user = await getUserById(ctx, assigneeId);
  return buildUserAssigneeDetails(assigneeId, user);
}

export async function hydrateDelegatedAgent(
  ctx: Ctx,
  delegatedToAgentId: Id<"projectAgents"> | undefined
): Promise<TaskDelegatedAgentDetails> {
  if (!delegatedToAgentId) {
    return null;
  }
  const projectAgent = await getProjectAgentById(ctx, delegatedToAgentId);
  return buildDelegatedAgentDetails(delegatedToAgentId, projectAgent);
}

export type TaskAssigneeSplitDetails = {
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
};

export async function hydrateTaskAssigneeSplits(
  ctx: Ctx,
  tasks: Doc<"tasks">[]
): Promise<Map<Id<"tasks">, TaskAssigneeSplitDetails>> {
  const userIds = new Set<Id<"users">>();
  const projectAgentIds = new Set<Id<"projectAgents">>();

  for (const task of tasks) {
    const split = getTaskAssigneeSplit(task);
    if (split.assigneeId) {
      userIds.add(split.assigneeId);
    }
    if (split.delegatedToAgentId) {
      projectAgentIds.add(split.delegatedToAgentId);
    }
  }

  const [users, projectAgents] = await Promise.all([
    getUsersByIds(ctx, Array.from(userIds)),
    getProjectAgentsByIds(ctx, Array.from(projectAgentIds)),
  ]);

  const userMap = new Map(users.filter((user): user is Doc<"users"> => user !== null).map((user) => [user._id, user]));
  const projectAgentMap = new Map(
    projectAgents
      .filter((projectAgent): projectAgent is Doc<"projectAgents"> => projectAgent !== null)
      .map((projectAgent) => [projectAgent._id, projectAgent])
  );

  const result = new Map<Id<"tasks">, TaskAssigneeSplitDetails>();
  for (const task of tasks) {
    const split = getTaskAssigneeSplit(task);
    result.set(task._id, {
      assignee: split.assigneeId
        ? buildUserAssigneeDetails(split.assigneeId, userMap.get(split.assigneeId) ?? null)
        : null,
      delegatedToAgent: split.delegatedToAgentId
        ? buildDelegatedAgentDetails(split.delegatedToAgentId, projectAgentMap.get(split.delegatedToAgentId) ?? null)
        : null,
    });
  }

  return result;
}
