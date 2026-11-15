import { v, type Infer } from "convex/values";
import { projectAgentAutomationValidator } from "../../lib/contracts/projectAgentAutomation";

export { projectAgentAutomationValidator };

export const agentAppearanceValidator = v.object({
  color: v.string(),
});

export const agentValidator = v.object({
  _id: v.id("agents"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  name: v.string(),
  description: v.optional(v.string()),
  prompt: v.optional(v.string()),
  category: v.optional(v.string()),
  appearance: agentAppearanceValidator,
  /** Always present in the API — legacy rows are defaulted to 1 on the way out (OS-1759). */
  version: v.number(),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

export const projectAgentValidator = v.object({
  _id: v.id("projectAgents"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  sourceAgentId: v.optional(v.id("agents")),
  name: v.string(),
  description: v.optional(v.string()),
  prompt: v.optional(v.string()),
  category: v.optional(v.string()),
  appearance: agentAppearanceValidator,
  automation: v.optional(projectAgentAutomationValidator),
  installedVersion: v.optional(v.number()),
  locallyEdited: v.optional(v.boolean()),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

export type AgentAppearance = Infer<typeof agentAppearanceValidator>;
export type Agent = Infer<typeof agentValidator>;
export type ProjectAgent = Infer<typeof projectAgentValidator>;
export type ProjectAgentAutomation = Infer<typeof projectAgentAutomationValidator>;
