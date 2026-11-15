import { v, type Infer } from "convex/values";
import { slashCommandComposerDocumentValidator } from "./slashCommands";

// The structured composer contract: display text plus unexpanded slash-command
// refs, expanded on the normal send path. Shared by project-agent automation
// prompts and Workflow Prompt steps (docs/specs/workflow-data-schema.md).
export const composerContentValidator = v.object({
  displayContent: v.string(),
  composerDocument: v.optional(slashCommandComposerDocumentValidator),
});

export type ComposerContent = Infer<typeof composerContentValidator>;
