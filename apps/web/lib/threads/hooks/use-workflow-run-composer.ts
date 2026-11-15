"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { firstPromptStepOf } from "@/convex/lib/contracts/workflowDefinition";
import type { ThreadComposerAttachedTask, ThreadComposerSubmitMessage } from "@/components/blocks/thread/thread-composer";
import { getDefaultCliEffort, getDefaultCliModel, getDefaultMode } from "@/lib/cli-runtime-ui/registry";
import { appRoute, useNavigation } from "@/lib/navigation";
import { buildComposerJsonFromPromptContent } from "@/lib/slash-commands/composer";
import {
  resolveThreadTarget,
  withTaskBranchFallback,
  type BaseRefPathEntry,
  type BaseRefSelection,
} from "@/lib/threads/base-ref-selection";
import type { ThreadComposerDraft, ThreadDraftPatch } from "@/lib/threads/draft-storage";

/** What the composer's workflow pill holds: enough for the trigger label + the start call. */
export interface ComposerWorkflowSelection {
  _id: Id<"workflows">;
  name: string;
  /** Tints the trigger's workflow glyph (OS-1875). */
  color?: string;
}

/** The worktree preselect a `runInNewWorktree` workflow seeds; branch resolves at submit. */
const SEEDED_BASE_REF = { type: "branch", startFromOrigin: false } as const;

function isSeededBaseRef(selection: BaseRefSelection | undefined): boolean {
  return (
    selection?.type === "branch" &&
    selection.branch === undefined &&
    selection.baseRef === undefined &&
    !selection.startFromOrigin
  );
}

interface UseWorkflowRunComposerOptions {
  sourceThreadId?: Id<"cliThreads">;
  expectedContainerId?: Id<"cliThreads"> | null;
  onStarted?: (containerId: Id<"cliThreads">, runId: Id<"workflowRuns">) => void | Promise<void>;
  organizationSlug: string;
  projectAlias: string;
  profiles: Array<{ _id: Id<"cliProfiles">; paths: BaseRefPathEntry[] }>;
  draftState: { profileId: string; pathId: string; baseRef: BaseRefSelection | undefined };
  draft: ThreadComposerDraft | undefined;
  setDraft: (patch: ThreadDraftPatch) => void;
  /** Fixed attached task for task-locked composers; defaults to the message's own attached task. */
  attachedTask?: ThreadComposerAttachedTask | null;
}

/**
 * Workflow start via the thread composer (docs/specs/workflows.md → Start).
 * Selecting a workflow seeds the draft with its first prompt and the first
 * lane's runtime (model/mode display only — the run reads the pinned version);
 * submit then starts the run instead of creating a thread and navigates to
 * the run's container thread. Failed starts throw so the composer keeps the
 * user's input.
 */
export function useWorkflowRunComposer({
  organizationSlug,
  projectAlias,
  profiles,
  draftState,
  draft,
  setDraft,
  attachedTask,
  sourceThreadId,
  expectedContainerId,
  onStarted,
}: UseWorkflowRunComposerOptions) {
  const navigation = useNavigation();
  const startRun = useMutation(api.workflows.runs.core.start);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ComposerWorkflowSelection | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const startInFlightRef = useRef(false);
  const workflow = useQuery(api.workflows.core.get, selectedWorkflow ? { workflowId: selectedWorkflow._id } : "skip");
  const isWorkflowLoading = selectedWorkflow !== null && workflow === undefined;

  // One seed per selection. The seeded text and the pre-seed worktree
  // selection are remembered so a deselect reverts exactly what the seed
  // injected and nothing the user changed (same idea as the agent
  // automation seed flow).
  const seededWorkflowIdRef = useRef<Id<"workflows"> | null>(null);
  const seededTextRef = useRef<string | null>(null);
  const preSeedBaseRefRef = useRef<{ previous: BaseRefSelection | undefined } | null>(null);

  useEffect(() => {
    if (!selectedWorkflow || !workflow || workflow._id !== selectedWorkflow._id) {
      return;
    }
    if (seededWorkflowIdRef.current === workflow._id) {
      return;
    }
    seededWorkflowIdRef.current = workflow._id;

    const definition = workflow.draftDefinition;
    const promptStep = firstPromptStepOf(definition)?.action;
    const currentText = draft?.text ?? "";
    // Text the user typed before selecting is theirs — only an empty composer
    // or a previous workflow's untouched prefill is replaced.
    const seedText = currentText === "" || currentText === seededTextRef.current;
    const text = promptStep?.content.displayContent ?? "";
    if (seedText) {
      seededTextRef.current = text;
    }
    if (definition.runInNewWorktree && !preSeedBaseRefRef.current) {
      preSeedBaseRefRef.current = { previous: draft?.baseRef };
    }
    const defaults = definition.lanes[0]?.defaults;
    setDraft({
      ...(seedText
        ? {
            text,
            composerContent: buildComposerJsonFromPromptContent(text, promptStep?.content.composerDocument?.refs ?? []),
            seedCount: (draft?.seedCount ?? 0) + 1,
          }
        : {}),
      ...(defaults
        ? {
            cliType: defaults.cliType,
            cliModel: defaults.cliModel ?? getDefaultCliModel(defaults.cliType),
            cliEffort: defaults.cliEffort ?? getDefaultCliEffort(defaults.cliType),
            mode: promptStep?.overrides?.mode ?? defaults.mode ?? getDefaultMode(defaults.cliType),
          }
        : {}),
      // Same preselection the spec asks of `runInNewWorktree` workflows: a
      // fresh worktree whose branch name resolves at submit.
      ...(definition.runInNewWorktree ? { baseRef: SEEDED_BASE_REF } : {}),
    });
  }, [draft?.baseRef, draft?.seedCount, draft?.text, selectedWorkflow, setDraft, workflow]);

  const selectWorkflow = useCallback(
    (next: ComposerWorkflowSelection | null) => {
      setSelectedWorkflow(next);
      if (next === null) {
        seededWorkflowIdRef.current = null;
        const patch: ThreadDraftPatch = {};
        // Only untouched seeds are reverted — edits are the user's.
        if (seededTextRef.current !== null && draft?.text === seededTextRef.current) {
          patch.text = "";
          patch.composerContent = undefined;
          patch.seedCount = (draft?.seedCount ?? 0) + 1;
        }
        if (preSeedBaseRefRef.current && isSeededBaseRef(draft?.baseRef)) {
          patch.baseRef = preSeedBaseRefRef.current.previous;
        }
        if (Object.keys(patch).length > 0) {
          setDraft(patch);
        }
        seededTextRef.current = null;
        preSeedBaseRefRef.current = null;
      }
    },
    [draft?.baseRef, draft?.seedCount, draft?.text, setDraft]
  );

  /**
   * Starts the run when a workflow is selected; returns false to fall through
   * to thread creation. Anything that prevents the start throws (after a
   * toast) so `PromptInput` keeps the composer content for a retry.
   */
  const maybeStartRun = useCallback(
    async (message: ThreadComposerSubmitMessage): Promise<boolean> => {
      if (!selectedWorkflow) {
        return false;
      }
      const fail = (userMessage: string): Error => {
        toast.error(userMessage);
        return new Error(userMessage);
      };
      if (message.files.length > 0) {
        throw fail("Attachments can't start a workflow run — remove them or deselect the workflow.");
      }
      // Runs have no Attached pull request yet (docs/specs/github-integration.md → Attached pull requests).
      if (message.pullRequestUrl) {
        throw fail("A pull request can't start a workflow run yet. Remove it or deselect the workflow.");
      }
      if (!workflow) {
        throw fail("The workflow is still loading — try again in a moment.");
      }
      if (startInFlightRef.current) {
        throw new Error("A workflow run start is already in flight");
      }
      const selectedProfile = profiles.find(
        (profile) => profile._id === draftState.profileId && profile.paths.some((path) => path.id === draftState.pathId)
      );
      if (!selectedProfile) {
        throw fail("Pick a machine and working directory before starting the workflow.");
      }

      startInFlightRef.current = true;
      setIsStarting(true);
      try {
        const task = attachedTask ?? message.attachedTask ?? null;
        const text = message.text.trim();
        // The derived-branch fallback seeds from the prompt (per the spec),
        // suffixed so repeat runs of one workflow don't collide on the name.
        const promptFirstLine = text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? workflow.name;
        const target = resolveThreadTarget({
          selection: withTaskBranchFallback(draftState.baseRef, task),
          pathId: draftState.pathId,
          paths: selectedProfile.paths,
          messageSeed: `${promptFirstLine} ${Date.now().toString(36).slice(-4)}`,
        });
        const definitionPrompt = firstPromptStepOf(workflow.draftDefinition)?.action.content.displayContent;
        // No prompt step to override → typed text becomes the run's Kickoff step.
        const sendsOverride = definitionPrompt === undefined ? text !== "" : text !== definitionPrompt.trim();
        const { containerThreadId, runId } = await startRun({
          workflowId: workflow._id,
          ...(sourceThreadId ? { sourceThreadId, expectedContainerId } : {}),
          profileId: selectedProfile._id,
          pathId: target.pathId,
          worktree: target.worktree,
          taskId: task?._id,
          firstPromptOverride: sendsOverride
            ? {
                displayContent: text,
                composerDocument:
                  message.composerDocument && message.composerDocument.refs.length > 0
                    ? message.composerDocument
                    : undefined,
              }
            : undefined,
        });
        if (onStarted) {
          await onStarted(containerThreadId, runId);
        } else {
          navigation.push(appRoute.projectThreadDetail(organizationSlug, projectAlias, containerThreadId));
        }
        setSelectedWorkflow(null);
        seededWorkflowIdRef.current = null;
        seededTextRef.current = null;
        preSeedBaseRefRef.current = null;
        setDraft({ text: "", composerContent: undefined, seedCount: (draft?.seedCount ?? 0) + 1 });
      } catch (error) {
        toast.error(error instanceof ConvexError ? String(error.data) : "Failed to start the workflow");
        throw error;
      } finally {
        startInFlightRef.current = false;
        setIsStarting(false);
      }
      return true;
    },
    [
      attachedTask,
      sourceThreadId,
      expectedContainerId,
      onStarted,
      draft?.seedCount,
      draftState.baseRef,
      draftState.pathId,
      draftState.profileId,
      navigation,
      organizationSlug,
      projectAlias,
      profiles,
      selectedWorkflow,
      setDraft,
      startRun,
      workflow,
    ]
  );

  return { selectedWorkflow, selectWorkflow, isStarting, isWorkflowLoading, maybeStartRun };
}
