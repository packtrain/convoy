"use client";

import { useState } from "react";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import type { ThreadAgentSelectorAgent } from "@/components/blocks/thread/thread-agent-selector";
import type { Id } from "@/convex/_generated/dataModel";
import type { LaneDefinition } from "@/convex/lib/contracts/workflowDefinition";
import type { CliModel, CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import { buildComposerJsonFromPromptContent, type ThreadComposerDocument } from "@/lib/slash-commands/composer";
import { useComposerRuntimeOverrides } from "@/lib/threads/hooks/use-composer-runtime-overrides";
import { laneEffectiveCliType } from "@/lib/workflows/draft";

/** The project context the prompt composer resolves its slash-command catalog against. */
export interface StepComposerContext {
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
}

export interface PromptDraft {
  text: string;
  document: ThreadComposerDocument;
  projectAgentId?: Id<"projectAgents">;
  cliType?: CliTypeSlug;
  cliModel?: CliModel;
  cliEffort?: string;
  mode?: string;
}

const NOOP_SUBMIT = () => {};

/**
 * The real thread composer in config mode, the same reuse the project-agent
 * automation form makes. A single Lane hides the runtime selector — the
 * Lane owns runtime/model/effort, mode is the only step override; a Parallel
 * Lane edits the full overrides, Project agent included, since each of its
 * Prompts starts its own thread (project-settings.md → Workflows).
 */
export function WorkflowStepPromptComposer({
  composer,
  projectAgents,
  lane,
  value,
  onChange,
}: {
  composer: StepComposerContext;
  /** Offered as a Parallel-Lane step's Project-agent override. */
  projectAgents?: ThreadAgentSelectorAgent[];
  lane?: LaneDefinition;
  value: PromptDraft;
  onChange: React.Dispatch<React.SetStateAction<PromptDraft>>;
}) {
  // Seeded once on mount — the editor owns the content afterwards.
  const [initialPromptContent] = useState(() => buildComposerJsonFromPromptContent(value.text, value.document.refs));
  const patch = (fields: Partial<PromptDraft>) => onChange((prev) => ({ ...prev, ...fields }));
  const isParallel = lane?.type === "parallel";
  const runtimeSelectors = useComposerRuntimeOverrides(
    value,
    patch,
    isParallel ? undefined : laneEffectiveCliType(lane)
  );

  return (
    <ThreadComposer
      projectId={composer.projectId}
      organizationId={composer.organizationId}
      onSubmit={NOOP_SUBMIT}
      textareaPlaceholder="Prompt for the lane's agent. Type / to insert a saved prompt."
      textareaClassName="min-h-24"
      containerClassName="p-0"
      contentClassName="max-w-none"
      initialInput={value.text}
      initialComposerContent={initialPromptContent}
      onInputChange={(text) => patch({ text })}
      onComposerDocumentChange={(document) => patch({ document })}
      hideAttachmentTools
      hideSubmit
      selectorsProps={{
        hideWorkingDirectory: true,
        profiles: [],
        profileId: "",
        pathId: "",
        ...runtimeSelectors,
        ...(isParallel
          ? {
              projectAgents: projectAgents ?? [],
              projectAgentId: value.projectAgentId,
              onProjectAgentChange: (projectAgentId: string | undefined) =>
                patch({ projectAgentId: projectAgentId as Id<"projectAgents"> | undefined }),
            }
          : {}),
      }}
    />
  );
}
