import { v, type Infer } from "convex/values";
import { paginationResultValidator } from "convex/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { priorityValidator, statusValidator } from "../../lib/contracts/validators";
import { taskDelegatedAgentDetailsValidator, taskUserAssigneeDetailsValidator } from "../../lib/contracts/taskAssignees";
import { taskExternalLinkValidator } from "../../lib/contracts/taskExternalLinks";
import { agentThreadWorkEntryValidator } from "../../lib/contracts/agentThreadWork";
import { taskTypeSummaryValidator } from "../../lib/contracts/taskTypes";
import { mcpTaskListSummaryValidator, structuredTaskListValidator } from "./lists/validators";
import type { Status } from "@/lib/tasks/status";
import type { Priority } from "@/lib/tasks/priority";

export type TaskUpdateFields = {
  name?: string;
  taskTypeKey?: string;
  description?: string;
  searchText?: string;
  priority?: Priority;
  dueDate?: number;
  status?: Status;
  listKey?: string;
  rank?: string;
  parentId?: Id<"tasks">;
  assigneeId?: Id<"users">;
  delegatedToAgentId?: Id<"projectAgents">;
  tags?: string[];
  labelId?: Id<"projectLabels">;
  sectionId?: Id<"taskSections">;
};

export type TaskSearchFilters = {
  status?: Status;
  assigneeId?: Id<"users"> | null;
  delegatedToAgentId?: Id<"projectAgents"> | null;
};

export type SearchableTask = Pick<Doc<"tasks">, "refNumber" | "name" | "description" | "tags">;

export type GetByRefLookupResult = {
  ref: string;
  taskDoc: Doc<"tasks"> | null;
  error?: string;
};

export const archiveTasksReturnValidator = v.object({
  archivedRootIds: v.array(v.id("tasks")),
});

export const createTaskResultValidator = v.object({
  taskId: v.id("tasks"),
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  projectAlias: v.string(),
  refNumber: v.number(),
  refId: v.string(),
});

export const projectLabelValidator = v.object({
  _id: v.id("projectLabels"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  name: v.string(),
  color: v.string(),
  rank: v.string(),
});

export type ProjectLabelReturn = Infer<typeof projectLabelValidator>;

export const taskReturnValidator = v.object({
  _id: v.id("tasks"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  parentId: v.union(v.id("tasks"), v.null()),
  clientId: v.string(),
  refNumber: v.number(),
  refId: v.string(),
  name: v.string(),
  description: v.union(v.string(), v.null()),
  priority: priorityValidator,
  dueDate: v.union(v.number(), v.null()),
  status: statusValidator,
  list: v.union(structuredTaskListValidator, v.null()),
  assignee: taskUserAssigneeDetailsValidator,
  delegatedToAgent: taskDelegatedAgentDetailsValidator,
  tags: v.array(v.string()),
  labelId: v.union(v.id("projectLabels"), v.null()),
  sectionId: v.union(v.id("taskSections"), v.null()),
  checklistId: v.optional(v.union(v.id("checklists"), v.null())),
  externalLinks: v.array(taskExternalLinkValidator),
  agentThreadWork: v.optional(v.array(agentThreadWorkEntryValidator)),
  attachmentCount: v.number(),
  artifactCount: v.number(),
  rank: v.string(),
  createdBy: v.id("users"),
  createdByName: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  taskType: taskTypeSummaryValidator,
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
  scheduledDeletionId: v.optional(v.id("_scheduled_functions")),
  isArchived: v.boolean(),
  archivedAt: v.optional(v.number()),
  archivedBy: v.optional(v.id("users")),
});

const taskSearchResultValidator = v.object({
  _id: v.id("tasks"),
  parentId: v.union(v.id("tasks"), v.null()),
  refId: v.string(),
  name: v.string(),
  list: v.union(structuredTaskListValidator, v.null()),
  taskType: taskTypeSummaryValidator,
  status: statusValidator,
  priority: priorityValidator,
  assignee: taskUserAssigneeDetailsValidator,
  delegatedToAgent: taskDelegatedAgentDetailsValidator,
  createdByName: v.union(v.string(), v.null()),
  isArchived: v.boolean(),
});

export const taskSearchResponseValidator = paginationResultValidator(taskSearchResultValidator);

export const deleteTasksResultValidator = v.object({
  deletedIds: v.array(v.id("tasks")),
});

export const moveToListResultValidator = v.object({
  taskIds: v.array(v.id("tasks")),
  list: mcpTaskListSummaryValidator,
});

export const paginatedTaskResultValidator = v.object({
  page: v.array(taskReturnValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  splitCursor: v.optional(v.union(v.string(), v.null())),
});

export const getByRefsResultValidator = v.object({
  results: v.array(
    v.object({
      ref: v.string(),
      task: v.union(taskReturnValidator, v.null()),
      error: v.optional(v.string()),
    })
  ),
});

export type TaskReturn = Infer<typeof taskReturnValidator>;

export const taskSectionValidator = v.object({
  _id: v.id("taskSections"),
  name: v.string(),
  color: v.union(v.string(), v.null()),
  rank: v.string(),
});

export type TaskSection = Infer<typeof taskSectionValidator>;

export function toTaskSection(section: Doc<"taskSections">): TaskSection {
  return { _id: section._id, name: section.name, color: section.color ?? null, rank: section.rank };
}
