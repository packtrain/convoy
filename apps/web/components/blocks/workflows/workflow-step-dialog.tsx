"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ThreadAgentSelectorAgent } from "@/components/blocks/thread/thread-agent-selector";
import type { LaneDefinition, StepAction, StepOverrides, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import { MAX_WORKFLOW_BASH_SCRIPT_LENGTH } from "@/convex/workflows/lib/invariants";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/cli-runtime-ui/registry";
import { createEmptyThreadComposerDocument } from "@/lib/slash-commands/composer";
import { loadRememberedNewThreadCliSelection } from "@/lib/threads/remembered-new-thread-cli-models";
import { reconcileStepOverrides, type StepInput } from "@/lib/workflows/draft";
import type { PromptDraft, StepComposerContext } from "./workflow-step-prompt-composer";

export type { StepComposerContext } from "./workflow-step-prompt-composer";

// Loaded on demand: the composer drags the tiptap editor with it, which the
// Wait/Bash dialog and read-only grids never need.
const WorkflowStepPromptComposer = dynamic(() =>
  import("./workflow-step-prompt-composer").then((module) => module.WorkflowStepPromptComposer)
);

const DEFAULT_BASH_TIMEOUT_MINUTES = 10;

type BashReportOutput = Extract<StepAction, { type: "bash" }>["reportOutput"];

/**
 * Config for one grid Step. The Step type is fixed by how the dialog opened
 * (`createType` when creating; the step's own type when editing) — editing
 * never changes a Step's type.
 */
export function WorkflowStepDialog({
  step,
  createType = "bash",
  composer,
  projectAgents,
  lane,
  seedOverrides,
  onOpenChange,
  onSubmit,
  onDelete,
}: {
  /** null = creating a new step of `createType`. */
  step: WorkflowStep | null;
  createType?: "bash" | "prompt";
  /** Required for the Prompt form; without it the dialog cannot edit Prompt steps. */
  composer?: StepComposerContext;
  /** Offered as a Parallel-Lane step's Project-agent override. */
  projectAgents?: ThreadAgentSelectorAgent[];
  /** The step's Lane; its type scopes the Prompt form's runtime overrides
   * (workflow-data-schema.md → Lane and override rules). */
  lane?: LaneDefinition;
  /** The Lane's last Prompt overrides; a new Parallel-Lane Prompt starts on
   * their runtime, else the remembered new-thread selection (OS-1892). */
  seedOverrides?: StepOverrides;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: StepInput) => void;
  onDelete?: () => void;
}) {
  // Mode comes from the step, never a negation: a Prompt step must not fall
  // through to the Wait form and get its composer content overwritten.
  const mode = step === null ? createType : step.action.type;
  const bash = step?.action.type === "bash" ? step.action : null;
  const promptAction = step?.action.type === "prompt" ? step.action : null;
  const [name, setName] = useState(step?.name ?? "");
  const [script, setScript] = useState(bash?.script ?? "");
  const [timeoutMinutes, setTimeoutMinutes] = useState(bash ? String(bash.timeoutMs / 60_000) : "");
  const [reportOutput, setReportOutput] = useState<BashReportOutput>(bash?.reportOutput ?? "on_failure");
  const [prompt, setPrompt] = useState<PromptDraft>(() => ({
    text: promptAction?.content.displayContent ?? "",
    document: promptAction?.content.composerDocument ?? createEmptyThreadComposerDocument(),
    projectAgentId: promptAction?.overrides?.projectAgentId,
    mode: promptAction?.overrides?.mode,
    // A new Parallel-Lane Prompt starts its own thread: it opens on the Lane's
    // last-used runtime, else the remembered one like any new-thread composer.
    ...(step === null && lane?.type === "parallel"
      ? seedOverrides?.cliType
        ? { cliType: seedOverrides.cliType, cliModel: seedOverrides.cliModel, cliEffort: seedOverrides.cliEffort }
        : rememberedRuntime()
      : {
          cliType: promptAction?.overrides?.cliType,
          cliModel: promptAction?.overrides?.cliModel,
          cliEffort: promptAction?.overrides?.cliEffort,
        }),
  }));

  if (mode === "prompt" && !composer) {
    return null;
  }
  const isBash = mode === "bash";
  const isPrompt = mode === "prompt";
  // A parallel lane's one-shot thread has no agent to report to (workflow-data-schema.md
  // → Save and version cut); Save normalizes the same way, the lock just shows it.
  const parallelBash = isBash && lane?.type === "parallel";
  const effectiveReportOutput: BashReportOutput = parallelBash ? "stop_on_failure" : reportOutput;
  const canSubmit = isPrompt
    ? prompt.text.trim().length > 0 || prompt.document.refs.length > 0
    : !isBash || script.trim().length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({ name: name.trim() || undefined, action: buildAction() });
  }

  function buildAction(): StepAction {
    if (isPrompt) {
      // The form edits every override field; reconcile applies the Lane
      // override rule to the result.
      const overrides = reconcileStepOverrides(
        {
          projectAgentId: prompt.projectAgentId,
          cliType: prompt.cliType,
          cliModel: prompt.cliModel,
          cliEffort: prompt.cliEffort,
          mode: prompt.mode,
        },
        lane,
        prompt.cliType ?? DEFAULT_FALLBACK_CLI_TYPE
      );
      return {
        type: "prompt",
        content: {
          // The prompt round-trips as typed; the trim above only gates emptiness.
          displayContent: prompt.text,
          composerDocument: prompt.document.refs.length > 0 ? prompt.document : undefined,
        },
        overrides,
      };
    }
    if (!isBash) {
      return { type: "wait" };
    }
    const minutes = Number(timeoutMinutes);
    return {
      type: "bash",
      // The script round-trips as typed; the trim above only gates emptiness.
      script,
      // Converted before rounding so fractional minutes survive; an empty
      // or non-positive timeout falls back to the 10-minute default.
      timeoutMs:
        Number.isFinite(minutes) && minutes > 0
          ? Math.round(minutes * 60_000)
          : DEFAULT_BASH_TIMEOUT_MINUTES * 60_000,
      reportOutput: effectiveReportOutput,
    };
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={isPrompt ? "sm:max-w-xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{step ? "Edit step" : isPrompt ? "Add prompt step" : "Add Bash step"}</DialogTitle>
          <DialogDescription>
            {isPrompt
              ? "Prompt sends a message to the lane's agent."
              : isBash
                ? "Bash runs a script on the run's machine."
                : "Wait blocks the lane until you resume it."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {/* Prompt steps have no name — the card renders the prompt text. */}
          {isPrompt ? null : (
            <div className="space-y-2">
              <Label htmlFor="workflow-step-name">Name</Label>
              <Input
                id="workflow-step-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={isBash ? "Optional" : "Wait for human"}
              />
            </div>
          )}

          {isPrompt && composer ? (
            <WorkflowStepPromptComposer
              composer={composer}
              projectAgents={projectAgents}
              lane={lane}
              value={prompt}
              onChange={setPrompt}
            />
          ) : null}

          {isBash ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="workflow-step-script">Script</Label>
                <Textarea
                  id="workflow-step-script"
                  value={script}
                  onChange={(event) => setScript(event.target.value)}
                  rows={6}
                  maxLength={MAX_WORKFLOW_BASH_SCRIPT_LENGTH}
                  className="font-mono text-xs"
                  placeholder="pnpm lint && pnpm test"
                />
              </div>
              <div className="flex gap-4">
                <div className="w-32 shrink-0 space-y-2">
                  <Label htmlFor="workflow-step-timeout">Timeout (minutes)</Label>
                  {/* Loose native constraints: fractional minutes are legal and the
                      submit handler defaults anything non-positive. */}
                  <Input
                    id="workflow-step-timeout"
                    type="number"
                    step="any"
                    value={timeoutMinutes}
                    onChange={(event) => setTimeoutMinutes(event.target.value)}
                    placeholder={String(DEFAULT_BASH_TIMEOUT_MINUTES)}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="workflow-step-report">Result handling</Label>
                  <Select value={effectiveReportOutput} onValueChange={(value) => setReportOutput(value as BashReportOutput)} disabled={parallelBash}>
                    <SelectTrigger id="workflow-step-report" className="w-full cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Always report to the agent</SelectItem>
                      <SelectItem value="on_failure">Report on failures</SelectItem>
                      <SelectItem value="stop_on_failure">Stop on failure</SelectItem>
                    </SelectContent>
                  </Select>
                  {parallelBash ? (
                    <p className="text-xs text-muted-foreground">A parallel lane runs scripts in their own thread, with no agent to report to.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <DialogFooter>
            {step && onDelete ? (
              <Button type="button" variant="destructive" className="mr-auto cursor-pointer" onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!canSubmit}>
              {step ? "Save step" : "Add step"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function rememberedRuntime(): Pick<PromptDraft, "cliType" | "cliModel" | "cliEffort"> {
  const remembered = loadRememberedNewThreadCliSelection();
  const cliType = remembered.lastCliType;
  return cliType
    ? { cliType, cliModel: remembered.modelsByCliType[cliType], cliEffort: remembered.effortsByCliType[cliType] }
    : {};
}
