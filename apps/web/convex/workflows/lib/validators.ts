import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { workflowDefinitionValidator } from "../../lib/contracts/workflowDefinition";

const workflowIdentityFields = {
  _id: v.id("workflows"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  name: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  color: v.optional(v.string()),
  dirtySinceLastVersion: v.boolean(),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
} as const;

// Identity only — never the draft definition, so list invalidations stay small
// (see the OS-1365 plan → Reactivity & cost).
export const workflowSummaryValidator = v.object(workflowIdentityFields);

export const workflowValidator = v.object({
  ...workflowIdentityFields,
  draftDefinition: workflowDefinitionValidator,
});

export type WorkflowSummary = Infer<typeof workflowSummaryValidator>;
export type Workflow = Infer<typeof workflowValidator>;

export function toWorkflowSummary(workflow: Doc<"workflows">): WorkflowSummary {
  return {
    _id: workflow._id,
    _creationTime: workflow._creationTime,
    projectId: workflow.projectId,
    name: workflow.name,
    description: workflow.description,
    category: workflow.category,
    color: workflow.color,
    dirtySinceLastVersion: workflow.dirtySinceLastVersion,
    createdBy: workflow.createdBy,
    updatedBy: workflow.updatedBy,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function toWorkflow(workflow: Doc<"workflows">): Workflow {
  return {
    ...toWorkflowSummary(workflow),
    draftDefinition: workflow.draftDefinition,
  };
}
