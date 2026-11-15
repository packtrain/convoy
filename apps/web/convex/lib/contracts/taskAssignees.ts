import { v, type Infer } from "convex/values";

// Split model (OS-1335): the assignee is the human accountable for the task,
// delegation is the agent executing it.
export const taskUserAssigneeDetailsValidator = v.union(
  v.object({
    type: v.literal("user"),
    userId: v.id("users"),
    name: v.union(v.string(), v.null()),
    avatarUrl: v.union(v.string(), v.null()),
  }),
  v.null()
);
export type TaskUserAssigneeDetails = Infer<typeof taskUserAssigneeDetailsValidator>;

export const taskDelegatedAgentDetailsValidator = v.union(
  v.object({
    type: v.literal("projectAgent"),
    projectAgentId: v.id("projectAgents"),
    name: v.string(),
    appearance: v.object({
      color: v.string(),
    }),
    isDeleted: v.boolean(),
  }),
  v.null()
);
export type TaskDelegatedAgentDetails = Infer<typeof taskDelegatedAgentDetailsValidator>;

// Stored activity rows reference this shape forever (legacy agent-assignment
// events included), so it stays even though new events are user-only.
export const taskAssigneeActivityValueValidator = v.union(
  v.object({
    type: v.literal("user"),
    userId: v.id("users"),
    name: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("projectAgent"),
    projectAgentId: v.id("projectAgents"),
    name: v.optional(v.string()),
  })
);
export type TaskAssigneeActivityValue = Infer<typeof taskAssigneeActivityValueValidator>;
