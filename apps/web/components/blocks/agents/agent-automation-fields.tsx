"use client";

import { useState } from "react";
import { Check, ChevronDown, GitBranch } from "lucide-react";

import { FormFieldHelp } from "@/components/custom/form-field-ext";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliModel, CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import {
  buildComposerJsonFromPromptContent,
  createEmptyThreadComposerDocument,
  type ThreadComposerDocument,
} from "@/lib/slash-commands/composer";
import { useComposerRuntimeOverrides } from "@/lib/threads/hooks/use-composer-runtime-overrides";

export type AgentAutomationWorkspace = "local" | "worktree";

export interface AgentAutomationDraft {
  enabled: boolean;
  promptText: string;
  composerDocument: ThreadComposerDocument;
  cliType?: CliTypeSlug;
  cliModel?: CliModel;
  cliEffort?: string;
  mode?: string;
  workspace?: AgentAutomationWorkspace;
}

export const EMPTY_AGENT_AUTOMATION_DRAFT: AgentAutomationDraft = {
  enabled: false,
  promptText: "",
  composerDocument: createEmptyThreadComposerDocument(),
};

export type ProjectAgentAutomationInput = {
  enabled: boolean;
  prompt?: { displayContent: string; composerDocument?: ThreadComposerDocument };
  cliType?: CliTypeSlug;
  cliModel?: CliModel;
  cliEffort?: string;
  mode?: string;
  workspace?: AgentAutomationWorkspace;
};

export function automationToDraft(automation: ProjectAgentAutomationInput | undefined): AgentAutomationDraft {
  if (!automation) {
    return EMPTY_AGENT_AUTOMATION_DRAFT;
  }
  return {
    enabled: automation.enabled,
    promptText: automation.prompt?.displayContent ?? "",
    composerDocument: automation.prompt?.composerDocument ?? createEmptyThreadComposerDocument(),
    cliType: automation.cliType,
    cliModel: automation.cliModel,
    cliEffort: automation.cliEffort,
    mode: automation.mode,
    workspace: automation.workspace,
  };
}

/** Converts the draft to the mutation arg; null when everything is unset so the field is cleared. */
export function draftToAutomation(draft: AgentAutomationDraft): ProjectAgentAutomationInput | null {
  const promptText = draft.promptText.trim();
  const hasPrompt = promptText.length > 0 || draft.composerDocument.refs.length > 0;
  if (!draft.enabled && !hasPrompt && !draft.cliType && !draft.cliModel && !draft.cliEffort && !draft.mode && !draft.workspace) {
    return null;
  }
  return {
    enabled: draft.enabled,
    prompt: hasPrompt
      ? {
          displayContent: draft.promptText,
          composerDocument: draft.composerDocument.refs.length > 0 ? draft.composerDocument : undefined,
        }
      : undefined,
    cliType: draft.cliType,
    cliModel: draft.cliModel,
    cliEffort: draft.cliEffort,
    mode: draft.mode,
    workspace: draft.workspace,
  };
}

const WORKSPACE_LABELS: Record<AgentAutomationWorkspace, string> = {
  local: "Work locally",
  worktree: "New worktree",
};

const NOOP_SUBMIT = () => {};

/**
 * Assignment-automation section of the project-agent form (OS-1094). The prompt is the
 * real thread composer in config mode: send/attachment affordances hidden, the
 * profile-bound directory selector replaced by a profile-agnostic workspace preference.
 *
 * Changes are emitted as partial patches, not whole-draft replacements: the tiptap editor
 * fires its callbacks from closures that can hold a stale draft, and a stale whole-draft
 * write would clobber the other field.
 */
export function AgentAutomationFields({
  organizationId,
  projectId,
  value,
  onChange,
  disabled,
}: {
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  value: AgentAutomationDraft;
  onChange: (patch: Partial<AgentAutomationDraft>) => void;
  disabled: boolean;
}) {
  // Seeded once on mount — the editor owns the content afterwards.
  const [initialPromptContent] = useState(() =>
    buildComposerJsonFromPromptContent(value.promptText, value.composerDocument.refs)
  );

  const composerDisabled = disabled || !value.enabled;
  const runtimeSelectors = useComposerRuntimeOverrides(value, onChange);

  return (
    <div className="grid gap-4">
      <Label
        htmlFor="agent-automation-enabled"
        className="flex cursor-pointer items-center gap-2"
      >
        <Checkbox
          id="agent-automation-enabled"
          checked={value.enabled}
          disabled={disabled}
          onCheckedChange={(enabled) => onChange({ enabled: enabled === true })}
          className="cursor-pointer"
        />
        Enable automation
        <FormFieldHelp help="Automation only runs when a task is assigned in the web interface. Assignments made via MCP or the CLI never start a thread." />
      </Label>

      <ThreadComposer
        projectId={projectId}
        organizationId={organizationId}
        onSubmit={NOOP_SUBMIT}
        textareaPlaceholder="Prompt to prefill the thread composer. Type / to insert a saved prompt."
        textareaDisabled={composerDisabled}
        textareaClassName="min-h-20"
        containerClassName="p-0"
        contentClassName="max-w-none"
        initialInput={value.promptText}
        initialComposerContent={initialPromptContent}
        onInputChange={(promptText) => onChange({ promptText })}
        onComposerDocumentChange={(composerDocument) => onChange({ composerDocument })}
        hideAttachmentTools
        hideSubmit
        selectorsProps={{
          hideWorkingDirectory: true,
          profiles: [],
          profileId: "",
          pathId: "",
          disabled: composerDisabled,
          ...runtimeSelectors,
        }}
        extraSelectorTools={
          <WorkspacePreferenceSelector
            value={value.workspace ?? "local"}
            disabled={composerDisabled}
            onChange={(workspace) => onChange({ workspace })}
          />
        }
      />
    </div>
  );
}

function WorkspacePreferenceSelector({
  value,
  disabled,
  onChange,
}: {
  value: AgentAutomationWorkspace;
  disabled: boolean;
  onChange: (value: AgentAutomationWorkspace) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="min-w-0 max-w-40 cursor-pointer gap-1.5 px-2"
          aria-label={`Workspace: ${WORKSPACE_LABELS[value]}`}
          title={`Workspace: ${WORKSPACE_LABELS[value]}`}
        >
          <GitBranch className={value === "worktree" ? "size-3.5 shrink-0 text-info" : "size-3.5 shrink-0 opacity-70"} />
          <span className="min-w-0 truncate">{WORKSPACE_LABELS[value]}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(Object.keys(WORKSPACE_LABELS) as AgentAutomationWorkspace[]).map((workspace) => (
          <DropdownMenuItem key={workspace} className="cursor-pointer gap-2" onSelect={() => onChange(workspace)}>
            <span className="min-w-0 flex-1 truncate">{WORKSPACE_LABELS[workspace]}</span>
            {workspace === value ? <Check className="size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
